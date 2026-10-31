import assert from "node:assert/strict";
import { test } from "node:test";
import { dayInBelgrade, hoursForDay, todayHours } from "../../lib/workspace/format.ts";
import { conversationsLabel, membersLabel, nextSteps } from "../../lib/workspace/organization-overview.ts";
import { applyIndustryTemplate, businessMatchesTemplate, createEmptyDraft, knowledgeMatchesTemplate, matchesIndustryTemplate } from "../../lib/workspace/templates.ts";

const example = () => applyIndustryTemplate(createEmptyDraft(), "salon");
const alone = { members: 1, pendingInvitations: 0 };
const states = (steps: ReturnType<typeof nextSteps>) => Object.fromEntries(steps.map((step) => [step.id, step.state]));

test("an untouched industry example counts as unfinished, even though it is valid", () => {
  const draft = example();
  assert.ok(matchesIndustryTemplate(draft));
  const steps = nextSteps(draft, alone);
  assert.deepEqual(states(steps), { business: "todo", knowledge: "todo", team: "todo", phone: "soon" });
  assert.match(steps[0].detail, new RegExp(draft.business.name));
  assert.match(steps[1].detail, /primeri za vašu delatnost/);
});

test("hours stored with another key order still count as the example", () => {
  const draft = example();
  // PostgreSQL jsonb returns object keys in its own order.
  for (const day of Object.keys(draft.hours) as Array<keyof typeof draft.hours>) {
    const { open, from, to } = draft.hours[day];
    draft.hours[day] = { to, from, open };
  }
  assert.ok(businessMatchesTemplate(draft));
  draft.hours.mon = { ...draft.hours.mon, from: "07:15" };
  assert.equal(businessMatchesTemplate(draft), false);
});

test("the firm's own details and answers finish their steps independently", () => {
  const draft = example();
  draft.business.name = "Moj salon";
  assert.equal(businessMatchesTemplate(draft), false);
  assert.equal(knowledgeMatchesTemplate(draft), true);
  assert.deepEqual(states(nextSteps(draft, alone)), { business: "done", knowledge: "todo", team: "todo", phone: "soon" });

  draft.knowledge = [...draft.knowledge, { id: "own", question: "Imate li parking?", answer: "Da, ispred salona." }];
  const steps = nextSteps(draft, alone);
  assert.equal(states(steps).knowledge, "done");
  assert.match(steps[1].detail, /odgovora/);
  assert.equal(matchesIndustryTemplate(draft), false);
});

test("empty or invalid data asks to be completed", () => {
  const draft = example();
  draft.knowledge = [];
  draft.business.name = "";
  const steps = nextSteps(draft, alone);
  assert.equal(steps[0].state, "todo");
  assert.match(steps[0].detail, /prazna ili neispravna/);
  assert.match(steps[1].detail, /Još nema odgovora/);
});

test("a second member or a pending invitation finishes the team step; the phone stays 'soon' with no link", () => {
  assert.deepEqual(nextSteps(example(), { members: 2, pendingInvitations: 0 }).find((step) => step.id === "team")?.state, "done");
  const invited = nextSteps(example(), { members: 1, pendingInvitations: 1 }).find((step) => step.id === "team");
  assert.equal(invited?.state, "done");
  assert.match(invited?.detail ?? "", /čeka prihvatanje/);
  const phone = nextSteps(example(), alone).find((step) => step.id === "phone");
  assert.equal(phone?.page, undefined);
  assert.equal(phone?.state, "soon");
});

test("Serbian counts", () => {
  assert.deepEqual([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map(membersLabel), ["1 član", "2 člana", "4 člana", "5 članova", "11 članova", "12 članova", "14 članova", "21 član", "22 člana", "25 članova", "101 član", "111 članova"]);
  assert.deepEqual([1, 2, 5, 11, 21].map(conversationsLabel), ["1 razgovor", "2 razgovora", "5 razgovora", "11 razgovora", "21 razgovor"]);
});

test("today is the day in Serbia, whatever the server's time zone", () => {
  // Sunday 23:30 UTC is already Monday 00:30 in Belgrade (winter time, UTC+1).
  assert.equal(dayInBelgrade(new Date("2026-11-01T23:30:00Z")), "mon");
  assert.equal(dayInBelgrade(new Date("2026-11-01T22:30:00Z")), "sun");
  const { hours } = example();
  assert.deepEqual(hoursForDay(hours, "mon"), todayHours(hours, new Date(2026, 10, 2, 12)));
});
