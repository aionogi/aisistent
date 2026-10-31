import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEnv } from "node:util";
import { connectionOptions } from "../../lib/db/config.ts";
import { formatEnvFile, normalizeAppUrl, readExistingSecrets, sessionPooler, SetupError, transactionPoolerUrl, vercelVariables } from "../../lib/db/supabase-setup.ts";

const SHOWN = "postgresql://postgres.abcdefghijklmnop:[YOUR-PASSWORD]@aws-1-eu-central-1.pooler.supabase.com:5432/postgres";
const PEM = "-----BEGIN CERTIFICATE-----\nMIIBexample\nline2\n-----END CERTIFICATE-----\n";

test("the Connect dialog's address gets the password URL-encoded and yields the project ref", () => {
  const { adminUrl, projectRef } = sessionPooler(SHOWN, "p@ss/w#rd?1");
  assert.equal(projectRef, "abcdefghijklmnop");
  const url = new URL(adminUrl);
  assert.equal(decodeURIComponent(url.password), "p@ss/w#rd?1");
  assert.equal(url.hostname, "aws-1-eu-central-1.pooler.supabase.com");
  assert.equal(url.port, "5432");
});

test("wrong addresses are refused with a fix, and messages never contain the password", () => {
  const cases: Array<[string, string, RegExp]> = [
    [SHOWN, "", /set SUPABASE_DB_PASSWORD/],
    ["not a url", "secret-value", /not a valid address/],
    ["mysql://postgres.abc:secret-value@aws-1-eu-central-1.pooler.supabase.com:5432/postgres", "", /must start with postgresql/],
    ["postgresql://postgres:secret-value@db.abcdefghijklmnop.supabase.co:5432/postgres", "", /not the direct connection/],
    ["postgresql://postgres.abc:secret-value@aws-1-eu-central-1.pooler.supabase.com:6543/postgres", "", /Transaction pooler/],
    ["postgresql://postgres.abc:secret-value@aws-1-eu-central-1.pooler.supabase.com:5433/postgres", "", /port 5432/],
    ["postgresql://postgres:secret-value@aws-1-eu-central-1.pooler.supabase.com:5432/postgres", "", /postgres\.<project-ref>/],
    ["postgresql://postgres.abc@aws-1-eu-central-1.pooler.supabase.com:5432/postgres", "", /has no password/],
  ];
  for (const [address, password, expected] of cases) {
    assert.throws(() => sessionPooler(address, password), (error: Error) => {
      assert.ok(error instanceof SetupError);
      assert.match(error.message, expected);
      assert.doesNotMatch(error.message, /secret-value/);
      return true;
    }, address);
  }
});

test("the application address uses the restricted login on the transaction pooler", () => {
  const url = new URL(transactionPoolerUrl(sessionPooler(SHOWN, "owner-password"), "app-password_123"));
  assert.equal(url.username, "aisistent_app.abcdefghijklmnop");
  assert.equal(url.password, "app-password_123");
  assert.equal(url.port, "6543");
  assert.equal(url.hostname, "aws-1-eu-central-1.pooler.supabase.com");
  assert.equal(url.pathname, "/postgres");
  assert.doesNotMatch(url.toString(), /owner-password/);
});

test("the production address is https and host only", () => {
  assert.equal(normalizeAppUrl(" https://aisistent.vercel.app/ "), "https://aisistent.vercel.app");
  for (const value of ["http://aisistent.vercel.app", "aisistent.vercel.app", "https://aisistent.vercel.app/account/", ""]) {
    assert.throws(() => normalizeAppUrl(value), SetupError, value);
  }
});

const input = { databaseUrl: "postgresql://aisistent_app.abc:pw@host.pooler.supabase.com:6543/postgres", caCert: PEM, appBaseUrl: "https://a.vercel.app", rateLimitSecret: "rate-secret", cronSecret: "cron-secret", auth0Secret: "auth-secret" };

test("Vercel gets the runtime variables only, never owner credentials", () => {
  const without = vercelVariables(input);
  assert.deepEqual(Object.keys(without).sort(), ["APP_BASE_URL", "AUTH0_SECRET", "AUTH_REQUIRE_MFA", "CRON_SECRET", "DATABASE_CA_CERT", "DATABASE_POOL_MAX", "DATABASE_URL", "RATE_LIMIT_IP_HEADER", "RATE_LIMIT_SECRET"]);
  assert.equal(without.RATE_LIMIT_IP_HEADER, "x-forwarded-for");
  assert.equal(without.AUTH_REQUIRE_MFA, "false");
  const withAuth0 = vercelVariables({ ...input, auth0: { domain: "t.eu.auth0.com", clientId: "id", clientSecret: "secret" } });
  assert.equal(withAuth0.AUTH0_DOMAIN, "t.eu.auth0.com");
  for (const variables of [without, withAuth0]) {
    assert.ok(!("DATABASE_ADMIN_URL" in variables));
    assert.ok(!("DATABASE_APP_PASSWORD" in variables));
  }
});

test("the env file survives a round trip, including the multi-line certificate", () => {
  const text = formatEnvFile(vercelVariables(input));
  assert.equal(text.trim().split("\n").length, 9, "one line per variable");
  const parsed = parseEnv(text);
  assert.equal(parsed.DATABASE_URL, input.databaseUrl);
  assert.equal(parsed.CRON_SECRET, "cron-secret");
  // Parsers either expand \n or keep it; connectionOptions accepts both.
  const ca = connectionOptions(input.databaseUrl, { DATABASE_CA_CERT: parsed.DATABASE_CA_CERT }).ssl?.ca;
  assert.equal(ca, PEM.trim());
  assert.equal(connectionOptions(input.databaseUrl, { DATABASE_CA_CERT: PEM.trim().replace(/\n/g, "\\n") }).ssl?.ca, PEM.trim());
});

test("running the setup again keeps the secrets Vercel already holds", () => {
  assert.deepEqual(readExistingSecrets(null), {});
  const secrets = readExistingSecrets(formatEnvFile(vercelVariables({ ...input, databaseUrl: "postgresql://aisistent_app.abc:app%2Fpassword@host:6543/postgres" })));
  assert.deepEqual(secrets, { appPassword: "app/password", rateLimitSecret: "rate-secret", cronSecret: "cron-secret", auth0Secret: "auth-secret" });
  assert.equal(readExistingSecrets('DATABASE_URL="broken"\n').appPassword, undefined);
});
