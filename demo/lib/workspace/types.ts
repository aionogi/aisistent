export type IndustryId = "salon" | "clinic" | "garage" | "restaurant" | "other";
export type DayId = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type AssistantTone = "professional" | "warm" | "concise";
export type UnknownAnswerAction = "take-message" | "offer-callback";
export type HandoffTopic = "complaints" | "pricing" | "urgent" | "special-requests";
export type StepId = "industry" | "business" | "hours" | "assistant" | "review";

export type DayHours = { open: boolean; from: string; to: string };

export type ServiceItem = { id: string; name: string; duration: string };

export type KnowledgeEntry = { id: string; question: string; answer: string };

export type BusinessDetails = {
  name: string;
  city: string;
  address: string;
  description: string;
  website: string;
  services: ServiceItem[];
};

export type AssistantBehavior = {
  name: string;
  tone: AssistantTone;
  greeting: string;
  bookingEnabled: boolean;
  handoffTopics: HandoffTopic[];
  unknownAnswer: UnknownAnswerAction;
};

/**
 * The complete example configuration edited in onboarding and the workspace.
 * It lives only in the browser tab; see lib/workspace/storage.ts.
 */
export type WorkspaceDraft = {
  version: 1;
  industry: IndustryId | null;
  business: BusinessDetails;
  hours: Record<DayId, DayHours>;
  assistant: AssistantBehavior;
  knowledge: KnowledgeEntry[];
  onboardingCompleted: boolean;
  updatedAt: string | null;
};
