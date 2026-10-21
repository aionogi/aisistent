import { DAY_IDS, HANDOFF_LABELS, TONE_LABELS, UNKNOWN_ANSWER_LABELS, INDUSTRY_LABELS } from "./templates.ts";
import type { WorkspaceDraft } from "./types.ts";

/**
 * Temporary draft storage for the M2 prototype.
 *
 * The draft is kept in `sessionStorage`: it survives in-app navigation and
 * reloads in the same browser tab, and disappears when the tab is closed.
 * Nothing is sent to a server. When storage is blocked (for example in some
 * private modes), the draft stays in memory until the page is reloaded.
 */
export const DRAFT_STORAGE_KEY = "aisistent.workspace-draft.v1";

export type LoadResult =
  | { status: "empty" }
  | { status: "loaded"; draft: WorkspaceDraft }
  | { status: "invalid" }
  | { status: "unavailable" };

function getStorage(): Storage | null {
  try {
    const storage = window.sessionStorage;
    const probe = `${DRAFT_STORAGE_KEY}.probe`;
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

export function loadDraft(): LoadResult {
  const storage = getStorage();
  if (!storage) return { status: "unavailable" };
  let raw: string | null;
  try {
    raw = storage.getItem(DRAFT_STORAGE_KEY);
  } catch {
    return { status: "unavailable" };
  }
  if (raw === null) return { status: "empty" };
  try {
    const draft = parseDraft(JSON.parse(raw));
    return draft ? { status: "loaded", draft } : { status: "invalid" };
  } catch {
    return { status: "invalid" };
  }
}

export function saveDraft(draft: WorkspaceDraft): boolean {
  try {
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(): void {
  try {
    window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // Storage is unavailable; the in-memory draft is reset by the caller.
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isOneOf = <T extends string>(value: unknown, options: Record<T, unknown>): value is T => isString(value) && Object.hasOwn(options, value);

/** Accepts only drafts with the current shape; anything else is discarded rather than repaired. */
export function parseDraft(value: unknown): WorkspaceDraft | null {
  if (!isObject(value) || value.version !== 1) return null;
  const { business, hours, assistant, knowledge } = value;
  if (value.industry !== null && !isOneOf(value.industry, INDUSTRY_LABELS)) return null;
  if (!isObject(business) || !["name", "city", "address", "description", "website"].every((key) => isString(business[key]))) return null;
  if (!Array.isArray(business.services) || !business.services.every((item) => isObject(item) && isString(item.id) && isString(item.name) && isString(item.duration))) return null;
  if (!isObject(hours) || !DAY_IDS.every((day) => {
    const entry = hours[day];
    return isObject(entry) && typeof entry.open === "boolean" && isString(entry.from) && isString(entry.to);
  })) return null;
  if (!isObject(assistant) || !isString(assistant.name) || !isString(assistant.greeting) || typeof assistant.bookingEnabled !== "boolean") return null;
  if (!isOneOf(assistant.tone, TONE_LABELS) || !isOneOf(assistant.unknownAnswer, UNKNOWN_ANSWER_LABELS)) return null;
  if (!Array.isArray(assistant.handoffTopics) || !assistant.handoffTopics.every((topic) => isOneOf(topic, HANDOFF_LABELS))) return null;
  if (!Array.isArray(knowledge) || !knowledge.every((item) => isObject(item) && isString(item.id) && isString(item.question) && isString(item.answer))) return null;
  if (typeof value.onboardingCompleted !== "boolean" || (value.updatedAt !== null && !isString(value.updatedAt))) return null;
  return value as WorkspaceDraft;
}
