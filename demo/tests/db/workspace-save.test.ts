import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { PoolClient } from "pg";
import { withOrganization } from "../../lib/db/context.ts";
import { ConflictError, createOrganization, getAssistantConfig, listKnowledge, provisionUser, saveWorkspace } from "../../lib/db/repositories.ts";
import { toStoredConfig } from "../../lib/workspace/persistence.ts";
import { createCompleteExample } from "../../lib/workspace/templates.ts";
import { startTestDatabase, type TestDatabase } from "./harness.ts";

let db: TestDatabase;
let alice: string, bob: string, carol: string;
let orgA: string, orgB: string;

before(async () => {
  db = await startTestDatabase();
  alice = await provisionUser(db.appPool, { subject: "auth0|alice", email: null, displayName: "Alice" });
  bob = await provisionUser(db.appPool, { subject: "auth0|bob", email: null, displayName: "Bob" });
  carol = await provisionUser(db.appPool, { subject: "auth0|carol", email: null, displayName: "Carol" });
  orgA = await createOrganization(db.appPool, alice, "Studio Mila");
  orgB = await createOrganization(db.appPool, bob, "Servis Jovanović");
  await db.admin.query("INSERT INTO app.memberships (organization_id, user_id, role) VALUES ($1, $2, 'member')", [orgA, carol]);
});
after(async () => { await db?.stop(); });

const asAlice = <T>(work: (client: PoolClient) => Promise<T>) => withOrganization(db.appPool, { userId: alice, organizationId: orgA }, work);
const asBob = <T>(work: (client: PoolClient) => Promise<T>) => withOrganization(db.appPool, { userId: bob, organizationId: orgB }, work);
const config = toStoredConfig(createCompleteExample()) as unknown as Record<string, unknown>;

test("the first save stores the configuration and assigns server ids to new knowledge", async () => {
  const result = await asAlice((client) => saveWorkspace(client, {
    config,
    knowledge: [
      { id: "knowledge-local-1", question: "Da li je potrebno zakazivanje?", answer: "Preporučujemo." },
      { id: "knowledge-local-2", question: "Parking?", answer: "Ispred salona." },
    ],
    expectedRevision: 0,
  }));
  assert.equal(result.revision, 1);
  assert.deepEqual(Object.keys(result.idMap).sort(), ["knowledge-local-1", "knowledge-local-2"]);
  assert.ok(Object.values(result.idMap).every((id) => /^[0-9a-f-]{36}$/.test(id)));

  await asAlice(async (client) => {
    assert.equal((await getAssistantConfig(client))?.revision, 1);
    assert.deepEqual((await listKnowledge(client)).map((entry) => entry.question), ["Da li je potrebno zakazivanje?", "Parking?"]);
  });
  const audit = await db.admin.query("SELECT action, target FROM app.audit_events WHERE organization_id = $1 AND action = 'workspace.save'", [orgA]);
  assert.deepEqual(audit.rows, [{ action: "workspace.save", target: "revision 1" }]);
});

test("later saves update, delete, and add knowledge by id", async () => {
  const [first] = await asAlice((client) => listKnowledge(client));
  const result = await asAlice((client) => saveWorkspace(client, {
    config,
    knowledge: [
      { id: first.id, question: first.question, answer: "Da, preporučujemo zakazivanje." },
      { id: "knowledge-local-3", question: "Radite li nedeljom?", answer: "Ne." },
    ],
    expectedRevision: 1,
  }));
  assert.equal(result.revision, 2);
  assert.deepEqual(Object.keys(result.idMap), ["knowledge-local-3"]);
  const entries = await asAlice((client) => listKnowledge(client));
  assert.deepEqual(entries.map((entry) => [entry.question, entry.answer]), [["Da li je potrebno zakazivanje?", "Da, preporučujemo zakazivanje."], ["Radite li nedeljom?", "Ne."]]);
  assert.equal(entries[0].id, first.id, "existing rows keep their id");
});

test("a stale revision is rejected and changes nothing", async () => {
  const before = await asAlice((client) => listKnowledge(client));
  await assert.rejects(asAlice((client) => saveWorkspace(client, { config, knowledge: [], expectedRevision: 1 })), ConflictError);
  assert.deepEqual(await asAlice((client) => listKnowledge(client)), before);
});

test("members cannot save, and nothing changes", async () => {
  const before = await asAlice((client) => listKnowledge(client));
  await assert.rejects(
    withOrganization(db.appPool, { userId: carol, organizationId: orgA }, (client) => saveWorkspace(client, { config, knowledge: [], expectedRevision: 2 })),
    (error: Error) => error instanceof ConflictError || /row-level security/.test(error.message),
  );
  assert.deepEqual(await asAlice((client) => listKnowledge(client)), before);
});

test("knowledge ids from another organization are inserted as new entries, never edited", async () => {
  const aliceEntries = await asAlice((client) => listKnowledge(client));
  const result = await asBob((client) => saveWorkspace(client, {
    config,
    knowledge: [{ id: aliceEntries[0].id, question: "Preuzeto pitanje", answer: "Pokušaj izmene tuđeg odgovora." }],
    expectedRevision: 0,
  }));
  assert.ok(result.idMap[aliceEntries[0].id]);
  assert.notEqual(result.idMap[aliceEntries[0].id], aliceEntries[0].id);
  assert.deepEqual(await asAlice((client) => listKnowledge(client)), aliceEntries, "the other organization's knowledge is unchanged");
  assert.deepEqual((await asBob((client) => listKnowledge(client))).map((entry) => entry.question), ["Preuzeto pitanje"]);
});
