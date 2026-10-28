import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { withUser, type MemberRole } from "./context.ts";

/**
 * Team management on top of migration 0003, and organization export, leaving,
 * and deletion on top of migration 0006. Functions that take a PoolClient
 * run inside withOrganization(); the database functions re-check the caller's
 * role, so these wrappers add no authority of their own.
 */

export type TeamErrorCode =
  | "owner_required" | "admin_required" | "member_required" | "already_member" | "invalid_expiry" | "invalid_role" | "member_not_found" | "last_owner"
  | "invitation_not_found" | "invitation_used" | "invitation_revoked" | "invitation_expired" | "invitation_email_mismatch"
  | "confirmation_mismatch" | "invalid_retention";

const KNOWN_CODES = new Set<string>([
  "owner_required", "admin_required", "member_required", "already_member", "invalid_expiry", "invalid_role", "member_not_found", "last_owner",
  "invitation_not_found", "invitation_used", "invitation_revoked", "invitation_expired", "invitation_email_mismatch",
  "confirmation_mismatch", "invalid_retention",
]);

export class TeamError extends Error {
  readonly code: TeamErrorCode;
  constructor(code: TeamErrorCode) {
    super(code);
    this.name = "TeamError";
    this.code = code;
  }
}

/** Turns the database's named exceptions into TeamError; anything else is rethrown. */
async function translate<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    const message = (error as Error).message;
    if (KNOWN_CODES.has(message)) throw new TeamError(message as TeamErrorCode);
    throw error;
  }
}

export const INVITATION_LIFETIME_DAYS = 7;

export type Member = { userId: string; displayName: string | null; email: string | null; role: MemberRole; joinedAt: Date };
export type Invitation = { id: string; email: string; role: "admin" | "member"; createdAt: Date; expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null };
export type InvitationPreview = { organizationName: string; role: "admin" | "member"; email: string; status: "valid" | "expired" | "accepted" | "revoked" };
export type AuditEntry = { id: string; createdAt: Date; actorName: string | null; action: string; target: string | null; result: string };

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidInvitationEmail(email: string): boolean {
  return email.length <= 320 && emailPattern.test(email.trim());
}

/** Creates an invitation and returns the one-time token for the link; only its hash is stored. */
export async function createInvitation(client: PoolClient, input: { email: string; role: "admin" | "member" }): Promise<{ id: string; token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITATION_LIFETIME_DAYS * 24 * 60 * 60 * 1000);
  const { rows } = await translate(client.query<{ id: string }>("SELECT app.create_invitation($1, $2, $3, $4) AS id", [input.email, input.role, hashToken(token), expiresAt]));
  return { id: rows[0].id, token, expiresAt };
}

export async function revokeInvitation(client: PoolClient, invitationId: string): Promise<boolean> {
  const { rows } = await translate(client.query<{ revoked: boolean }>("SELECT app.revoke_invitation($1) AS revoked", [invitationId]));
  return rows[0].revoked;
}

/** Open and recent invitations of the current organization (owners only; others see none). */
export async function listInvitations(client: PoolClient): Promise<Invitation[]> {
  const { rows } = await client.query<Invitation>(
    `SELECT id, email, role, created_at AS "createdAt", expires_at AS "expiresAt", accepted_at AS "acceptedAt", revoked_at AS "revokedAt"
     FROM app.invitations WHERE organization_id = app.current_organization_id()
     ORDER BY created_at DESC LIMIT 50`,
  );
  return rows;
}

export function previewInvitation(pool: Pool, userId: string, token: string): Promise<InvitationPreview | null> {
  return withUser(pool, userId, async (client) => {
    const { rows } = await client.query<InvitationPreview>(
      `SELECT organization_name AS "organizationName", role, email, status FROM app.invitation_preview($1)`,
      [hashToken(token)],
    );
    return rows[0] ?? null;
  });
}

/** Accepts an invitation for the signed-in user and returns the organization id. */
export function acceptInvitation(pool: Pool, userId: string, token: string): Promise<string> {
  return withUser(pool, userId, async (client) => {
    const { rows } = await translate(client.query<{ id: string }>("SELECT app.accept_invitation($1) AS id", [hashToken(token)]));
    return rows[0].id;
  });
}

export async function changeMemberRole(client: PoolClient, userId: string, role: MemberRole): Promise<void> {
  await translate(client.query("SELECT app.change_member_role($1, $2)", [userId, role]));
}

export async function removeMember(client: PoolClient, userId: string): Promise<void> {
  await translate(client.query("SELECT app.remove_member($1)", [userId]));
}

export async function listMembers(client: PoolClient): Promise<Member[]> {
  const { rows } = await translate(client.query<Member>(
    `SELECT user_id AS "userId", display_name AS "displayName", email, role, joined_at AS "joinedAt" FROM app.list_members()`,
  ));
  return rows;
}

export async function getAuditLog(client: PoolClient, limit = 100): Promise<AuditEntry[]> {
  const { rows } = await translate(client.query<AuditEntry>(
    `SELECT id::text AS id, created_at AS "createdAt", actor_name AS "actorName", action, target, result FROM app.audit_log($1)`,
    [limit],
  ));
  return rows;
}

export const EXPORT_FORMAT = "aisistent.organization-export";

/** Everything the organization holds, as one document for its owner; records an `organization.export` event. */
export async function exportOrganization(client: PoolClient): Promise<Record<string, unknown>> {
  const { rows } = await translate(client.query<{ document: Record<string, unknown> }>("SELECT app.export_organization() AS document"));
  return { format: EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(), ...rows[0].document };
}

/** The signed-in member leaves the organization; the last owner cannot. */
export async function leaveOrganization(client: PoolClient): Promise<void> {
  await translate(client.query("SELECT app.leave_organization()"));
}

/** Permanently deletes the organization; `confirmName` must repeat its name. */
export async function deleteOrganization(client: PoolClient, confirmName: string): Promise<void> {
  await translate(client.query("SELECT app.delete_organization($1)", [confirmName]));
}

/** Owners set how many days conversations are kept (migration 0008); records the change. */
export async function setConversationRetention(client: PoolClient, days: number): Promise<void> {
  await translate(client.query("SELECT app.set_conversation_retention($1)", [days]));
}
