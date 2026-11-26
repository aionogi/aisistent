import type { Pool, PoolClient } from "pg";

/**
 * Test conversations and AI spending (migration 0009). Every function runs
 * inside withOrganization(); the database refuses anyone who is not an owner
 * or admin of the current organization.
 */

export type TestMessage = { speaker: "customer" | "assistant"; body: string };

/** Most messages one test conversation holds (enforced again in the database). */
export const MAX_TEST_CONVERSATION_MESSAGES = 60;

export class TestConversationError extends Error {
  readonly code: "not_found" | "full";
  constructor(code: "not_found" | "full") {
    super(code);
    this.name = "TestConversationError";
    this.code = code;
  }
}

/** The transcript of one test conversation of the current organization, or null when there is none with that id. */
export async function getTestTranscript(client: PoolClient, conversationId: string): Promise<TestMessage[] | null> {
  const { rows: found } = await client.query("SELECT 1 FROM app.conversations WHERE id = $1 AND organization_id = app.current_organization_id() AND channel = 'test'", [conversationId]);
  if (found.length === 0) return null;
  const { rows } = await client.query<TestMessage>(
    `SELECT speaker, body FROM app.conversation_messages
     WHERE conversation_id = $1 AND organization_id = app.current_organization_id() ORDER BY position`,
    [conversationId],
  );
  return rows.filter((row) => row.speaker === "customer" || row.speaker === "assistant");
}

/** Appends messages to a test conversation, creating it when the id is null; returns its id. */
export async function appendTestMessages(client: PoolClient, conversationId: string | null, messages: TestMessage[]): Promise<string> {
  try {
    const { rows } = await client.query<{ id: string }>("SELECT app.append_test_messages($1, $2) AS id", [conversationId, JSON.stringify(messages)]);
    return rows[0].id;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("conversation_not_found")) throw new TestConversationError("not_found");
    if (message.includes("conversation_full")) throw new TestConversationError("full");
    throw error;
  }
}

/** True while today's (UTC) spending on the AI provider is below the server's daily limit. */
export async function assistantBudgetAvailable(client: Pool | PoolClient, limitMicrodollars: number): Promise<boolean> {
  const { rows } = await client.query<{ available: boolean }>("SELECT app.assistant_budget_available($1) AS available", [limitMicrodollars]);
  return rows[0]?.available === true;
}

/** Adds one provider request to today's totals. */
export async function recordAssistantUsage(client: PoolClient, usage: { inputTokens: number; outputTokens: number; costMicrodollars: number }): Promise<void> {
  await client.query("SELECT app.record_assistant_usage($1, $2, $3)", [usage.inputTokens, usage.outputTokens, usage.costMicrodollars]);
}
