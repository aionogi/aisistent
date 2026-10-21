import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { appConnectionString } from "../../lib/db/config.ts";
import { APP_PASSWORD, startTestDatabase, type TestDatabase } from "./harness.ts";

const run = promisify(execFile);
const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

let db: TestDatabase;
before(async () => { db = await startTestDatabase({ migrate: false }); });
after(async () => { await db?.stop(); });

// Mirrors Render: preDeployCommand `npm run db:migrate` with DATABASE_ADMIN_URL
// and DATABASE_APP_PASSWORD, then the web server derives its own connection.
test("the deploy migration command prepares a working restricted login", async () => {
  const env = { ...process.env, DATABASE_ADMIN_URL: db.adminUrl, DATABASE_APP_PASSWORD: APP_PASSWORD, DATABASE_URL: "" };
  const first = await run(process.execPath, ["scripts/db/migrate.ts"], { cwd: projectDir, env });
  assert.match(first.stdout, /Migrations applied: 0001_core_tenancy, 0002_auth_sessions/);
  assert.match(first.stdout, /Application database login is up to date/);

  const second = await run(process.execPath, ["scripts/db/migrate.ts"], { cwd: projectDir, env });
  assert.match(second.stdout, /Migrations applied: none \(2 already applied\)/);

  const derived = appConnectionString({ DATABASE_ADMIN_URL: db.adminUrl, DATABASE_APP_PASSWORD: APP_PASSWORD });
  assert.ok(derived);
  assert.equal(new URL(derived).username, "aisistent_app");
  const client = new pg.Client({ connectionString: derived });
  await client.connect();
  try {
    const { rows } = await client.query("SELECT current_user AS name");
    assert.equal(rows[0].name, "aisistent_app");
  } finally {
    await client.end();
  }
});

test("the web server runs without a database when none is configured", () => {
  assert.equal(appConnectionString({}), null);
  assert.equal(appConnectionString({ DATABASE_ADMIN_URL: "postgresql://owner:secret@db:5432/aisistent" }), null);
});
