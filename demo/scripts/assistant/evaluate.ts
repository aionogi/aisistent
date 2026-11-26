// Runs the Serbian evaluation set (lib/assistant/evaluation.ts) against the
// real model, from your own computer. Each run is a few paid requests (with
// Claude Haiku a few cents in total) and prints every reply with its checks.
//
// Settings come from the environment or from demo/.env.assistant.local:
//   ANTHROPIC_API_KEY='...'          the key (never printed)
//   ASSISTANT_MODEL='claude-haiku-5-5'   optional
//
//   npm run eval:assistant
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { assistantConfig } from "../../lib/assistant/config.ts";
import { EVALUATION_CASES, runEvaluation, type EvaluationResult } from "../../lib/assistant/evaluation.ts";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const settingsFile = path.join(projectDir, ".env.assistant.local");
const fromFile = existsSync(settingsFile) ? parseEnv(readFileSync(settingsFile, "utf8")) : {};
const settings = { ...fromFile, ...Object.fromEntries(Object.entries(process.env).filter(([key]) => ["ANTHROPIC_API_KEY", "ASSISTANT_MODEL", "ASSISTANT_API_URL"].includes(key))) };
const config = assistantConfig({ ...settings, ASSISTANT_ENABLED: "true" });

if (!config) {
  console.error(`
No usable key. Create ${settingsFile} with one line:
ANTHROPIC_API_KEY='<your key>'
(or set ANTHROPIC_API_KEY in this terminal). ASSISTANT_MODEL is optional.
`);
  process.exit(1);
}

console.log(`Model: ${config.model} · ${EVALUATION_CASES.length} conversations · invented firm "Servis Primer"\n`);
const print = (result: EvaluationResult) => {
  console.log(`${result.failed.length ? "✗" : "✓"} ${result.label} (${result.id})`);
  console.log(`  ${result.reply ?? `[${result.outcome}]`}`);
  for (const failure of result.failed) console.log(`  → nije ispunjeno: ${failure}`);
  console.log("");
};
const { results, costMicrodollars } = await runEvaluation(config, print);
const failed = results.filter((result) => result.failed.length > 0);
console.log(`Passed ${results.length - failed.length} of ${results.length}. Estimated cost $${(costMicrodollars / 1_000_000).toFixed(4)}.`);
if (failed.length) console.log("A failed check means: read that reply. The rules are simple text checks, not a verdict.");
process.exitCode = failed.length ? 2 : 0;
