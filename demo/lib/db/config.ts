/** NOLOGIN role that holds the application's table privileges and RLS policies (see migration 0001). */
export const RUNTIME_ROLE = "aisistent_runtime";
/** Login role the application server connects as; a member of RUNTIME_ROLE only. */
export const APP_LOGIN_ROLE = "aisistent_app";

type Env = Record<string, string | undefined>;

/**
 * Connection string for the application's restricted role.
 *
 * Production (Render): built from DATABASE_ADMIN_URL's host and database with
 * the aisistent_app login and DATABASE_APP_PASSWORD, so no owner credential is
 * used at runtime. Local development and tests may set DATABASE_URL directly.
 * Returns null when the database is not configured, so the demo still runs.
 */
export function appConnectionString(env: Env = process.env): string | null {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (!env.DATABASE_ADMIN_URL || !env.DATABASE_APP_PASSWORD) return null;
  const url = new URL(env.DATABASE_ADMIN_URL);
  url.username = APP_LOGIN_ROLE;
  url.password = env.DATABASE_APP_PASSWORD;
  return url.toString();
}

/** Owner connection used only by the migration runner. */
export function adminConnectionString(env: Env = process.env): string {
  if (!env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required to run migrations.");
  return env.DATABASE_ADMIN_URL;
}
