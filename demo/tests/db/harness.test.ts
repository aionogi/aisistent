import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import pg from "pg";
import { startTestDatabase } from "./harness.ts";

async function rejectsPassword(databaseUrl: string, user: string, password: string): Promise<void> {
  const url = new URL(databaseUrl);
  url.username = user;
  url.password = password;
  const client = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 5_000 });
  try {
    await assert.rejects(client.connect(), (error: unknown) => (error as { code?: string }).code === "28P01");
  } finally {
    await client.end();
  }
}

test("temporary databases reject public test passwords and another cluster's administrator credential", { timeout: 120_000 }, async (t) => {
  const first = await startTestDatabase();
  t.after(() => first.stop());
  const second = await startTestDatabase();
  t.after(() => second.stop());
  const firstPassword = decodeURIComponent(new URL(first.adminUrl).password);
  const secondPassword = decodeURIComponent(new URL(second.adminUrl).password);
  assert.ok(firstPassword !== secondPassword, "clusters must not share an owner password");
  for (const db of [first, second]) {
    assert.equal((await db.admin.query("SELECT current_user AS name")).rows[0].name, "render_owner");
    assert.equal((await db.appPool.query("SELECT current_user AS name")).rows[0].name, "aisistent_app");
    assert.equal(existsSync(path.join(db.workDir, "pw")), false, "the initdb password file is removed");
    await rejectsPassword(db.adminUrl, "render_owner", "owner-test-password");
    await rejectsPassword(db.adminUrl, "postgres", "superuser-test-password");
  }
  await rejectsPassword(second.adminUrl, "render_owner", firstPassword);
  await rejectsPassword(first.adminUrl, "render_owner", secondPassword);
});

// The restore drill's copy lives in one of these databases, so its data must
// go even when the server stops first, as Ctrl+C in a terminal can make it.
test("a temporary database whose server dies first still stops and leaves no data behind", { timeout: 60_000 }, async (t) => {
  const db = await startTestDatabase({ migrate: false });
  let stopped = false;
  t.after(async () => {
    if (!stopped) await db.stop();
  });
  const postmaster = Number(readFileSync(path.join(db.workDir, "data", "postmaster.pid"), "utf8").split("\n")[0]);
  assert.ok(Number.isInteger(postmaster) && postmaster > 0);
  process.kill(postmaster);
  // The dropped connection must not crash this process.
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  await db.stop();
  stopped = true;
  assert.equal(existsSync(db.workDir), false);
});
