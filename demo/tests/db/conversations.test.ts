import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { PoolClient } from "pg";
import { ForbiddenError, withOrganization } from "../../lib/db/context.ts";
import { deleteConversation, getConversationMessages, getConversationRetention, listConversations, recordConversation, type RecordedConversation } from "../../lib/db/conversations.ts";
import { createOrganization, provisionUser } from "../../lib/db/repositories.ts";
import { deleteOrganization, exportOrganization, setConversationRetention, TeamError } from "../../lib/db/team.ts";
import { purgeExpiredConversations } from "../../lib/operations/store.ts";
import { startTestDatabase, type TestDatabase } from "./harness.ts";

let db: TestDatabase;
let ana: string, marko: string, mila: string, stranger: string;
let org: string, otherOrg: string;
let booking: string;

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
const call = (overrides: Partial<RecordedConversation> = {}): RecordedConversation => ({
  channel: "call",
  outcome: "booked",
  customerName: "Mila Petrović",
  customerContact: "+381 60 000 0000",
  summary: "Zakazano šišanje za sredu u 10 h.",
  startedAt: daysAgo(1),
  endedAt: new Date(daysAgo(1).getTime() + 120_000),
  messages: [
    { speaker: "assistant", body: "Dobar dan, Salon Ana." },
    { speaker: "customer", body: "Imate li termin u sredu?" },
    { speaker: "assistant", body: "Imamo u 10 h. Da zakažem?" },
  ],
  ...overrides,
});

before(async () => {
  db = await startTestDatabase();
  ana = await provisionUser(db.appPool, { subject: "mock|ana", email: "ana@example.test", displayName: "Ana" });
  marko = await provisionUser(db.appPool, { subject: "mock|marko", email: "marko@example.test", displayName: "Marko" });
  mila = await provisionUser(db.appPool, { subject: "mock|mila", email: "mila@example.test", displayName: "Mila" });
  stranger = await provisionUser(db.appPool, { subject: "mock|stranger", email: "stranger@example.test", displayName: "Stranger" });
  org = await createOrganization(db.appPool, ana, "Salon Ana");
  otherOrg = await createOrganization(db.appPool, stranger, "Druga firma");
  await db.admin.query("INSERT INTO app.memberships (organization_id, user_id, role) VALUES ($1, $2, 'admin'), ($1, $3, 'member')", [org, marko, mila]);
  // The migration owner stands in for M4's ingestion path.
  booking = await recordConversation(db.admin, org, call());
  await recordConversation(db.admin, otherOrg, call({ customerName: "Tuđi klijent", summary: "Tuđi razgovor." }));
});
after(async () => { await db?.stop(); });

const as = <T>(userId: string, work: (client: PoolClient) => Promise<T>, organizationId = org) => withOrganization(db.appPool, { userId, organizationId }, work);
const rejectsWith = (promise: Promise<unknown>, code: string) => assert.rejects(promise, (error: unknown) => error instanceof TeamError && error.code === code);
const count = async (table: string, organizationId: string) => Number((await db.admin.query(`SELECT count(*) FROM app.${table} WHERE organization_id = $1`, [organizationId])).rows[0].count);

describe("reading", () => {
  test("members read their organization's conversations and transcripts in order", async () => {
    const list = await as(mila, (client) => listConversations(client));
    assert.deepEqual(list.map((item) => [item.customerName, item.channel, item.outcome]), [["Mila Petrović", "call", "booked"]]);
    const messages = await as(mila, (client) => getConversationMessages(client, booking));
    assert.deepEqual(messages.map((message) => [message.position, message.speaker]), [[1, "assistant"], [2, "customer"], [3, "assistant"]]);
  });

  test("other organizations' records stay invisible, even by id or with a forged organization context", async () => {
    await assert.rejects(as(stranger, (client) => listConversations(client)), ForbiddenError);
    assert.deepEqual(await as(stranger, (client) => getConversationMessages(client, booking), otherOrg), []);
    assert.deepEqual((await as(stranger, (client) => listConversations(client), otherOrg)).map((item) => item.customerName), ["Tuđi klijent"]);
    const forged = await db.appPool.connect();
    try {
      await forged.query("BEGIN");
      await forged.query("SELECT set_config('app.user_id', $1, true), set_config('app.organization_id', $2, true)", [stranger, org]);
      assert.equal((await forged.query("SELECT * FROM app.conversations")).rowCount, 0);
      assert.equal((await forged.query("SELECT * FROM app.conversation_messages")).rowCount, 0);
    } finally {
      await forged.query("ROLLBACK");
      forged.release();
    }
  });
});

describe("writing", () => {
  test("the web runtime can neither insert, change, nor record conversations", async () => {
    await assert.rejects(as(ana, (client) => client.query("INSERT INTO app.conversations (organization_id, channel, outcome, started_at) VALUES ($1, 'call', 'answered', now())", [org])), /permission denied/);
    await assert.rejects(as(ana, (client) => client.query("UPDATE app.conversations SET summary = 'x'")), /permission denied/);
    await assert.rejects(as(ana, (client) => client.query("INSERT INTO app.conversation_messages (conversation_id, organization_id, position, speaker, body) VALUES ($1, $2, 9, 'team', 'x')", [booking, org])), /permission denied/);
    await assert.rejects(as(ana, (client) => recordConversation(client, org, call())), /permission denied/);
  });

  test("records are validated, and a transcript cannot be attached to another organization", async () => {
    await assert.rejects(recordConversation(db.admin, org, call({ channel: "fax" as never })), /conversations_channel_check/);
    await assert.rejects(recordConversation(db.admin, org, call({ endedAt: daysAgo(3) })), /conversations_check/);
    await assert.rejects(recordConversation(db.admin, org, call({ messages: [{ speaker: "customer", body: "   " }] })), /conversation_messages_body_check/);
    await assert.rejects(recordConversation(db.admin, org, call({ messages: Array.from({ length: 501 }, () => ({ speaker: "customer" as const, body: "x" })) })), /invalid_messages/);
    await assert.rejects(db.admin.query("INSERT INTO app.conversation_messages (conversation_id, organization_id, position, speaker, body) VALUES ($1, $2, 9, 'team', 'x')", [booking, otherOrg]), /foreign key/);
    assert.equal(await count("conversations", org), 1, "failed records leave nothing behind");
  });
});

describe("deleting and retention", () => {
  test("members cannot delete; admins delete a conversation with its transcript and the deletion is recorded", async () => {
    const extra = await recordConversation(db.admin, org, call({ customerName: "Luka", outcome: "handoff" }));
    assert.equal(await as(mila, (client) => deleteConversation(client, extra)), false);
    assert.equal(await as(stranger, (client) => deleteConversation(client, extra), otherOrg), false);
    assert.equal(await as(marko, (client) => deleteConversation(client, extra)), true);
    assert.equal((await db.admin.query("SELECT 1 FROM app.conversation_messages WHERE conversation_id = $1", [extra])).rowCount, 0);
    const { rows } = await db.admin.query("SELECT actor_user_id FROM app.audit_events WHERE action = 'conversation.delete' AND target = $1", [extra]);
    assert.deepEqual(rows, [{ actor_user_id: marko }]);
  });

  test("owners set the retention period; others and invalid values are refused", async () => {
    assert.equal(await as(mila, (client) => getConversationRetention(client)), 90, "default");
    await rejectsWith(as(marko, (client) => setConversationRetention(client, 30)), "owner_required");
    await rejectsWith(as(ana, (client) => setConversationRetention(client, 3)), "invalid_retention");
    await as(ana, (client) => setConversationRetention(client, 30));
    assert.equal(await as(ana, (client) => getConversationRetention(client)), 30);
    await assert.rejects(as(ana, (client) => client.query("UPDATE app.organizations SET conversation_retention_days = 700 WHERE id = $1", [org])), /permission denied/);
    const { rows } = await db.admin.query("SELECT target FROM app.audit_events WHERE organization_id = $1 AND action = 'organization.retention_change'", [org]);
    assert.deepEqual(rows, [{ target: "90→30" }]);
  });

  test("cleanup removes conversations older than each organization's period, in bounded batches", async () => {
    const old = await recordConversation(db.admin, org, call({ startedAt: daysAgo(40), endedAt: daysAgo(40) }));
    const older = await recordConversation(db.admin, org, call({ startedAt: daysAgo(45), endedAt: daysAgo(45) }));
    const keptElsewhere = await recordConversation(db.admin, otherOrg, call({ startedAt: daysAgo(40), endedAt: daysAgo(40) }));
    assert.equal(await purgeExpiredConversations(db.appPool, 1), 1);
    assert.equal(await purgeExpiredConversations(db.appPool, 1), 1);
    assert.equal(await purgeExpiredConversations(db.appPool, 1), 0);
    const remaining = (await db.admin.query("SELECT id FROM app.conversations WHERE id = ANY($1)", [[old, older, keptElsewhere, booking]])).rows.map((row) => row.id).sort();
    assert.deepEqual(remaining, [booking, keptElsewhere].sort(), "30 days here, 90 days in the other organization");
    await assert.rejects(purgeExpiredConversations(db.appPool, 0), /invalid_cleanup_batch_size/);
  });
});

describe("export and organization deletion", () => {
  test("the owner's export includes conversations with transcripts and the retention period", async () => {
    const document = await as(ana, (client) => exportOrganization(client)) as { organization: { conversationRetentionDays: number }; conversations: Array<{ customerName: string; messages: Array<{ speaker: string }> }> };
    assert.equal(document.organization.conversationRetentionDays, 30);
    assert.deepEqual(document.conversations.map((item) => [item.customerName, item.messages.length]), [["Mila Petrović", 3]]);
    assert.ok(!JSON.stringify(document).includes("Tuđi"));
  });

  test("deleting the organization deletes its conversations and transcripts", async () => {
    await as(ana, (client) => deleteOrganization(client, "Salon Ana"));
    assert.equal(await count("conversations", org), 0);
    assert.equal(await count("conversation_messages", org), 0);
    assert.equal(await count("conversations", otherOrg), 2);
  });
});
