import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { connectionOptions } from "../db/config.ts";
import { encryptBackup, validateRecipient } from "./encryption.ts";
import { makeBackupId, pruneBackups, type BackupManifest } from "./storage.ts";

const execute = promisify(execFile);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const LOCAL = new Set(["127.0.0.1", "localhost", "[::1]"]);
const safeLabel = /^[a-z0-9-]{1,40}$/;
const safeRole = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

export class BackupError extends Error {}
export type BackupOptions = {
  sourceUrl: string;
  caCert?: string;
  outputDirectory: string;
  recipient: string;
  sourceLabel: string;
  retentionDays: number;
  minimumCopies: number;
  toolsDirectory?: string;
  /** Tests only: exercise concurrent source writes or an interrupted run. */
  afterArchive?: (index: number) => Promise<void>;
};

export function postgresTool(name: "pg_dump" | "pg_restore", directory?: string): string {
  if (directory && !path.isAbsolute(directory)) throw new BackupError("PostgreSQL tool directory must be absolute.");
  const file = `${name}${process.platform === "win32" ? ".exe" : ""}`;
  return directory ? path.join(directory, file) : file;
}

export async function checkPostgresTools(directory?: string): Promise<void> {
  for (const name of ["pg_dump", "pg_restore"] as const) {
    try {
      const { stdout } = await execute(postgresTool(name, directory), ["--version"], { timeout: 10_000, windowsHide: true });
      if (!new RegExp(`^${name} \\(PostgreSQL\\) 17\\.`).test(stdout)) throw new Error();
    } catch { throw new BackupError("PostgreSQL 17 client tools are required."); }
  }
}

/** No inherited libpq service/options or unrelated deployment secrets reach the tools. */
export function postgresEnvironment(url: URL, caFile?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  for (const [key, value] of Object.entries(process.env)) {
    if (["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LD_LIBRARY_PATH"].includes(key.toUpperCase())) env[key] = value;
  }
  return { ...env, PGHOST: url.hostname.replace(/^\[|\]$/g, ""), PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGCONNECT_TIMEOUT: "15",
    PGOPTIONS: "-c default_transaction_read_only=on", PGAPPNAME: "aisistent-backup",
    ...(caFile ? { PGSSLMODE: "verify-full", PGSSLROOTCERT: caFile } : { PGSSLMODE: "disable" }) };
}

export function validateSource(urlText: string, caCert?: string): URL {
  let url: URL;
  try { url = new URL(urlText); } catch { throw new BackupError("Backup database configuration is invalid."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.username || !url.pathname.slice(1) || url.search || url.hash) {
    throw new BackupError("Use an explicit PostgreSQL URL without query parameters for backups.");
  }
  if (!LOCAL.has(url.hostname) && !caCert?.trim().startsWith("-----BEGIN CERTIFICATE-----")) {
    throw new BackupError("Remote backups require the database CA certificate.");
  }
  return url;
}

async function outputDirectory(value: string): Promise<string> {
  if (!path.isAbsolute(value)) throw new BackupError("Backup directory must be absolute.");
  const rejectUnsafe = (directory: string) => {
    const relative = path.relative(repository, directory);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)) ||
        /(?:^|[\\/])OneDrive(?:$|[\\/ -])/i.test(directory) || path.dirname(directory) === directory) {
      throw new BackupError("Choose a dedicated backup directory outside the checkout and OneDrive.");
    }
  };
  rejectUnsafe(path.resolve(value));
  await mkdir(value, { recursive: true, mode: 0o700 });
  const stat = await lstat(value);
  if (stat.isSymbolicLink()) throw new BackupError("Backup directory must not be a symbolic link.");
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) throw new BackupError("Backup directory must be private to its worker account.");
  const resolved = await realpath(value);
  rejectUnsafe(resolved);
  return resolved;
}

async function encryptedDump(url: URL, caFile: string | undefined, args: string[], file: string, options: BackupOptions) {
  const controller = new AbortController();
  const child = spawn(postgresTool("pg_dump", options.toolsDirectory), ["--no-password", "--format=custom", ...args], {
    env: postgresEnvironment(url, caFile), stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let warning = false;
  child.stderr.on("data", () => { warning = true; }); // Never retain database messages/content.
  const finished = new Promise<void>((resolve, reject) => {
    child.once("error", () => reject(new BackupError("Database export could not start.")));
    child.once("close", (code) => code === 0 && !warning ? resolve() : reject(new BackupError("Database export failed.")));
  });
  const timer = setTimeout(() => { controller.abort(); child.kill(); }, 10 * 60_000);
  const encrypted = encryptBackup(child.stdout, file, options.recipient, { signal: controller.signal });
  try {
    const [result] = await Promise.all([encrypted, finished]);
    return result;
  } catch {
    controller.abort(); child.kill();
    await Promise.allSettled([encrypted, finished]);
    throw new BackupError("Encrypted database export failed.");
  } finally { clearTimeout(timer); }
}

/** One consistent snapshot, encrypted before any dump byte reaches disk. No scheduler or upload is implicit. */
export async function createBackup(options: BackupOptions): Promise<{ manifest: BackupManifest; directory: string; pruned: number }> {
  if (!safeLabel.test(options.sourceLabel) || !Number.isInteger(options.retentionDays) || options.retentionDays < 1 || options.retentionDays > 3650 ||
      !Number.isInteger(options.minimumCopies) || options.minimumCopies < 1 || options.minimumCopies > 1000) {
    throw new BackupError("Set a safe source label and explicit bounded backup retention.");
  }
  validateRecipient(options.recipient);
  const url = validateSource(options.sourceUrl, options.caCert);
  await checkPostgresTools(options.toolsDirectory);
  const root = await outputDirectory(options.outputDirectory);
  const lockPath = path.join(root, ".aisistent-backup.lock");
  let lock;
  try { lock = await open(lockPath, "wx", 0o600); } catch { throw new BackupError("Backup directory is locked; another run may be active."); }
  const staging = path.join(root, `.pending-${randomUUID()}`);
  let source: pg.Client | undefined;
  try {
    const marker = path.join(root, ".aisistent-backup-store.json");
    try { await writeFile(marker, JSON.stringify({ version: 1, sourceLabel: options.sourceLabel }), { flag: "wx", mode: 0o600 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = JSON.parse(await readFile(marker, "utf8"));
      if ((await lstat(marker)).isSymbolicLink() || existing.version !== 1 || existing.sourceLabel !== options.sourceLabel) {
        throw new BackupError("This backup directory belongs to a different source.");
      }
    }
    await mkdir(staging, { mode: 0o700 });
    const caFile = options.caCert ? path.join(staging, "database-ca.crt") : undefined;
    if (caFile) await writeFile(caFile, options.caCert!.replace(/\\n/g, "\n"), { flag: "wx", mode: 0o600 });
    source = new pg.Client({ ...connectionOptions(options.sourceUrl, options.caCert ? { DATABASE_CA_CERT: options.caCert } : {}), connectionTimeoutMillis: 15_000, application_name: "aisistent-backup" });
    source.on("error", () => {});
    await source.connect();
    await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    const info = (await source.query("SELECT pg_export_snapshot() AS snapshot, now() AS at, current_setting('server_version_num') AS version")).rows[0];
    if (Math.floor(Number(info.version) / 10_000) !== 17) throw new BackupError("Backup source must use PostgreSQL 17.");
    const { rows } = await source.query<{ name: string }>(`SELECT DISTINCT pg_get_userbyid(grantee) AS name FROM (
      SELECT (aclexplode(nspacl)).grantee FROM pg_namespace WHERE nspname = 'app'
      UNION ALL SELECT (aclexplode(c.relacl)).grantee FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app' OR (n.nspname = 'public' AND c.relname = 'schema_migrations')
      UNION ALL SELECT (aclexplode(p.proacl)).grantee FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app'
    ) grants WHERE grantee <> 0 AND grantee <> (SELECT nspowner FROM pg_namespace WHERE nspname = 'app') ORDER BY name`);
    const restoreRoles = [...new Set(["aisistent_runtime", ...rows.map(({ name }) => name)])];
    if (restoreRoles.length > 50 || restoreRoles.some((name) => !safeRole.test(name))) throw new BackupError("Backup has unsupported role names.");
    const files: BackupManifest["files"] = [];
    for (const [index, name] of (["app.dump.age", "migrations.dump.age"] as const).entries()) {
      const filter = index === 0 ? "--schema=app" : "--table=public.schema_migrations";
      const encrypted = await encryptedDump(url, caFile, [`--snapshot=${info.snapshot}`, filter], path.join(staging, name), options);
      const durable = await open(path.join(staging, name), "r+");
      try { await durable.sync(); } finally { await durable.close(); }
      files.push({ name, ...encrypted });
      await options.afterArchive?.(index);
    }
    await source.query("COMMIT");
    await source.end(); source = undefined;
    if (caFile) await rm(caFile);
    const manifest: BackupManifest = { version: 1, id: makeBackupId(), createdAt: new Date(info.at).toISOString(), sourceLabel: options.sourceLabel, restoreRoles, files };
    const manifestFile = await open(path.join(staging, "manifest.json"), "wx", 0o600);
    try { await manifestFile.writeFile(JSON.stringify(manifest)); await manifestFile.sync(); } finally { await manifestFile.close(); }
    const directory = path.join(root, manifest.id);
    await rename(staging, directory);
    const { deleted } = await pruneBackups(root, { retentionDays: options.retentionDays, minimumCopies: options.minimumCopies, sourceLabel: options.sourceLabel });
    return { manifest, directory, pruned: deleted };
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError("Backup did not complete; inspect configuration without printing secrets.");
  } finally {
    if (source) { await source.query("ROLLBACK").catch(() => {}); await source.end().catch(() => {}); }
    // staging is an internally generated direct child of the validated root, never a caller-supplied delete target.
    try { await rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    finally { try { await lock.close(); } finally { await rm(lockPath, { force: true }); } }
  }
}
