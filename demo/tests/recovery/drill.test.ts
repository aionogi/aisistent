import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import { test } from "node:test";
import pg from "pg";
import type { SessionData } from "@auth0/nextjs-auth0/types";
import { PostgresSessionStore } from "../../lib/auth/session-store.ts";
import { withOrganization } from "../../lib/db/context.ts";
import { deleteConversation, recordConversation } from "../../lib/db/conversations.ts";
import { createOrganization, provisionUser, saveWorkspace } from "../../lib/db/repositories.ts";
import { acceptInvitation, createInvitation } from "../../lib/db/team.ts";
import { MIGRATIONS_DIR, startTestDatabase } from "../db/harness.ts";
import { DrillError, formatDrillReport, runRestoreDrill } from "./drill.ts";

test("the restore drill copies the live data into an isolated database, checks it and leaves no archive behind", { timeout: 300_000 }, async (t) => {
  const source = await startTestDatabase();
  const pendingRemoval = new pg.Client({ connectionString: source.adminUrl });
  pendingRemoval.on("error", () => {});
  let removalConnected = false;
  t.after(async () => {
    if (removalConnected) await pendingRemoval.query("ROLLBACK").catch(() => {});
    await pendingRemoval.end().catch(() => {});
    await source.stop();
  });
  // Like a provider that grants its own roles: the copy must keep that privilege as it is.
  await source.admin.query("CREATE ROLE drill_provider_role NOLOGIN");
  await source.admin.query("GRANT SELECT ON public.schema_migrations TO drill_provider_role");

  const user = (name: string) => provisionUser(source.appPool, { subject: `drill|${name}`, email: `${name}@example.test`, displayName: name });
  const alice = await user("alice");
  const bob = await user("bob");
  const mila = await user("mila");
  const orgA = await createOrganization(source.appPool, alice, "Drill Alpha");
  const orgB = await createOrganization(source.appPool, bob, "Drill Beta");
  await withOrganization(source.appPool, { userId: alice, organizationId: orgA }, (client) => saveWorkspace(client, {
    expectedRevision: 0, config: { business: { name: "Alpha" } }, knowledge: [{ id: "new", question: "Synthetic question?", answer: "Alpha answer" }],
  }));
  const invite = await withOrganization(source.appPool, { userId: alice, organizationId: orgA }, (client) => createInvitation(client, { email: "mila@example.test", role: "member" }));
  await acceptInvitation(source.appPool, mila, invite.token);
  await withOrganization(source.appPool, { userId: alice, organizationId: orgA }, (client) => createInvitation(client, { email: "pending@example.test", role: "admin" }));
  const session: SessionData = {
    user: { sub: "drill|alice", email: "alice@example.test" },
    tokenSet: { accessToken: "synthetic-drill-token", expiresAt: Math.floor(Date.now() / 1000) + 3600 },
    internal: { sid: "synthetic-drill-session", createdAt: Math.floor(Date.now() / 1000) },
  };
  await new PostgresSessionStore(source.appPool, randomBytes(32).toString("hex")).set(randomBytes(32).toString("hex"), session);
  const conversationId = await recordConversation(source.admin, orgB, {
    channel: "message", outcome: "answered", startedAt: new Date(),
    messages: [{ speaker: "customer", body: "Synthetic transcript" }],
  });

  // Audit IDs are allocated before commit. The snapshot sees a later event
  // but not this pending removal, which must still be reported after commit.
  await pendingRemoval.connect();
  removalConnected = true;
  await pendingRemoval.query("BEGIN");
  await pendingRemoval.query("SELECT set_config('app.user_id', $1, true), set_config('app.organization_id', $2, true)", [alice, orgA]);
  await pendingRemoval.query("SELECT app.remove_member($1)", [mila]);
  const removalId = (await pendingRemoval.query("SELECT max(id)::text AS id FROM app.audit_events WHERE action = 'member.remove'")).rows[0].id;
  const higherId = (await source.admin.query("INSERT INTO app.audit_events (action, result) VALUES ('workspace.save', 'success') RETURNING id::text AS id")).rows[0].id;
  assert.ok(BigInt(higherId) > BigInt(removalId));
  assert.equal((await source.admin.query("SELECT 1 FROM app.memberships WHERE organization_id = $1 AND user_id = $2", [orgA, mila])).rowCount, 1);

  const { report, target } = await runRestoreDrill({
    sourceUrl: source.adminUrl,
    migrationsDir: MIGRATIONS_DIR,
    afterDump: async () => {
      await pendingRemoval.query("COMMIT");
      assert.equal(await withOrganization(source.appPool, { userId: bob, organizationId: orgB }, (client) => deleteConversation(client, conversationId)), true);
    },
  });
  assert.equal(target, undefined);
  assert.equal(existsSync(report.artifactDir), false, "the archives are deleted");
  assert.equal(report.tables.find(({ table }) => table === "app.organizations")?.count, 2);
  assert.deepEqual(report.createdRoles, ["drill_provider_role"]);
  assert.ok(report.grantees.includes("aisistent_runtime") && report.grantees.includes("drill_provider_role"));
  assert.equal(report.organizations, 2);
  assert.equal(report.memberships, 3);
  // Three members reach their firm, an outsider is refused three ways per firm, and members are refused the other firm.
  assert.equal(report.isolationChecks, 3 + 2 * 3 + 3);
  assert.equal(report.removedSessions, 1);
  assert.equal(report.removedInvitations, 2);
  assert.deepEqual(report.postSnapshot, [{ action: "conversation.delete", count: 1 }, { action: "member.remove", count: 1 }]);
  assert.equal((await source.admin.query("SELECT 1 FROM app.memberships WHERE organization_id = $1 AND user_id = $2", [orgA, mila])).rowCount, 0);
  assert.equal(report.tables.find(({ table }) => table === "app.conversations")?.count, 1, "the snapshot would revive the deleted conversation");
  assert.equal(report.archives.length, 2);
  assert.ok(report.archives.every(({ bytes, sha256 }) => bytes > 0 && /^[0-9a-f]{64}$/.test(sha256)));
  assert.match(report.server, /^17\./);

  const printed = formatDrillReport(report, false);
  assert.match(printed, /Restore drill passed/);
  assert.match(printed, /roles besides aisistent_runtime hold privileges on the app's objects: drill_provider_role/);
  assert.match(printed, /After the snapshot: conversation\.delete 1, member\.remove 1\.\n  A real restore would undo these/);
  assert.match(formatDrillReport({ ...report, postSnapshot: [{ action: "conversation.delete", count: 1 }] }, false), /A real restore would undo these: reapply them/,
    "a conversation deletion alone requires reconciliation, without relying on another kind of change");
  assert.match(printed, /So is its temporary database/);
  for (const secret of [new URL(source.adminUrl).password, "alice@example.test", "Alpha answer", "Drill Alpha", "Synthetic transcript", conversationId, orgA, mila, report.artifactDir]) {
    assert.ok(!printed.includes(secret), "the printed report holds no password, address, content or local path");
  }
});

test("the restore drill stops when the live database's migrations differ from this checkout", { timeout: 300_000 }, async (t) => {
  const source = await startTestDatabase();
  t.after(() => source.stop());
  await source.admin.query("UPDATE public.schema_migrations SET checksum = repeat('0', 64) WHERE version = (SELECT max(version) FROM public.schema_migrations)");
  const drillDirs = () => readdirSync(os.tmpdir()).filter((name) => name.startsWith("aisistent-drill-"));
  const before = new Set(drillDirs());
  await assert.rejects(
    runRestoreDrill({ sourceUrl: source.adminUrl, migrationsDir: MIGRATIONS_DIR }),
    (error: unknown) => error instanceof DrillError && /migrations \(\d+\) do not match this checkout/.test((error as Error).message),
  );
  assert.deepEqual(drillDirs().filter((name) => !before.has(name)), [], "a failed drill deletes its archives too");
});

test("the restore drill refuses a remote database without its certificate", async () => {
  await assert.rejects(
    runRestoreDrill({ sourceUrl: "postgresql://postgres.ref:secret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres", migrationsDir: MIGRATIONS_DIR }),
    (error: unknown) => error instanceof DrillError && /CA certificate/.test((error as Error).message) && !/secret/.test((error as Error).message),
  );
});
