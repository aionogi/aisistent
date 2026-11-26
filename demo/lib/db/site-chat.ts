import type { Pool, PoolClient } from "pg";
import type { TestMessage } from "./assistant.ts";

/**
 * The website chat in the database (migration 0010). Settings are read and
 * changed inside withOrganization(); the visitor side runs without a user or
 * organization and reaches data only through the widget's public id and the
 * visitor's token hash.
 */

type Queryable = Pool | PoolClient;

export type SiteChatSettings = {
  publicId: string;
  enabled: boolean;
  allowedOrigins: string[];
  dailyMessageLimit: number;
  updatedAt: Date;
};

export type OpenSiteChat = {
  organizationId: string;
  dailyMessageLimit: number;
  config: unknown;
  configUpdatedAt: Date | null;
  knowledge: Array<{ id: string; question: string; answer: string }>;
};

export type SiteThread = { ended: boolean; offTopicStreak: number; messages: TestMessage[] };

export type SiteChatErrorCode = "invalid" | "forbidden" | "unavailable" | "changed" | "full" | "ended";

export class SiteChatError extends Error {
  readonly code: SiteChatErrorCode;
  constructor(code: SiteChatErrorCode) {
    super(code);
    this.name = "SiteChatError";
    this.code = code;
  }
}

const DATABASE_ERRORS: Array<[string, SiteChatErrorCode]> = [
  ["invalid_site_chat", "invalid"],
  ["editor_required", "forbidden"],
  ["site_chat_unavailable", "unavailable"],
  ["thread_changed", "changed"],
  ["thread_full", "full"],
  ["thread_ended", "ended"],
];

function translated(error: unknown): unknown {
  const message = error instanceof Error ? error.message : "";
  const match = DATABASE_ERRORS.find(([text]) => message.includes(text));
  // A token hash already used with another widget, which only a forged token can cause.
  if (!match && (error as { code?: string })?.code === "23505" && message.includes("site_chat_threads")) return new SiteChatError("changed");
  return match ? new SiteChatError(match[1]) : error;
}

/** The current organization's website chat settings, or null before they were first saved. */
export async function getSiteChatSettings(client: PoolClient): Promise<SiteChatSettings | null> {
  const { rows } = await client.query<SiteChatSettings>(
    `SELECT public_id AS "publicId", enabled, allowed_origins AS "allowedOrigins", daily_message_limit AS "dailyMessageLimit", updated_at AS "updatedAt"
     FROM app.site_chat_settings WHERE organization_id = app.current_organization_id()`,
  );
  return rows[0] ?? null;
}

/** Saves the current organization's settings (owners and admins); returns the widget's public id. */
export async function setSiteChat(client: PoolClient, settings: { enabled: boolean; allowedOrigins: string[]; dailyMessageLimit: number }): Promise<string> {
  try {
    const { rows } = await client.query<{ id: string }>("SELECT app.set_site_chat($1, $2, $3) AS id", [settings.enabled, settings.allowedOrigins, settings.dailyMessageLimit]);
    return rows[0].id;
  } catch (error) {
    throw translated(error);
  }
}

/** The websites that may show the widget, or null for an unknown widget. */
export async function siteChatFrameOrigins(pool: Queryable, publicId: string): Promise<string[] | null> {
  const { rows } = await pool.query<{ origins: string[] | null }>("SELECT app.site_chat_frame($1) AS origins", [publicId]);
  return rows[0]?.origins ?? null;
}

/** An enabled widget's firm, settings and knowledge, or null when it is off or unknown. */
export async function openSiteChat(pool: Queryable, publicId: string): Promise<OpenSiteChat | null> {
  const { rows } = await pool.query<{ organization_id: string; daily_message_limit: number; config: unknown; config_updated_at: Date | null; knowledge: OpenSiteChat["knowledge"] }>(
    "SELECT organization_id, daily_message_limit, config, config_updated_at, knowledge FROM app.site_chat_open($1)",
    [publicId],
  );
  const row = rows[0];
  if (!row) return null;
  return { organizationId: row.organization_id, dailyMessageLimit: row.daily_message_limit, config: row.config, configUpdatedAt: row.config_updated_at, knowledge: row.knowledge };
}

/** One visitor's conversation with an enabled widget, or null. */
export async function getSiteThread(pool: Queryable, publicId: string, tokenHash: Buffer): Promise<SiteThread | null> {
  const { rows } = await pool.query<{ thread: { ended: boolean; offTopicStreak: number; messages: Array<{ speaker: string; body: string }> } | null }>(
    "SELECT app.site_chat_thread($1, $2) AS thread",
    [publicId, tokenHash],
  );
  const thread = rows[0]?.thread;
  if (!thread) return null;
  return {
    ended: thread.ended,
    offTopicStreak: thread.offTopicStreak,
    messages: thread.messages.filter((message): message is TestMessage => message.speaker === "customer" || message.speaker === "assistant"),
  };
}

/**
 * Appends one exchange to the visitor's conversation, creating it when
 * expectedCount is 0. Returns the new number of messages.
 */
export async function appendSiteMessages(
  pool: Queryable,
  publicId: string,
  tokenHash: Buffer,
  expectedCount: number,
  messages: TestMessage[],
  state: { offTopic: boolean; end: boolean },
): Promise<number> {
  try {
    const { rows } = await pool.query<{ count: number }>(
      "SELECT app.site_chat_append($1, $2, $3, $4, $5, $6) AS count",
      [publicId, tokenHash, expectedCount, JSON.stringify(messages), state.offTopic, state.end],
    );
    return rows[0].count;
  } catch (error) {
    throw translated(error);
  }
}

/** Adds one provider request made for an enabled widget to today's totals. */
export async function recordSiteChatUsage(pool: Queryable, publicId: string, usage: { inputTokens: number; outputTokens: number; costMicrodollars: number }): Promise<void> {
  try {
    await pool.query("SELECT app.record_site_chat_usage($1, $2, $3, $4)", [publicId, usage.inputTokens, usage.outputTokens, usage.costMicrodollars]);
  } catch (error) {
    throw translated(error);
  }
}
