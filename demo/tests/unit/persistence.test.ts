import assert from "node:assert/strict";
import { test } from "node:test";
import { checkDraftLimits, draftFromStored, MAX_KNOWLEDGE_ENTRIES, toStoredConfig } from "../../lib/workspace/persistence.ts";
import { createCompleteExample, createEmptyDraft } from "../../lib/workspace/templates.ts";

test("a complete example survives the stored round trip", () => {
  const draft = createCompleteExample();
  const stored = JSON.parse(JSON.stringify(toStoredConfig(draft)));
  assert.equal("knowledge" in stored, false);
  const restored = draftFromStored(stored, draft.knowledge, null);
  assert.deepEqual(restored, { ...draft, updatedAt: null });
});

test("no stored configuration yields an empty draft with the stored knowledge", () => {
  const restored = draftFromStored(null, [{ id: "k1", question: "Q?", answer: "A." }], new Date("2026-10-21T10:00:00Z"));
  assert.ok(restored);
  assert.equal(restored.industry, null);
  assert.deepEqual(restored.knowledge, [{ id: "k1", question: "Q?", answer: "A." }]);
  assert.equal(restored.updatedAt, "2026-10-21T10:00:00.000Z");
});

test("stored documents with an unexpected shape are rejected", () => {
  assert.equal(draftFromStored({ version: 2 }, [], null), null);
  assert.equal(draftFromStored([], [], null), null);
  assert.equal(draftFromStored({ ...toStoredConfig(createEmptyDraft()), industry: "bakery" }, [], null), null);
});

test("incomplete drafts are allowed but oversized or malformed values are not", () => {
  assert.equal(checkDraftLimits(createEmptyDraft()), null, "an unfinished draft can be saved");
  assert.equal(checkDraftLimits(createCompleteExample()), null);

  const longName = createCompleteExample();
  longName.business.name = "x".repeat(61);
  assert.match(checkDraftLimits(longName) ?? "", /predugački/);

  const badTime = createCompleteExample();
  badTime.hours.mon.from = "25:00";
  assert.match(checkDraftLimits(badTime) ?? "", /SS:MM/);

  const emptyAnswer = createCompleteExample();
  emptyAnswer.knowledge[0].answer = "   ";
  assert.match(checkDraftLimits(emptyAnswer) ?? "", /pitanje i odgovor/);

  const tooMany = createCompleteExample();
  tooMany.knowledge = Array.from({ length: MAX_KNOWLEDGE_ENTRIES + 1 }, (_, index) => ({ id: `k${index}`, question: "Q?", answer: "A." }));
  assert.match(checkDraftLimits(tooMany) ?? "", /najviše/);
});
