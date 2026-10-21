import type { Pool, PoolClient } from "pg";

export type MemberRole = "owner" | "admin" | "member";

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string): void {
  if (!uuidPattern.test(value)) throw new ForbiddenError(`Invalid ${label}.`);
}

async function inTransaction<T>(pool: Pool, settings: Record<string, string>, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Transaction-local (is_local = true): the values vanish at COMMIT/ROLLBACK,
    // so a pooled connection never carries one request's identity into the next.
    for (const [key, value] of Object.entries(settings)) {
      await client.query("SELECT set_config($1, $2, true)", [key, value]);
    }
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Runs work as a verified user with no organization selected (for example, listing memberships). */
export async function withUser<T>(pool: Pool, userId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
  assertUuid(userId, "user id");
  return inTransaction(pool, { "app.user_id": userId }, work);
}

/**
 * Runs work inside one organization. Membership is re-checked against the
 * database on every call, so a removed member loses access immediately; RLS
 * enforces the same boundary independently inside PostgreSQL.
 */
export async function withOrganization<T>(
  pool: Pool,
  context: { userId: string; organizationId: string },
  work: (client: PoolClient, role: MemberRole) => Promise<T>,
): Promise<T> {
  assertUuid(context.userId, "user id");
  assertUuid(context.organizationId, "organization id");
  return inTransaction(pool, { "app.user_id": context.userId, "app.organization_id": context.organizationId }, async (client) => {
    const { rows } = await client.query<{ role: MemberRole | null }>("SELECT app.member_role($1) AS role", [context.organizationId]);
    const role = rows[0]?.role;
    if (!role) throw new ForbiddenError("Not a member of this organization.");
    return work(client, role);
  });
}

export function canManage(role: MemberRole): boolean {
  return role === "owner" || role === "admin";
}
