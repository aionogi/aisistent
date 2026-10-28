import type { Pool } from "pg";
import { APP_LOGIN_ROLE, RUNTIME_ROLE } from "../db/config.ts";
import { purgeExpiredConversations, purgeOperationalData, type CleanupCounts } from "./store.ts";

const BATCH_SIZE = 500;
const MAX_PASSES = 20;

export type CleanupResult = CleanupCounts & { conversations: number; passes: number; reachedPassLimit: boolean };

/**
 * Removes expired sessions, invitations, rate-limit buckets and conversations
 * past their retention, in bounded passes. Refuses to run unless connected as
 * the restricted application login, so a misconfigured owner or superuser
 * connection never runs it. Used by `npm run ops:cleanup` and the Vercel cron.
 */
export async function runCleanup(pool: Pool): Promise<CleanupResult> {
  const { rows } = await pool.query<{ login: string; superuser: boolean; bypass_rls: boolean; member: boolean; owns_schema: boolean }>(
    `SELECT current_user AS login, role.rolsuper AS superuser, role.rolbypassrls AS bypass_rls,
       pg_has_role(current_user, $1, 'MEMBER') AS member,
       pg_has_role(current_user, schema.nspowner, 'MEMBER') AS owns_schema
     FROM pg_roles AS role CROSS JOIN pg_namespace AS schema
     WHERE role.rolname = current_user AND schema.nspname = 'app'`,
    [RUNTIME_ROLE],
  );
  const role = rows[0];
  if (!role || role.login !== APP_LOGIN_ROLE || role.superuser || role.bypass_rls || !role.member || role.owns_schema) {
    throw new Error("Restricted cleanup login required.");
  }

  const total: CleanupResult = { sessions: 0, invitations: 0, rateLimits: 0, conversations: 0, passes: 0, reachedPassLimit: false };
  while (total.passes < MAX_PASSES) {
    // Conversations past their organization's retention period go too (migration 0008).
    const removed = { ...await purgeOperationalData(pool, BATCH_SIZE), conversations: await purgeExpiredConversations(pool, BATCH_SIZE) };
    total.passes += 1;
    total.sessions += removed.sessions;
    total.invitations += removed.invitations;
    total.rateLimits += removed.rateLimits;
    total.conversations += removed.conversations;
    if (Object.values(removed).every((count) => count < BATCH_SIZE)) break;
    if (total.passes === MAX_PASSES) total.reachedPassLimit = true;
  }
  return total;
}
