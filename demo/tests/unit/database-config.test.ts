import assert from "node:assert/strict";
import { test } from "node:test";
import { connectionOptions, poolSize } from "../../lib/db/config.ts";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIBexample\n-----END CERTIFICATE-----";
const POOLER = "postgresql://aisistent_app.abcdefghijklmnop:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres";

test("without a CA certificate the connection string is used as given", () => {
  assert.deepEqual(connectionOptions("postgresql://app:pw@127.0.0.1:5432/db?sslmode=disable", {}), { connectionString: "postgresql://app:pw@127.0.0.1:5432/db?sslmode=disable" });
});

test("with DATABASE_CA_CERT every connection verifies the server, and URL TLS settings cannot weaken it", () => {
  const options = connectionOptions(`${POOLER}?sslmode=no-verify&sslrootcert=/tmp/x.crt&application_name=x`, { DATABASE_CA_CERT: PEM });
  assert.deepEqual(options.ssl, { ca: PEM, rejectUnauthorized: true });
  const url = new URL(options.connectionString);
  assert.equal(url.searchParams.get("sslmode"), null);
  assert.equal(url.searchParams.get("sslrootcert"), null);
  assert.equal(url.searchParams.get("application_name"), "x");
  assert.equal(url.username, "aisistent_app.abcdefghijklmnop");
  assert.equal(url.port, "6543");

  // Single-line values with "\n" escapes (some dashboards) work too.
  assert.equal(connectionOptions(POOLER, { DATABASE_CA_CERT: PEM.replace(/\n/g, "\\n") }).ssl?.ca, PEM);
  assert.throws(() => connectionOptions(POOLER, { DATABASE_CA_CERT: "not a certificate" }), /PEM certificate/);
});

test("pool size is bounded", () => {
  assert.equal(poolSize({}), 10);
  assert.equal(poolSize({ DATABASE_POOL_MAX: "3" }), 3);
  for (const value of ["0", "21", "2.5", "many", "-1"]) assert.equal(poolSize({ DATABASE_POOL_MAX: value }), 10, value);
});
