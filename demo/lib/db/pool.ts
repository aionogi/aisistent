import pg from "pg";
import { appConnectionString, connectionOptions, poolSize } from "./config.ts";
import { logEvent } from "../operations/logging.ts";

const globalForPool = globalThis as typeof globalThis & { aisistentPool?: pg.Pool | null };

/**
 * Shared pool for the restricted application role, or null when no database
 * is configured (the M2 demo keeps working without one). Server code only.
 * Statement and idle-transaction timeouts are settings of the database role
 * (see ensureAppLogin), because a transaction pooler drops connection options.
 */
export function getPool(): pg.Pool | null {
  if (globalForPool.aisistentPool !== undefined) return globalForPool.aisistentPool;
  const connectionString = appConnectionString();
  globalForPool.aisistentPool = connectionString
    ? new pg.Pool({ ...connectionOptions(connectionString), max: poolSize(), connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000, application_name: "aisistent-web" })
    : null;
  globalForPool.aisistentPool?.on("error", () => logEvent("database.idle_error", { outcome: "error" }));
  return globalForPool.aisistentPool;
}
