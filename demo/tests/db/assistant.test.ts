import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { PoolClient } from "pg";
import { appendTestMessages, assistantBudgetAvailable, getTestTranscript, recordAssistantUsage, TestConversationError } from "../../lib/db/assistant.ts";
import { withOrganization } from "../../lib/db/context.ts";
import { listConversations, recordConversation } from "../../lib/db/conversations.ts";
import { createOrganization, provisionUser } from "../../lib/db/repositories.ts";
import { exportOrganization } from "../../lib/db/team.ts";
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
});
after(async () => { await db?.stop(); });

const as = <T>(userId: string, work: (client: PoolClient) => Promise<T>, organizationId = org) => withOrganization(db.appPool, { userId, organizationId }, work);
const exchange = (question: string, answer: string) => [{ speaker: "customer" as const, body: question }, { speaker: "assistant" as const, body: answer }];
const today = () => new Date().toISOString().slice(0, 10);

test("owners and admins keep a test conversation whose history comes back in order", async () => {
  const id = await as(ana, (client) => appendTestMessages(client, null, [{ speaker: "assistant", body: "Dobar dan, Salon Ana." }, ...exchange("Radite li subotom?", "Da, od 9 do 15 h.")]));
  await as(marko, (client) => appendTestMessages(client, id, exchange("A nedeljom?", "Nedeljom ne radimo.")));
  const transcript = await as(mila, (client) => getTestTranscript(client, id));
  assert.deepEqual(transcript?.map((message) => message.body), ["Dobar dan, Salon Ana.", "Radite li subotom?", "Da, od 9 do 15 h.", "A nedeljom?", "Nedeljom ne radimo."]);
  const [stored] = await as(mila, (client) => listConversations(client));
  assert.equal(stored.channel, "test");
  assert.equal(stored.summary, "Radite li subotom?");
  // Test conversations belong to the organization's data: export includes them.
  const exported = await as(ana, (client) => exportOrganization(client)) as { conversations: Array<{ channel: string }> };
  assert.ok(exported.conversations.some((conversation) => conversation.channel === "test"));
});

test("members cannot write test conversations, and nobody can extend another organization's", async () => {
  await assert.rejects(as(mila, (client) => appendTestMessages(client, null, exchange("Pitanje", "Odgovor"))), /editor_required/);
  const foreign = await withOrganization(db.appPool, { userId: stranger, organizationId: otherOrg }, (client) => appendTestMessages(client, null, exchange("Tuđe", "Tuđe")));
  await assert.rejects(as(ana, (client) => appendTestMessages(client, foreign, exchange("Upad", "Upad"))), (error) => error instanceof TestConversationError && error.code === "not_found");
  assert.equal(await as(ana, (client) => getTestTranscript(client, foreign)), null);
  // A recorded call cannot be extended through the test path either.
  const call = await recordConversation(db.admin, org, { channel: "call", outcome: "answered", startedAt: new Date(), messages: [{ speaker: "assistant", body: "Dobar dan." }] });
  await assert.rejects(as(ana, (client) => appendTestMessages(client, call, exchange("Upad", "Upad"))), (error) => error instanceof TestConversationError && error.code === "not_found");
  assert.equal(await as(ana, (client) => getTestTranscript(client, call)), null);
});

test("only customer and assistant messages of bounded length are accepted, and a conversation holds at most 60", async () => {
  for (const messages of [[], [{ speaker: "team", body: "Tim" }], [{ speaker: "customer", body: " " }], [{ speaker: "customer", body: "x".repeat(4001) }], Array(5).fill({ speaker: "customer", body: "x" })]) {
    await assert.rejects(as(ana, (client) => appendTestMessages(client, null, messages as never)), /invalid_messages/);
  }
  let id: string | null = null;
  for (let index = 0; index < 30; index++) id = await as(ana, (client) => appendTestMessages(client, id, exchange(`Pitanje ${index}`, `Odgovor ${index}`)));
  await assert.rejects(as(ana, (client) => appendTestMessages(client, id, exchange("Još jedno", "Ne"))), (error) => error instanceof TestConversationError && error.code === "full");
});

test("spending is counted per UTC day, only for editors, and the budget closes at the limit", async () => {
  await db.admin.query("DELETE FROM app.assistant_daily_spend");
  assert.equal(await as(ana, (client) => assistantBudgetAvailable(client, 1000)), true);
  await as(ana, (client) => recordAssistantUsage(client, { inputTokens: 2000, outputTokens: 100, costMicrodollars: 600 }));
  await as(marko, (client) => recordAssistantUsage(client, { inputTokens: 1000, outputTokens: 50, costMicrodollars: 400 }));
  const { rows } = await db.admin.query("SELECT usage_day::text AS day, requests, input_tokens::int AS input, output_tokens::int AS output, cost_microdollars::int AS cost FROM app.assistant_daily_spend");
  assert.deepEqual(rows, [{ day: today(), requests: 2, input: 3000, output: 150, cost: 1000 }]);
  assert.equal(await as(ana, (client) => assistantBudgetAvailable(client, 1000)), false);
  assert.equal(await as(ana, (client) => assistantBudgetAvailable(client, 1001)), true);
  assert.equal(await as(ana, (client) => assistantBudgetAvailable(client, 0)), false);
  await assert.rejects(as(mila, (client) => recordAssistantUsage(client, { inputTokens: 1, outputTokens: 1, costMicrodollars: 1 })), /editor_required/);
  await assert.rejects(as(ana, (client) => recordAssistantUsage(client, { inputTokens: -1, outputTokens: 1, costMicrodollars: 1 })), /invalid_usage/);
});

test("the runtime reaches the new data only through the functions", async () => {
  await assert.rejects(db.appPool.query("SELECT * FROM app.assistant_daily_spend"), /permission denied/);
  await assert.rejects(as(ana, (client) => client.query("INSERT INTO app.conversations (organization_id, channel, outcome, started_at) VALUES (app.current_organization_id(), 'test', 'answered', now())")), /permission denied/);
  await assert.rejects(as(ana, (client) => client.query("SELECT app.require_editor()")), /permission denied/);
  // Fabricating a call or message record stays reserved for the future ingestion path.
  await assert.rejects(as(ana, (client) => client.query("SELECT app.record_conversation(app.current_organization_id(), '{}'::jsonb)")), /permission denied/);
});
