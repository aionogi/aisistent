import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { prepareDatabase, SetupError } from "../../lib/db/supabase-setup.ts";
import { APP_PASSWORD, MIGRATIONS_DIR, startTestDatabase, type TestDatabase } from "./harness.ts";

let db: TestDatabase;
before(async () => { db = await startTestDatabase({ migrate: false }); });
after(async () => { await db?.stop(); });

const options = () => ({ adminUrl: db.adminUrl, appUrl: db.appUrl, appPassword: APP_PASSWORD, migrationsDir: MIGRATIONS_DIR, attempts: 2, retryDelayMs: 0 });

test("the setup applies migrations, creates the login, and proves the application address works", async () => {
  const first = await prepareDatabase(options());
  assert.ok(first.applied.includes("0001_core_tenancy"));
  assert.equal(first.alreadyApplied, 0);
  assert.equal(first.postgresMajor, 17);
  assert.equal(first.statementTimeout, "10s");

  const again = await prepareDatabase(options());
  assert.deepEqual(again.applied, []);
  assert.equal(again.alreadyApplied, first.applied.length);
});

test("an application address that cannot log in fails the setup without exposing it", async () => {
  const wrong = new URL(db.appUrl);
  wrong.password = "not-the-app-password";
  await assert.rejects(prepareDatabase({ ...options(), appUrl: wrong.toString() }), (error: Error) => {
    assert.ok(error instanceof SetupError);
    assert.match(error.message, /could not connect through the transaction pooler/);
    assert.doesNotMatch(error.message, /not-the-app-password/);
    return true;
  });
});

test("an address that connects as the owner is refused as the application login", async () => {
  await assert.rejects(prepareDatabase({ ...options(), appUrl: db.adminUrl }), (error: Error) => {
    assert.ok(error instanceof SetupError);
    assert.match(error.message, /restricted aisistent_app login/);
    return true;
  });
});
