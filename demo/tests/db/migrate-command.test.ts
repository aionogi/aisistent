import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readdir } from "node:fs/promises";
import pg from "pg";
import { appConnectionString } from "../../lib/db/config.ts";
import { APP_PASSWORD, startTestDatabase, type TestDatabase } from "./harness.ts";

const run = promisify(execFile);
const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

let db: TestDatabase;
before(async () => { db = await startTestDatabase({ migrate: false }); });
after(async () => { await db?.stop(); });

// `npm run db:migrate` with DATABASE_ADMIN_URL and DATABASE_APP_PASSWORD, as run
// before a deploy; the web server then connects as the restricted login.
test("the deploy migration command prepares a working restricted login", async () => {
  const env = { ...process.env, DATABASE_ADMIN_URL: db.adminUrl, DATABASE_APP_PASSWORD: APP_PASSWORD, DATABASE_URL: "" };
  const first = await run(process.execPath, ["scripts/db/migrate.ts"], { cwd: projectDir, env });
  assert.match(first.stdout, /Migrations applied: 0001_core_tenancy, 0002_auth_sessions, 0003_team_management/);
  assert.match(first.stdout, /Application database login is up to date/);

  const second = await run(process.execPath, ["scripts/db/migrate.ts"], { cwd: projectDir, env });
  const migrationCount = (await readdir(path.join(projectDir, "db/migrations"))).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).length;
  assert.ok(second.stdout.includes(`Migrations applied: none (${migrationCount} already applied)`));

  const derived = appConnectionString({ DATABASE_ADMIN_URL: db.adminUrl, DATABASE_APP_PASSWORD: APP_PASSWORD });
  assert.ok(derived);
  assert.equal(new URL(derived).username, "aisistent_app");
  const client = new pg.Client({ connectionString: derived });
  await client.connect();
  try {
    const { rows } = await client.query("SELECT current_user AS name");
    assert.equal(rows[0].name, "aisistent_app");
    // Role settings, so they hold through a transaction pooler that drops connection options.
    assert.equal((await client.query("SHOW statement_timeout")).rows[0].statement_timeout, "10s");
    assert.equal((await client.query("SHOW idle_in_transaction_session_timeout")).rows[0].idle_in_transaction_session_timeout, "30s");
  } finally {
    await client.end();
  }
});

test("the web server runs without a database when none is configured", () => {
  assert.equal(appConnectionString({}), null);
  assert.equal(appConnectionString({ DATABASE_ADMIN_URL: "postgresql://owner:secret@db:5432/aisistent" }), null);
});
