import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createOrganization, provisionUser } from "../../lib/db/repositories.ts";
import { consumeRateLimit, purgeOperationalData } from "../../lib/operations/store.ts";
import { startTestDatabase, type TestDatabase } from "./harness.ts";

const run = promisify(execFile);
const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let db: TestDatabase;
before(async () => { db = await startTestDatabase(); });
after(async () => { await db?.stop(); });
const invalidParameter = (error: unknown) => (error as { code?: string }).code === "22023";

test("parallel requests admit exactly the quota and denied requests cannot grow the counter", async () => {
  const key = randomBytes(32);
  const results = await Promise.all(Array.from({ length: 40 }, () => consumeRateLimit(db.appPool, key, 7, 60)));
  assert.equal(results.filter((result) => result.allowed).length, 7);
  assert.ok(results.filter((result) => !result.allowed).every((result) => result.retryAfterSeconds >= 1 && result.retryAfterSeconds <= 60));
  assert.ok(results.filter((result) => result.allowed).every((result) => result.retryAfterSeconds === 0));
  const row = (await db.admin.query("SELECT request_count, expires_at FROM app.rate_limit_buckets WHERE bucket_key = $1", [key])).rows[0];
  assert.equal(row.request_count, 7);
  await consumeRateLimit(db.appPool, key, 7, 60);
  const unchanged = (await db.admin.query("SELECT request_count, expires_at FROM app.rate_limit_buckets WHERE bucket_key = $1", [key])).rows[0];
  assert.deepEqual(unchanged, row, "denials neither extend expiry nor increment the counter");
});

test("keys are isolated and an expired fixed window starts again atomically", async () => {
  const key = randomBytes(32);
  assert.equal((await consumeRateLimit(db.appPool, key, 2, 60)).allowed, true);
  const original = (await db.admin.query("SELECT expires_at FROM app.rate_limit_buckets WHERE bucket_key = $1", [key])).rows[0].expires_at;
  assert.equal((await consumeRateLimit(db.appPool, key, 2, 120)).allowed, true);
  const afterSecond = (await db.admin.query("SELECT expires_at FROM app.rate_limit_buckets WHERE bucket_key = $1", [key])).rows[0].expires_at;
  assert.deepEqual(afterSecond, original, "later calls cannot extend an existing window");
  assert.equal((await consumeRateLimit(db.appPool, key, 2, 60)).allowed, false);
  assert.equal((await consumeRateLimit(db.appPool, randomBytes(32), 2, 60)).allowed, true);

  await db.admin.query("UPDATE app.rate_limit_buckets SET expires_at = now() - interval '1 second' WHERE bucket_key = $1", [key]);
  const reset = await Promise.all(Array.from({ length: 8 }, () => consumeRateLimit(db.appPool, key, 2, 60)));
  assert.equal(reset.filter((result) => result.allowed).length, 2);
  const row = (await db.admin.query("SELECT request_count, expires_at > now() AS active FROM app.rate_limit_buckets WHERE bucket_key = $1", [key])).rows[0];
  assert.deepEqual(row, { request_count: 2, active: true });
});

test("database bounds reject invalid keys, quotas, and windows", async () => {
  for (const key of [null, randomBytes(31), randomBytes(33)]) {
    await assert.rejects(db.appPool.query("SELECT * FROM app.consume_rate_limit($1, 5, 60)", [key]), invalidParameter);
  }
  for (const limit of [null, 0, -1, 10001]) {
    await assert.rejects(db.appPool.query("SELECT * FROM app.consume_rate_limit($1, $2, 60)", [randomBytes(32), limit]), invalidParameter);
  }
  for (const seconds of [null, 0, -1, 86401]) {
    await assert.rejects(db.appPool.query("SELECT * FROM app.consume_rate_limit($1, 5, $2)", [randomBytes(32), seconds]), invalidParameter);
  }
});

test("the runtime cannot access bucket rows and operational functions are not public", async () => {
  for (const statement of ["SELECT * FROM app.rate_limit_buckets", "DELETE FROM app.rate_limit_buckets", "UPDATE app.rate_limit_buckets SET request_count = 1"]) {
    await assert.rejects(db.appPool.query(statement), /permission denied/);
  }
  await db.admin.query("CREATE ROLE operations_outsider NOLOGIN");
  const { rows } = await db.admin.query(`SELECT
    has_function_privilege('operations_outsider', 'app.consume_rate_limit(bytea,integer,integer)', 'EXECUTE') AS outsider_limit,
    has_function_privilege('operations_outsider', 'app.purge_operational_data(integer)', 'EXECUTE') AS outsider_cleanup,
    has_function_privilege('aisistent_runtime', 'app.consume_rate_limit(bytea,integer,integer)', 'EXECUTE') AS runtime_limit,
    has_function_privilege('aisistent_runtime', 'app.purge_operational_data(integer)', 'EXECUTE') AS runtime_cleanup`);
  assert.deepEqual(rows[0], { outsider_limit: false, outsider_cleanup: false, runtime_limit: true, runtime_cleanup: true });
});

test("cleanup is bounded, repeatable and preserves active rows, memberships and audit history", async () => {
  const owner = await provisionUser(db.appPool, { subject: "mock|cleanup", email: "cleanup@example.test", displayName: "Cleanup" });
  const org = await createOrganization(db.appPool, owner, "Cleanup test");
  const initial = (await db.admin.query("SELECT (SELECT count(*) FROM app.memberships) AS memberships, (SELECT count(*) FROM app.audit_events) AS audits")).rows[0];
  for (let index = 0; index < 4; index += 1) {
    const expired = index < 3;
    await db.admin.query(
      "INSERT INTO app.auth_sessions (id_hash, subject, payload, expires_at) VALUES ($1, 'mock|cleanup', $2, now() + $3 * interval '1 hour')",
      [randomBytes(32), Buffer.from("encrypted-fixture"), expired ? -1 : 1],
    );
    await db.admin.query(
      `INSERT INTO app.invitations (organization_id, email, role, token_hash, expires_at, accepted_at, revoked_at)
        VALUES ($1, $2, 'member', $3, now() + $4 * interval '1 hour', $5, $6)`,
      [org, `cleanup-${index}@example.test`, randomBytes(32), expired ? -1 : 1, index === 1 ? new Date() : null, index === 2 ? new Date() : null],
    );
    await db.admin.query("INSERT INTO app.rate_limit_buckets VALUES ($1, 1, now() + $2 * interval '1 hour')", [randomBytes(32), expired ? -1 : 1]);
  }
  assert.deepEqual(await purgeOperationalData(db.appPool, 2), { sessions: 2, invitations: 2, rateLimits: 2 });
  assert.deepEqual(await purgeOperationalData(db.appPool, 2), { sessions: 1, invitations: 1, rateLimits: 1 });
  assert.deepEqual(await purgeOperationalData(db.appPool, 2), { sessions: 0, invitations: 0, rateLimits: 0 });
  assert.equal((await db.admin.query("SELECT 1 FROM app.auth_sessions WHERE subject = 'mock|cleanup'")).rowCount, 1);
  assert.equal((await db.admin.query("SELECT 1 FROM app.invitations WHERE organization_id = $1", [org])).rowCount, 1);
  assert.ok((await db.admin.query("SELECT 1 FROM app.rate_limit_buckets WHERE expires_at > now()")).rowCount! >= 1);
  assert.deepEqual((await db.admin.query("SELECT (SELECT count(*) FROM app.memberships) AS memberships, (SELECT count(*) FROM app.audit_events) AS audits")).rows[0], initial);
});

test("cleanup skips locked rows and a later pass collects them", async () => {
  const key = randomBytes(32);
  await db.admin.query("INSERT INTO app.rate_limit_buckets VALUES ($1, 1, now() - interval '1 hour')", [key]);
  await db.admin.query("BEGIN");
  try {
    await db.admin.query("SELECT 1 FROM app.rate_limit_buckets WHERE bucket_key = $1 FOR UPDATE", [key]);
    assert.equal((await purgeOperationalData(db.appPool, 1)).rateLimits, 0);
  } finally {
    await db.admin.query("ROLLBACK");
  }
  assert.equal((await purgeOperationalData(db.appPool, 1)).rateLimits, 1);
});

test("cleanup rejects unbounded batch sizes and the legacy session purge is bounded", async () => {
  for (const batch of [null, 0, -1, 1001]) {
    await assert.rejects(db.appPool.query("SELECT * FROM app.purge_operational_data($1)", [batch]), invalidParameter);
  }
  await db.admin.query(`INSERT INTO app.auth_sessions (id_hash, subject, payload, expires_at)
    SELECT decode(md5('session-a-' || index) || md5('session-b-' || index), 'hex'), 'mock|bulk', decode('00', 'hex'), now() - interval '1 hour'
    FROM generate_series(1, 1001) AS index`);
  assert.equal((await db.appPool.query("SELECT app.auth_session_purge_expired() AS removed")).rows[0].removed, 1000);
  assert.equal((await db.appPool.query("SELECT app.auth_session_purge_expired() AS removed")).rows[0].removed, 1);
  assert.equal((await db.appPool.query("SELECT app.auth_session_purge_expired() AS removed")).rows[0].removed, 0);
});

test("cleanup command uses the restricted login and emits count-only JSON", async () => {
  await db.admin.query("INSERT INTO app.rate_limit_buckets VALUES ($1, 1, now() - interval '1 hour')", [randomBytes(32)]);
  const { stdout, stderr } = await run(process.execPath, ["scripts/operations/cleanup.ts"], { cwd: projectDir, env: { ...process.env, DATABASE_URL: db.appUrl } });
  assert.equal(stderr, "");
  assert.deepEqual(JSON.parse(stdout), { event: "operations.cleanup", result: "success", passes: 1, reachedPassLimit: false, sessions: 0, invitations: 0, rateLimits: 1, conversations: 0 });
});

test("cleanup command rejects owner and missing configuration without exposing credentials", async () => {
  for (const connectionString of [db.adminUrl, "", "not-a-database-url-with-secret"]) {
    await assert.rejects(
      run(process.execPath, ["scripts/operations/cleanup.ts"], { cwd: projectDir, env: { ...process.env, DATABASE_URL: connectionString } }),
      (error: unknown) => {
        const failure = error as { code: number; stdout: string; stderr: string };
        assert.equal(failure.code, 1);
        assert.equal(failure.stdout, "");
        assert.deepEqual(JSON.parse(failure.stderr), { event: "operations.cleanup", result: "error" });
        return true;
      },
    );
  }
});
