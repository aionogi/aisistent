import type { Pool } from "pg";

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };
export type CleanupCounts = { sessions: number; invitations: number; rateLimits: number };

/** Shared, atomic fixed-window admission through the restricted runtime role. */
export async function consumeRateLimit(pool: Pool, key: Buffer, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const { rows } = await pool.query<{ allowed: boolean; retry_after_seconds: number }>(
    "SELECT allowed, retry_after_seconds FROM app.consume_rate_limit($1, $2, $3)",
    [key, limit, windowSeconds],
  );
  const row = rows[0];
  if (!row || typeof row.allowed !== "boolean" || !Number.isInteger(row.retry_after_seconds)) {
    throw new Error("Invalid rate limit result.");
  }
  return { allowed: row.allowed, retryAfterSeconds: row.retry_after_seconds };
}

/** A bounded pass; active data and the durable audit trail are preserved. */
export async function purgeOperationalData(pool: Pool, batchSize = 500): Promise<CleanupCounts> {
  const { rows } = await pool.query<{ sessions: number; invitations: number; rate_limits: number }>(
    "SELECT sessions, invitations, rate_limits FROM app.purge_operational_data($1)",
    [batchSize],
  );
  const row = rows[0];
  if (!row || ![row.sessions, row.invitations, row.rate_limits].every((count) => Number.isInteger(count) && count >= 0 && count <= batchSize)) {
    throw new Error("Invalid cleanup result.");
  }
  return { sessions: row.sessions, invitations: row.invitations, rateLimits: row.rate_limits };
}
