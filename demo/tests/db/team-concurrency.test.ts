import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import type { PoolClient } from "pg";
import { createHash } from "node:crypto";
import { createOrganization, provisionUser } from "../../lib/db/repositories.ts";
import { changeMemberRole, createInvitation, previewInvitation, removeMember, TeamError } from "../../lib/db/team.ts";
import { startTestDatabase, type TestDatabase } from "./harness.ts";

let db: TestDatabase;
let sequence = 0;
before(async () => { db = await startTestDatabase(); });
after(async () => { await db?.stop(); });

async function fixture() {
  const prefix = `concurrency-${++sequence}`;
  const user = (name: string) => provisionUser(db.appPool, { subject: `${prefix}|${name}`, email: `${prefix}-${name}@example.test`, displayName: name });
  const owner = await user("owner");
  const second = await user("second");
  const target = await user("target");
  const invitee = await user("invitee");
  const organization = await createOrganization(db.appPool, owner, `Team ${sequence}`);
  await db.admin.query("INSERT INTO app.memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member')", [organization, second, target]);
  return { owner, second, target, invitee, organization, email: `${prefix}-invitee@example.test` };
}

async function transaction(userId: string, organizationId: string): Promise<PoolClient> {
  const client = await db.appPool.connect();
  await client.query("BEGIN");
  await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.organization_id', $2, true)", [userId, organizationId]);
  return client;
}

async function waitUntilBlocked(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt++) {
    // pg_locks is visible to the non-superuser migration role, unlike other
    // users' pg_stat_activity wait details.
    const { rowCount } = await db.admin.query("SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted", [pid]);
    if (rowCount) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("The competing operation never waited for the transaction lock.");
}

async function rollbackAndRelease(...clients: PoolClient[]): Promise<void> {
  for (const client of clients) {
    await client.query("ROLLBACK");
    client.release();
  }
}

function capture<T>(pending: Promise<T>): Promise<T | Error> {
  return pending.catch((error: unknown) => error instanceof Error ? error : new Error(String(error)));
}

function expectTeamError(result: unknown, code: string) {
  assert.ok(result instanceof TeamError);
  assert.equal(result.code, code);
}

test("a demoted owner cannot promote someone from a request waiting on another team change", async () => {
  const f = await fixture();
  const a = await transaction(f.owner, f.organization);
  const b = await transaction(f.second, f.organization);
  try {
    const pid = (await b.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await changeMemberRole(a, f.second, "member");
    const pending = capture(changeMemberRole(b, f.target, "owner"));
    await waitUntilBlocked(pid);
    await a.query("COMMIT");
    expectTeamError(await pending, "owner_required");
    const { rows } = await db.admin.query("SELECT role FROM app.memberships WHERE organization_id = $1 AND user_id = $2", [f.organization, f.target]);
    assert.equal(rows[0].role, "member");
  } finally { await rollbackAndRelease(a, b); }
});

test("a removed owner cannot remove another member from an already queued request", async () => {
  const f = await fixture();
  const a = await transaction(f.owner, f.organization);
  const b = await transaction(f.second, f.organization);
  try {
    const pid = (await b.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await removeMember(a, f.second);
    const pending = capture(removeMember(b, f.target));
    await waitUntilBlocked(pid);
    await a.query("COMMIT");
    expectTeamError(await pending, "owner_required");
    const { rowCount } = await db.admin.query("SELECT 1 FROM app.memberships WHERE organization_id = $1 AND user_id = $2", [f.organization, f.target]);
    assert.equal(rowCount, 1);
  } finally { await rollbackAndRelease(a, b); }
});

test("concurrent invitations retain only the newest role and revoke the earlier token", async () => {
  const f = await fixture();
  const a = await transaction(f.owner, f.organization);
  const b = await transaction(f.second, f.organization);
  let first: Awaited<ReturnType<typeof createInvitation>>;
  let second: Awaited<ReturnType<typeof createInvitation>>;
  try {
    const pid = (await b.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    first = await createInvitation(a, { email: f.email, role: "admin" });
    const pending = capture(createInvitation(b, { email: f.email, role: "member" }));
    await waitUntilBlocked(pid);
    await a.query("COMMIT");
    const result = await pending;
    assert.ok(!(result instanceof Error));
    second = result;
    await b.query("COMMIT");
  } finally { await rollbackAndRelease(a, b); }
  assert.equal((await previewInvitation(db.appPool, f.invitee, first.token))?.status, "revoked");
  assert.deepEqual(await previewInvitation(db.appPool, f.invitee, second.token), {
    organizationName: `Team ${sequence}`, email: f.email, role: "member", status: "valid",
  });
  const { rows } = await db.admin.query("SELECT count(*)::int AS count FROM app.invitations WHERE organization_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL", [f.organization, f.email]);
  assert.equal(rows[0].count, 1);
});

test("an invitation accepted during a concurrent replacement cannot leave a new membership and a live replacement link", async () => {
  const f = await fixture();
  const initial = await transaction(f.owner, f.organization);
  let invitation: Awaited<ReturnType<typeof createInvitation>>;
  try {
    invitation = await createInvitation(initial, { email: f.email, role: "member" });
    await initial.query("COMMIT");
  } finally { await rollbackAndRelease(initial); }
  const a = await transaction(f.invitee, f.organization);
  const b = await transaction(f.owner, f.organization);
  try {
    const pid = (await b.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const tokenHash = createHash("sha256").update(invitation.token).digest();
    await a.query("SELECT app.accept_invitation($1)", [tokenHash]);
    const pending = capture(createInvitation(b, { email: f.email, role: "admin" }));
    await waitUntilBlocked(pid);
    await a.query("COMMIT");
    expectTeamError(await pending, "already_member");
    const { rows } = await db.admin.query("SELECT count(*)::int AS count FROM app.invitations WHERE organization_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL", [f.organization, f.email]);
    assert.equal(rows[0].count, 0);
  } finally { await rollbackAndRelease(a, b); }
});

test("two concurrent owner demotions still leave one owner", async () => {
  const f = await fixture();
  const a = await transaction(f.owner, f.organization);
  const b = await transaction(f.second, f.organization);
  try {
    const pid = (await b.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await changeMemberRole(a, f.owner, "member");
    const pending = capture(changeMemberRole(b, f.second, "member"));
    await waitUntilBlocked(pid);
    await a.query("COMMIT");
    expectTeamError(await pending, "last_owner");
    const { rows } = await db.admin.query("SELECT count(*)::int AS count FROM app.memberships WHERE organization_id = $1 AND role = 'owner'", [f.organization]);
    assert.equal(rows[0].count, 1);
  } finally { await rollbackAndRelease(a, b); }
});

test("upgrading a database with duplicate pending links keeps the newest and records revocations", async () => {
  const f = await fixture();
  await db.admin.query("DROP INDEX app.invitations_one_pending_per_address");
  const { rows } = await db.admin.query<{ id: string }>(
    `INSERT INTO app.invitations (organization_id, email, role, token_hash, created_at, expires_at)
     VALUES ($1, $2, 'admin', $3, now() - interval '1 hour', now() + interval '1 day'),
            ($1, $2, 'member', $4, now(), now() + interval '1 day') RETURNING id`,
    [f.organization, f.email, createHash("sha256").update("old-link").digest(), createHash("sha256").update("new-link").digest()],
  );
  await db.admin.query(await readFile(new URL("../../db/migrations/0005_team_authorization_lock.sql", import.meta.url), "utf8"));
  const { rows: links } = await db.admin.query("SELECT id, revoked_at IS NOT NULL AS revoked FROM app.invitations WHERE organization_id = $1 ORDER BY created_at", [f.organization]);
  assert.deepEqual(links, [{ id: rows[0].id, revoked: true }, { id: rows[1].id, revoked: false }]);
  const { rows: events } = await db.admin.query("SELECT target FROM app.audit_events WHERE organization_id = $1 AND action = 'invitation.revoke'", [f.organization]);
  assert.deepEqual(events, [{ target: rows[0].id }]);
});
