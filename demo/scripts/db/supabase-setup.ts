// Prepares a Supabase project for the app in one step, on your own computer:
// checks the addresses, generates the secrets, applies the migrations, proves
// the app can connect through the transaction pooler, and writes
// demo/.env.vercel.local for Vercel's "Import .env". Settings come from
// demo/.env.supabase.local, which the first run creates as a template. Both
// files are git-ignored. Secret values are never printed.
//
//   npm run setup:supabase
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { formatEnvFile, generateSecret, normalizeAppUrl, prepareDatabase, readExistingSecrets, sessionPooler, SetupError, transactionPoolerUrl, vercelVariables } from "../../lib/db/supabase-setup.ts";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const settingsFile = path.join(projectDir, ".env.supabase.local");
const auth0File = path.join(projectDir, ".env.auth0.local");
const outputFile = path.join(projectDir, ".env.vercel.local");

const TEMPLATE = `# Settings for npm run setup:supabase. Git ignores this file. Keep the single quotes.
# Supabase -> Connect -> Session pooler, exactly as shown:
SUPABASE_SESSION_POOLER_URL='<session pooler address>'
# The database password you saved when creating the project:
SUPABASE_DB_PASSWORD='<database password>'
# The certificate you downloaded, for example C:\\Users\\you\\Documents\\aisistent\\prod-ca-2021.crt
SUPABASE_CA_CERT_FILE='<path to prod-ca-2021.crt>'
# Your production address on Vercel:
VERCEL_APP_URL='https://<project>.vercel.app'
# From the Auth0 application's Settings page (or leave these out and use .env.auth0.local):
# AUTH0_DOMAIN='<tenant>.eu.auth0.com'
# AUTH0_CLIENT_ID='<Client ID>'
# AUTH0_CLIENT_SECRET='<Client Secret>'
`;

/** Explains the failures people actually hit; driver messages hold no passwords. */
function hint(message: string): string {
  if (/password authentication failed/i.test(message)) return " Check SUPABASE_DB_PASSWORD (Supabase -> Database settings can reset it).";
  if (/tenant or user not found/i.test(message)) return " Copy the address again from Supabase -> Connect -> Session pooler.";
  if (/UNABLE_TO_VERIFY|self.signed|unable to verify|certificate/i.test(message)) return " Check that SUPABASE_CA_CERT_FILE is this project's certificate.";
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|timeout/i.test(message)) return " Check your internet connection and the address.";
  return "";
}

try {
  if (!existsSync(settingsFile)) {
    writeFileSync(settingsFile, TEMPLATE);
    throw new SetupError(`Created ${settingsFile}. Fill it in and run this command again.`);
  }
  const settings = { ...(existsSync(auth0File) ? parseEnv(readFileSync(auth0File, "utf8")) : {}), ...parseEnv(readFileSync(settingsFile, "utf8")) };
  const value = (key: string) => settings[key]?.trim() ?? "";
  const unfilled = ["SUPABASE_SESSION_POOLER_URL", "SUPABASE_CA_CERT_FILE", "VERCEL_APP_URL"].filter((key) => !value(key) || value(key).includes("<"));
  if (value("SUPABASE_DB_PASSWORD").startsWith("<")) unfilled.push("SUPABASE_DB_PASSWORD");
  if (unfilled.length) throw new SetupError(`Fill in ${unfilled.join(", ")} in ${settingsFile}.`);

  const pooler = sessionPooler(value("SUPABASE_SESSION_POOLER_URL"), value("SUPABASE_DB_PASSWORD"));
  const appBaseUrl = normalizeAppUrl(value("VERCEL_APP_URL"));
  if (!existsSync(value("SUPABASE_CA_CERT_FILE"))) throw new SetupError("SUPABASE_CA_CERT_FILE: the file was not found. Check the path.");
  const caCert = readFileSync(value("SUPABASE_CA_CERT_FILE"), "utf8").trim();
  if (!caCert.startsWith("-----BEGIN CERTIFICATE-----")) throw new SetupError("SUPABASE_CA_CERT_FILE is not a PEM certificate (it should start with -----BEGIN CERTIFICATE-----).");

  const auth0Values = ["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET"].map(value);
  const auth0 = auth0Values.every((item) => item && !item.includes("<")) ? { domain: auth0Values[0].replace(/^https:\/\//i, "").replace(/\/+$/, ""), clientId: auth0Values[1], clientSecret: auth0Values[2] } : undefined;

  const existing = readExistingSecrets(existsSync(outputFile) ? readFileSync(outputFile, "utf8") : null);
  const appPassword = existing.appPassword ?? generateSecret();
  const databaseUrl = transactionPoolerUrl(pooler, appPassword);

  console.log("Applying migrations and checking the connections…");
  const report = await prepareDatabase({ adminUrl: pooler.adminUrl, appUrl: databaseUrl, appPassword, caCert, migrationsDir: path.join(projectDir, "db/migrations") });

  writeFileSync(outputFile, formatEnvFile(vercelVariables({
    databaseUrl,
    caCert,
    appBaseUrl,
    rateLimitSecret: existing.rateLimitSecret ?? generateSecret(),
    cronSecret: existing.cronSecret ?? generateSecret(),
    auth0Secret: existing.auth0Secret ?? generateSecret(),
    auth0,
  })));

  console.log(`
Database ready.
  Migrations: ${report.applied.length} applied, ${report.alreadyApplied} already in place.
  PostgreSQL: ${report.postgresMajor}${report.postgresMajor === 17 ? "" : " (the app is developed and tested on 17; tell your developer)"}.
  App login: aisistent_app connected through the transaction pooler with a verified certificate; statement timeout ${report.statementTimeout}.
  Wrote: ${outputFile}

Next:
  1. Vercel -> your project -> Settings -> Environment Variables -> Import .env: choose that file, environment Production only.
  2. Vercel -> Deployments -> latest -> Redeploy.${auth0 ? `
  3. In the Auth0 application add ${appBaseUrl}/auth/callback (Allowed Callback URLs) and ${appBaseUrl}/ (Allowed Logout URLs).` : `
  3. Auth0 values are missing, so sign-in stays off. Add AUTH0_DOMAIN, AUTH0_CLIENT_ID and AUTH0_CLIENT_SECRET to ${path.basename(settingsFile)} and run this command again (the other secrets stay the same).`}
  Then delete ${path.basename(settingsFile)} and ${path.basename(outputFile)}, or keep them only until the checks pass: they hold secrets, and a OneDrive folder syncs them to the cloud.
  Running this command without ${path.basename(outputFile)} generates new secrets, which you would import again.`);
} catch (error) {
  const message = (error as Error).message;
  const fromDriver = !(error instanceof SetupError) || /could not connect/.test(message);
  console.error(`\n${message}${fromDriver ? hint(message) : ""}\n`);
  process.exitCode = 1;
}
