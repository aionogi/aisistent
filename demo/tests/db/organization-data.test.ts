import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { PoolClient } from "pg";
import { ForbiddenError, withOrganization } from "../../lib/db/context.ts";
import { addKnowledge, createOrganization, listMemberships, provisionUser, saveAssistantConfig } from "../../lib/db/repositories.ts";
import { changeMemberRole, createInvitation, deleteOrganization, EXPORT_FORMAT, exportOrganization, leaveOrganization, listMembers, TeamError } from "../../lib/db/team.ts";
import { startTestDatabase, type TestDatabase } from "./harness.ts";

let db: TestDatabase;
let ana: string, marko: string, mila: string, stranger: string;
let org: string, otherOrg: string;

before(async () => {
  db = await startTestDatabase();
  ana = await provisionUser(db.appPool, { subject: "mock|ana", email: "ana@example.test", displayName: "Ana" });
  marko = await provisionUser(db.appPool, { subject: "mock|marko", email: "marko@example.test", displayName: "Marko" });
  mila = await provisionUser(db.appPool, { subject: "mock|mila", email: "mila@example.test", displayName: "Mila" });
  stranger = await provisionUser(db.appPool, { subject: "mock|stranger", email: "stranger@example.test", displayName: "Stranger" });
  org = await createOrganization(db.appPool, ana, "Salon Ana");
  otherOrg = await createOrganization(db.appPool, stranger, "Druga firma");
  await db.admin.query("INSERT INTO app.memberships (organization_id, user_id, role) VALUES ($1, $2, 'admin'), ($1, $3, 'member')", [org, marko, mila]);
  await as(ana, async (client) => {
    await saveAssistantConfig(client, { business: { name: "Salon Ana" } }, 0);
    await addKnowledge(client, { question: "Da li radite nedeljom?", answer: "Ne, nedeljom ne radimo." });
    await createInvitation(client, { email: "jelena@example.test", role: "member" });
  });
  await as(stranger, (client) => addKnowledge(client, { question: "Tuđe pitanje", answer: "Tuđi odgovor" }), otherOrg);
});
after(async () => { await db?.stop(); });

const as = <T>(userId: string, work: (client: PoolClient) => Promise<T>, organizationId = org) => withOrganization(db.appPool, { userId, organizationId }, work);
const rejectsWith = (promise: Promise<unknown>, code: string) => assert.rejects(promise, (error: unknown) => error instanceof TeamError && error.code === code);
const count = async (table: string, organizationId: string) =>
  Number((await db.admin.query(`SELECT count(*) FROM app.${table} WHERE organization_id = $1`, [organizationId])).rows[0].count);

describe("export", () => {
  test("the owner's export holds the organization's data and nothing secret or foreign", async () => {
    const document = await as(ana, (client) => exportOrganization(client));
    assert.equal(document.format, EXPORT_FORMAT);
    assert.equal(document.version, 1);
    assert.equal((document.organization as { name: string }).name, "Salon Ana");
    assert.deepEqual((document.members as Array<{ name: string; role: string }>).map(({ name, role }) => [name, role]), [["Ana", "owner"], ["Marko", "admin"], ["Mila", "member"]]);
    assert.deepEqual((document.invitations as Array<{ email: string }>).map(({ email }) => email), ["jelena@example.test"]);
    assert.deepEqual((document.knowledge as Array<{ question: string }>).map(({ question }) => question), ["Da li radite nedeljom?"]);
    const stored = document.assistantConfig as { config: unknown; revision: number };
    assert.deepEqual([stored.config, stored.revision], [{ business: { name: "Salon Ana" } }, 1]);
    assert.ok((document.activity as Array<{ action: string }>).some(({ action }) => action === "invitation.create"));

    const text = JSON.stringify(document);
    const hash = (await db.admin.query("SELECT encode(token_hash, 'hex') AS hash FROM app.invitations WHERE organization_id = $1", [org])).rows[0].hash as string;
    for (const secret of [hash, "token_hash", "mock|", "Tuđe pitanje", "Druga firma", "stranger@example.test"]) {
      assert.ok(!text.includes(secret), `export must not contain ${secret}`);
    }
  });

  test("exporting is recorded in the activity log", async () => {
    const { rows } = await db.admin.query("SELECT actor_user_id FROM app.audit_events WHERE organization_id = $1 AND action = 'organization.export'", [org]);
    assert.deepEqual(rows.map((row) => row.actor_user_id), [ana]);
  });

  test("admins, members, and other organizations cannot export", async () => {
    await rejectsWith(as(marko, (client) => exportOrganization(client)), "owner_required");
    await rejectsWith(as(mila, (client) => exportOrganization(client)), "owner_required");
    await assert.rejects(as(stranger, (client) => exportOrganization(client)), ForbiddenError);
  });
});

describe("leaving", () => {
  test("a member leaves and loses access on the next request", async () => {
    await as(mila, (client) => leaveOrganization(client));
    assert.deepEqual((await as(ana, (client) => listMembers(client))).map((member) => member.displayName), ["Ana", "Marko"]);
    await assert.rejects(as(mila, (client) => listMembers(client)), ForbiddenError);
    const { rows } = await db.admin.query("SELECT actor_user_id, target FROM app.audit_events WHERE organization_id = $1 AND action = 'member.leave'", [org]);
    assert.deepEqual(rows, [{ actor_user_id: mila, target: mila }]);
    assert.ok(await db.admin.query("SELECT 1 FROM app.users WHERE id = $1", [mila]).then((result) => result.rowCount === 1), "the account itself remains");
  });

  test("the last owner cannot leave; after handing over ownership they can", async () => {
    await rejectsWith(as(ana, (client) => leaveOrganization(client)), "last_owner");
    await as(ana, (client) => changeMemberRole(client, marko, "owner"));
    await as(ana, (client) => leaveOrganization(client));
    await rejectsWith(as(marko, (client) => leaveOrganization(client)), "last_owner");
    // Restore Ana as owner for the deletion tests.
    await db.admin.query("INSERT INTO app.memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner')", [org, ana]);
  });

  test("non-members cannot leave someone else's organization", async () => {
    await assert.rejects(as(stranger, (client) => leaveOrganization(client)), ForbiddenError);
    assert.equal(await count("memberships", otherOrg), 1);
  });
});

describe("deletion", () => {
  test("only an owner who repeats the exact name can delete; nothing changes otherwise", async () => {
    await db.admin.query("UPDATE app.memberships SET role = 'admin' WHERE organization_id = $1 AND user_id = $2", [org, marko]);
    await rejectsWith(as(marko, (client) => deleteOrganization(client, "Salon Ana")), "owner_required");
    await rejectsWith(as(ana, (client) => deleteOrganization(client, "salon ana")), "confirmation_mismatch");
    await rejectsWith(as(ana, (client) => deleteOrganization(client, "")), "confirmation_mismatch");
    await assert.rejects(as(stranger, (client) => deleteOrganization(client, "Salon Ana")), ForbiddenError);
    assert.equal(await count("knowledge_entries", org), 1);
    assert.equal(await count("memberships", org), 2);
  });

  test("the runtime role cannot delete organizations directly", async () => {
    await assert.rejects(as(ana, (client) => client.query("DELETE FROM app.organizations WHERE id = $1", [org])), /permission denied/);
  });

  test("deleting removes the organization's data for every member and keeps one deletion record", async () => {
    await as(ana, (client) => deleteOrganization(client, "  Salon Ana "));
    assert.equal((await db.admin.query("SELECT 1 FROM app.organizations WHERE id = $1", [org])).rowCount, 0);
    for (const table of ["memberships", "assistant_configs", "knowledge_entries", "invitations", "audit_events"]) {
      assert.equal(await count(table, org), 0, `${table} rows remain`);
    }
    const { rows } = await db.admin.query("SELECT organization_id, actor_user_id, target, result FROM app.audit_events WHERE action = 'organization.delete'");
    assert.deepEqual(rows, [{ organization_id: null, actor_user_id: ana, target: org, result: "success" }]);

    await assert.rejects(as(ana, (client) => listMembers(client)), ForbiddenError);
    await assert.rejects(as(marko, (client) => listMembers(client)), ForbiddenError);
    assert.deepEqual(await listMemberships(db.appPool, ana), []);
    assert.equal((await db.admin.query("SELECT 1 FROM app.users WHERE id = ANY($1)", [[ana, marko]])).rowCount, 2, "accounts remain");
  });

  test("other organizations are untouched", async () => {
    assert.equal(await count("knowledge_entries", otherOrg), 1);
    assert.equal(await count("memberships", otherOrg), 1);
    assert.deepEqual((await listMemberships(db.appPool, stranger)).map((membership) => membership.organizationName), ["Druga firma"]);
  });
});
