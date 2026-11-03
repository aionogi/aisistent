import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { generateIdentity, identityToRecipient } from "age-encryption";
import { decryptBackup, encryptBackup, validateRecipient } from "../../lib/backup/encryption.ts";

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aisistent-encryption-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const identity = await generateIdentity();
  return { directory, identity, recipient: await identityToRecipient(identity) };
}

function chunks(bytes: Buffer) {
  return Readable.from((function* () {
    for (let start = 0; start < bytes.length; start += 16_384) yield bytes.subarray(start, start + 16_384);
  })());
}

test("a large streamed backup is standard age ciphertext and decrypts with the offline identity", async (t) => {
  const { directory, identity, recipient } = await fixture(t);
  const plain = Buffer.concat([Buffer.from("synthetic private customer content\n"), randomBytes(300_000)]);
  const encryptedPath = path.join(directory, "app.dump.age");
  const decryptedPath = path.join(directory, "restored.dump");
  const report = await encryptBackup(chunks(plain), encryptedPath, recipient);
  const encrypted = await readFile(encryptedPath);
  assert.match(encrypted.subarray(0, 25).toString(), /^age-encryption\.org\/v1\n->/);
  assert.equal(encrypted.includes(Buffer.from("synthetic private customer content")), false);
  assert.equal(report.bytes, encrypted.length);
  assert.equal(report.sha256, createHash("sha256").update(encrypted).digest("hex"));
  assert.deepEqual(await readdir(directory), ["app.dump.age"], "encryption never creates a plaintext staging file");
  if (process.platform !== "win32") assert.equal((await stat(encryptedPath)).mode & 0o777, 0o600);
  await decryptBackup(encryptedPath, decryptedPath, identity);
  assert.deepEqual(await readFile(decryptedPath), plain);
});

test("wrong identity, corrupted data and truncation remove all partial plaintext", async (t) => {
  const { directory, identity, recipient } = await fixture(t);
  const encryptedPath = path.join(directory, "app.dump.age");
  await encryptBackup(chunks(randomBytes(200_000)), encryptedPath, recipient);
  const valid = await readFile(encryptedPath);
  const bad = Buffer.from(valid);
  bad[bad.length - 5] ^= 1;
  const cases = [
    { name: "wrong-key", bytes: valid, key: await generateIdentity() },
    { name: "corrupted", bytes: bad, key: identity },
    { name: "truncated", bytes: valid.subarray(0, valid.length - 50), key: identity },
  ];
  for (const value of cases) {
    const input = path.join(directory, `${value.name}.age`);
    const output = path.join(directory, `${value.name}.dump`);
    await writeFile(input, value.bytes);
    await assert.rejects(decryptBackup(input, output, value.key), /^Error: Backup decryption failed\.$/);
    assert.equal(existsSync(output), false, `${value.name} left plaintext behind`);
  }
});

test("an input failure removes partial ciphertext and does not disclose the source error", async (t) => {
  const { directory, recipient } = await fixture(t);
  const output = path.join(directory, "failed.age");
  const input = Readable.from((async function* () {
    yield randomBytes(100_000);
    throw new Error("synthetic-secret-source-error");
  })());
  await assert.rejects(encryptBackup(input, output, recipient), (error: Error) => error.message === "Backup encryption failed.");
  assert.equal(existsSync(output), false);
});

test("encryption and decryption never overwrite or remove existing destinations", async (t) => {
  const { directory, identity, recipient } = await fixture(t);
  const existing = path.join(directory, "existing");
  await writeFile(existing, "preserve me");
  await assert.rejects(encryptBackup(chunks(Buffer.from("new")), existing, recipient), /Backup encryption failed/);
  assert.equal(await readFile(existing, "utf8"), "preserve me");
  const encrypted = path.join(directory, "valid.age");
  await encryptBackup(chunks(Buffer.from("new")), encrypted, recipient);
  await assert.rejects(decryptBackup(encrypted, existing, identity), /Backup decryption failed/);
  assert.equal(await readFile(existing, "utf8"), "preserve me");
});

test("invalid recipients and an aborted stream leave no backup artifact", async (t) => {
  const { directory, recipient } = await fixture(t);
  const invalid = path.join(directory, "invalid.age");
  assert.throws(() => validateRecipient("AGE-SECRET-KEY-1secret"), /public recipient/);
  assert.throws(() => validateRecipient(recipient.toUpperCase()), /public recipient/);
  const badRecipient = recipient.slice(0, -1) + (recipient.endsWith("x") ? "q" : "x");
  await assert.rejects(encryptBackup(chunks(Buffer.from("new")), invalid, badRecipient), /Backup encryption failed/);
  assert.equal(existsSync(invalid), false);
  const cancelled = path.join(directory, "cancelled.age");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(encryptBackup(chunks(Buffer.from("new")), cancelled, recipient, { signal: controller.signal }), /Backup encryption failed/);
  assert.equal(existsSync(cancelled), false);
});
