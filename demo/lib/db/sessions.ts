import type { PoolClient } from "pg";

/**
 * The signed-in user's own sign-in sessions (migration 0007). Run inside
 * withUser(): the database resolves the user from that context.
 */

export type SessionSummary = { createdAt: Date; updatedAt: Date; expiresAt: Date };

/** Unexpired sessions, most recently active first; times only. */
export async function listMySessions(client: PoolClient): Promise<SessionSummary[]> {
  const { rows } = await client.query<SessionSummary>(
    `SELECT created_at AS "createdAt", updated_at AS "updatedAt", expires_at AS "expiresAt" FROM app.my_sessions()`,
  );
  return rows;
}

/** Ends every application session of the signed-in user on every device; returns how many. */
export async function endMySessions(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ removed: number }>("SELECT app.end_my_sessions() AS removed");
  return rows[0].removed;
}
