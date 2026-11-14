import { questionKey } from "./knowledge-import.ts";
import { hoursEqual, industrySuggestions } from "./templates.ts";
import type { AssistantTone, DayHours, DayId, HandoffTopic, WorkspaceDraft } from "./types.ts";

const serviceKey = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase("sr-Latn");

/** The industry's typical services that the draft does not list yet; the person adds each one deliberately. */
export function suggestedServices(draft: WorkspaceDraft): string[] {
  const present = new Set(draft.business.services.map((service) => serviceKey(service.name)));
  return industrySuggestions(draft.industry).services.filter((name) => !present.has(serviceKey(name)));
}

/** Questions customers of this industry often ask that the knowledge base does not answer yet; the person writes each answer. */
export function suggestedQuestions(draft: WorkspaceDraft): string[] {
  const present = new Set(draft.knowledge.map((entry) => questionKey(entry.question)));
  return industrySuggestions(draft.industry).questions.filter((question) => !present.has(questionKey(question)));
}

/** The industry's typical working hours, unless the draft already has exactly them. Applying replaces the whole week. */
export function suggestedHours(draft: WorkspaceDraft): Record<DayId, DayHours> | null {
  const { hours } = industrySuggestions(draft.industry);
  return hours && !hoursEqual(hours, draft.hours) ? hours : null;
}

/** The tone and topics for the team usually chosen in this industry, shown as a recommendation, never selected for the person. */
export function recommendedBehavior(draft: WorkspaceDraft): { tone: AssistantTone | null; handoffTopics: HandoffTopic[] } {
  const { tone, handoffTopics } = industrySuggestions(draft.industry);
  return { tone, handoffTopics };
}
