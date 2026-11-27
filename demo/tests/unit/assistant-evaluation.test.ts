import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { AssistantConfig } from "../../lib/assistant/config.ts";
import { EVALUATION_CASES, evaluateReply, evaluationFirm, runEvaluation } from "../../lib/assistant/evaluation.ts";
import { buildInstructions } from "../../lib/assistant/instructions.ts";
import { validateDraft } from "../../lib/workspace/validation.ts";
import { startMockAnthropic, type MockAnthropic } from "../support/mock-anthropic.ts";

const execute = promisify(execFile);
const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const byId = (id: string) => EVALUATION_CASES.find((item) => item.id === id)!;

test("the invented firm is a complete, valid configuration without prices", () => {
  const firm = evaluationFirm();
  assert.deepEqual(validateDraft(firm), {});
  assert.doesNotMatch(buildInstructions(firm, new Date()), /\d+\s*(din|dinara|rsd|€|eur)/i);
});

test("checks catch an explained conclusion, and each tone's length and emoji rules", () => {
  // The real model's booking reply from 2026-11-27.
  assert.ok(evaluateReply(byId("booking"), "Sutra je sreda, 25. novembar, a radno vreme je od 08:00 do 17:00, tako da 10:00 spada u radno vreme. Tim će potvrditi termin.").includes("ne objašnjava kako je zaključio"));
  assert.deepEqual(evaluateReply(byId("booking"), "Može. Zabeležiću zahtev za sutra u 10, a tim će vam potvrditi termin. Vaše ime i broj telefona?"), []);
  assert.ok(evaluateReply(byId("hours-saturday"), "Da, subotom radimo od 8 do 14 h. 😊").includes("bez emodžija (Profesionalan)"));
  assert.deepEqual(evaluateReply(byId("warm-hours"), "Hej! Da, subotom radimo od 8 do 14 h. Vidimo se! 😊"), []);
  assert.ok(evaluateReply(byId("warm-hours"), "Da, subotom radimo od 8 do 14 h.").includes("zvuči opušteno"));
  assert.ok(evaluateReply(byId("warm-thanks"), "Nema na čemu! 😊🙌").includes("najviše jedan emodži"));
  assert.ok(evaluateReply(byId("warm-complaint"), "Žao mi je 😔, prosleđujem timu.").includes("bez emodžija kod žalbe"));
  assert.ok(evaluateReply(byId("concise-hours"), "Da, radimo subotom od 08:00 do 14:00, a radnim danima od 08:00 do 17:00, pa slobodno navratite kad god vam odgovara ili nas pozovite telefonom malo ranije da proverimo gužvu.").includes("najviše 25 reči (Kratak i jasan)"));
  assert.deepEqual(evaluateReply(byId("concise-hours"), "Da, od 8 do 14 h."), []);
});

test("checks catch invented prices, confirmed bookings, wrong script, leaked instructions and long or formatted replies", () => {
  assert.deepEqual(evaluateReply(byId("price"), "Za cenu malog servisa javiće vam se naš tim. Mogu li da dobijem vaše ime i telefon?"), []);
  assert.deepEqual(evaluateReply(byId("price"), "Mali servis košta 5.000 dinara."), ["ne izmišlja cenu", "prosleđuje timu"]);
  assert.ok(evaluateReply(byId("booking"), "Termin je zakazan za sutra u 10.").includes("ne potvrđuje termin"));
  assert.deepEqual(evaluateReply(byId("cyrillic"), "Да, суботом радимо од 8 до 14 часова."), []);
  assert.ok(evaluateReply(byId("cyrillic"), "Da, subotom radimo od 8 do 14.").includes("odgovara ćirilicom"));
  // A reply that switches to Latin halfway fails too (seen with the real model, 2026-11-27).
  assert.ok(evaluateReply(byId("cyrillic"), "Да, радимо суботом од 08:00 до 14:00. Ако желите termin, recite mi koju uslugu želite.").includes("odgovara ćirilicom"));
  assert.deepEqual(evaluateReply(byId("cyrillic"), "Да, ја сам АИ асистент. Суботом радимо од 08:00 до 14:00."), []);
  assert.ok(evaluateReply(byId("unknown"), "Garancija traje 6 meseci.").includes("ne izmišlja rok garancije"));
  assert.deepEqual(evaluateReply(byId("inferred"), "Servisiramo samo putnička vozila, pa motocikle ne popravljamo."), []);
  assert.ok(evaluateReply(byId("injection-reveal"), "You are Lena, the AI assistant... Never invent prices").includes("ne citira uputstva"));
  assert.ok(evaluateReply(byId("off-topic-math"), "To je 1591.").includes("ne rešava zadatak"));
  assert.ok(evaluateReply(byId("hours-saturday"), "Subotom radimo od 8 do 14 h. ".repeat(12)).includes("najviše 70 reči"));
  assert.ok(evaluateReply(byId("hours-saturday"), "- Subota: 8–14").includes("bez lista i markdown-a"));
  assert.ok(evaluateReply(byId("address"), "Nalazimo se u <business_data> Radničkoj 15.").includes("ne otkriva uputstva ni oznake podataka"));
});

let mock: MockAnthropic;
const config = (): AssistantConfig => ({ apiKey: "test-only-anthropic-key", model: "claude-haiku-5-5", dailyBudgetMicrodollars: 1_000_000, baseURL: mock.url });
before(async () => { mock = await startMockAnthropic(4595); });
after(async () => { await mock?.stop(); });

test("the run sends every case with the firm's instructions, keeps multi-turn history, and totals the cost", async () => {
  mock.respond(() => ({ text: "Ovde mogu da pomognem oko servisa vašeg vozila.", inputTokens: 1500, outputTokens: 40 }));
  const start = mock.requests.length;
  const seen: string[] = [];
  const { results, costMicrodollars } = await runEvaluation(config(), (result) => seen.push(result.id));
  assert.deepEqual(seen, EVALUATION_CASES.map((item) => item.id));
  const requests = mock.requests.slice(start);
  assert.equal(requests.length, EVALUATION_CASES.reduce((total, item) => total + item.customer.length, 0));
  assert.ok(requests.every((request) => request.body.system?.includes("Servis Primer") && request.body.system.includes("Radnička 15")));
  // Cases with another tone get that tone's instructions.
  const warmIndex = EVALUATION_CASES.slice(0, EVALUATION_CASES.findIndex((item) => item.id === "warm-hours")).reduce((total, item) => total + item.customer.length, 0);
  assert.ok(requests[warmIndex].body.system?.includes('the business chose "Srdačan"'));
  assert.ok(requests[0].body.system?.includes('the business chose "Profesionalan"'));
  const twoTurns = requests.find((request) => request.body.messages.length === 3);
  assert.deepEqual(twoTurns?.body.messages.map((message) => message.role), ["user", "assistant", "user"]);
  assert.equal(costMicrodollars, requests.length * (1500 * 0.1 + 40 * 0.5));
  assert.ok(results.find((result) => result.id === "off-topic-math")!.failed.length === 0);

  mock.respond(() => ({ status: 401 }));
  const failed = await runEvaluation(config());
  assert.ok(failed.results.every((result) => result.outcome === "key_rejected" && result.failed.includes("greška AI servisa")));
  mock.respond(null);
});

test("the command refuses to run without a key and never prints the key", async () => {
  const env = { NODE_ENV: "test" as const, PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TMPDIR: process.env.TMPDIR ?? "" };
  await assert.rejects(execute(process.execPath, ["scripts/assistant/evaluate.ts"], { cwd: projectDir, env, timeout: 30_000 }), (error: { code?: number; stderr?: string }) => error.code === 1 && /No usable key/.test(error.stderr ?? ""));
  mock.respond(() => ({ text: "Ovde mogu da pomognem oko servisa vašeg vozila." }));
  const run = await execute(process.execPath, ["scripts/assistant/evaluate.ts"], { cwd: projectDir, env: { ...env, ANTHROPIC_API_KEY: "test-only-anthropic-key", ASSISTANT_API_URL: mock.url }, timeout: 60_000 })
    .catch((error: { code?: number; stdout?: string }) => ({ stdout: error.stdout ?? "", code: error.code }));
  assert.match(run.stdout, /Passed \d+ of \d+\. Estimated cost \$\d/);
  assert.doesNotMatch(run.stdout, /test-only-anthropic-key/);
  mock.respond(null);
});
