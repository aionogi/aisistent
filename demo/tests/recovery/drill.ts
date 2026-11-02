import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";
import pg from "pg";
import { APP_LOGIN_ROLE, connectionOptions, RUNTIME_ROLE } from "../../lib/db/config.ts";
import { ForbiddenError, withOrganization, withUser } from "../../lib/db/context.ts";
import { ensureAppLogin, migrate } from "../../lib/db/migrator.ts";
import { createOrganization, provisionUser, saveWorkspace } from "../../lib/db/repositories.ts";
import { startTestDatabase, type TestDatabase } from "../db/harness.ts";
import { checkClientTools, executable } from "./postgres-tools.ts";
import { dataSnapshot, describeChanges, granteesOf, securitySnapshot } from "./snapshots.ts";

const execute = promisify(execFile);
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

/** A check failed or a step could not run; the message never holds a password or table content. */
export class DrillError extends Error {}

export type DrillOptions = {
  /** Owner connection to the live database; read only, never changed. */
  sourceUrl: string;
  /** The provider's CA certificate (PEM). Required unless the database is on this computer. */
  caCert?: string;
  migrationsDir: string;
  log?: (line: string) => void;
  /** Leave the restored copy running, for example to sign in to it. */
  keepTarget?: boolean;
  /** Tests only: changes to the live database after the snapshot. */
  afterDump?: () => Promise<void>;
};

export type DrillReport = {
  server: string;
  clientTools: string[];
  snapshotAt: string;
  archives: { name: string; bytes: number; sha256: string }[];
  tables: { table: string; count: number }[];
  grantees: string[];
  createdRoles: string[];
  warnings: string[];
  organizations: number;
  memberships: number;
  isolationChecks: number;
  removedSessions: number;
  removedInvitations: number;
  postSnapshot: { action: string; count: number }[];
  timings: { dumpMs: number; restoreMs: number; totalMs: number };
  artifactDir: string;
};

/** Changes after the snapshot that a restore would undo, so they must be reapplied before reopening traffic. */
export const RECONCILE_ACTIONS = ["invitation.accept", "invitation.revoke", "member.leave", "member.remove", "member.role_change", "organization.delete"];

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const RLS_TABLES = ["users", "organizations", "memberships", "assistant_configs", "knowledge_entries", "audit_events", "invitations"];
const MAX_CROSS_CHECKS = 200;

/** libpq settings for the client tools, from a URL; inherited PG* variables could otherwise redirect them. */
function toolEnv(url: URL, caFile?: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^PG/i.test(key)) delete env[key];
  return {
    ...env,
    PGHOST: url.hostname.replace(/^\[|\]$/g, ""),
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)) || "postgres",
    PGCONNECT_TIMEOUT: "15",
    PGAPPNAME: "aisistent-restore-drill",
    ...(caFile ? { PGSSLMODE: "verify-full", PGSSLROOTCERT: caFile } : { PGSSLMODE: "disable" }),
  };
}

async function runTool(tool: "pg_dump" | "pg_restore", env: NodeJS.ProcessEnv, args: string[]): Promise<string> {
  try {
    const { stderr } = await execute(executable(tool), ["--no-password", ...args], { env, timeout: 600_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    return stderr.trim();
  } catch (error) {
    const detail = String((error as { stderr?: string }).stderr || (error as Error).message).split(env.PGPASSWORD || "\u0000").join("***").trim();
    throw new DrillError(`${tool} failed: ${detail}`);
  }
}

async function expectRejects(work: Promise<unknown>, pattern: RegExp, check: string): Promise<void> {
  try {
    await work;
  } catch (error) {
    if (pattern.test((error as Error).message)) return;
    throw new DrillError(`${check}: unexpected error ${(error as Error).message}`);
  }
  throw new DrillError(`${check}: the restricted login was allowed to do it.`);
}

async function expectForbidden(work: Promise<unknown>, check: string): Promise<void> {
  try {
    await work;
  } catch (error) {
    if (error instanceof ForbiddenError) return;
    throw error;
  }
  throw new DrillError(`${check}: access was granted.`);
}

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** The drill's result for the person who ran it, then one line of evidence with no secrets or content. */
export function formatDrillReport(report: DrillReport, keptTarget: boolean): string {
  const providerRoles = report.grantees.filter((name) => name !== RUNTIME_ROLE);
  const reconcile = report.postSnapshot.filter(({ action }) => RECONCILE_ACTIONS.includes(action));
  return `
Restore drill passed.
  Live database: PostgreSQL ${report.server}, snapshot ${report.snapshotAt}
  Copy: ${report.archives.map(({ name, bytes, sha256 }) => `${name} ${kb(bytes)} (sha256 ${sha256.slice(0, 12)}…)`).join(", ")}
  Restored and identical: ${report.tables.map(({ table, count }) => `${table.replace(/^app\./, "")} ${count}`).join(", ")}
  Access rules identical; migrations match this checkout; the app login stays restricted.
  Firms kept apart: ${report.organizations} firms, ${report.memberships} memberships, ${report.isolationChecks} access checks.
  Removed from the copy before use: ${report.removedSessions} sessions, ${report.removedInvitations} invitations. A new save works.${providerRoles.length ? `
  Note: roles besides ${RUNTIME_ROLE} hold privileges on the app's objects: ${providerRoles.join(", ")}. Tell your developer.` : ""}${report.warnings.length ? `
  Tool warnings: ${report.warnings.join(" | ")}` : ""}
  After the snapshot: ${report.postSnapshot.length ? report.postSnapshot.map(({ action, count }) => `${action} ${count}`).join(", ") : "no changes"}.${reconcile.length ? `
  A real restore would undo these: reapply them before reopening the site (runbook, step 6).` : ""}
  Took: copy ${seconds(report.timings.dumpMs)}, restore ${seconds(report.timings.restoreMs)}, all checks ${seconds(report.timings.totalMs)}.
  The copy's files are deleted.${keptTarget ? "" : " So is its temporary database."}

For the developer (no secrets, no content):
${JSON.stringify({ ...report, artifactDir: undefined })}
`;
}

/**
 * Takes a consistent logical copy of the application's data from the live
 * database, restores it into a new PostgreSQL 17 database on this computer
 * with fresh credentials, and checks it: identical data and access rules,
 * this release's migrations, a restricted login, row-level security, firms
 * kept apart, restored sessions and invitation links removed, and a new save.
 * Then it lists changes made on the live database after the snapshot. The
 * archives are deleted at the end, even when a check fails.
 */
export async function runRestoreDrill(options: DrillOptions): Promise<{ report: DrillReport; target?: TestDatabase }> {
  const started = Date.now();
  const log = options.log ?? (() => {});
  const sourceUrl = new URL(options.sourceUrl);
  if (!LOCAL_HOSTS.has(sourceUrl.hostname) && !options.caCert) throw new DrillError("A database on another computer needs its CA certificate, so the copy travels over a verified connection.");
  const clientTools = await checkClientTools();
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "aisistent-drill-"));
  const caFile = options.caCert ? path.join(artifactDir, "ca.crt") : undefined;
  if (caFile) await writeFile(caFile, `${options.caCert!.replace(/\\n/g, "\n").trim()}\n`);
  const sourceOptions = () => ({ ...connectionOptions(options.sourceUrl, options.caCert ? { DATABASE_CA_CERT: options.caCert } : {}), application_name: "aisistent-restore-drill", connectionTimeoutMillis: 15_000 });
  const warnings: string[] = [];
  let target: TestDatabase | undefined;

  try {
    log("Taking a consistent copy of the live database (read only)…");
    const source = new pg.Client(sourceOptions());
    await source.connect();
    const archives = [path.join(artifactDir, "app.dump"), path.join(artifactDir, "migrations.dump")];
    let info: { snapshot: string; at: Date; version: string; audit_id: string | null };
    let data: Awaited<ReturnType<typeof dataSnapshot>>;
    let security: Awaited<ReturnType<typeof securitySnapshot>>;
    const dumpStarted = Date.now();
    try {
      // One exported snapshot: the digests and both archives describe the same moment.
      await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY");
      info = (await source.query("SELECT pg_export_snapshot() AS snapshot, now() AS at, current_setting('server_version') AS version, (SELECT max(id)::text FROM app.audit_events) AS audit_id")).rows[0];
      data = await dataSnapshot(source);
      security = await securitySnapshot(source);
      const env = toolEnv(sourceUrl, caFile);
      // pg_dump selects either schemas or tables, so the migration history is a second archive.
      warnings.push(await runTool("pg_dump", env, ["--format=custom", `--snapshot=${info.snapshot}`, "--schema=app", `--file=${archives[0]}`]));
      warnings.push(await runTool("pg_dump", env, ["--format=custom", `--snapshot=${info.snapshot}`, "--table=public.schema_migrations", `--file=${archives[1]}`]));
      await source.query("COMMIT");
    } finally {
      await source.end().catch(() => {});
    }
    const dumpMs = Date.now() - dumpStarted;
    const archiveReport = await Promise.all(archives.map(async (file) => {
      const bytes = await readFile(file);
      return { name: path.basename(file), bytes: bytes.length, sha256: digest(bytes) };
    }));
    await options.afterDump?.();

    log("Restoring into a new temporary database on this computer…");
    const appPassword = randomBytes(32).toString("base64url");
    target = await startTestDatabase({ migrate: false, appPassword });
    await target.admin.query(`CREATE ROLE ${RUNTIME_ROLE} NOLOGIN`);
    await ensureAppLogin(target.admin, appPassword);
    // The provider may grant its own roles privileges; they must exist for the privileges to be restored as they are.
    const grantees = granteesOf(security);
    const createdRoles: string[] = [];
    for (const name of grantees) {
      if ((await target.admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [name])).rowCount) continue;
      await target.admin.query(`CREATE ROLE ${target.admin.escapeIdentifier(name)} NOLOGIN`);
      createdRoles.push(name);
    }
    const restoreStarted = Date.now();
    const targetUrl = new URL(target.adminUrl);
    for (const file of archives) {
      warnings.push(await runTool("pg_restore", toolEnv(targetUrl), ["--no-owner", "--exit-on-error", "--single-transaction", `--dbname=${decodeURIComponent(targetUrl.pathname.slice(1))}`, file]));
    }
    const restoreMs = Date.now() - restoreStarted;
    for (const [index, file] of archives.entries()) {
      if (digest(await readFile(file)) !== archiveReport[index].sha256) throw new DrillError(`${path.basename(file)} changed during the restore.`);
    }

    log("Checking the restored copy…");
    const restoredData = await dataSnapshot(target.admin);
    const changedTables = data.filter((table, index) => !isDeepStrictEqual(table, restoredData[index])).map(({ table }) => table);
    if (changedTables.length || restoredData.length !== data.length) throw new DrillError(`Restored data differs from the snapshot: ${changedTables.join(", ") || "different tables"}.`);
    const changedRules = describeChanges(await securitySnapshot(target.admin), security);
    if (changedRules.length) throw new DrillError(`Restored access rules differ from the live database:\n  ${changedRules.join("\n  ")}`);

    const files = (await readdir(options.migrationsDir)).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
    const expected = await Promise.all(files.map(async (name) => ({ version: name.replace(/\.sql$/, ""), checksum: digest(await readFile(path.join(options.migrationsDir, name))) })));
    const restored = (await target.admin.query("SELECT version, checksum FROM public.schema_migrations ORDER BY version")).rows;
    if (!isDeepStrictEqual(restored, expected)) {
      throw new DrillError(`The live database's migrations (${restored.length}) do not match this checkout's (${expected.length}). Run the drill from the release that is deployed.`);
    }
    if ((await migrate(target.admin, options.migrationsDir)).applied.length) throw new DrillError("The restored copy needed migrations.");

    const owner = decodeURIComponent(targetUrl.username);
    const login = (await target.appPool.query(`SELECT current_user AS name, r.rolsuper, r.rolbypassrls, r.rolcreaterole,
      pg_has_role(current_user, $1, 'MEMBER') AS owner_member, pg_has_role(current_user, $2, 'MEMBER') AS runtime_member
      FROM pg_roles r WHERE r.rolname = current_user`, [owner, RUNTIME_ROLE])).rows[0];
    if (!isDeepStrictEqual(login, { name: APP_LOGIN_ROLE, rolsuper: false, rolbypassrls: false, rolcreaterole: false, owner_member: false, runtime_member: true })) {
      throw new DrillError("The restored application login has more rights than the restricted aisistent_app role.");
    }
    await expectRejects(target.appPool.query(`SET ROLE ${target.admin.escapeIdentifier(owner)}`), /permission denied|must be member/, "Taking the owner role");
    await expectRejects(target.appPool.query("ALTER TABLE app.knowledge_entries DISABLE ROW LEVEL SECURITY"), /must be owner/, "Turning off row-level security");
    await expectRejects(target.appPool.query("SELECT 1 FROM app.auth_sessions"), /permission denied/, "Reading sessions directly");
    await expectRejects(target.appPool.query("SELECT 1 FROM app.rate_limit_buckets"), /permission denied/, "Reading request limits directly");
    for (const table of RLS_TABLES) {
      if ((await target.appPool.query(`SELECT 1 FROM app.${table}`)).rowCount) throw new DrillError(`app.${table} returned rows without a signed-in user.`);
    }

    const organizations: string[] = (await target.admin.query("SELECT id FROM app.organizations ORDER BY id")).rows.map((row) => row.id);
    const memberships: { organization_id: string; user_id: string }[] = (await target.admin.query("SELECT organization_id, user_id FROM app.memberships ORDER BY organization_id, user_id")).rows;
    const outsider = await provisionUser(target.appPool, { subject: `restore-drill|${randomBytes(8).toString("hex")}`, email: null, displayName: "Restore drill" });
    let isolationChecks = 0;
    for (const membership of memberships) {
      await withOrganization(target.appPool, { userId: membership.user_id, organizationId: membership.organization_id }, async () => true);
      isolationChecks++;
    }
    for (const organizationId of organizations) {
      await expectForbidden(withOrganization(target.appPool, { userId: outsider, organizationId }, async () => true), "A person outside the firm");
      await withUser(target.appPool, outsider, async (client) => {
        await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
        for (const table of ["assistant_configs", "knowledge_entries"]) {
          if ((await client.query(`SELECT 1 FROM app.${table}`)).rowCount) throw new DrillError(`A forged firm context read app.${table}.`);
        }
        await expectRejects(client.query("INSERT INTO app.knowledge_entries (organization_id, question, answer) VALUES ($1, 'drill question', 'drill answer')", [organizationId]), /row-level security/, "Writing into another firm");
      });
      isolationChecks += 3;
    }
    const memberOf = new Map<string, Set<string>>();
    for (const { user_id, organization_id } of memberships) memberOf.set(user_id, (memberOf.get(user_id) ?? new Set()).add(organization_id));
    let cross = 0;
    for (const [userId, own] of memberOf) {
      for (const organizationId of organizations) {
        if (own.has(organizationId) || cross >= MAX_CROSS_CHECKS) continue;
        await expectForbidden(withOrganization(target.appPool, { userId, organizationId }, async () => true), "A member of another firm");
        cross++;
      }
    }
    isolationChecks += cross;

    // Raw restores revive sessions and invitation links revoked after the snapshot.
    await target.admin.query("BEGIN");
    let removedSessions: number;
    let removedInvitations: number;
    try {
      removedSessions = (await target.admin.query("DELETE FROM app.auth_sessions")).rowCount ?? 0;
      removedInvitations = (await target.admin.query("DELETE FROM app.invitations")).rowCount ?? 0;
      await target.admin.query("COMMIT");
    } catch (error) {
      await target.admin.query("ROLLBACK");
      throw error;
    }

    const auditBefore = BigInt((await target.admin.query("SELECT coalesce(max(id), 0)::text AS id FROM app.audit_events")).rows[0].id);
    const checkOrganization = await createOrganization(target.appPool, outsider, "Restore drill check");
    const saved = await withOrganization(target.appPool, { userId: outsider, organizationId: checkOrganization }, (client) => saveWorkspace(client, { expectedRevision: 0, config: { business: { name: "Restore drill check" } }, knowledge: [] }));
    const auditAfter = BigInt((await target.admin.query("SELECT coalesce(max(id), 0)::text AS id FROM app.audit_events")).rows[0].id);
    if (saved.revision !== 1 || auditAfter <= auditBefore) throw new DrillError("A new save on the restored copy did not work.");

    log("Looking for changes on the live database after the snapshot…");
    const live = new pg.Client(sourceOptions());
    await live.connect();
    let postSnapshot: { action: string; count: number }[];
    try {
      postSnapshot = (await live.query("SELECT action, count(*)::int AS count FROM app.audit_events WHERE id > $1 GROUP BY action ORDER BY action", [info.audit_id ?? "0"])).rows;
    } finally {
      await live.end().catch(() => {});
    }

    const report: DrillReport = {
      server: info.version,
      clientTools,
      snapshotAt: new Date(info.at).toISOString(),
      archives: archiveReport,
      tables: data.map(({ table, count }) => ({ table, count })),
      grantees,
      createdRoles,
      warnings: warnings.filter(Boolean),
      organizations: organizations.length,
      memberships: memberships.length,
      isolationChecks,
      removedSessions,
      removedInvitations,
      postSnapshot,
      timings: { dumpMs, restoreMs, totalMs: Date.now() - started },
      artifactDir,
    };
    if (!options.keepTarget) {
      await target.stop();
      target = undefined;
    }
    return { report, target };
  } catch (error) {
    await target?.stop().catch(() => {});
    throw error;
  } finally {
    await rm(artifactDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
