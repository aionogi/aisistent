import type { Pool, PoolClient } from "pg";
import { withUser, type MemberRole } from "./context.ts";

/**
 * Data access for tenant records. Functions that take a PoolClient must run
 * inside withOrganization(); they never accept an organization id from the
 * caller and instead use the transaction's verified context.
 */

export class ConflictError extends Error {
  constructor(message = "The record was changed by someone else.") {
    super(message);
    this.name = "ConflictError";
  }
}

export type Membership = { organizationId: string; organizationName: string; role: MemberRole };
export type AssistantConfigRecord = { config: Record<string, unknown>; revision: number; updatedAt: Date };
export type KnowledgeRecord = { id: string; question: string; answer: string; updatedAt: Date };

/** Call only after the identity provider's session has been verified on the server. */
export async function provisionUser(pool: Pool, identity: { subject: string; email: string | null; displayName: string | null }): Promise<string> {
  const { rows } = await pool.query<{ id: string }>("SELECT app.provision_user($1, $2, $3) AS id", [identity.subject, identity.email, identity.displayName]);
  return rows[0].id;
}

export function createOrganization(pool: Pool, userId: string, name: string): Promise<string> {
  return withUser(pool, userId, async (client) => {
    const { rows } = await client.query<{ id: string }>("SELECT app.create_organization($1) AS id", [name]);
    return rows[0].id;
  });
}

export function listMemberships(pool: Pool, userId: string): Promise<Membership[]> {
  return withUser(pool, userId, async (client) => {
    const { rows } = await client.query<Membership>(
      `SELECT o.id AS "organizationId", o.name AS "organizationName", m.role
       FROM app.memberships m JOIN app.organizations o ON o.id = m.organization_id
       WHERE m.user_id = app.current_user_id()
       ORDER BY o.created_at`,
    );
    return rows;
  });
}

export async function getAssistantConfig(client: PoolClient): Promise<AssistantConfigRecord | null> {
  const { rows } = await client.query<AssistantConfigRecord>(
    `SELECT config, revision, updated_at AS "updatedAt" FROM app.assistant_configs
     WHERE organization_id = app.current_organization_id()`,
  );
  return rows[0] ?? null;
}

/**
 * Saves the organization's configuration with optimistic concurrency:
 * `expectedRevision` is the revision the editor loaded (0 for a first save).
 * The caller validates `config` before saving.
 */
export async function saveAssistantConfig(client: PoolClient, config: Record<string, unknown>, expectedRevision: number): Promise<number> {
  const { rows } = await client.query<{ revision: number }>(
    `INSERT INTO app.assistant_configs AS c (organization_id, config, revision, updated_by)
     VALUES (app.current_organization_id(), $1, 1, app.current_user_id())
     ON CONFLICT (organization_id) DO UPDATE
       SET config = excluded.config, revision = c.revision + 1, updated_at = now(), updated_by = excluded.updated_by
       WHERE c.revision = $2
     RETURNING c.revision`,
    [config, expectedRevision],
  );
  if (rows.length === 0) throw new ConflictError();
  return rows[0].revision;
}

export async function listKnowledge(client: PoolClient): Promise<KnowledgeRecord[]> {
  const { rows } = await client.query<KnowledgeRecord>(
    `SELECT id, question, answer, updated_at AS "updatedAt" FROM app.knowledge_entries
     WHERE organization_id = app.current_organization_id()
     ORDER BY created_at`,
  );
  return rows;
}

export async function addKnowledge(client: PoolClient, entry: { question: string; answer: string }): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO app.knowledge_entries (organization_id, question, answer, created_by)
     VALUES (app.current_organization_id(), $1, $2, app.current_user_id())
     RETURNING id`,
    [entry.question.trim(), entry.answer.trim()],
  );
  return rows[0].id;
}

/** Returns false when the entry does not exist in the current organization. */
export async function updateKnowledge(client: PoolClient, id: string, entry: { question: string; answer: string }): Promise<boolean> {
  const result = await client.query(
    `UPDATE app.knowledge_entries SET question = $2, answer = $3, updated_at = now()
     WHERE id = $1 AND organization_id = app.current_organization_id()`,
    [id, entry.question.trim(), entry.answer.trim()],
  );
  return result.rowCount === 1;
}

export async function deleteKnowledge(client: PoolClient, id: string): Promise<boolean> {
  const result = await client.query(
    "DELETE FROM app.knowledge_entries WHERE id = $1 AND organization_id = app.current_organization_id()",
    [id],
  );
  return result.rowCount === 1;
}

export async function recordAudit(client: PoolClient, event: { action: string; target?: string; result: "success" | "denied" | "error" }): Promise<void> {
  await client.query(
    `INSERT INTO app.audit_events (organization_id, actor_user_id, action, target, result)
     VALUES (app.current_organization_id(), app.current_user_id(), $1, $2, $3)`,
    [event.action, event.target ?? null, event.result],
  );
}

export async function getOrganizationName(client: PoolClient): Promise<string | null> {
  const { rows } = await client.query<{ name: string }>("SELECT name FROM app.organizations WHERE id = app.current_organization_id()");
  return rows[0]?.name ?? null;
}

export type WorkspaceSaveInput = {
  config: Record<string, unknown>;
  knowledge: Array<{ id: string; question: string; answer: string }>;
  /** The configuration revision the editor last loaded or saved (0 before the first save). */
  expectedRevision: number;
};

/**
 * Saves the editor's whole workspace in the current organization's transaction:
 * the configuration (with optimistic revision check) and the knowledge list.
 * Knowledge entries are matched by id; ids that are not this organization's
 * rows are inserted as new entries, and rows missing from the list are deleted.
 * Returns the new revision and the server ids assigned to new entries.
 */
export async function saveWorkspace(client: PoolClient, input: WorkspaceSaveInput): Promise<{ revision: number; idMap: Record<string, string> }> {
  const revision = await saveAssistantConfig(client, input.config, input.expectedRevision);
  const existing = new Map((await listKnowledge(client)).map((entry) => [entry.id, entry]));
  const kept = new Set<string>();
  const idMap: Record<string, string> = {};

  for (const entry of input.knowledge) {
    const current = existing.get(entry.id);
    if (current && !kept.has(entry.id)) {
      if (current.question !== entry.question.trim() || current.answer !== entry.answer.trim()) await updateKnowledge(client, entry.id, entry);
      kept.add(entry.id);
    } else {
      const id = await addKnowledge(client, entry);
      idMap[entry.id] = id;
      kept.add(id);
    }
  }
  for (const id of existing.keys()) {
    if (!kept.has(id)) await deleteKnowledge(client, id);
  }
  // Autosave runs every few seconds; one audit entry per person per 15 minutes keeps the log readable.
  const recent = await client.query(
    `SELECT 1 FROM app.audit_events
     WHERE organization_id = app.current_organization_id() AND actor_user_id = app.current_user_id()
       AND action = 'workspace.save' AND created_at > now() - interval '15 minutes'
     LIMIT 1`,
  );
  if (!recent.rowCount) await recordAudit(client, { action: "workspace.save", target: `revision ${revision}`, result: "success" });
  return { revision, idMap };
}
