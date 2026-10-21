import { parseDraft } from "./storage.ts";
import { createEmptyDraft, DAY_IDS } from "./templates.ts";
import type { KnowledgeEntry, WorkspaceDraft } from "./types.ts";
import { LIMITS } from "./validation.ts";

/**
 * Conversion between the editor's WorkspaceDraft and what an organization
 * stores: the configuration document (app.assistant_configs.config) plus
 * separate knowledge rows (app.knowledge_entries).
 *
 * Drafts may be incomplete while someone is still setting up, so the server
 * does not require every field; it enforces shape and size limits only.
 */

export type StoredConfig = Omit<WorkspaceDraft, "knowledge" | "updatedAt">;

/** What the browser learns from a save request (see the organization save action). */
export type SaveWorkspaceResult =
  | { status: "saved"; revision: number; savedAt: string; idMap: Record<string, string> }
  | { status: "conflict" | "forbidden" | "signed-out" | "error" }
  | { status: "invalid"; message: string };

/** Upper bound for knowledge entries per organization in the editor. */
export const MAX_KNOWLEDGE_ENTRIES = 200;
const MAX_ID_LENGTH = 80;
const timeOrEmpty = /^(([01]\d|2[0-3]):[0-5]\d)?$/;

export function toStoredConfig(draft: WorkspaceDraft): StoredConfig {
  const { knowledge: _knowledge, updatedAt: _updatedAt, ...config } = draft;
  return config;
}

/**
 * Rebuilds the editor draft from stored data. Returns null when the stored
 * document does not match the current shape, so the caller can decide how to
 * recover instead of showing corrupted values.
 */
export function draftFromStored(config: unknown, knowledge: Array<Pick<KnowledgeEntry, "id" | "question" | "answer">>, updatedAt: Date | null): WorkspaceDraft | null {
  if (config === null) return { ...createEmptyDraft(), knowledge: knowledge.map(({ id, question, answer }) => ({ id, question, answer })), updatedAt: updatedAt?.toISOString() ?? null };
  if (typeof config !== "object" || Array.isArray(config)) return null;
  return parseDraft({
    ...(config as Record<string, unknown>),
    knowledge: knowledge.map(({ id, question, answer }) => ({ id, question, answer })),
    updatedAt: updatedAt?.toISOString() ?? null,
  });
}

/**
 * Checks a draft received from the browser before it is stored. Returns a
 * Serbian message for the editor, or null when the draft is acceptable.
 */
export function checkDraftLimits(draft: WorkspaceDraft): string | null {
  const { business, assistant, knowledge } = draft;
  const tooLong = (value: string, limit: number) => value.length > limit;
  if (tooLong(business.name, LIMITS.businessName) || tooLong(business.city, LIMITS.city) || tooLong(business.address, LIMITS.address)
    || tooLong(business.description, LIMITS.description) || tooLong(business.website, LIMITS.website)) {
    return "Neki podaci o poslu su predugački.";
  }
  if (business.services.length > LIMITS.maxServices) return `Najviše ${LIMITS.maxServices} usluga.`;
  if (business.services.some((service) => tooLong(service.id, MAX_ID_LENGTH) || tooLong(service.name, LIMITS.serviceName) || tooLong(service.duration, LIMITS.serviceDuration))) {
    return "Naziv ili trajanje usluge je predugačko.";
  }
  if (DAY_IDS.some((day) => !timeOrEmpty.test(draft.hours[day].from) || !timeOrEmpty.test(draft.hours[day].to))) return "Radno vreme nije u obliku SS:MM.";
  if (tooLong(assistant.name, LIMITS.assistantName) || tooLong(assistant.greeting, LIMITS.greeting)) return "Ime ili pozdrav asistenta je predugačak.";
  if (knowledge.length > MAX_KNOWLEDGE_ENTRIES) return `Baza znanja može imati najviše ${MAX_KNOWLEDGE_ENTRIES} odgovora.`;
  if (knowledge.some((entry) => tooLong(entry.id, MAX_ID_LENGTH) || !entry.question.trim() || !entry.answer.trim() || tooLong(entry.question, LIMITS.question) || tooLong(entry.answer, LIMITS.answer))) {
    return "Svaki odgovor u bazi znanja mora imati pitanje i odgovor u dozvoljenoj dužini.";
  }
  return null;
}
