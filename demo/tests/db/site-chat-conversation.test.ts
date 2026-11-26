import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { AssistantConfig } from "../../lib/assistant/config.ts";
import { withOrganization } from "../../lib/db/context.ts";
import { createOrganization, provisionUser, saveWorkspace } from "../../lib/db/repositories.ts";
import { setSiteChat } from "../../lib/db/site-chat.ts";
import { answerVisitor, visitorHistory, type SiteChatReply } from "../../lib/site-chat/conversation.ts";
import { OFF_TOPIC_MARKER } from "../../lib/site-chat/policy.ts";
import { toStoredConfig } from "../../lib/workspace/persistence.ts";
import { chooseIndustry, createEmptyOrganizationDraft } from "../../lib/workspace/templates.ts";
import { startMockAnthropic, type MockAnthropic } from "../support/mock-anthropic.ts";
import { startTestDatabase, type TestDatabase } from "./harness.ts";

let db: TestDatabase;
let mock: MockAnthropic;
let owner: string, org: string, widget: string;
const previousSecret = process.env.RATE_LIMIT_SECRET;

before(async () => {
  process.env.RATE_LIMIT_SECRET = "test-only-rate-secret-0123456789abcdef";
  db = await startTestDatabase();
  mock = await startMockAnthropic(4596);
  owner = await provisionUser(db.appPool, { subject: "mock|ana", email: "ana@example.test", displayName: "Ana" });
  org = await createOrganization(db.appPool, owner, "Salon Ana");
  const draft = chooseIndustry(createEmptyOrganizationDraft(), "salon", "Salon Ana");
  draft.business = { ...draft.business, city: "Kraljevo" };
  draft.assistant = { ...draft.assistant, name: "Mila", greeting: "Dobar dan, ovde Mila, AI asistent salona Ana." };
  await withOrganization(db.appPool, { userId: owner, organizationId: org }, async (client) => {
    await saveWorkspace(client, { config: toStoredConfig(draft) as unknown as Record<string, unknown>, knowledge: [{ id: "k1", question: "Da li imate parking?", answer: "Da, iza zgrade." }], expectedRevision: 0 });
    widget = await setSiteChat(client, { enabled: true, allowedOrigins: ["https://salon-ana.rs"], dailyMessageLimit: 300 });
  });
});
after(async () => {
  await mock?.stop();
  await db?.stop();
  if (previousSecret === undefined) delete process.env.RATE_LIMIT_SECRET;
  else process.env.RATE_LIMIT_SECRET = previousSecret;
});
beforeEach(async () => {
  await db.admin.query("DELETE FROM app.rate_limit_buckets");
  await db.admin.query("DELETE FROM app.assistant_daily_spend");
  mock.respond(null);
});

const config = (): AssistantConfig => ({ apiKey: "test-only-anthropic-key", model: "claude-haiku-5-5", dailyBudgetMicrodollars: 1_000_000, baseURL: mock.url });
let address = 0;
/** Each call comes from a new client address unless one is given, so the per-address budgets stay out of the way. */
const send = (token: string | null, message: string, identity = `198.51.100.${++address % 250}`, publicId: string = widget) =>
  answerVisitor({ pool: db.appPool, config: config(), identity }, { publicId, token, message });
const ok = (result: SiteChatReply) => {
  assert.equal(result.status, "ok", JSON.stringify(result));
  return result as Extract<SiteChatReply, { status: "ok" }>;
};
const webConversations = async () => Number((await db.admin.query("SELECT count(*) FROM app.conversations WHERE organization_id = $1 AND channel = 'web'", [org])).rows[0].count);

test("a visitor's conversation is answered from the firm's data, kept on the server, and readable again with its token", async () => {
  mock.respond(() => ({ text: "Da, parking je iza zgrade.", inputTokens: 1600, outputTokens: 20 }));
  const start = mock.requests.length;
  const first = ok(await send(null, "Da li imate parking?"));
  assert.equal(first.reply, "Da, parking je iza zgrade.");
  assert.equal(first.ended, false);
  const request = mock.requests[start];
  assert.ok(request.body.system?.includes("in the chat on its website") && request.body.system.includes("Q: Da li imate parking?") && request.body.system.includes("Kraljevo"));
  assert.ok(!request.body.system?.includes("This conversation is a test"));
  assert.deepEqual(request.body.messages, [{ role: "user", content: "Da li imate parking?" }]);

  // Sending the same message again is refused without a provider request.
  const repeated = await send(first.token, "  da li imate   PARKING? ");
  assert.deepEqual([repeated.status, repeated.status === "error" && repeated.code], ["error", "invalid"]);
  assert.equal(mock.requests.length, start + 1);

  mock.respond(() => ({ text: "Ponedeljkom radimo od 9 do 17 h." }));
  ok(await send(first.token, "Kada radite?"));
  // The history comes from the database, never from the browser.
  assert.deepEqual(mock.requests.at(-1)!.body.messages.map((message) => message.role), ["user", "assistant", "user"]);

  const history = await visitorHistory({ pool: db.appPool, identity: "198.51.100.1" }, { publicId: widget, token: first.token });
  assert.equal(history.status, "ok");
  assert.deepEqual(history.status === "ok" && history.messages.map((message) => message.body), ["Dobar dan, ovde Mila, AI asistent salona Ana.", "Da li imate parking?", "Da, parking je iza zgrade.", "Kada radite?", "Ponedeljkom radimo od 9 do 17 h."]);
  // An unknown token reads as an empty conversation, not as an error that reveals anything.
  assert.deepEqual(await visitorHistory({ pool: db.appPool, identity: "198.51.100.1" }, { publicId: widget, token: "A".repeat(43) }), { status: "ok", messages: [], ended: false });
  const spend = await db.admin.query("SELECT requests FROM app.assistant_daily_spend");
  assert.equal(spend.rows[0].requests, 2);
});

test("unrelated messages get a short refusal without the marker, and the third in a row ends the conversation for good", async () => {
  mock.respond(() => ({ text: `${OFF_TOPIC_MARKER} Mogu da pomognem samo oko usluga salona Ana.` }));
  const first = ok(await send(null, "Koliko je 37 puta 43?"));
  assert.equal(first.reply, "Mogu da pomognem samo oko usluga salona Ana.");
  assert.equal(ok(await send(first.token, "Napiši mi pesmu o moru")).ended, false);
  const third = ok(await send(first.token, "Reši mi domaći iz fizike"));
  assert.equal(third.ended, true);

  const requests = mock.requests.length;
  const after = await send(first.token, "A sad?");
  assert.deepEqual([after.status, after.status === "error" && after.code], ["error", "restart"]);
  assert.equal(mock.requests.length, requests, "an ended conversation makes no provider request");
  const stored = await db.admin.query("SELECT body FROM app.conversation_messages m JOIN app.site_chat_threads t ON t.conversation_id = m.conversation_id WHERE t.ended ORDER BY m.position");
  assert.ok(stored.rows.every((row) => !String(row.body).includes(OFF_TOPIC_MARKER)), "the marker is never stored");

  // A related message in between resets the run.
  const mixed = ok(await send(null, "Koliko je 2+2?"));
  mock.respond(() => ({ text: "Radimo ponedeljkom od 9 do 17 h." }));
  ok(await send(mixed.token, "Kada radite?"));
  mock.respond(() => ({ text: `${OFF_TOPIC_MARKER} Samo pitanja o salonu.` }));
  assert.equal(ok(await send(mixed.token, "A 3+3?")).ended, false);
  assert.equal(ok(await send(mixed.token, "A 4+4?")).ended, false);
});

test("refusals happen before any provider request: chat off, bad input, unknown token, address burst, the firm's daily limit, the spending ceiling", async () => {
  const requests = mock.requests.length;
  const conversations = await webConversations();
  const code = (result: SiteChatReply) => (result.status === "error" ? result.code : "ok");

  assert.equal(code(await answerVisitor({ pool: db.appPool, config: null, identity: "x" }, { publicId: widget, token: null, message: "Ima li koga?" })), "unavailable");
  assert.equal(code(await send(null, "Ima li koga?", undefined, "0123456789abcdef0123")), "unavailable");
  assert.equal(code(await send(null, "Ima li koga?", undefined, "../../etc")), "unavailable");
  assert.equal(code(await send(null, "x".repeat(501))), "invalid");
  assert.equal(code(await send(null, "   ")), "invalid");
  assert.equal(code(await send("A".repeat(43), "Nastavljam tuđi razgovor")), "restart");
  assert.equal(code(await send("not-a-token", "Pitanje")), "restart");

  // One address: 8 messages a minute (each refused one above also counted for its own address only).
  for (let index = 0; index < 8; index++) await send(null, "x".repeat(501), "203.0.113.9");
  const burst = await send(null, "Pitanje", "203.0.113.9");
  assert.equal(code(burst), "limited");
  assert.ok(burst.status === "error" && burst.retryAfterSeconds! > 0);

  await withOrganization(db.appPool, { userId: owner, organizationId: org }, (client) => setSiteChat(client, { enabled: false, allowedOrigins: ["https://salon-ana.rs"], dailyMessageLimit: 300 }));
  assert.equal(code(await send(null, "Ima li koga?")), "unavailable");
  await withOrganization(db.appPool, { userId: owner, organizationId: org }, (client) => setSiteChat(client, { enabled: true, allowedOrigins: ["https://salon-ana.rs"], dailyMessageLimit: 10 }));

  await db.admin.query("INSERT INTO app.assistant_daily_spend (usage_day, cost_microdollars) VALUES ((now() AT TIME ZONE 'UTC')::date, 1000000)");
  assert.equal(code(await send(null, "Kada radite?")), "unavailable");
  await db.admin.query("DELETE FROM app.assistant_daily_spend");
  assert.equal(mock.requests.length, requests, "no refused message reached the provider");
  assert.equal(await webConversations(), conversations, "nothing was stored");

  // The firm's own limit counts messages from every address together (one was counted above).
  for (let index = 0; index < 9; index++) ok(await send(null, `Pitanje ${index}`));
  assert.equal(code(await send(null, "Jedanaesto pitanje")), "firm_limit");
  assert.equal(mock.requests.length, requests + 9);
  await withOrganization(db.appPool, { userId: owner, organizationId: org }, (client) => setSiteChat(client, { enabled: true, allowedOrigins: ["https://salon-ana.rs"], dailyMessageLimit: 300 }));
});

test("a provider failure stores nothing and tells the visitor to try again; a refusal still gives a useful reply", async () => {
  const conversations = await webConversations();
  mock.respond(() => ({ status: 401 }));
  const failed = await send(null, "Tajno pitanje kanarinac");
  assert.equal(failed.status === "error" && failed.code, "provider");
  // The visitor never learns about keys or the provider's error.
  assert.ok(failed.status === "error" && !/ključ|key|anthropic/i.test(failed.message));
  mock.respond(() => ({ status: 529 }));
  const busy = await send(null, "Pitanje");
  assert.ok(busy.status === "error" && /zauzet/.test(busy.message));
  assert.equal(await webConversations(), conversations);

  mock.respond(() => ({ stopReason: "refusal" }));
  const refused = ok(await send(null, "Nešto što model odbija"));
  assert.match(refused.reply, /Izvinite, na to trenutno ne mogu da odgovorim/);
  assert.equal(await webConversations(), conversations + 1);
});

test("two messages sent at once never interleave the stored transcript", async () => {
  const first = ok(await send(null, "Prvo pitanje"));
  const results = await Promise.all([send(first.token, "Drugo pitanje"), send(first.token, "Treće pitanje")]);
  assert.ok(results.some((result) => result.status === "ok"));
  // A losing request is told to reload, not stored next to the other answer.
  for (const result of results) if (result.status === "error") assert.equal(result.code, "changed");
  const history = await visitorHistory({ pool: db.appPool, identity: "198.51.100.2" }, { publicId: widget, token: first.token });
  const speakers = history.status === "ok" ? history.messages.map((message) => message.speaker) : [];
  for (let index = 1; index < speakers.length; index++) assert.notEqual(speakers[index], speakers[index - 1], speakers.join(","));
});
