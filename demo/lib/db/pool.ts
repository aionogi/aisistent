import pg from "pg";
import { appConnectionString } from "./config.ts";

const globalForPool = globalThis as typeof globalThis & { aisistentPool?: pg.Pool | null };

/**
 * Shared pool for the restricted application role, or null when no database
 * is configured (the M2 demo keeps working without one). Server code only.
 */
export function getPool(): pg.Pool | null {
  if (globalForPool.aisistentPool !== undefined) return globalForPool.aisistentPool;
  const connectionString = appConnectionString();
  globalForPool.aisistentPool = connectionString
    ? new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, statement_timeout: 10_000, application_name: "aisistent-web" })
    : null;
  return globalForPool.aisistentPool;
}
