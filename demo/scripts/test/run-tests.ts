// Runs `node --test` on the given file patterns. The test runner itself
// reports success when the patterns match nothing, so a renamed folder could
// turn a check green without running a single test; this fails instead.
// On GitHub Actions it also adds the counts as a notice, readable without logs.
//   node scripts/test/run-tests.ts "tests/unit/**/*.test.ts" ...
import { spawn } from "node:child_process";
import { globSync } from "node:fs";

const patterns = process.argv.slice(2);
if (patterns.length === 0 || patterns.every((pattern) => globSync(pattern).length === 0)) {
  console.error(`No test files match ${patterns.join(", ") || "(no pattern)"}.`);
  process.exit(1);
}

const child = spawn(process.execPath, ["--test", "--test-reporter=spec", ...patterns], {
  stdio: ["inherit", "pipe", "inherit"],
  env: { ...process.env, ...(process.stdout.isTTY ? { FORCE_COLOR: "1" } : {}) },
});

let tail = "";
child.stdout.on("data", (chunk: Buffer) => {
  process.stdout.write(chunk);
  tail = (tail + chunk.toString("utf8")).slice(-8000);
});

child.on("exit", (code) => {
  const summary = tail.replace(/\x1b\[[0-9;]*m/g, "");
  const count = (name: string) => Number(new RegExp(`^ℹ ${name} (\\d+)$`, "m").exec(summary)?.[1]);
  const tests = count("tests");
  const passed = count("pass");
  if (process.env.GITHUB_ACTIONS === "true" && Number.isInteger(tests)) {
    console.log(`::notice title=Tests::${patterns.join(" ")}: ${passed} of ${tests} passed`);
  }
  // A run whose summary cannot be read fails too, rather than passing unseen.
  if (code === 0 && !(tests > 0)) {
    console.error("The test run reported no tests.");
    process.exit(1);
  }
  process.exit(code ?? 1);
});
