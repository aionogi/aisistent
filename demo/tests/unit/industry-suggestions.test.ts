import assert from "node:assert/strict";
import { test } from "node:test";
import { checkDraftLimits, draftFromStored } from "../../lib/workspace/persistence.ts";
import { recommendedBehavior, suggestedHours, suggestedQuestions, suggestedServices } from "../../lib/workspace/suggestions.ts";
import { applyIndustryTemplate, chooseIndustry, createEmptyDraft, createEmptyOrganizationDraft, DAY_IDS } from "../../lib/workspace/templates.ts";
import { isStepComplete } from "../../lib/workspace/validation.ts";

test("a firm that has not saved yet starts with no working days, no times and no greeting", () => {
  const draft = draftFromStored(null, [], null);
  assert.ok(draft);
  assert.deepEqual(draft, { ...createEmptyOrganizationDraft(), updatedAt: null });
  for (const day of DAY_IDS) assert.deepEqual(draft.hours[day], { open: false, from: "", to: "" });
  assert.equal(draft.assistant.greeting, "");
  // Choices that always hold a value keep neutral defaults.
  assert.equal(draft.assistant.tone, "professional");
  assert.equal(isStepComplete("hours", draft), false);
  assert.equal(checkDraftLimits(draft), null);
});

test("a firm's industry choice fills in only the firm's own name", () => {
  const before = createEmptyOrganizationDraft();
  const draft = chooseIndustry(before, "salon", "Frizerski salon Ana");
  assert.deepEqual(draft, { ...before, industry: "salon", business: { ...before.business, name: "Frizerski salon Ana" } });
  // The demo's example business never appears, nor any example address, answer, greeting or hours.
  const serialized = JSON.stringify(draft);
  for (const invented of ["Studio Mila", "Novi Sad", "Cvetna", ".example", "Parking", "20:00", "Zdravo"]) assert.ok(!serialized.includes(invented), invented);
  assert.equal(isStepComplete("business", draft), false);
  assert.equal(isStepComplete("hours", draft), false);
  assert.equal(isStepComplete("assistant", draft), false);
});

test("switching the industry keeps everything the person entered", () => {
  const own = chooseIndustry(createEmptyOrganizationDraft(), "salon", "Salon Ana");
  own.business = { ...own.business, name: "Salon Ana Plus", city: "Skopje", services: [{ id: "s1", name: "Šminkanje", duration: "1 h" }] };
  own.hours = { ...own.hours, sat: { open: true, from: "10:00", to: "14:00" } };
  own.assistant = { ...own.assistant, tone: "concise", greeting: "Dobar dan, Salon Ana Plus, izvolite." };
  own.knowledge = [{ id: "k1", question: "Radite li nedeljom?", answer: "Ne, nedeljom ne radimo." }];
  assert.deepEqual(chooseIndustry(own, "clinic", "Salon Ana"), { ...own, industry: "clinic" });
});

test("typical hours are a suggestion until applied, and 'other' suggests none", () => {
  const draft = chooseIndustry(createEmptyOrganizationDraft(), "garage", "Servis");
  const hours = suggestedHours(draft);
  assert.ok(hours);
  assert.deepEqual(hours.mon, { open: true, from: "08:00", to: "17:00" });
  assert.equal(draft.hours.mon.open, false, "the suggestion is not applied by itself");
  const applied = { ...draft, hours };
  assert.equal(suggestedHours(applied), null, "nothing left to suggest once applied");
  assert.equal(isStepComplete("hours", applied), true);
  assert.equal(suggestedHours(chooseIndustry(createEmptyOrganizationDraft(), "other", "Firma")), null);
  assert.equal(suggestedHours(createEmptyOrganizationDraft()), null);
});

test("the industry's usual tone and topics are recommended, never selected", () => {
  const draft = chooseIndustry(createEmptyOrganizationDraft(), "clinic", "Ordinacija");
  assert.deepEqual(recommendedBehavior(draft), { tone: "professional", handoffTopics: ["urgent", "complaints", "pricing"] });
  assert.deepEqual(draft.assistant.handoffTopics, createEmptyDraft().assistant.handoffTopics);
  assert.deepEqual(recommendedBehavior(chooseIndustry(draft, "other")), { tone: null, handoffTopics: [] });
});

test("suggested services and questions leave out what the firm already has", () => {
  const draft = chooseIndustry(createEmptyOrganizationDraft(), "salon", "Salon");
  assert.deepEqual(suggestedServices(draft), ["Šišanje i feniranje", "Farbanje", "Manikir"]);
  assert.equal(suggestedQuestions(draft).length, 3);

  draft.business.services = [{ id: "s1", name: "  farbanje ", duration: "" }];
  draft.knowledge = [{ id: "k1", question: "da li je potrebno zakazivanje", answer: "Da, zakažite telefonom." }];
  assert.deepEqual(suggestedServices(draft), ["Šišanje i feniranje", "Manikir"]);
  assert.deepEqual(suggestedQuestions(draft), ["Koliko traje farbanje?", "Da li postoji parking?"]);

  // A service added from a suggestion without a duration is valid and storable.
  draft.business.city = "Sarajevo";
  assert.equal(isStepComplete("business", draft), true);
  assert.equal(checkDraftLimits(draft), null);
});

test("no industry or 'other' has no suggestions, and the demo still fills its example", () => {
  assert.deepEqual(suggestedServices(createEmptyDraft()), []);
  assert.deepEqual(suggestedQuestions(createEmptyDraft()), []);
  const other = chooseIndustry(createEmptyOrganizationDraft(), "other", "Firma");
  assert.deepEqual(suggestedServices(other), []);
  assert.deepEqual(suggestedQuestions(other), []);
  const demo = applyIndustryTemplate(createEmptyDraft(), "salon");
  assert.equal(demo.business.name, "Studio Mila");
  assert.deepEqual(demo.hours.mon, { open: true, from: "09:00", to: "20:00" });
});
