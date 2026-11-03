import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { startTestDatabase } from "./harness.ts";

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
