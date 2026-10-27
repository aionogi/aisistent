import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { SessionData } from "@auth0/nextjs-auth0/types";
import { PostgresSessionStore } from "../../lib/auth/session-store.ts";
import { withUser } from "../../lib/db/context.ts";
import { provisionUser } from "../../lib/db/repositories.ts";
import { endMySessions, listMySessions } from "../../lib/db/sessions.ts";
import { startTestDatabase, type TestDatabase } from "./harness.ts";

const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

let db: TestDatabase;
let store: PostgresSessionStore;
let ana: string, marko: string;
before(async () => {
  db = await startTestDatabase();
  store = new PostgresSessionStore(db.appPool, SECRET);
  ana = await provisionUser(db.appPool, { subject: "mock|ana", email: "ana@example.test", displayName: "Ana" });
  marko = await provisionUser(db.appPool, { subject: "mock|marko", email: "marko@example.test", displayName: "Marko" });
});
after(async () => { await db?.stop(); });

function session(sub: string, sid: string): SessionData {
  return { user: { sub }, tokenSet: { accessToken: "", expiresAt: Math.floor(Date.now() / 1000) + 3600 }, internal: { sid, createdAt: Math.floor(Date.now() / 1000) } };
}

test("users see only their own unexpired sessions, as times", async () => {
  await store.set("ana-laptop", session("mock|ana", "sid-1"));
  await store.set("ana-phone", session("mock|ana", "sid-2"));
  await store.set("ana-old", session("mock|ana", "sid-3"));
  await db.admin.query("UPDATE app.auth_sessions SET expires_at = now() - interval '1 minute' WHERE provider_session_id = 'sid-3'");
  await store.set("marko-laptop", session("mock|marko", "sid-4"));

  const sessions = await withUser(db.appPool, ana, (client) => listMySessions(client));
  assert.equal(sessions.length, 2);
  assert.deepEqual(Object.keys(sessions[0]).sort(), ["createdAt", "expiresAt", "updatedAt"]);
  assert.ok(sessions.every((item) => item.expiresAt > new Date()));
  assert.equal((await withUser(db.appPool, marko, (client) => listMySessions(client))).length, 1);
});

test("without a user context nothing is listed and nothing can be ended", async () => {
  const { rows } = await db.appPool.query("SELECT * FROM app.my_sessions()");
  assert.deepEqual(rows, []);
  await assert.rejects(db.appPool.query("SELECT app.end_my_sessions()"), /user_required/);
  assert.equal(Number((await db.admin.query("SELECT count(*) FROM app.auth_sessions")).rows[0].count), 4);
});

test("ending sessions removes every session of that user, including expired rows, and nobody else's", async () => {
  assert.equal(await withUser(db.appPool, ana, (client) => endMySessions(client)), 3);
  assert.equal(await store.get("ana-laptop"), null);
  assert.equal(await store.get("ana-phone"), null);
  assert.ok(await store.get("marko-laptop"), "another user's session remains");
  const { rows } = await db.admin.query("SELECT organization_id, actor_user_id, target FROM app.audit_events WHERE action = 'auth.sessions_end'");
  assert.deepEqual(rows, [{ organization_id: null, actor_user_id: ana, target: "3" }]);
  assert.equal(await withUser(db.appPool, ana, (client) => endMySessions(client)), 0, "repeating is harmless");
});
