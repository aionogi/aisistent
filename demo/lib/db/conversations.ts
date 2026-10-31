import type { PoolClient } from "pg";
import { recordAudit } from "./repositories.ts";

/**
 * Durable conversation records (migration 0008). Functions that take a
 * PoolClient run inside withOrganization(); RLS limits reads to members and
 * deletes to owners and admins.
 */

export type ConversationChannel = "call" | "message";
export type ConversationOutcome = "booked" | "answered" | "handoff" | "unanswered";
export type ConversationSpeaker = "assistant" | "customer" | "team";

export type StoredConversation = {
  id: string;
  channel: ConversationChannel;
  outcome: ConversationOutcome;
  customerName: string | null;
  customerContact: string | null;
  summary: string | null;
  startedAt: Date;
  endedAt: Date | null;
};
export type StoredMessage = { position: number; speaker: ConversationSpeaker; body: string; spokenAt: Date | null };

export const RETENTION_OPTIONS = [30, 90, 180, 365] as const;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The most recent conversations of the current organization. */
export async function listConversations(client: PoolClient, limit = 100): Promise<StoredConversation[]> {
  const { rows } = await client.query<StoredConversation>(
    `SELECT id, channel, outcome, customer_name AS "customerName", customer_contact AS "customerContact", summary,
       started_at AS "startedAt", ended_at AS "endedAt"
     FROM app.conversations WHERE organization_id = app.current_organization_id()
     ORDER BY started_at DESC, id LIMIT $1`,
    [Math.min(Math.max(limit, 1), 200)],
  );
  return rows;
}

export async function countConversations(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ total: number }>("SELECT count(*)::int AS total FROM app.conversations WHERE organization_id = app.current_organization_id()");
  return rows[0].total;
}

/** The transcript of one conversation, or an empty list for unknown or foreign ids. */
export async function getConversationMessages(client: PoolClient, conversationId: string): Promise<StoredMessage[]> {
  if (!uuidPattern.test(conversationId)) return [];
  const { rows } = await client.query<StoredMessage>(
    `SELECT position, speaker, body, spoken_at AS "spokenAt" FROM app.conversation_messages
     WHERE conversation_id = $1 AND organization_id = app.current_organization_id() ORDER BY position`,
    [conversationId],
  );
  return rows;
}

/** Deletes one conversation with its transcript (owners and admins); records the deletion. */
export async function deleteConversation(client: PoolClient, conversationId: string): Promise<boolean> {
  if (!uuidPattern.test(conversationId)) return false;
  const result = await client.query("DELETE FROM app.conversations WHERE id = $1 AND organization_id = app.current_organization_id()", [conversationId]);
  if (result.rowCount !== 1) return false;
  await recordAudit(client, { action: "conversation.delete", target: conversationId, result: "success" });
  return true;
}

export async function getConversationRetention(client: PoolClient): Promise<number | null> {
  const { rows } = await client.query<{ days: number }>(
    "SELECT conversation_retention_days AS days FROM app.organizations WHERE id = app.current_organization_id()",
  );
  return rows[0]?.days ?? null;
}

export type RecordedConversation = {
  channel: ConversationChannel;
  outcome: ConversationOutcome;
  customerName?: string;
  customerContact?: string;
  summary?: string;
  startedAt: Date;
  endedAt?: Date;
  messages: Array<{ speaker: ConversationSpeaker; body: string; spokenAt?: Date }>;
};

/**
 * Stores a finished conversation. Needs a connection allowed to execute
 * app.record_conversation(): no application role is in M3 (only the
 * migration owner, used by tests); M4's ingestion path will get that grant.
 */
export async function recordConversation(client: Pick<PoolClient, "query">, organizationId: string, conversation: RecordedConversation): Promise<string> {
  const record = {
    channel: conversation.channel,
    outcome: conversation.outcome,
    customer_name: conversation.customerName ?? null,
    customer_contact: conversation.customerContact ?? null,
    summary: conversation.summary ?? null,
    started_at: conversation.startedAt.toISOString(),
    ended_at: conversation.endedAt?.toISOString() ?? null,
    messages: conversation.messages.map((message) => ({ speaker: message.speaker, body: message.body, spoken_at: message.spokenAt?.toISOString() ?? null })),
  };
  const { rows } = await client.query<{ id: string }>("SELECT app.record_conversation($1, $2) AS id", [organizationId, record]);
  return rows[0].id;
}
