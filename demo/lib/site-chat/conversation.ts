import type { Pool } from "pg";
import { AssistantProviderError, replyToCustomer } from "../assistant/anthropic.ts";
import type { AssistantConfig } from "../assistant/config.ts";
import { buildInstructions } from "../assistant/instructions.ts";
import { costMicrodollars } from "../assistant/pricing.ts";
import { assistantBudgetAvailable, type TestMessage } from "../db/assistant.ts";
import { appendSiteMessages, getSiteThread, openSiteChat, recordSiteChatUsage, SiteChatError } from "../db/site-chat.ts";
import { logEvent } from "../operations/logging.ts";
import { checkRateLimit, limitMessage } from "../operations/rate-limits.ts";
import { draftFromStored } from "../workspace/persistence.ts";
import { isPublicId, MAX_SITE_CONVERSATION_MESSAGES, MAX_SITE_MESSAGE_LENGTH, offTopicState, readOffTopicMarker } from "./policy.ts";
import { newVisitorToken, visitorTokenHash } from "./token.ts";

/**
 * Answers a visitor of a firm's website. Everything from the browser is
 * untrusted: the widget id only selects an enabled firm, the conversation is
 * found by the visitor's token, and its history is read from the database.
 *
 * Layers against abuse, cheapest first: per-address budgets (a burst and an
 * hour), message length, a repeated message, the firm's own daily limit, a cap
 * of 40 messages per conversation, the server's daily spending ceiling, and the
 * end of a conversation after three unrelated messages in a row. The instructions keep
 * the assistant on the firm's business; the marker it adds to unrelated
 * replies only counts them.
 */

export type SiteChatFailure = "unavailable" | "invalid" | "limited" | "firm_limit" | "restart" | "changed" | "provider" | "error";

export type SiteChatReply =
  | { status: "ok"; token: string; reply: string; ended: boolean }
  | { status: "error"; code: SiteChatFailure; message: string; retryAfterSeconds?: number };

export type SiteChatHistory =
  | { status: "ok"; messages: TestMessage[]; ended: boolean }
  | { status: "error"; code: SiteChatFailure; message: string; retryAfterSeconds?: number };

type Context = { pool: Pool; config: AssistantConfig | null; identity: string; requestId?: string; now?: Date };

const UNAVAILABLE = "Chat trenutno nije dostupan. Kontaktirajte nas telefonom ili e-poštom.";
/** Shown when the model declines or returns no text; the visitor still gets a next step. */
const FALLBACK_REPLY = "Izvinite, na to trenutno ne mogu da odgovorim. Mogu da zabeležim vaše pitanje za naš tim.";

const failure = (code: SiteChatFailure, message: string, retryAfterSeconds?: number) =>
  ({ status: "error" as const, code, message, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) });

function restartMessage(code: "not_found" | "full" | "ended"): string {
  if (code === "full") return "Razgovor je dostigao najveću dužinu. Započnite novi razgovor.";
  if (code === "ended") return "Ovaj razgovor je završen. Možete započeti novi razgovor.";
  return "Ovaj razgovor više ne postoji. Započnite novi razgovor.";
}

const sameText = (left: string, right: string) => left.trim().replace(/\s+/g, " ").toLowerCase() === right.trim().replace(/\s+/g, " ").toLowerCase();

function log(outcome: "success" | "denied" | "error", requestId?: string, cause?: unknown): void {
  logEvent(outcome === "error" ? "action.failed" : "action.completed", { operation: "site.message", outcome, requestId }, cause);
}

/** One visitor message and the assistant's reply, stored in the firm's conversations. */
export async function answerVisitor(context: Context, input: { publicId: unknown; token: unknown; message: unknown }): Promise<SiteChatReply> {
  const { pool, config, identity, requestId } = context;
  if (!config || !isPublicId(input.publicId)) return failure("unavailable", UNAVAILABLE);
  const publicId = input.publicId;

  for (const operation of ["site.message", "site.hourly"] as const) {
    const limit = await checkRateLimit(pool, operation, identity, requestId);
    if (!limit.allowed) return failure("limited", limitMessage(limit), limit.retryAfterSeconds);
  }

  const text = typeof input.message === "string" ? input.message.trim() : "";
  if (!text) return failure("invalid", "Napišite poruku.");
  if (text.length > MAX_SITE_MESSAGE_LENGTH) return failure("invalid", `Poruka može imati najviše ${MAX_SITE_MESSAGE_LENGTH} znakova.`);
  const isNew = input.token === null || input.token === undefined;
  const token = isNew ? newVisitorToken() : input.token;
  const tokenHash = visitorTokenHash(token);
  if (!tokenHash || typeof token !== "string") return failure("restart", restartMessage("not_found"));

  let prepared;
  try {
    const open = await openSiteChat(pool, publicId);
    if (!open) return failure("unavailable", UNAVAILABLE);
    const draft = draftFromStored(open.config, open.knowledge, open.configUpdatedAt);
    if (!draft) return failure("unavailable", UNAVAILABLE);
    const thread = isNew ? null : await getSiteThread(pool, publicId, tokenHash);
    if (!isNew && !thread) return failure("restart", restartMessage("not_found"));
    if (thread?.ended) return failure("restart", restartMessage("ended"));
    const history = thread?.messages ?? [];
    if (history.length + 2 > MAX_SITE_CONVERSATION_MESSAGES) return failure("restart", restartMessage("full"));
    // The same message again costs a request and adds nothing.
    const previous = history.findLast((message) => message.speaker === "customer")?.body;
    if (previous !== undefined && sameText(previous, text)) return failure("invalid", "Ovu poruku ste već poslali. Napišite drugo pitanje ili sačekajte odgovor.");
    prepared = { open, draft, thread, history };
  } catch (cause) {
    log("error", requestId, cause);
    return failure("error", "Poruka nije poslata. Pokušajte ponovo.");
  }
  const { open, draft, thread, history } = prepared;

  // The firm's allowance is counted only for messages that reach its assistant.
  const daily = await checkRateLimit(pool, "site.daily", open.organizationId, requestId, open.dailyMessageLimit);
  if (!daily.allowed) {
    return daily.status === 429
      ? failure("firm_limit", "Asistent je danas odgovorio na najveći broj poruka. Kontaktirajte nas telefonom ili e-poštom.")
      : failure("limited", limitMessage(daily), daily.retryAfterSeconds);
  }
  try {
    if (!(await assistantBudgetAvailable(pool, config.dailyBudgetMicrodollars))) return failure("unavailable", UNAVAILABLE);
  } catch (cause) {
    log("error", requestId, cause);
    return failure("error", "Poruka nije poslata. Pokušajte ponovo.");
  }

  let reply;
  try {
    reply = await replyToCustomer(config, buildInstructions(draft, context.now ?? new Date(), "site"), [...history, { speaker: "customer", body: text }]);
  } catch (cause) {
    log("error", requestId, cause);
    const busy = cause instanceof AssistantProviderError && (cause.code === "rate_limited" || cause.code === "overloaded");
    return failure("provider", busy ? "Asistent je trenutno zauzet. Pokušajte ponovo za minut." : "Asistent trenutno ne može da odgovori. Pokušajte ponovo malo kasnije.");
  }

  const marked = readOffTopicMarker(reply.text ?? "");
  const replyText = marked.text || FALLBACK_REPLY;
  const { ended } = offTopicState(thread?.offTopicStreak ?? 0, marked.offTopic);
  const greeting = draft.assistant.greeting.trim();
  const exchange: TestMessage[] = [
    ...(isNew && greeting ? [{ speaker: "assistant" as const, body: greeting }] : []),
    { speaker: "customer", body: text },
    { speaker: "assistant", body: replyText },
  ];
  try {
    // Spending is recorded first, so a failed save still counts toward the daily ceiling.
    await recordSiteChatUsage(pool, publicId, { inputTokens: reply.usage.inputTokens, outputTokens: reply.usage.outputTokens, costMicrodollars: costMicrodollars(config.model, reply.usage) });
    await appendSiteMessages(pool, publicId, tokenHash, history.length, exchange, { offTopic: marked.offTopic, end: ended });
  } catch (cause) {
    if (cause instanceof SiteChatError) {
      if (cause.code === "unavailable") return failure("unavailable", UNAVAILABLE);
      if (cause.code === "changed") return failure("changed", "U međuvremenu je stigao drugi odgovor. Učitavam razgovor ponovo.");
      if (cause.code === "full" || cause.code === "ended") return failure("restart", restartMessage(cause.code));
    }
    log("error", requestId, cause);
    return failure("error", "Odgovor nije sačuvan. Pokušajte ponovo.");
  }
  log("success", requestId);
  return { status: "ok", token, reply: replyText, ended };
}

/** A visitor's conversation so far, to show it again after the page changes; empty for an unknown token. */
export async function visitorHistory(context: Omit<Context, "config" | "now">, input: { publicId: unknown; token: unknown }): Promise<SiteChatHistory> {
  const { pool, identity, requestId } = context;
  if (!isPublicId(input.publicId)) return failure("unavailable", UNAVAILABLE);
  const limit = await checkRateLimit(pool, "site.read", identity, requestId);
  if (!limit.allowed) return failure("limited", limitMessage(limit), limit.retryAfterSeconds);
  const tokenHash = visitorTokenHash(input.token);
  if (!tokenHash) return { status: "ok", messages: [], ended: false };
  try {
    const thread = await getSiteThread(pool, input.publicId, tokenHash);
    return { status: "ok", messages: thread?.messages ?? [], ended: thread?.ended ?? false };
  } catch (cause) {
    logEvent("action.failed", { operation: "site.read", outcome: "error", requestId }, cause);
    return failure("error", "Razgovor nije učitan. Pokušajte ponovo.");
  }
}
