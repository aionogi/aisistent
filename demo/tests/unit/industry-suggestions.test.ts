import assert from "node:assert/strict";
import { test } from "node:test";
import { checkDraftLimits } from "../../lib/workspace/persistence.ts";
import { suggestedQuestions, suggestedServices } from "../../lib/workspace/suggestions.ts";
import { applyIndustryTemplate, chooseIndustry, createEmptyDraft, suggestGreeting } from "../../lib/workspace/templates.ts";
import { isStepComplete } from "../../lib/workspace/validation.ts";

test("a real firm's industry choice invents nothing about the business", () => {
  const draft = chooseIndustry(createEmptyDraft(), "salon", "Frizerski salon Ana");
  assert.equal(draft.industry, "salon");
  assert.deepEqual(draft.business, { name: "Frizerski salon Ana", city: "", address: "", description: "", website: "", services: [] });
  assert.deepEqual(draft.knowledge, []);
  // The demo's example business never appears, nor any example address or answer.
  const serialized = JSON.stringify(draft);
  for (const invented of ["Studio Mila", "Novi Sad", "Cvetna", ".example", "Parking"]) assert.ok(!serialized.includes(invented), invented);
  // Settings take the industry's suggestion: salon hours, a warm tone, a greeting with the firm's own name.
  assert.deepEqual(draft.hours.mon, { open: true, from: "09:00", to: "20:00" });
  assert.deepEqual(draft.hours.sun.open, false);
  assert.equal(draft.assistant.tone, "warm");
  assert.equal(draft.assistant.greeting, suggestGreeting("warm", "Frizerski salon Ana", draft.assistant.name));
  // The person still has to enter the city and at least one service.
  assert.equal(isStepComplete("business", draft), false);
  assert.equal(checkDraftLimits(draft), null);
});

test("choosing or switching the industry keeps everything the person entered", () => {
  const own = chooseIndustry(createEmptyDraft(), "salon", "Salon Ana");
  own.business = { ...own.business, name: "Salon Ana Plus", city: "Skopje", services: [{ id: "s1", name: "Šminkanje", duration: "1 h" }] };
  own.hours = { ...own.hours, sat: { open: true, from: "10:00", to: "14:00" } };
  own.assistant = { ...own.assistant, tone: "concise", greeting: "Dobar dan, Salon Ana Plus, izvolite." };
  own.knowledge = [{ id: "k1", question: "Radite li nedeljom?", answer: "Ne, nedeljom ne radimo." }];

  const switched = chooseIndustry(own, "clinic", "Salon Ana");
  assert.equal(switched.industry, "clinic");
  assert.deepEqual(switched.business, own.business);
  assert.deepEqual(switched.hours, own.hours);
  assert.equal(switched.assistant.tone, "concise");
  assert.equal(switched.assistant.greeting, own.assistant.greeting);
  assert.deepEqual(switched.knowledge, own.knowledge);
});

test("untouched suggestions follow the new industry, and an unchanged suggested greeting is rewritten for its tone", () => {
  const salon = chooseIndustry(createEmptyDraft(), "salon", "Moja firma");
  const garage = chooseIndustry(salon, "garage", "Moja firma");
  assert.deepEqual(garage.hours.mon, { open: true, from: "08:00", to: "17:00" });
  assert.equal(garage.assistant.tone, "concise");
  assert.deepEqual(garage.assistant.handoffTopics, ["pricing", "special-requests"]);
  assert.equal(garage.assistant.greeting, suggestGreeting("concise", "Moja firma", garage.assistant.name));
  // Without a firm name there is nothing to greet with yet.
  assert.equal(chooseIndustry(createEmptyDraft(), "clinic").assistant.greeting, "");
});

test("suggested services and questions leave out what the firm already has", () => {
  const draft = chooseIndustry(createEmptyDraft(), "salon", "Salon");
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
  const other = chooseIndustry(createEmptyDraft(), "other", "Firma");
  assert.deepEqual(suggestedServices(other), []);
  assert.deepEqual(suggestedQuestions(other), []);
  assert.equal(applyIndustryTemplate(createEmptyDraft(), "salon").business.name, "Studio Mila");
});
