import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, test } from "node:test";
import type { SessionData } from "@auth0/nextjs-auth0/types";
import { PostgresSessionStore, SESSION_DURATIONS } from "../../lib/auth/session-store.ts";
import { startTestDatabase, type TestDatabase } from "./harness.ts";

const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

let db: TestDatabase;
let store: PostgresSessionStore;
before(async () => {
  db = await startTestDatabase();
  store = new PostgresSessionStore(db.appPool, SECRET);
});
after(async () => { await db?.stop(); });

function session(sub: string, sid: string, extra: Partial<SessionData> = {}): SessionData {
  return {
    user: { sub, email: `${sub.split("|")[1]}@example.test` },
    tokenSet: { accessToken: `access-token-for-${sub}`, idToken: "header.payload.signature", expiresAt: Math.floor(Date.now() / 1000) + 3600 },
    internal: { sid, createdAt: Math.floor(Date.now() / 1000) },
    ...extra,
  };
}

const rowFor = async (id: string) => (await db.admin.query("SELECT * FROM app.auth_sessions WHERE id_hash = $1", [createHash("sha256").update(id).digest()])).rows[0];

test("sessions round-trip and are stored hashed and encrypted", async () => {
  await store.set("session-id-a", session("auth0|alice", "sid-a"));
  assert.equal((await store.get("session-id-a"))?.user.sub, "auth0|alice");

  const row = await rowFor("session-id-a");
  assert.ok(row, "row is addressed by the id's hash");
  assert.equal(row.subject, "auth0|alice");
  assert.equal(row.provider_session_id, "sid-a");
  const raw = (row.payload as Buffer).toString("latin1");
  assert.ok(!raw.includes("access-token-for"), "token is not stored in plain text");
  assert.ok(!raw.includes("alice@example.test"), "email is not stored in plain text");
  const { rowCount } = await db.admin.query("SELECT 1 FROM app.auth_sessions WHERE id_hash::text LIKE '%session-id-a%'");
  assert.equal(rowCount, 0);
});

test("expiry follows the inactivity window, capped by the absolute lifetime", async () => {
  await store.set("session-id-new", session("auth0|alice", "sid-new"));
  const fresh = await rowFor("session-id-new");
  const inSeconds = (new Date(fresh.expires_at).getTime() - Date.now()) / 1000;
  assert.ok(Math.abs(inSeconds - SESSION_DURATIONS.inactivity) < 60);

  const createdLongAgo = Math.floor(Date.now() / 1000) - SESSION_DURATIONS.absolute + 120;
  await store.set("session-id-old", session("auth0|alice", "sid-old", { internal: { sid: "sid-old", createdAt: createdLongAgo } }));
  const old = await rowFor("session-id-old");
  const remaining = (new Date(old.expires_at).getTime() - Date.now()) / 1000;
  assert.ok(remaining > 0 && remaining <= 120, "an old session cannot be extended past its absolute lifetime");
});

test("expired, tampered, or foreign-key sessions are not returned", async () => {
  await store.set("session-id-expired", session("auth0|alice", "sid-x"));
  await db.admin.query("UPDATE app.auth_sessions SET expires_at = now() - interval '1 second' WHERE subject = 'auth0|alice' AND provider_session_id = 'sid-x'");
  assert.equal(await store.get("session-id-expired"), null);
  assert.equal(await store.update("session-id-expired", session("auth0|alice", "sid-x")), false);

  await store.set("session-id-tampered", session("auth0|alice", "sid-t"));
  await db.admin.query("UPDATE app.auth_sessions SET payload = overlay(payload placing decode('00', 'hex') from 40 for 1) WHERE provider_session_id = 'sid-t'");
  assert.equal(await store.get("session-id-tampered"), null);

  await store.set("session-id-b", session("auth0|bob", "sid-b"));
  const other = new PostgresSessionStore(db.appPool, SECRET.replace("0", "f"));
  assert.equal(await other.get("session-id-b"), null, "a different secret cannot read sessions");

  // Moving one session's ciphertext onto another id fails authentication.
  await db.admin.query(
    `UPDATE app.auth_sessions SET payload = (SELECT payload FROM app.auth_sessions WHERE provider_session_id = 'sid-b')
     WHERE provider_session_id = 'sid-a'`,
  );
  assert.equal(await store.get("session-id-a"), null);
});

test("update only touches existing sessions; delete and back-channel logout remove them", async () => {
  assert.equal(await store.update("never-created", session("auth0|carol", "sid-c")), false);
  assert.equal(await store.get("never-created"), null);

  await store.set("session-id-c1", session("auth0|carol", "sid-c1"));
  await store.set("session-id-c2", session("auth0|carol", "sid-c2"));
  await store.set("session-id-d", session("auth0|dave", "sid-d"));
  assert.equal(await store.update("session-id-c1", session("auth0|carol", "sid-c1", { user: { sub: "auth0|carol", name: "Carol" } })), true);
  assert.equal((await store.get("session-id-c1"))?.user.name, "Carol");

  await store.delete("session-id-c1");
  assert.equal(await store.get("session-id-c1"), null);

  await store.deleteByLogoutToken({});
  assert.ok(await store.get("session-id-c2"), "an empty logout token removes nothing");
  await store.deleteByLogoutToken({ sub: "auth0|dave", sid: "sid-c2" });
  assert.ok(await store.get("session-id-c2"), "sid and sub must both match when both are given");
  await store.deleteByLogoutToken({ sub: "auth0|carol" });
  assert.equal(await store.get("session-id-c2"), null);
  assert.ok(await store.get("session-id-d"), "other users keep their sessions");
});

test("the application role cannot read the sessions table directly", async () => {
  await assert.rejects(db.appPool.query("SELECT * FROM app.auth_sessions"), /permission denied/);
  await assert.rejects(db.appPool.query("DELETE FROM app.auth_sessions"), /permission denied/);
});

test("expired sessions can be purged", async () => {
  const { rows } = await db.appPool.query("SELECT app.auth_session_purge_expired() AS removed");
  assert.ok(rows[0].removed >= 1);
  assert.equal((await db.admin.query("SELECT 1 FROM app.auth_sessions WHERE expires_at <= now()")).rowCount, 0);
});

test("a short secret is rejected", () => {
  assert.throws(() => new PostgresSessionStore(db.appPool, "too-short"), /at least 32/);
});
