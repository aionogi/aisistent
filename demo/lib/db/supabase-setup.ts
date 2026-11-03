import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import pg from "pg";
import { APP_LOGIN_ROLE, connectionOptions } from "./config.ts";
import { ensureAppLogin, migrate } from "./migrator.ts";

/** Problems the person running the setup can fix; the message never contains secrets. */
export class SetupError extends Error {}

const PASSWORD_PLACEHOLDER = "[YOUR-PASSWORD]";
const TRANSACTION_POOLER_PORT = "6543";

export type SessionPooler = { adminUrl: string; projectRef: string };

/**
 * The owner connection from the session pooler address in Supabase's Connect
 * dialog. The dialog shows a [YOUR-PASSWORD] placeholder; a separate password
 * is inserted URL-encoded, so special characters need no manual escaping.
 */
export function sessionPooler(rawUrl: string, password = ""): SessionPooler {
  const value = rawUrl.trim();
  if (value.includes(PASSWORD_PLACEHOLDER) && !password) throw new SetupError(`SUPABASE_SESSION_POOLER_URL still contains ${PASSWORD_PLACEHOLDER}: set SUPABASE_DB_PASSWORD to your database password.`);
  let url: URL;
  try {
    url = new URL(value.replace(PASSWORD_PLACEHOLDER, encodeURIComponent(password)));
  } catch {
    throw new SetupError("SUPABASE_SESSION_POOLER_URL is not a valid address. Copy it from Supabase → Connect → Session pooler.");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") throw new SetupError("SUPABASE_SESSION_POOLER_URL must start with postgresql://.");
  if (!url.hostname.endsWith(".pooler.supabase.com")) throw new SetupError("SUPABASE_SESSION_POOLER_URL must be the Session pooler address (host ending in .pooler.supabase.com), not the direct connection.");
  if (url.port === TRANSACTION_POOLER_PORT) throw new SetupError("SUPABASE_SESSION_POOLER_URL uses port 6543, the Transaction pooler. Migrations need the Session pooler (port 5432).");
  if (url.port !== "5432") throw new SetupError("SUPABASE_SESSION_POOLER_URL must use port 5432.");
  const projectRef = /^postgres\.([a-z0-9]+)$/.exec(decodeURIComponent(url.username))?.[1];
  if (!projectRef) throw new SetupError("SUPABASE_SESSION_POOLER_URL must use the user postgres.<project-ref>, as shown in the Connect dialog.");
  if (!url.password) throw new SetupError("SUPABASE_SESSION_POOLER_URL has no password: set SUPABASE_DB_PASSWORD or include it in the address.");
  return { adminUrl: url.toString(), projectRef };
}

/** The owner connection and the CA certificate from the settings file's three Supabase entries. */
export function supabaseConnection(settings: Record<string, string | undefined>, file: string): { adminUrl: string; caCert: string } {
  const value = (key: string) => settings[key]?.trim() ?? "";
  const unfilled = ["SUPABASE_SESSION_POOLER_URL", "SUPABASE_CA_CERT_FILE"].filter((key) => !value(key) || value(key).includes("<"));
  if (value("SUPABASE_DB_PASSWORD").startsWith("<")) unfilled.push("SUPABASE_DB_PASSWORD");
  if (unfilled.length) throw new SetupError(`Fill in ${unfilled.join(", ")} in ${file}.`);
  const { adminUrl } = sessionPooler(value("SUPABASE_SESSION_POOLER_URL"), value("SUPABASE_DB_PASSWORD"));
  if (!existsSync(value("SUPABASE_CA_CERT_FILE"))) throw new SetupError("SUPABASE_CA_CERT_FILE: the file was not found. Check the path.");
  const caCert = readFileSync(value("SUPABASE_CA_CERT_FILE"), "utf8").trim();
  if (!caCert.startsWith("-----BEGIN CERTIFICATE-----")) throw new SetupError("SUPABASE_CA_CERT_FILE is not a PEM certificate (it should start with -----BEGIN CERTIFICATE-----).");
  return { adminUrl, caCert };
}

/** The application's address: same host, transaction pooler port, restricted login with its project suffix. */
export function transactionPoolerUrl({ adminUrl, projectRef }: SessionPooler, appPassword: string): string {
  const url = new URL(adminUrl);
  url.username = `${APP_LOGIN_ROLE}.${projectRef}`;
  url.password = encodeURIComponent(appPassword);
  url.port = TRANSACTION_POOLER_PORT;
  return url.toString();
}

export function normalizeAppUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new SetupError("VERCEL_APP_URL must be the production address, for example https://aisistent.vercel.app.");
  }
  if (url.protocol !== "https:" || url.pathname.length > 1 || url.search || url.hash) throw new SetupError("VERCEL_APP_URL must be only https:// and the host, for example https://aisistent.vercel.app.");
  return url.origin;
}

export const generateSecret = () => randomBytes(32).toString("base64url");

/** Explains the connection failures people actually hit; driver messages hold no passwords. */
export function connectionHint(message: string): string {
  if (/password authentication failed/i.test(message)) return " Check SUPABASE_DB_PASSWORD (Supabase -> Database settings can reset it).";
  if (/tenant or user not found/i.test(message)) return " Copy the address again from Supabase -> Connect -> Session pooler.";
  if (/UNABLE_TO_VERIFY|self.signed|unable to verify|certificate/i.test(message)) return " Check that SUPABASE_CA_CERT_FILE is this project's certificate.";
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|timeout/i.test(message)) return " Check your internet connection and the address.";
  return "";
}

export type ExistingSecrets = { appPassword?: string; rateLimitSecret?: string; cronSecret?: string; auth0Secret?: string };

/** Secrets from an earlier run, so running the setup again does not change what Vercel already holds. */
export function readExistingSecrets(envFileText: string | null): ExistingSecrets {
  if (!envFileText) return {};
  const values = parseEnv(envFileText);
  let appPassword: string | undefined;
  try {
    appPassword = values.DATABASE_URL ? decodeURIComponent(new URL(values.DATABASE_URL).password) || undefined : undefined;
  } catch {
    appPassword = undefined;
  }
  return { appPassword, rateLimitSecret: values.RATE_LIMIT_SECRET, cronSecret: values.CRON_SECRET, auth0Secret: values.AUTH0_SECRET };
}

export type VercelInput = {
  databaseUrl: string;
  caCert: string;
  appBaseUrl: string;
  rateLimitSecret: string;
  cronSecret: string;
  auth0Secret: string;
  auth0?: { domain: string; clientId: string; clientSecret: string };
};

/** Production variables for Vercel. The owner URL and database passwords are deliberately not among them. */
export function vercelVariables(input: VercelInput): Record<string, string> {
  return {
    DATABASE_URL: input.databaseUrl,
    DATABASE_CA_CERT: input.caCert.trim(),
    DATABASE_POOL_MAX: "3",
    RATE_LIMIT_SECRET: input.rateLimitSecret,
    RATE_LIMIT_IP_HEADER: "x-forwarded-for",
    CRON_SECRET: input.cronSecret,
    APP_BASE_URL: input.appBaseUrl,
    AUTH0_SECRET: input.auth0Secret,
    // Generated production imports must never turn privileged-write MFA off.
    AUTH_REQUIRE_MFA: "true",
    ...(input.auth0 ? { AUTH0_DOMAIN: input.auth0.domain, AUTH0_CLIENT_ID: input.auth0.clientId, AUTH0_CLIENT_SECRET: input.auth0.clientSecret } : {}),
  };
}

/** A .env file for Vercel's import. Line breaks become \n, which parsers and connectionOptions both accept. */
export function formatEnvFile(variables: Record<string, string>): string {
  return Object.entries(variables)
    .map(([key, value]) => `${key}="${value.replace(/\r?\n/g, "\\n").replace(/"/g, '\\"')}"`)
    .join("\n") + "\n";
}

export type MigrationReport = { applied: string[]; alreadyApplied: number; revokedFrom: string[]; postgresMajor: number };
export type DatabaseReport = MigrationReport & { statementTimeout: string };

const postgresMajorOf = async (client: pg.Client) => Math.floor(Number((await client.query("SHOW server_version_num")).rows[0].server_version_num) / 10_000);

/**
 * Applies new migrations as the owner and nothing else: the app login, its
 * password and every secret stay as they are, so the live site keeps working.
 */
export async function migrateDatabase({ adminUrl, caCert, migrationsDir }: { adminUrl: string; caCert?: string; migrationsDir: string }): Promise<MigrationReport> {
  const admin = new pg.Client({ ...connectionOptions(adminUrl, caCert ? { DATABASE_CA_CERT: caCert } : {}), application_name: "aisistent-migrate", connectionTimeoutMillis: 15_000 });
  await admin.connect();
  try {
    const postgresMajor = await postgresMajorOf(admin);
    const result = await migrate(admin, migrationsDir);
    return { applied: result.applied, alreadyApplied: result.skipped.length, revokedFrom: result.revokedFrom, postgresMajor };
  } finally {
    await admin.end();
  }
}

type PrepareOptions = {
  adminUrl: string;
  appUrl: string;
  appPassword: string;
  caCert?: string;
  migrationsDir: string;
  /** Stop before changing anything when the app login exists: its password is about to be replaced. */
  refuseExistingLogin?: boolean;
  attempts?: number;
  retryDelayMs?: number;
};

/**
 * Applies migrations as the owner, sets up the restricted login, then proves
 * the application's own address works: right login, no elevated rights, and
 * the role's timeouts in effect. The pooler can take a moment to learn a new
 * login, so that last connection is retried.
 */
export async function prepareDatabase({ adminUrl, appUrl, appPassword, caCert, migrationsDir, refuseExistingLogin = false, attempts = 6, retryDelayMs = 5_000 }: PrepareOptions): Promise<DatabaseReport> {
  const env = caCert ? { DATABASE_CA_CERT: caCert } : {};
  const admin = new pg.Client({ ...connectionOptions(adminUrl, env), application_name: "aisistent-setup", connectionTimeoutMillis: 15_000 });
  await admin.connect();
  let applied: string[];
  let alreadyApplied: number;
  let revokedFrom: string[];
  let postgresMajor: number;
  try {
    if (refuseExistingLogin && (await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [APP_LOGIN_ROLE])).rowCount) {
      throw new SetupError(`The database already has the ${APP_LOGIN_ROLE} login, but .env.vercel.local is missing, so this run would give it a new password and make new secrets. The live site would lose its database until Vercel gets them. Nothing was changed.
  To apply new migrations only: npm run migrate:supabase
  To replace the password and secrets on purpose: npm run setup:supabase:new-secrets, then import the new file into Vercel and redeploy at once.`);
    }
    postgresMajor = await postgresMajorOf(admin);
    const result = await migrate(admin, migrationsDir);
    applied = result.applied;
    alreadyApplied = result.skipped.length;
    revokedFrom = result.revokedFrom;
    await ensureAppLogin(admin, appPassword);
  } finally {
    await admin.end();
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    const client = new pg.Client({ ...connectionOptions(appUrl, env), application_name: "aisistent-setup", connectionTimeoutMillis: 15_000 });
    try {
      await client.connect();
      const { rows } = await client.query<{ login: string; superuser: boolean; bypass_rls: boolean; statement_timeout: string }>(
        `SELECT current_user AS login, role.rolsuper AS superuser, role.rolbypassrls AS bypass_rls, current_setting('statement_timeout') AS statement_timeout
         FROM pg_roles AS role WHERE role.rolname = current_user`,
      );
      const row = rows[0];
      if (row?.login !== APP_LOGIN_ROLE || row.superuser || row.bypass_rls) throw new SetupError("The application address did not connect as the restricted aisistent_app login.");
      return { applied, alreadyApplied, revokedFrom, postgresMajor, statementTimeout: row.statement_timeout };
    } catch (error) {
      if (error instanceof SetupError) throw error;
      lastError = error;
    } finally {
      await client.end().catch(() => {});
    }
  }
  throw new SetupError(`Migrations finished, but the application could not connect through the transaction pooler: ${(lastError as Error)?.message ?? "unknown error"}`);
}
