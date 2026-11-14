"use server";

import { headers } from "next/headers";
import { replyToCustomer, AssistantProviderError, type ProviderFailure, type ReplyOutcome } from "../../../../../../../lib/assistant/anthropic.ts";
import { assistantConfig } from "../../../../../../../lib/assistant/config.ts";
import { buildInstructions } from "../../../../../../../lib/assistant/instructions.ts";
import { MAX_TEST_MESSAGE_LENGTH } from "../../../../../../../lib/assistant/limits.ts";
import { costMicrodollars } from "../../../../../../../lib/assistant/pricing.ts";
import { getCurrentAccount } from "../../../../../../../lib/auth/account.ts";
import { mfaRequired } from "../../../../../../../lib/auth/auth0.ts";
import { appendTestMessages, assistantBudgetAvailable, getTestTranscript, MAX_TEST_CONVERSATION_MESSAGES, recordAssistantUsage, TestConversationError, type TestMessage } from "../../../../../../../lib/db/assistant.ts";
import { canManage, ForbiddenError, withOrganization } from "../../../../../../../lib/db/context.ts";
import { getPool } from "../../../../../../../lib/db/pool.ts";
import { getAssistantConfig, listKnowledge } from "../../../../../../../lib/db/repositories.ts";
import { actionLimit, actionLog } from "../../../../../../../lib/operations/action-guard.ts";
import { checkRateLimit, limitMessage } from "../../../../../../../lib/operations/rate-limits.ts";
import { draftFromStored } from "../../../../../../../lib/workspace/persistence.ts";
import type { WorkspaceDraft } from "../../../../../../../lib/workspace/types.ts";

export type TestChatResult =
  | { status: "ok"; conversationId: string; reply: string; outcome: ReplyOutcome }
  | { status: "error"; message: string; restart?: boolean };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Shown when the model declines or returns no text; the customer still gets a useful next step. */
const FALLBACK_REPLY = "Izvinite, na to trenutno ne mogu da odgovorim. Mogu da zabeležim vaše pitanje za naš tim.";

const PROVIDER_MESSAGES: Record<ProviderFailure, string> = {
  key_rejected: "AI servis je odbio ključ. Vlasnik servera treba da proveri ANTHROPIC_API_KEY.",
  rate_limited: "AI servis je trenutno zauzet. Pokušajte ponovo za minut.",
  overloaded: "AI servis je trenutno preopterećen. Pokušajte ponovo za minut.",
  request_rejected: "AI servis nije prihvatio zahtev. Započnite novi razgovor i pokušajte ponovo.",
  timeout: "AI servis nije odgovorio na vreme. Pokušajte ponovo.",
  unreachable: "AI servis trenutno nije dostupan. Pokušajte ponovo.",
  provider_error: "AI servis je vratio grešku. Pokušajte ponovo.",
};

const error = (message: string, restart?: boolean): TestChatResult => ({ status: "error", message, ...(restart ? { restart } : {}) });

type Prepared =
  | { kind: "ready"; draft: WorkspaceDraft; transcript: TestMessage[] }
  | { kind: "forbidden" | "budget" | "not_found" | "full" | "corrupt" };

/**
 * Sends one test message to the organization's assistant and stores the
 * exchange as a test conversation. Everything from the browser is untrusted:
 * identity, membership and role come from the server, the conversation
 * history is read from the database (never sent by the browser), and the
 * organization id is only a lookup key that withOrganization() verifies.
 *
 * No database connection is held while the provider answers.
 */
export async function sendTestMessageAction(organizationId: string, conversationId: unknown, message: unknown): Promise<TestChatResult> {
  const config = assistantConfig();
  if (!config) return error("Probni razgovor nije uključen na ovom serveru.");
  const account = await getCurrentAccount();
  const pool = getPool();
  if (!account || !pool) return error("Sesija je istekla. Prijavite se ponovo.");
  const rateError = await actionLimit(pool, "assistant.message", account.userId);
  if (rateError) return error(rateError);
  if (mfaRequired() && !account.mfa) {
    await actionLog("assistant.message", "denied");
    return error("Za probni razgovor potrebna je prijava sa dvofaktorskom potvrdom.");
  }
  if (conversationId !== null && (typeof conversationId !== "string" || !uuidPattern.test(conversationId))) return error("Neispravan razgovor.", true);
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) return error("Napišite poruku.");
  if (text.length > MAX_TEST_MESSAGE_LENGTH) return error(`Poruka može imati najviše ${MAX_TEST_MESSAGE_LENGTH} znakova.`);

  const context = { userId: account.userId, organizationId };
  let prepared: Prepared;
  try {
    prepared = await withOrganization(pool, context, async (client, role): Promise<Prepared> => {
      if (!canManage(role)) return { kind: "forbidden" };
      if (!(await assistantBudgetAvailable(client, config.dailyBudgetMicrodollars))) return { kind: "budget" };
      const stored = await getAssistantConfig(client);
      const draft = draftFromStored(stored?.config ?? null, await listKnowledge(client), stored?.updatedAt ?? null);
      if (!draft) return { kind: "corrupt" };
      const transcript = conversationId === null ? [] : await getTestTranscript(client, conversationId);
      if (transcript === null) return { kind: "not_found" };
      if (transcript.length + 2 > MAX_TEST_CONVERSATION_MESSAGES) return { kind: "full" };
      return { kind: "ready", draft, transcript };
    });
  } catch (cause) {
    if (cause instanceof ForbiddenError) return error("Nemate pristup ovoj firmi.");
    await actionLog("assistant.message", "error", cause);
    return error("Probni razgovor trenutno nije dostupan. Pokušajte ponovo.");
  }
  switch (prepared.kind) {
    case "forbidden":
      await actionLog("assistant.message", "denied");
      return error("Probni razgovor je dostupan vlasniku i administratorima firme.");
    case "budget":
      return error("Dnevni limit troška za AI na ovom serveru je potrošen. Pokušajte sutra.");
    case "not_found":
      return error("Ovaj razgovor više ne postoji. Započnite novi.", true);
    case "full":
      return error("Razgovor je dostigao najveću dužinu. Započnite novi.", true);
    case "corrupt":
      return error("Podešavanje firme nije u očekivanom obliku. Osvežite stranicu.");
  }

  // Counted only after membership is confirmed, so outsiders cannot use up a firm's daily allowance.
  const requestId = (await headers()).get("x-request-id") ?? undefined;
  const daily = await checkRateLimit(pool, "assistant.daily", organizationId, requestId);
  if (!daily.allowed) return error(daily.status === 429 ? "Dnevni broj probnih poruka za ovu firmu je potrošen. Pokušajte sutra." : limitMessage(daily));

  const { draft, transcript } = prepared;
  let reply;
  try {
    reply = await replyToCustomer(config, buildInstructions(draft, new Date()), [...transcript, { speaker: "customer", body: text }]);
  } catch (cause) {
    await actionLog("assistant.message", "error", cause);
    return error(cause instanceof AssistantProviderError ? PROVIDER_MESSAGES[cause.code] : PROVIDER_MESSAGES.provider_error);
  }

  const replyText = reply.text ?? FALLBACK_REPLY;
  const greeting = draft.assistant.greeting.trim();
  const exchange: TestMessage[] = [
    ...(conversationId === null && greeting ? [{ speaker: "assistant" as const, body: greeting }] : []),
    { speaker: "customer", body: text },
    { speaker: "assistant", body: replyText },
  ];
  try {
    // Spending is recorded on its own, so a failed save still counts toward the daily limit.
    await withOrganization(pool, context, (client) => recordAssistantUsage(client, {
      inputTokens: reply.usage.inputTokens,
      outputTokens: reply.usage.outputTokens,
      costMicrodollars: costMicrodollars(config.model, reply.usage),
    }));
    const id = await withOrganization(pool, context, (client) => appendTestMessages(client, conversationId, exchange));
    await actionLog("assistant.message", "success");
    return { status: "ok", conversationId: id, reply: replyText, outcome: reply.outcome };
  } catch (cause) {
    if (cause instanceof TestConversationError) return error(cause.code === "full" ? "Razgovor je dostigao najveću dužinu. Započnite novi." : "Ovaj razgovor više ne postoji. Započnite novi.", true);
    if (cause instanceof ForbiddenError) return error("Nemate pristup ovoj firmi.");
    await actionLog("assistant.message", "error", cause);
    return error("Odgovor nije sačuvan. Pokušajte ponovo.");
  }
}
