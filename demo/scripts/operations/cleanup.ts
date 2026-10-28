// Run once from a scheduler with DATABASE_URL for the restricted app login.
// No provider dependency, admin credential fallback, or raw database errors.
// On Vercel the same cleanup runs daily through /api/cron/cleanup/.
import pg from "pg";
import { connectionOptions } from "../../lib/db/config.ts";
import { runCleanup } from "../../lib/operations/cleanup.ts";

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
    ...connectionOptions(process.env.DATABASE_URL),
    max: 1,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 1_000,
    application_name: "aisistent-cleanup",
  });
  pool.on("error", reportFailure);
  const { passes, reachedPassLimit, ...counts } = await runCleanup(pool);
  if (failed) throw new Error("Cleanup connection failed.");
  console.log(JSON.stringify({ event: "operations.cleanup", result: "success", passes, reachedPassLimit, ...counts }));
} catch {
  reportFailure();
} finally {
  try {
    await pool?.end();
  } catch {
    reportFailure();
  }
}
