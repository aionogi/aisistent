import Anthropic from "@anthropic-ai/sdk";
import type { TestMessage } from "../db/assistant.ts";
import type { AssistantConfig } from "./config.ts";
import type { ProviderUsage } from "./pricing.ts";

/**
 * Anthropic's Messages API, the only code that knows the AI provider. A
 * different provider replaces this file and keeps `replyToCustomer`'s shape.
 */

const TIMEOUT_MS = 25_000;
// Room for the model's own reasoning plus a short spoken-style answer.
const MAX_TOKENS = 1500;

export type ReplyOutcome = "answered" | "refused" | "incomplete";
export type ProviderReply = { text: string | null; outcome: ReplyOutcome; usage: ProviderUsage };
export type ProviderFailure = "key_rejected" | "rate_limited" | "overloaded" | "request_rejected" | "timeout" | "unreachable" | "provider_error";

/**
 * Carries only a fixed code: it reaches logs and error reporting, so never the
 * conversation or the provider's reply. Codes stay under 20 characters, which
 * error reporting would otherwise replace as possible tokens.
 */
export class AssistantProviderError extends Error {
  readonly code: ProviderFailure;
  constructor(code: ProviderFailure) {
    super(code);
    this.name = "AssistantProviderError";
    this.code = code;
  }
}

/** The transcript as API turns: it starts with the customer's first message (the greeting is in the instructions). */
export function providerMessages(transcript: TestMessage[]): Anthropic.MessageParam[] {
  const start = transcript.findIndex((message) => message.speaker === "customer");
  if (start < 0) return [];
  return transcript.slice(start).map((message) => ({ role: message.speaker === "customer" ? "user" : "assistant", content: message.body }));
}

function failureFor(error: unknown): ProviderFailure {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return "key_rejected";
  if (error instanceof Anthropic.RateLimitError) return "rate_limited";
  if (error instanceof Anthropic.APIConnectionTimeoutError) return "timeout";
  if (error instanceof Anthropic.APIConnectionError) return "unreachable";
  if (error instanceof Anthropic.InternalServerError) return error.status === 529 ? "overloaded" : "provider_error";
  if (error instanceof Anthropic.APIError && typeof error.status === "number" && error.status >= 400 && error.status < 500) return "request_rejected";
  return "provider_error";
}

/** Asks the model for the assistant's next reply to the customer's last message. */
export async function replyToCustomer(config: AssistantConfig, instructions: string, transcript: TestMessage[]): Promise<ProviderReply> {
  const messages = providerMessages(transcript);
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") throw new AssistantProviderError("request_rejected");
  const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseURL, timeout: TIMEOUT_MS, maxRetries: 1 });

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: config.model,
      max_tokens: MAX_TOKENS,
      // Thinking stays at the model's default (adaptive); low effort keeps short chat replies fast and cheap.
      output_config: { effort: "low" },
      system: instructions,
      messages,
    });
  } catch (error) {
    throw new AssistantProviderError(failureFor(error));
  }

  const usage: ProviderUsage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
  };
  if (response.stop_reason === "refusal") return { text: null, outcome: "refused", usage };
  // A response can begin with thinking blocks; only text blocks are the answer.
  const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("").trim();
  if (!text) return { text: null, outcome: "incomplete", usage };
  return { text: text.slice(0, 2000), outcome: "answered", usage };
}
