/**
 * Estimated cost of one provider request, for the server's daily spending
 * limit. The provider's own bill is authoritative; set a spending limit in
 * its console as the hard ceiling. Rates are US dollars per million tokens
 * from Anthropic's price list as of 2026-11-03; check them when changing the
 * model. An unknown model is charged at a high rate, so the limit errs on the
 * safe side.
 */

type Rate = { input: number; output: number };

const RATES: Record<string, Rate> = {
  // Prompts up to 100K tokens; longer ones cost 5x, handled below.
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-fable-5-2": { input: 8, output: 40 },
};
const UNKNOWN_MODEL: Rate = { input: 10, output: 50 };

export type ProviderUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
};

/** Millionths of a dollar. $1 per million tokens is exactly one microdollar per token. */
export function costMicrodollars(model: string, usage: ProviderUsage): number {
  const rate = RATES[model] ?? UNKNOWN_MODEL;
  // Cache writes cost up to 2x input and reads 0.1x; counting them at 2x and 1x overestimates, never underestimates.
  const input = usage.inputTokens + 2 * (usage.cacheCreationInputTokens ?? 0) + (usage.cacheReadInputTokens ?? 0);
  const multiplier = model === "claude-haiku-5-5" && input > 100_000 ? 5 : 1;
  return Math.ceil(input * rate.input * multiplier + usage.outputTokens * rate.output * multiplier);
}
