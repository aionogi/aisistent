import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import pg from "pg";
import { migrateDatabase, prepareDatabase, SetupError } from "../../lib/db/supabase-setup.ts";
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

test("without the earlier secrets the setup stops before replacing an existing app password", async () => {
  await assert.rejects(prepareDatabase({ ...options(), appPassword: "a-completely-new-app-password-0123456789", refuseExistingLogin: true }), (error: Error) => {
    assert.ok(error instanceof SetupError);
    assert.match(error.message, /already has the aisistent_app login/);
    assert.match(error.message, /npm run migrate:supabase/);
    assert.match(error.message, /Nothing was changed/);
    return true;
  });
  // The old password still works, so nothing was replaced.
  const client = new pg.Client({ connectionString: db.appUrl });
  await client.connect();
  await client.end();
});

test("applying migrations alone leaves the app login and its password as they are", async () => {
  const report = await migrateDatabase({ adminUrl: db.adminUrl, migrationsDir: MIGRATIONS_DIR });
  assert.deepEqual(report.applied, []);
  assert.ok(report.alreadyApplied > 0);
  assert.deepEqual(report.revokedFrom, []);
  assert.equal(report.postgresMajor, 17);
  const client = new pg.Client({ connectionString: db.appUrl });
  await client.connect();
  assert.equal((await client.query("SELECT current_user AS login")).rows[0].login, "aisistent_app");
  await client.end();
});
