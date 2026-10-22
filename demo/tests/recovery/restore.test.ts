import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import pg from "pg";
import type { SessionData } from "@auth0/nextjs-auth0/types";
import { PostgresSessionStore } from "../../lib/auth/session-store.ts";
import { ForbiddenError, withOrganization, withUser } from "../../lib/db/context.ts";
import { ensureAppLogin, migrate } from "../../lib/db/migrator.ts";
import { createOrganization, getAssistantConfig, listKnowledge, provisionUser, recordAudit, saveWorkspace } from "../../lib/db/repositories.ts";
import { acceptInvitation, createInvitation, previewInvitation, removeMember, revokeInvitation, TeamError } from "../../lib/db/team.ts";
import { consumeRateLimit } from "../../lib/operations/store.ts";
import { MIGRATIONS_DIR, startTestDatabase } from "../db/harness.ts";
import { checkClientTools, runDatabaseTool } from "./postgres-tools.ts";

const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const secret = () => randomBytes(32).toString("hex");

async function dataSnapshot(client: pg.Client) {
  const { rows: tables } = await client.query<{ schema: string; name: string }>(
    `SELECT schemaname AS schema, tablename AS name FROM pg_tables
     WHERE schemaname = 'app' OR (schemaname = 'public' AND tablename = 'schema_migrations')
     ORDER BY schemaname, tablename`,
  );
  const snapshot = [];
  for (const { schema, name } of tables) {
    const qualified = `${client.escapeIdentifier(schema)}.${client.escapeIdentifier(name)}`;
    const { rows } = await client.query<{ row: string }>(`SELECT to_jsonb(t)::text AS row FROM ${qualified} t ORDER BY to_jsonb(t)::text COLLATE "C"`);
    snapshot.push({ table: `${schema}.${name}`, count: rows.length, sha256: digest(JSON.stringify(rows)) });
  }
  return snapshot;
}

/** Compare ownership, ACLs, RLS policies, function bodies, constraints and indexes before any repair. */
async function securitySnapshot(client: pg.Client) {
  // pg_restore may replace an explicitly owner-only ACL with NULL (the same default privileges).
  const queries = {
    relations: `SELECT c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity,
      pg_get_userbyid(c.relowner) AS owner,
      CASE WHEN c.relkind IN ('r', 'p', 'v', 'm', 'f') THEN coalesce(c.relacl, acldefault('r', c.relowner))::text
           WHEN c.relkind = 'S' THEN coalesce(c.relacl, acldefault('S', c.relowner))::text
           ELSE c.relacl::text END AS acl
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app' ORDER BY c.relname`,
    schema: `SELECT nspname, pg_get_userbyid(nspowner) AS owner, nspacl::text FROM pg_namespace WHERE nspname = 'app'`,
    policies: `SELECT * FROM pg_policies WHERE schemaname = 'app' ORDER BY tablename, policyname`,
    functions: `SELECT p.oid::regprocedure::text AS signature, pg_get_functiondef(p.oid) AS definition,
      pg_get_userbyid(p.proowner) AS owner, p.proacl::text
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app' ORDER BY signature`,
    constraints: `SELECT c.conrelid::regclass::text AS relation, c.conname, pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'app' ORDER BY relation, c.conname`,
    indexes: `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'app' ORDER BY tablename, indexname`,
  };
  const result: Record<string, unknown[]> = {};
  for (const [key, sql] of Object.entries(queries)) result[key] = (await client.query(sql)).rows;
  return result;
}

test("isolated logical recovery preserves data and tenant controls, then invalidates restored access", { timeout: 180_000 }, async (t) => {
  const started = Date.now();
  const versions = await checkClientTools();
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "aisistent-recovery-"));
  // Only the directory returned by mkdtemp is removed; no caller-supplied cleanup path exists.
  t.after(() => rm(artifactDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const sourcePassword = secret();
  const targetPassword = secret();
  const source = await startTestDatabase({ appPassword: sourcePassword });
  t.after(() => source.stop());
  const target = await startTestDatabase({ migrate: false, appPassword: targetPassword });
  t.after(() => target.stop());
  assert.notEqual(source.adminUrl, target.adminUrl);
  assert.equal((await target.admin.query("SELECT to_regnamespace('app') AS schema")).rows[0].schema, null);
  await target.admin.query("CREATE ROLE aisistent_runtime NOLOGIN");
  await ensureAppLogin(target.admin, targetPassword);

  const user = (name: string) => provisionUser(source.appPool, { subject: `recovery|${name}`, email: `${name}@example.test`, displayName: name });
  const alice = await user("alice");
  const bob = await user("bob");
  const removed = await user("removed");
  const invited = await user("invited");
  const orgA = await createOrganization(source.appPool, alice, "Recovery Alpha");
  const orgB = await createOrganization(source.appPool, bob, "Recovery Beta");
  const contextA = { userId: alice, organizationId: orgA };
  const contextB = { userId: bob, organizationId: orgB };
  for (const [context, name] of [[contextA, "Alpha"], [contextB, "Beta"]] as const) {
    await withOrganization(source.appPool, context, (client) => saveWorkspace(client, {
      expectedRevision: 0, config: { business: { name } },
      knowledge: [{ id: "new", question: "Synthetic question?", answer: `${name} snapshot answer` }],
    }));
  }
  const removedInvite = await withOrganization(source.appPool, contextA, (client) => createInvitation(client, { email: "removed@example.test", role: "member" }));
  await acceptInvitation(source.appPool, removed, removedInvite.token);
  await withOrganization(source.appPool, contextA, (client) => removeMember(client, removed));
  const invitation = await withOrganization(source.appPool, contextA, (client) => createInvitation(client, { email: "invited@example.test", role: "admin" }));
  const oldSecret = secret();
  const oldSessionId = secret();
  const session: SessionData = {
    user: { sub: "recovery|alice", email: "alice@example.test" },
    tokenSet: { accessToken: "synthetic-recovery-token", expiresAt: Math.floor(Date.now() / 1000) + 3600 },
    internal: { sid: "synthetic-recovery-session", createdAt: Math.floor(Date.now() / 1000) },
  };
  const sourceStore = new PostgresSessionStore(source.appPool, oldSecret);
  await sourceStore.set(oldSessionId, session);
  await consumeRateLimit(source.appPool, randomBytes(32), 2, 3600);
  const snapshot = await dataSnapshot(source.admin);
  const security = await securitySnapshot(source.admin);
  const dumpFile = path.join(artifactDir, "synthetic.dump");
  const snapshotTime = new Date().toISOString();
  await runDatabaseTool("pg_dump", source.adminUrl, ["--format=custom", `--file=${dumpFile}`]);
  const archiveHash = digest(await readFile(dumpFile));

  // These revocations happen after the backup: a raw restore would revive both credentials.
  await sourceStore.delete(oldSessionId);
  await withOrganization(source.appPool, contextA, (client) => revokeInvitation(client, invitation.id));
  await withOrganization(source.appPool, contextA, (client) => saveWorkspace(client, {
    expectedRevision: 1, config: { business: { name: "After snapshot" } }, knowledge: [],
  }));
  const restoreStarted = Date.now();
  await runDatabaseTool("pg_restore", target.adminUrl, ["--no-owner", "--exit-on-error", "--single-transaction", dumpFile]);
  const restoreMs = Date.now() - restoreStarted;
  assert.equal(digest(await readFile(dumpFile)), archiveHash);

  await t.test("all table digests, migration checksums and security definitions match the snapshot", async () => {
    assert.deepEqual(await dataSnapshot(target.admin), snapshot);
    assert.deepEqual(await securitySnapshot(target.admin), security);
    const files = (await readdir(MIGRATIONS_DIR)).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
    const expected = await Promise.all(files.map(async (name) => ({ version: name.replace(/\.sql$/, ""), checksum: digest(await readFile(path.join(MIGRATIONS_DIR, name))) })));
    assert.deepEqual((await target.admin.query("SELECT version, checksum FROM public.schema_migrations ORDER BY version")).rows, expected);
    // Only after the comparison: an intact restore must require no migration repair.
    assert.deepEqual((await migrate(target.admin, MIGRATIONS_DIR)).applied, []);
  });

  await t.test("fresh application credentials retain restricted roles and cannot take ownership", async () => {
    const wrongUrl = new URL(target.appUrl);
    wrongUrl.password = sourcePassword;
    const wrong = new pg.Client({ connectionString: wrongUrl.toString() });
    try { await assert.rejects(wrong.connect(), /password authentication failed/); } finally { await wrong.end(); }
    const { rows } = await target.appPool.query(`SELECT current_user AS name, r.rolsuper, r.rolbypassrls, r.rolcreaterole,
      pg_has_role(current_user, 'render_owner', 'MEMBER') AS owner_member,
      pg_has_role(current_user, 'aisistent_runtime', 'MEMBER') AS runtime_member FROM pg_roles r WHERE r.rolname = current_user`);
    assert.deepEqual(rows[0], { name: "aisistent_app", rolsuper: false, rolbypassrls: false, rolcreaterole: false, owner_member: false, runtime_member: true });
    assert.equal((await target.admin.query("SELECT rolcanlogin FROM pg_roles WHERE rolname = 'aisistent_runtime'")).rows[0].rolcanlogin, false);
    await assert.rejects(target.appPool.query("SET ROLE render_owner"), /permission denied|must be member/);
    await assert.rejects(target.appPool.query("ALTER TABLE app.knowledge_entries DISABLE ROW LEVEL SECURITY"), /must be owner/);
    await assert.rejects(target.appPool.query("SELECT * FROM app.auth_sessions"), /permission denied/);
    await assert.rejects(target.appPool.query("SELECT * FROM app.rate_limit_buckets"), /permission denied/);
  });

  await t.test("restored RLS blocks cross-tenant reads, writes and removed members", async () => {
    for (const table of ["users", "organizations", "memberships", "assistant_configs", "knowledge_entries", "audit_events", "invitations"]) {
      assert.equal((await target.appPool.query(`SELECT 1 FROM app.${table}`)).rowCount, 0);
    }
    for (const [userId, organizationId] of [[alice, orgB], [bob, orgA], [removed, orgA]]) {
      await assert.rejects(withOrganization(target.appPool, { userId, organizationId }, async () => true), ForbiddenError);
      await withUser(target.appPool, userId, async (client) => {
        await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
        for (const table of ["assistant_configs", "knowledge_entries"]) {
          assert.equal((await client.query(`SELECT 1 FROM app.${table}`)).rowCount, 0);
        }
        assert.equal((await client.query("UPDATE app.knowledge_entries SET answer = 'forbidden' WHERE organization_id = $1", [organizationId])).rowCount, 0);
        assert.equal((await client.query("DELETE FROM app.knowledge_entries WHERE organization_id = $1", [organizationId])).rowCount, 0);
        await assert.rejects(client.query("INSERT INTO app.knowledge_entries (organization_id, question, answer) VALUES ($1, 'question', 'forbidden')", [organizationId]), /row-level security/);
      });
    }
  });

  await t.test("restored sessions and invitation links are invalidated before reuse", async () => {
    const restoredOldStore = new PostgresSessionStore(target.appPool, oldSecret);
    assert.equal(await sourceStore.get(oldSessionId), null);
    assert.equal((await restoredOldStore.get(oldSessionId))?.user.sub, session.user.sub);
    assert.equal((await previewInvitation(target.appPool, invited, invitation.token))?.status, "valid");
    assert.equal((await previewInvitation(source.appPool, invited, invitation.token))?.status, "revoked");
    // Isolated target only. Operational expiry cleanup is insufficient for unexpired restored access.
    await target.admin.query("BEGIN");
    try {
      await target.admin.query("DELETE FROM app.auth_sessions");
      await target.admin.query("DELETE FROM app.invitations");
      await target.admin.query("COMMIT");
    } catch (error) { await target.admin.query("ROLLBACK"); throw error; }
    assert.equal(await restoredOldStore.get(oldSessionId), null);
    assert.equal(await restoredOldStore.update(oldSessionId, session), false);
    assert.equal(await previewInvitation(target.appPool, invited, invitation.token), null);
    await assert.rejects(acceptInvitation(target.appPool, invited, invitation.token), (error: unknown) => error instanceof TeamError && error.code === "invitation_not_found");
    const newStore = new PostgresSessionStore(target.appPool, secret());
    const newId = secret();
    await newStore.set(newId, session);
    assert.equal((await newStore.get(newId))?.user.sub, session.user.sub);
  });

  await t.test("snapshot business data remains usable and new saves advance the audit sequence", async () => {
    const maxAuditId = BigInt((await target.admin.query("SELECT max(id)::text AS id FROM app.audit_events")).rows[0].id);
    await withOrganization(target.appPool, contextA, async (client) => {
      assert.deepEqual((await getAssistantConfig(client))?.config, { business: { name: "Alpha" } });
      const knowledge = await listKnowledge(client);
      assert.equal(knowledge[0].answer, "Alpha snapshot answer");
      const saved = await saveWorkspace(client, { expectedRevision: 1, config: { business: { name: "Recovered Alpha" } }, knowledge: [{ ...knowledge[0], answer: "Recovered answer" }] });
      assert.equal(saved.revision, 2);
      await recordAudit(client, { action: "recovery.verify", result: "success" });
    });
    await withOrganization(target.appPool, contextB, async (client) => {
      assert.deepEqual((await getAssistantConfig(client))?.config, { business: { name: "Beta" } });
      assert.equal((await listKnowledge(client))[0].answer, "Beta snapshot answer");
    });
    assert.ok(BigInt((await target.admin.query("SELECT max(id)::text AS id FROM app.audit_events")).rows[0].id) > maxAuditId);
  });
  t.diagnostic(JSON.stringify({ scope: "synthetic-local-only", versions, snapshotTime, archiveSha256: archiveHash, tables: snapshot.map(({ table, count }) => ({ table, count })), restoreMs, elapsedMs: Date.now() - started }));
});
