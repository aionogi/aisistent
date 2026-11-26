import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { PoolClient } from "pg";
import { withOrganization } from "../../lib/db/context.ts";
import { deleteConversation, getConversationMessages, listConversations } from "../../lib/db/conversations.ts";
import { createOrganization, provisionUser } from "../../lib/db/repositories.ts";
import { appendSiteMessages, getSiteChatSettings, getSiteThread, openSiteChat, recordSiteChatUsage, setSiteChat, siteChatFrameOrigins, SiteChatError, type SiteChatErrorCode } from "../../lib/db/site-chat.ts";
import { deleteOrganization, exportOrganization } from "../../lib/db/team.ts";
import { newVisitorToken, visitorTokenHash } from "../../lib/site-chat/token.ts";
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
const fails = (code: SiteChatErrorCode) => (error: unknown) => error instanceof SiteChatError && error.code === code;
const hash = () => visitorTokenHash(newVisitorToken())!;
const exchange = (question: string, answer: string) => [{ speaker: "customer" as const, body: question }, { speaker: "assistant" as const, body: answer }];
const state = { offTopic: false, end: false };

test("owners and admins turn the chat on for chosen websites; members only read the settings", async () => {
  assert.equal(await as(mila, (client) => getSiteChatSettings(client)), null);
  const id = await as(ana, (client) => setSiteChat(client, { enabled: true, allowedOrigins: ["https://salon-ana.rs"], dailyMessageLimit: 300 }));
  assert.match(id, /^[0-9a-f]{20}$/);
  // The public id stays the same when the settings change, so the embed code keeps working.
  assert.equal(await as(marko, (client) => setSiteChat(client, { enabled: true, allowedOrigins: ["https://salon-ana.rs", "https://www.salon-ana.rs"], dailyMessageLimit: 120 })), id);
  const settings = await as(mila, (client) => getSiteChatSettings(client));
  assert.deepEqual([settings?.publicId, settings?.enabled, settings?.allowedOrigins, settings?.dailyMessageLimit], [id, true, ["https://salon-ana.rs", "https://www.salon-ana.rs"], 120]);
  await assert.rejects(as(mila, (client) => setSiteChat(client, { enabled: false, allowedOrigins: [], dailyMessageLimit: 300 })), fails("forbidden"));
  // Another firm's members see nothing of it.
  assert.equal(await as(stranger, (client) => getSiteChatSettings(client), otherOrg), null);
  const { rows } = await db.admin.query("SELECT target FROM app.audit_events WHERE organization_id = $1 AND action = 'site_chat.change' ORDER BY id", [org]);
  assert.deepEqual(rows.map((row) => row.target), ["on", "on"]);
});

test("only https website origins are accepted, at most five, and turning on needs at least one", async () => {
  for (const origins of [[], ["http://salon.rs"], ["https://salon.rs/"], ["https://salon.rs:8443"], ["https://127.0.0.1"], ["https://localhost"], ["https://Salon.rs"], ["javascript:alert(1)"], Array(6).fill("https://salon.rs")]) {
    await assert.rejects(as(ana, (client) => setSiteChat(client, { enabled: true, allowedOrigins: origins, dailyMessageLimit: 300 })), fails("invalid"), JSON.stringify(origins));
  }
  for (const limit of [9, 5001]) {
    await assert.rejects(as(ana, (client) => setSiteChat(client, { enabled: true, allowedOrigins: ["https://salon-ana.rs"], dailyMessageLimit: limit })), fails("invalid"));
  }
});

test("a visitor's conversation is created on the first message and continues only with its token", async () => {
  const id = await as(ana, (client) => setSiteChat(client, { enabled: true, allowedOrigins: ["https://salon-ana.rs"], dailyMessageLimit: 300 }));
  assert.deepEqual(await siteChatFrameOrigins(db.appPool, id), ["https://salon-ana.rs"]);
  const open = await openSiteChat(db.appPool, id);
  assert.equal(open?.organizationId, org);
  assert.equal(open?.dailyMessageLimit, 300);

  const visitor = hash();
  assert.equal(await getSiteThread(db.appPool, id, visitor), null);
  assert.equal(await appendSiteMessages(db.appPool, id, visitor, 0, [{ speaker: "assistant", body: "Dobar dan, Salon Ana." }, ...exchange("Radite li subotom?", "Da, od 9 do 15 h.")], state), 3);
  assert.equal(await appendSiteMessages(db.appPool, id, visitor, 3, exchange("A nedeljom?", "Nedeljom ne radimo."), state), 5);
  const thread = await getSiteThread(db.appPool, id, visitor);
  assert.deepEqual(thread?.messages.map((message) => message.body), ["Dobar dan, Salon Ana.", "Radite li subotom?", "Da, od 9 do 15 h.", "A nedeljom?", "Nedeljom ne radimo."]);
  assert.equal(thread?.ended, false);

  // A second answer computed from the same history is refused instead of interleaving.
  await assert.rejects(appendSiteMessages(db.appPool, id, visitor, 3, exchange("Dupla", "Dupla"), state), fails("changed"));
  // A made-up token starts nothing unless the caller says it is a new conversation.
  await assert.rejects(appendSiteMessages(db.appPool, id, hash(), 2, exchange("Upad", "Upad"), state), fails("changed"));

  // The firm's members see the conversation under its own channel.
  const stored = (await as(mila, (client) => listConversations(client))).find((conversation) => conversation.channel === "web");
  assert.equal(stored?.summary, "Radite li subotom?");
  assert.equal((await as(mila, (client) => getConversationMessages(client, stored!.id))).length, 5);
});

test("a token works only with the widget it started on, and nothing reaches another firm", async () => {
  const id = (await as(ana, (client) => getSiteChatSettings(client)))!.publicId;
  const otherId = await as(stranger, (client) => setSiteChat(client, { enabled: true, allowedOrigins: ["https://druga.rs"], dailyMessageLimit: 300 }), otherOrg);
  const visitor = hash();
  await appendSiteMessages(db.appPool, id, visitor, 0, exchange("Pitanje", "Odgovor"), state);
  assert.equal(await getSiteThread(db.appPool, otherId, visitor), null);
  await assert.rejects(appendSiteMessages(db.appPool, otherId, visitor, 0, exchange("Tuđe", "Tuđe"), state), fails("changed"));
  assert.equal((await as(stranger, (client) => listConversations(client), otherOrg)).length, 0);
});

test("messages are bounded, a conversation holds at most 40, and an ended one takes no more", async () => {
  const id = (await as(ana, (client) => getSiteChatSettings(client)))!.publicId;
  for (const messages of [[], [{ speaker: "team", body: "Tim" }], [{ speaker: "customer", body: " " }], [{ speaker: "customer", body: "x".repeat(2001) }], Array(4).fill({ speaker: "customer", body: "x" })]) {
    await assert.rejects(appendSiteMessages(db.appPool, id, hash(), 0, messages as never, state), /invalid_messages/);
  }
  await assert.rejects(appendSiteMessages(db.appPool, id, Buffer.alloc(16), 0, exchange("Kratak", "Kratak"), state), /invalid_messages/);

  const long = hash();
  let count = 0;
  for (let index = 0; index < 20; index++) count = await appendSiteMessages(db.appPool, id, long, count, exchange(`Pitanje ${index}`, `Odgovor ${index}`), state);
  assert.equal(count, 40);
  await assert.rejects(appendSiteMessages(db.appPool, id, long, 40, exchange("Još", "Ne"), state), fails("full"));

  const offTopic = hash();
  count = await appendSiteMessages(db.appPool, id, offTopic, 0, exchange("Koliko je 2+2?", "Mogu da pomognem samo oko salona."), { offTopic: true, end: false });
  count = await appendSiteMessages(db.appPool, id, offTopic, count, exchange("Napiši pesmu", "Mogu da pomognem samo oko salona."), { offTopic: true, end: false });
  assert.equal((await getSiteThread(db.appPool, id, offTopic))?.offTopicStreak, 2);
  count = await appendSiteMessages(db.appPool, id, offTopic, count, exchange("A sad?", "Razgovor završavam."), { offTopic: true, end: true });
  const ended = await getSiteThread(db.appPool, id, offTopic);
  assert.deepEqual([ended?.ended, ended?.offTopicStreak], [true, 3]);
  await assert.rejects(appendSiteMessages(db.appPool, id, offTopic, count, exchange("Još", "Ne"), state), fails("ended"));

  // A related message resets the run.
  const reset = hash();
  count = await appendSiteMessages(db.appPool, id, reset, 0, exchange("Koliko je 2+2?", "Samo salon."), { offTopic: true, end: false });
  await appendSiteMessages(db.appPool, id, reset, count, exchange("Radite li subotom?", "Da."), state);
  assert.equal((await getSiteThread(db.appPool, id, reset))?.offTopicStreak, 0);
});

test("a widget that is off answers nothing, records nothing, and its frame stays allowed", async () => {
  const id = await as(ana, (client) => setSiteChat(client, { enabled: false, allowedOrigins: ["https://salon-ana.rs"], dailyMessageLimit: 300 }));
  assert.equal(await openSiteChat(db.appPool, id), null);
  assert.deepEqual(await siteChatFrameOrigins(db.appPool, id), ["https://salon-ana.rs"]);
  assert.equal(await siteChatFrameOrigins(db.appPool, "0123456789abcdef0123"), null);
  const visitor = hash();
  await assert.rejects(appendSiteMessages(db.appPool, id, visitor, 0, exchange("Ima li koga?", "Ne"), state), fails("unavailable"));
  await assert.rejects(recordSiteChatUsage(db.appPool, id, { inputTokens: 1, outputTokens: 1, costMicrodollars: 1 }), fails("unavailable"));
  await as(ana, (client) => setSiteChat(client, { enabled: true, allowedOrigins: ["https://salon-ana.rs"], dailyMessageLimit: 300 }));
});

test("spending for the website chat counts toward the server's daily total", async () => {
  const id = (await as(ana, (client) => getSiteChatSettings(client)))!.publicId;
  await db.admin.query("DELETE FROM app.assistant_daily_spend");
  await recordSiteChatUsage(db.appPool, id, { inputTokens: 1500, outputTokens: 40, costMicrodollars: 170 });
  const { rows } = await db.admin.query("SELECT requests, cost_microdollars::int AS cost FROM app.assistant_daily_spend");
  assert.deepEqual(rows, [{ requests: 1, cost: 170 }]);
  await assert.rejects(recordSiteChatUsage(db.appPool, id, { inputTokens: -1, outputTokens: 1, costMicrodollars: 1 }), /invalid_usage/);
});

test("the runtime cannot read threads or settings directly, and the export carries the settings but no tokens", async () => {
  await assert.rejects(db.appPool.query("SELECT * FROM app.site_chat_threads"), /permission denied/);
  await assert.rejects(as(ana, (client) => client.query("UPDATE app.site_chat_settings SET enabled = true")), /permission denied/);
  // Outside an organization the settings policy shows nothing.
  assert.equal((await db.appPool.query("SELECT 1 FROM app.site_chat_settings")).rowCount, 0);

  const document = await as(ana, (client) => exportOrganization(client)) as { siteChat: { enabled: boolean; allowedOrigins: string[]; dailyMessageLimit: number }; conversations: Array<{ channel: string }> };
  assert.deepEqual([document.siteChat.enabled, document.siteChat.allowedOrigins, document.siteChat.dailyMessageLimit], [true, ["https://salon-ana.rs"], 300]);
  assert.ok(document.conversations.some((conversation) => conversation.channel === "web"));
  const text = JSON.stringify(document);
  const { rows } = await db.admin.query("SELECT encode(token_hash, 'hex') AS hash FROM app.site_chat_threads WHERE organization_id = $1 LIMIT 1", [org]);
  assert.ok(!text.includes(rows[0].hash) && !text.includes("token_hash") && !text.includes("publicId"));
});

test("deleting a conversation or the organization removes the visitor threads with it", async () => {
  const id = (await as(ana, (client) => getSiteChatSettings(client)))!.publicId;
  const visitor = hash();
  await appendSiteMessages(db.appPool, id, visitor, 0, exchange("Za brisanje", "U redu"), state);
  const conversation = (await as(ana, (client) => listConversations(client))).find((item) => item.summary === "Za brisanje")!;
  await as(ana, (client) => deleteConversation(client, conversation.id));
  assert.equal(await getSiteThread(db.appPool, id, visitor), null);
  // The visitor starts over rather than writing into a deleted conversation.
  assert.equal(await appendSiteMessages(db.appPool, id, visitor, 0, exchange("Novo", "Novo"), state), 2);

  await as(ana, (client) => deleteOrganization(client, "Salon Ana"));
  const { rows } = await db.admin.query("SELECT (SELECT count(*) FROM app.site_chat_settings WHERE organization_id = $1)::int AS settings, (SELECT count(*) FROM app.site_chat_threads WHERE organization_id = $1)::int AS threads", [org]);
  assert.deepEqual(rows, [{ settings: 0, threads: 0 }]);
  assert.equal(await openSiteChat(db.appPool, id), null);
});
