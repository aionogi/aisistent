import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../scripts/test/run-tests.ts", import.meta.url));
const projectDir = fileURLToPath(new URL("../..", import.meta.url));

test("a test run fails when its patterns match no test files", () => {
  const result = spawnSync(process.execPath, [script, "tests/no-such-folder/**/*.test.ts"], { cwd: projectDir, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No test files match tests\/no-such-folder/);
});

test("on GitHub Actions a test run reports its counts as a notice and keeps the exit code", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aisistent-runner-"));
  // Without NODE_TEST_CONTEXT the nested run reports like a top-level one, not to this test.
  const { NODE_TEST_CONTEXT: _, ...inherited } = process.env;
  const env = { ...inherited, GITHUB_ACTIONS: "true" };
  try {
    await writeFile(path.join(dir, "one.test.ts"), "import test from \"node:test\";\ntest(\"passes\", () => {});\n");
    const passing = spawnSync(process.execPath, [script, "one.test.ts"], { cwd: dir, encoding: "utf8", env });
    assert.equal(passing.status, 0);
    assert.match(passing.stdout, /::notice title=Tests::one\.test\.ts: 1 of 1 passed/);

    await writeFile(path.join(dir, "two.test.ts"), "import test from \"node:test\";\ntest(\"fails\", () => { throw new Error(\"expected\"); });\n");
    const failing = spawnSync(process.execPath, [script, "*.test.ts"], { cwd: dir, encoding: "utf8", env });
    assert.equal(failing.status, 1);
    assert.match(failing.stdout, /::notice title=Tests::\*\.test\.ts: 1 of 2 passed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
