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

export type ConnectionOptions = { connectionString: string; ssl?: { ca: string; rejectUnauthorized: true } };

const URL_TLS_PARAMETERS = ["sslmode", "ssl", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"];

/**
 * Connection options for a remote database such as Supabase. With
 * DATABASE_CA_CERT (the provider's CA certificate as PEM; "\n" escapes are
 * accepted) every connection uses TLS and verifies the server against it.
 * TLS settings in the URL are removed then, because node-postgres would let
 * them override this verification. Without the variable (local databases) the
 * URL is used as given.
 */
export function connectionOptions(connectionString: string, env: Env = process.env): ConnectionOptions {
  const pem = env.DATABASE_CA_CERT?.replace(/\\n/g, "\n").trim();
  if (!pem) return { connectionString };
  if (!pem.startsWith("-----BEGIN CERTIFICATE-----")) throw new Error("DATABASE_CA_CERT must be a PEM certificate.");
  const url = new URL(connectionString);
  for (const parameter of URL_TLS_PARAMETERS) url.searchParams.delete(parameter);
  return { connectionString: url.toString(), ssl: { ca: pem, rejectUnauthorized: true } };
}

/**
 * Connections per server instance (DATABASE_POOL_MAX, 1–20, default 10). On
 * Vercel each function instance has its own pool, so keep it small and let
 * Supabase's transaction pooler share the database connections.
 */
export function poolSize(env: Env = process.env): number {
  const size = Number(env.DATABASE_POOL_MAX ?? 10);
  return Number.isInteger(size) && size >= 1 && size <= 20 ? size : 10;
}
