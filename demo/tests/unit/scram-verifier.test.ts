import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { ensureAppLogin, scramVerifier } from "../../lib/db/migrator.ts";

test("the verifier matches the RFC 7677 SCRAM-SHA-256 example", () => {
  const salt = Buffer.from("W22ZaJ0SNY7soEsUEjb6gQ==", "base64");
  const verifier = scramVerifier("pencil", salt, 4096);
  const match = verifier.match(/^SCRAM-SHA-256\$4096:([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$/);
  assert.ok(match, verifier);
  assert.equal(match[1], "W22ZaJ0SNY7soEsUEjb6gQ==");
  // The server signature from the RFC's exchange proves the derived ServerKey.
  const authMessage = [
    "n=user,r=rOprNGfwEbeRWgbNEkqO",
    "r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096",
    "c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0",
  ].join(",");
  const serverSignature = createHmac("sha256", Buffer.from(match[3], "base64")).update(authMessage).digest("base64");
  assert.equal(serverSignature, "6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=");
});

test("each verifier has its own salt, and passwords PostgreSQL would normalize are refused", () => {
  assert.notEqual(scramVerifier("same-password-0123456789-abcdefghij"), scramVerifier("same-password-0123456789-abcdefghij"));
  assert.throws(() => scramVerifier("has a space"), /printable ASCII/);
  assert.throws(() => scramVerifier("šifra-0123456789-0123456789-abcdef"), /printable ASCII/);
});

test("ensureAppLogin never sends the plain password to the database", async () => {
  const password = "plain-password-0123456789-abcdefghij";
  for (const existing of [false, true]) {
    const statements: string[] = [];
    const client = {
      escapeLiteral: (value: string) => `'${value.replace(/'/g, "''")}'`,
      query: async (sql: string) => { statements.push(sql); return { rowCount: existing && sql.startsWith("SELECT 1 FROM pg_roles") ? 1 : 0, rows: [] }; },
    };
    await ensureAppLogin(client as never, password);
    assert.ok(statements.some((sql) => /PASSWORD 'SCRAM-SHA-256\$4096:/.test(sql)), statements.join("\n"));
    assert.ok(statements.every((sql) => !sql.includes(password)));
  }
});
