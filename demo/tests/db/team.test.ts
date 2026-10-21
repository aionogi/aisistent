import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { PoolClient } from "pg";
import { ForbiddenError, withOrganization } from "../../lib/db/context.ts";
import { createOrganization, provisionUser } from "../../lib/db/repositories.ts";
import {
  acceptInvitation,
  changeMemberRole,
  createInvitation,
  getAuditLog,
  listInvitations,
  listMembers,
  previewInvitation,
  removeMember,
  revokeInvitation,
  TeamError,
} from "../../lib/db/team.ts";
import { startTestDatabase, type TestDatabase } from "./harness.ts";

let db: TestDatabase;
let owner: string, marko: string, jelena: string, stranger: string, unverified: string;
let org: string, otherOrg: string;

before(async () => {
  db = await startTestDatabase();
  owner = await provisionUser(db.appPool, { subject: "mock|ana", email: "ana@example.test", displayName: "Ana" });
  marko = await provisionUser(db.appPool, { subject: "mock|marko", email: "marko@example.test", displayName: "Marko" });
  jelena = await provisionUser(db.appPool, { subject: "mock|jelena", email: "jelena@example.test", displayName: "Jelena" });
  stranger = await provisionUser(db.appPool, { subject: "mock|stranger", email: "stranger@example.test", displayName: "Stranger" });
  unverified = await provisionUser(db.appPool, { subject: "mock|unverified", email: null, displayName: "Bez emaila" });
  org = await createOrganization(db.appPool, owner, "Salon Ana");
  otherOrg = await createOrganization(db.appPool, stranger, "Druga firma");
});
after(async () => { await db?.stop(); });

const as = <T>(userId: string, work: (client: PoolClient) => Promise<T>, organizationId = org) => withOrganization(db.appPool, { userId, organizationId }, work);
const rejectsWith = (promise: Promise<unknown>, code: string) => assert.rejects(promise, (error: unknown) => error instanceof TeamError && error.code === code);

describe("invitations", () => {
  let token: string;

  test("an owner creates an invitation; only the token's hash is stored", async () => {
    const created = await as(owner, (client) => createInvitation(client, { email: " Marko@Example.test ", role: "admin" }));
    token = created.token;
    assert.ok(token.length >= 40);
    const row = await db.admin.query("SELECT email, role, encode(token_hash, 'hex') AS hash FROM app.invitations WHERE id = $1", [created.id]);
    assert.equal(row.rows[0].email, "marko@example.test", "addresses are normalized");
    assert.ok(!row.rows[0].hash.includes(Buffer.from(token).toString("hex")));
    assert.deepEqual((await as(owner, (client) => listInvitations(client))).map((invitation) => invitation.email), ["marko@example.test"]);
  });

  test("the application cannot read token hashes", async () => {
    await assert.rejects(as(owner, (client) => client.query("SELECT token_hash FROM app.invitations")), /permission denied/);
  });

  test("the invitee sees a preview; strangers can preview but not accept", async () => {
    assert.deepEqual(await previewInvitation(db.appPool, marko, token), { organizationName: "Salon Ana", role: "admin", email: "marko@example.test", status: "valid" });
    await rejectsWith(acceptInvitation(db.appPool, stranger, token), "invitation_email_mismatch");
    await rejectsWith(acceptInvitation(db.appPool, unverified, token), "invitation_email_mismatch");
    assert.equal(await previewInvitation(db.appPool, marko, "not-a-real-token"), null);
    await rejectsWith(acceptInvitation(db.appPool, marko, "not-a-real-token"), "invitation_not_found");
  });

  test("accepting adds the membership with the invited role, once", async () => {
    assert.equal(await acceptInvitation(db.appPool, marko, token), org);
    const members = await as(owner, (client) => listMembers(client));
    assert.deepEqual(members.map((member) => [member.displayName, member.role]), [["Ana", "owner"], ["Marko", "admin"]]);
    assert.equal(await acceptInvitation(db.appPool, marko, token), org, "accepting again is harmless for the same user");
    await rejectsWith(acceptInvitation(db.appPool, stranger, token), "invitation_used");
    assert.equal((await previewInvitation(db.appPool, marko, token))?.status, "accepted");
  });

  test("existing members cannot be invited again", async () => {
    await rejectsWith(as(owner, (client) => createInvitation(client, { email: "marko@example.test", role: "member" })), "already_member");
  });

  test("revoked and expired invitations cannot be accepted", async () => {
    const revoked = await as(owner, (client) => createInvitation(client, { email: "jelena@example.test", role: "member" }));
    assert.equal(await as(owner, (client) => revokeInvitation(client, revoked.id)), true);
    assert.equal(await as(owner, (client) => revokeInvitation(client, revoked.id)), false, "revoking twice changes nothing");
    await rejectsWith(acceptInvitation(db.appPool, jelena, revoked.token), "invitation_revoked");

    const expiring = await as(owner, (client) => createInvitation(client, { email: "jelena@example.test", role: "member" }));
    await db.admin.query("UPDATE app.invitations SET expires_at = now() - interval '1 minute' WHERE id = $1", [expiring.id]);
    assert.equal((await previewInvitation(db.appPool, jelena, expiring.token))?.status, "expired");
    await rejectsWith(acceptInvitation(db.appPool, jelena, expiring.token), "invitation_expired");
  });

  test("a new invitation replaces the open one for the same address", async () => {
    const first = await as(owner, (client) => createInvitation(client, { email: "jelena@example.test", role: "member" }));
    const second = await as(owner, (client) => createInvitation(client, { email: "jelena@example.test", role: "member" }));
    await rejectsWith(acceptInvitation(db.appPool, jelena, first.token), "invitation_revoked");
    assert.equal(await acceptInvitation(db.appPool, jelena, second.token), org);
  });

  test("only owners can invite or revoke, even admins", async () => {
    await rejectsWith(as(marko, (client) => createInvitation(client, { email: "new@example.test", role: "member" })), "owner_required");
    await rejectsWith(as(jelena, (client) => createInvitation(client, { email: "new@example.test", role: "member" })), "owner_required");
    assert.deepEqual(await as(marko, (client) => listInvitations(client)), [], "admins do not see invitations");
  });

  test("an owner of another organization cannot touch this one's invitations", async () => {
    const created = await as(owner, (client) => createInvitation(client, { email: "x@example.test", role: "member" }));
    assert.equal(await as(stranger, (client) => revokeInvitation(client, created.id), otherOrg), false);
    assert.deepEqual((await as(stranger, (client) => listInvitations(client), otherOrg)).map((invitation) => invitation.id), []);
  });
});

describe("roles and removal", () => {
  test("members can see the team; non-members cannot open it", async () => {
    assert.deepEqual((await as(jelena, (client) => listMembers(client))).map((member) => member.displayName), ["Ana", "Marko", "Jelena"]);
    await assert.rejects(as(stranger, (client) => listMembers(client)), ForbiddenError);
  });

  test("only owners change roles", async () => {
    await rejectsWith(as(marko, (client) => changeMemberRole(client, jelena, "admin")), "owner_required");
    await as(owner, (client) => changeMemberRole(client, jelena, "admin"));
    assert.equal((await as(owner, (client) => listMembers(client))).find((member) => member.userId === jelena)?.role, "admin");
  });

  test("the last owner can be neither demoted nor removed", async () => {
    await rejectsWith(as(owner, (client) => changeMemberRole(client, owner, "admin")), "last_owner");
    await rejectsWith(as(owner, (client) => removeMember(client, owner)), "last_owner");
    // With a second owner, the first can step down.
    await as(owner, (client) => changeMemberRole(client, marko, "owner"));
    await as(owner, (client) => changeMemberRole(client, owner, "admin"));
    await rejectsWith(as(owner, (client) => changeMemberRole(client, marko, "member")), "owner_required");
    await as(marko, (client) => changeMemberRole(client, owner, "owner"));
  });

  test("removing a member ends their access on the next request", async () => {
    assert.ok(await as(jelena, (client) => listMembers(client)));
    await rejectsWith(as(jelena, (client) => removeMember(client, marko)), "owner_required");
    await as(owner, (client) => removeMember(client, jelena));
    await assert.rejects(as(jelena, (client) => listMembers(client)), ForbiddenError);
    await rejectsWith(as(owner, (client) => removeMember(client, jelena)), "member_not_found");
  });

  test("invalid roles are rejected", async () => {
    await rejectsWith(as(owner, (client) => changeMemberRole(client, marko, "superuser" as never)), "invalid_role");
  });
});

describe("audit log", () => {
  test("owners and admins read the log with actor names; members cannot", async () => {
    const entries = await as(owner, (client) => getAuditLog(client));
    const actions = entries.map((entry) => entry.action);
    for (const action of ["organization.create", "invitation.create", "invitation.revoke", "invitation.accept", "member.role_change", "member.remove"]) {
      assert.ok(actions.includes(action), `${action} is logged`);
    }
    assert.ok(entries.every((entry) => entry.actorName), "every entry names its actor");
    assert.ok(entries[0].createdAt >= entries[entries.length - 1].createdAt, "newest first");

    const memberUser = await provisionUser(db.appPool, { subject: "mock|member", email: "member@example.test", displayName: "Član" });
    await db.admin.query("INSERT INTO app.memberships (organization_id, user_id, role) VALUES ($1, $2, 'member')", [org, memberUser]);
    await rejectsWith(as(memberUser, (client) => getAuditLog(client)), "admin_required");
  });
});
