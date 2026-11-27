import assert from "node:assert/strict";
import { test } from "node:test";
import { buildInstructions } from "../../lib/assistant/instructions.ts";
import { greetingDisclosesAi, greetingWithAiDisclosure } from "../../lib/workspace/disclosure.ts";
import { chooseIndustry, createEmptyOrganizationDraft } from "../../lib/workspace/templates.ts";

test("a greeting discloses AI in Latin or Cyrillic, and words that merely contain the letters do not count", () => {
  for (const yes of ["Ja sam Lena, AI asistent.", "Dobar dan! (AI)", "Ovo je veštačka inteligencija.", "vestacka inteligencija", "Ја сам Лена, АИ асистент.", "вештачка интелигенција"]) {
    assert.equal(greetingDisclosesAi(yes), true, yes);
  }
  for (const no of ["Zdravo! Kako vam mogu pomoći?", "Dobar dan, Kaida salon.", "Mail nam pošaljite.", "Здраво!", ""]) {
    assert.equal(greetingDisclosesAi(no), false, no);
  }
});

test("the disclosure is appended in the greeting's script, with punctuation, and never past the limit", () => {
  assert.equal(greetingWithAiDisclosure("Zdravo! Kako vam mogu pomoći?", "Lena", 300), "Zdravo! Kako vam mogu pomoći? Ja sam Lena, AI asistent.");
  assert.equal(greetingWithAiDisclosure("Dobar dan, Salon Ana", "Mila", 300), "Dobar dan, Salon Ana. Ja sam Mila, AI asistent.");
  assert.equal(greetingWithAiDisclosure("Добар дан!", "Лена", 300), "Добар дан! Ја сам Лена, АИ асистент.");
  assert.equal(greetingWithAiDisclosure("Zdravo!", " ", 300), "Zdravo! Ja sam AI asistent.");
  assert.equal(greetingWithAiDisclosure("x".repeat(290), "Lena", 300), null);
  assert.ok(greetingDisclosesAi(greetingWithAiDisclosure("Zdravo!", "Lena", 300)!));
});

test("the first reply discloses AI when the greeting did not, and replies are asked to stay short", () => {
  const draft = chooseIndustry(createEmptyOrganizationDraft(), "garage", "Servis");
  draft.assistant = { ...draft.assistant, greeting: "Zdravo! Kako vam mogu pomoći?" };
  const plain = buildInstructions(draft, new Date("2026-11-26T10:00:00Z"));
  assert.ok(plain.includes("That greeting did not say that you are an AI, so say it briefly in your first reply."));
  assert.ok(plain.includes("one to three short sentences, about 40 words at most"));
  assert.ok(plain.includes("do not explain how you reached the answer"));
  assert.ok(plain.includes("Ask one question at a time."));
  assert.ok(plain.includes("when the customer writes in Cyrillic, write every word in Cyrillic"));

  draft.assistant = { ...draft.assistant, greeting: "Zdravo! Ja sam Lena, AI asistent." };
  assert.ok(!buildInstructions(draft, new Date()).includes("That greeting did not say"));
  draft.assistant = { ...draft.assistant, greeting: "" };
  assert.ok(buildInstructions(draft, new Date()).includes("say that you are the business's AI assistant"));
});
