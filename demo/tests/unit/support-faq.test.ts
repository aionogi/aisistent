import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { containsPersonalData, normalizeSupportText, replyTo, SUGGESTED_TOPICS, SUPPORT_TOPICS, topicById } from "../../lib/support/faq.ts";

const topicOf = (message: string) => replyTo(message).topicId;

test("suggested and listed questions get their own answers", () => {
  for (const id of SUGGESTED_TOPICS) assert.equal(topicOf(topicById(id)!.question), id);
  for (const topic of SUPPORT_TOPICS) assert.equal(topicOf(topic.question), topic.id, topic.question);
});

test("typed questions find the right answer regardless of case, diacritics or script", () => {
  const cases: Array<[string, string]> = [
    ["koliko kosta?", "pricing"],
    ["Колико кошта?", "pricing"],
    ["Da li je besplatno", "pricing"],
    ["Da li radi preko WhatsAppa?", "channels"],
    ["šta ako ne zna odgovor", "handoff"],
    ["Može li da prebaci poziv na kolegu?", "handoff"],
    ["kako radi", "capabilities"],
    ["Da li može da zakaže termin?", "capabilities"],
    ["kako da počnem", "setup"],
    ["Kako se PODEŠAVA?", "setup"],
    ["hoću da probam", "demo"],
    ["da li je ovo bot", "real_ai"],
    ["treba mi chatbot za sajt", "channels"],
    ["gde se čuvaju podaci", "data"],
    ["kako da se registrujem", "account"],
    ["mogu li da zadržim broj", "phone_number"],
    ["na kom jeziku priča", "language"],
  ];
  for (const [message, expected] of cases) assert.equal(topicOf(message), expected, message);
});

test("greetings and thanks get a short reply; anything else admits it has no answer", () => {
  assert.equal(replyTo("Zdravo").kind, "topic");
  assert.match(replyTo("Dobar dan").text, /Zdravo/);
  assert.match(replyTo("hvala!").text, /Nema na čemu/);
  const unknown = replyTo("asdf qwerty");
  assert.equal(unknown.kind, "unknown");
  assert.match(unknown.text, /nemam pouzdan odgovor/);
  assert.deepEqual(unknown.links, [{ label: "Česta pitanja na stranici", href: "#questions" }]);
});

test("contact details and card numbers get a privacy reminder instead of an answer", () => {
  for (const message of ["Moj broj je 064 123 4567", "+381641234567", "pišite na pera@example.com", "4111 1111 1111 1111", "064/123-4567"]) {
    assert.ok(containsPersonalData(message), message);
    assert.equal(replyTo(message).kind, "personal_data", message);
  }
  for (const message of ["radim od 9 do 17", "28.10.2026", "cena 1.500 din?", "imam 3 salona"]) {
    assert.ok(!containsPersonalData(message), message);
  }
});

test("answers make no price claims and link only inside the site", async () => {
  for (const topic of SUPPORT_TOPICS) {
    assert.doesNotMatch(topic.answer, /\d+\s*(din|rsd|eur|€|%)/i, topic.id);
    assert.ok(topic.answer.length <= 500, topic.id);
    for (const link of topic.links ?? []) assert.match(link.href, /^(#[a-z-]+|\/[a-z/-]*)$/, `${topic.id}: ${link.href}`);
  }
  assert.match(topicById("pricing")!.answer, /Cene još nisu objavljene/);
  // The in-page anchors the answers use exist on the landing page.
  const sources = (await Promise.all(["../../app/page.tsx", "../../components/ConversationDemo.tsx"].map((file) => readFile(new URL(file, import.meta.url), "utf8")))).join("\n");
  for (const anchor of new Set(SUPPORT_TOPICS.flatMap((topic) => topic.links ?? []).map((link) => link.href).filter((href) => href.startsWith("#")).concat("#questions"))) {
    assert.match(sources, new RegExp(`id="${anchor.slice(1)}"`), anchor);
  }
});

test("normalization", () => {
  assert.equal(normalizeSupportText("Đorđe, ČEKAJ — šta ćeš?"), "djordje cekaj sta ces");
  assert.equal(normalizeSupportText("Љубав њива џеп"), "ljubav njiva dzep");
});
