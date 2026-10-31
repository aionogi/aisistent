import { businessMatchesTemplate, knowledgeMatchesTemplate } from "./templates.ts";
import type { WorkspaceDraft } from "./types.ts";
import { isStepComplete } from "./validation.ts";

export type NextStepState = "done" | "todo" | "soon";
export type NextStep = { id: "business" | "knowledge" | "team" | "phone"; title: string; detail: string; state: NextStepState; page?: "assistant" | "knowledge" | "team" };

/** "1 član", "2 člana", "5 članova", "21 član". */
export function membersLabel(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (last === 1 && lastTwo !== 11) return `${count} član`;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return `${count} člana`;
  return `${count} članova`;
}

/** "1 razgovor", "2 razgovora", "5 razgovora", "21 razgovor". */
export function conversationsLabel(count: number): string {
  return `${count} ${count % 10 === 1 && count % 100 !== 11 ? "razgovor" : "razgovora"}`;
}

function answersLabel(count: number): string {
  return `${count} ${count % 10 === 1 && count % 100 !== 11 ? "odgovor" : "odgovora"}`;
}

/**
 * What an organization should do next, from its real data. Onboarding fills in
 * an example for the chosen industry, so details that still match it count as
 * unfinished even though they are valid.
 */
export function nextSteps(draft: WorkspaceDraft, team: { members: number; pendingInvitations: number }): NextStep[] {
  const businessComplete = isStepComplete("business", draft) && isStepComplete("hours", draft);
  const business: NextStep = !businessComplete
    ? { id: "business", title: "Dopunite podatke o poslu", detail: "Neka polja su prazna ili neispravna.", state: "todo", page: "assistant" }
    : businessMatchesTemplate(draft)
      ? { id: "business", title: "Upišite podatke o svom poslu", detail: `Još stoji primer za vašu delatnost („${draft.business.name}“).`, state: "todo", page: "assistant" }
      : { id: "business", title: "Podaci o poslu", detail: "Spremno", state: "done", page: "assistant" };

  const count = draft.knowledge.length;
  const knowledge: NextStep = count === 0
    ? { id: "knowledge", title: "Dodajte odgovore u bazu znanja", detail: "Još nema odgovora.", state: "todo", page: "knowledge" }
    : knowledgeMatchesTemplate(draft)
      ? { id: "knowledge", title: "Prilagodite bazu znanja", detail: `Još stoje primeri za vašu delatnost (${answersLabel(count)}).`, state: "todo", page: "knowledge" }
      : { id: "knowledge", title: "Baza znanja", detail: answersLabel(count), state: "done", page: "knowledge" };

  const teamStep: NextStep = team.members > 1
    ? { id: "team", title: "Tim", detail: membersLabel(team.members), state: "done", page: "team" }
    : team.pendingInvitations > 0
      ? { id: "team", title: "Tim", detail: "Pozivnica čeka prihvatanje.", state: "done", page: "team" }
      : { id: "team", title: "Pozovite tim", detail: "Za sada ste sami u firmi.", state: "todo", page: "team" };

  return [
    business,
    knowledge,
    teamStep,
    { id: "phone", title: "Povežite telefon", detail: "Dolazi u kasnijoj fazi. Do tada asistent ne prima pozive.", state: "soon" },
  ];
}
