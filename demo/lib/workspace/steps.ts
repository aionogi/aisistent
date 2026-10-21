import type { StepId, WorkspaceDraft } from "./types.ts";
import { isStepComplete } from "./validation.ts";

export type StepDefinition = { id: StepId; label: string; title: string; description: string };

export const STEPS: StepDefinition[] = [
  { id: "industry", label: "Delatnost", title: "Čime se bavite?", description: "Izaberite delatnost. Popunićemo primer podataka koji zatim možete prilagoditi svom poslu." },
  { id: "business", label: "Podaci o poslu", title: "Osnovni podaci o poslu", description: "Asistent koristi ove podatke kada se predstavlja i odgovara na pitanja klijenata." },
  { id: "hours", label: "Radno vreme", title: "Kada radite?", description: "Označite radne dane i vreme. Asistent ne predlaže termine van radnog vremena." },
  { id: "assistant", label: "Ponašanje", title: "Kako asistent razgovara?", description: "Ime, ton, pozdrav i situacije u kojima razgovor prepušta vašem timu." },
  { id: "review", label: "Pregled", title: "Pregledajte podešavanje", description: "Proverite celu konfiguraciju pre završetka. Sve možete menjati i kasnije, u radnom prostoru." },
];

export const STEP_IDS = STEPS.map((step) => step.id);

export function isStepId(value: string): value is StepId {
  return (STEP_IDS as string[]).includes(value);
}

/** Default onboarding root for the demo; organizations use `/org/<id>/onboarding`. */
export const DEMO_ONBOARDING_BASE = "/onboarding";

export function onboardingHref(step: StepId, base: string = DEMO_ONBOARDING_BASE): string {
  return `${base}/${step}/`;
}

/** The onboarding entry page, which resumes at the first incomplete step. */
export function onboardingStartHref(base: string = DEMO_ONBOARDING_BASE): string {
  return `${base}/`;
}

/** The first editable step that still has validation problems, or `review` when all are done. */
export function firstIncompleteStep(draft: WorkspaceDraft): StepId {
  for (const step of STEPS) {
    if (step.id === "review") return "review";
    if (!isStepComplete(step.id, draft)) return step.id;
  }
  return "review";
}

/** A step is reachable when every editable step before it passes validation. */
export function blockingStep(step: StepId, draft: WorkspaceDraft): StepDefinition | null {
  for (const candidate of STEPS) {
    if (candidate.id === step || candidate.id === "review") return null;
    if (!isStepComplete(candidate.id, draft)) return candidate;
  }
  return null;
}

export function completedStepCount(draft: WorkspaceDraft): number {
  return STEPS.filter((step) => step.id !== "review" && isStepComplete(step.id, draft)).length;
}

export const EDITABLE_STEP_COUNT = STEPS.length - 1;
