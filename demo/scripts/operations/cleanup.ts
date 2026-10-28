// Run once from a scheduler with DATABASE_URL for the restricted app login.
// No provider dependency, admin credential fallback, or raw database errors.
import pg from "pg";
import { APP_LOGIN_ROLE } from "../../lib/db/config.ts";
import { purgeExpiredConversations, purgeOperationalData, type CleanupCounts } from "../../lib/operations/store.ts";

const BATCH_SIZE = 500;
const MAX_PASSES = 20;
let pool: pg.Pool | undefined;
let failed = false;

function reportFailure() {
  if (!failed) console.error(JSON.stringify({ event: "operations.cleanup", result: "error" }));
  failed = true;
  process.exitCode = 1;
}

try {
  if (!process.env.DATABASE_URL) throw new Error("Cleanup configuration missing.");
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 1_000,
    statement_timeout: 10_000,
    application_name: "aisistent-cleanup",
  });
  pool.on("error", reportFailure);
  const { rows } = await pool.query<{ login: string; superuser: boolean; bypass_rls: boolean; member: boolean; owns_schema: boolean }>(
    `SELECT current_user AS login, role.rolsuper AS superuser, role.rolbypassrls AS bypass_rls,
       pg_has_role(current_user, 'aisistent_runtime', 'MEMBER') AS member,
       pg_has_role(current_user, schema.nspowner, 'MEMBER') AS owns_schema
     FROM pg_roles AS role CROSS JOIN pg_namespace AS schema
     WHERE role.rolname = current_user AND schema.nspname = 'app'`,
  );
  const role = rows[0];
  if (!role || role.login !== APP_LOGIN_ROLE || role.superuser || role.bypass_rls || !role.member || role.owns_schema) {
    throw new Error("Restricted cleanup login required.");
  }

  const total: CleanupCounts & { conversations: number } = { sessions: 0, invitations: 0, rateLimits: 0, conversations: 0 };
  let passes = 0;
  let reachedPassLimit = false;
  for (; passes < MAX_PASSES;) {
    // Conversations past their organization's retention period go too (migration 0008).
    const removed = { ...await purgeOperationalData(pool, BATCH_SIZE), conversations: await purgeExpiredConversations(pool, BATCH_SIZE) };
    if (failed) throw new Error("Cleanup connection failed.");
    passes += 1;
    total.sessions += removed.sessions;
    total.invitations += removed.invitations;
    total.rateLimits += removed.rateLimits;
    total.conversations += removed.conversations;
    if (Object.values(removed).every((count) => count < BATCH_SIZE)) break;
    if (passes === MAX_PASSES) reachedPassLimit = true;
  }
  console.log(JSON.stringify({ event: "operations.cleanup", result: "success", passes, reachedPassLimit, ...total }));
} catch {
  reportFailure();
} finally {
  try {
    await pool?.end();
  } catch {
    reportFailure();
  }
}
