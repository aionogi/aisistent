/**
 * Server configuration of the AI assistant. It is off unless the operator
 * turns it on: ASSISTANT_ENABLED=true and an ANTHROPIC_API_KEY. Setting
 * ASSISTANT_ENABLED to anything else is the emergency stop; a malformed value
 * also leaves the assistant off rather than guessing.
 */

export const DEFAULT_ASSISTANT_MODEL = "claude-haiku-5-5";
const DEFAULT_DAILY_BUDGET_USD = 1;
const DEFAULT_API_URL = "https://api.anthropic.com";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export type AssistantConfig = {
  apiKey: string;
  model: string;
  /** Spending ceiling per UTC day across all organizations, in millionths of a US dollar. */
  dailyBudgetMicrodollars: number;
  /** Provider address: Anthropic's API, or a loopback test server. */
  baseURL: string;
};

function providerUrl(value: string | undefined): string | null {
  try {
    const url = new URL(value?.trim() || DEFAULT_API_URL);
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))) return url.origin;
  } catch {
    // A malformed address leaves the assistant off.
  }
  return null;
}

function dailyBudget(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return DEFAULT_DAILY_BUDGET_USD * 1_000_000;
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(value.trim())) return null;
  const dollars = Number(value.trim());
  return dollars > 0 && dollars <= 1000 ? Math.round(dollars * 1_000_000) : null;
}

export function assistantConfig(env: Record<string, string | undefined> = process.env): AssistantConfig | null {
  if (env.ASSISTANT_ENABLED?.trim() !== "true") return null;
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  const model = env.ASSISTANT_MODEL?.trim() || DEFAULT_ASSISTANT_MODEL;
  const budget = dailyBudget(env.ASSISTANT_DAILY_BUDGET_USD);
  const baseURL = providerUrl(env.ASSISTANT_API_URL);
  if (!apiKey || /\s/.test(apiKey) || !/^claude-[a-z0-9.-]{1,60}$/.test(model) || budget === null || !baseURL) return null;
  return { apiKey, model, dailyBudgetMicrodollars: budget, baseURL };
}
