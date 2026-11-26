/**
 * The rules of the chat that firms embed on their websites (migration 0010).
 * Visitors are anonymous, so every limit here is enforced on the server and,
 * where it protects stored data, again in the database. Safe to import in the
 * browser; visitor tokens are in token.ts.
 */

/** Longest message a visitor can send; shared by the chat form and the server. */
export const MAX_SITE_MESSAGE_LENGTH = 500;
/** Most messages one visitor conversation holds, greeting included (also enforced in the database). */
export const MAX_SITE_CONVERSATION_MESSAGES = 40;
/** Unrelated messages in a row after which the conversation ends without further AI requests. */
export const OFF_TOPIC_LIMIT = 3;
/** Websites one firm can allow (also enforced in the database). */
export const MAX_ALLOWED_ORIGINS = 5;
export const DEFAULT_DAILY_MESSAGE_LIMIT = 300;
export const MIN_DAILY_MESSAGE_LIMIT = 10;
export const MAX_DAILY_MESSAGE_LIMIT = 5000;

/** The marker the model puts in a reply to a message that has nothing to do with the business; never shown. */
export const OFF_TOPIC_MARKER = "[OFF_TOPIC]";

const PUBLIC_ID = /^[0-9a-f]{20}$/;
const HOST_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export function isPublicId(value: unknown): value is string {
  return typeof value === "string" && PUBLIC_ID.test(value);
}

/**
 * The https origin of a website a person typed ("salon.rs", "https://www.salon.rs/kontakt"),
 * or null when it is not a public https website. International domain names
 * become their ASCII form, which is how browsers report an origin.
 */
export function normalizeOrigin(input: string): string | null {
  const text = input.trim();
  if (!text || text.length > 300 || /\s/.test(text)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  // URL parsing already lowercases the name and turns international names into their ASCII form.
  const host = url.hostname.replace(/\.$/, "");
  const labels = host.split(".");
  if (labels.length < 2 || labels.some((label) => label.length > 63 || !HOST_LABEL.test(label))) return null;
  // A top-level label of digits only means an IP address, not a website name.
  if (/^\d+$/.test(labels[labels.length - 1])) return null;
  return `https://${host}`;
}

export type OriginsResult = { origins: string[] } | { error: string };

/** Parses the websites field: one site per line or separated by commas. */
export function parseOrigins(text: string): OriginsResult {
  const entries = text.split(/[\n,]+/).map((entry) => entry.trim()).filter(Boolean);
  const origins: string[] = [];
  for (const entry of entries) {
    const origin = normalizeOrigin(entry);
    if (!origin) return { error: `„${entry.slice(0, 60)}“ nije adresa sajta. Upišite je kao salon.rs ili https://www.salon.rs.` };
    if (!origins.includes(origin)) origins.push(origin);
  }
  if (origins.length > MAX_ALLOWED_ORIGINS) return { error: `Najviše ${MAX_ALLOWED_ORIGINS} sajtova.` };
  return { origins };
}

/** The reply without the off-topic marker, and whether the model set it. */
export function readOffTopicMarker(reply: string): { text: string; offTopic: boolean } {
  const offTopic = reply.includes(OFF_TOPIC_MARKER);
  return { text: reply.split(OFF_TOPIC_MARKER).join("").replace(/[ \t]{2,}/g, " ").trim(), offTopic };
}

/** The run of unrelated messages after this reply, and whether the conversation ends with it. */
export function offTopicState(previousStreak: number, offTopic: boolean): { streak: number; ended: boolean } {
  const streak = offTopic ? previousStreak + 1 : 0;
  return { streak, ended: streak >= OFF_TOPIC_LIMIT };
}

/** The snippet a firm pastes into its website, just before </body>. */
export function embedCode(appOrigin: string, publicId: string): string {
  return `<script src="${appOrigin}/widget.js" data-aisistent="${publicId}" async></script>`;
}
