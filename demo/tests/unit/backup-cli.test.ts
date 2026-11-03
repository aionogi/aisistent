import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test, type TestContext } from "node:test";
import { generateIdentity, identityToRecipient } from "age-encryption";

const execute = promisify(execFile);
const script = fileURLToPath(new URL("../../scripts/operations/backup.ts", import.meta.url));
const repository = fileURLToPath(new URL("../../../", import.meta.url));
const webDatabase = "postgresql://web-user:synthetic-web-database-secret@unused.invalid:5432/web_database";
const webAuthSecret = "synthetic-web-auth0-secret-never-use-for-backups";

async function fixtureRoot(t: TestContext): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "aisistent-backup-cli-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return root;
}

async function run(command: string, settings: Partial<NodeJS.ProcessEnv> = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(?:BACKUP_|PG)/i.test(key)) delete env[key];
  Object.assign(env, { DATABASE_URL: webDatabase, AUTH0_SECRET: webAuthSecret }, settings);
  try {
    const { stdout, stderr } = await execute(process.execPath, [script, command], { env, timeout: 15_000, windowsHide: true });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number | string; stdout?: string; stderr?: string };
    if (typeof failure.code !== "number") throw error;
    return { code: failure.code, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

function noSecrets(result: { stdout: string; stderr: string }, secrets: string[] = []) {
  for (const secret of [webDatabase, webAuthSecret, "synthetic-web-database-secret", ...secrets]) {
    assert.ok(!`${result.stdout}${result.stderr}`.includes(secret), "scheduler output must not contain synthetic secret values");
  }
}

test("backup CLI requires its own configuration instead of inherited web credentials", async () => {
  for (const command of ["create", "check", "keys", "verify"]) {
    const result = await run(command);
    assert.equal(result.code, 1, `${command} must fail without BACKUP configuration`);
    assert.match(result.stderr, /"result":"error"/);
    assert.match(result.stderr, /Missing BACKUP_/);
    noSecrets(result);
  }
});

test("backup CLI refuses a remote database without a CA before creating output files", async (t) => {
  const root = await fixtureRoot(t);
  const recipientFile = path.join(root, "recipient.txt");
  const identity = await generateIdentity();
  await writeFile(recipientFile, await identityToRecipient(identity));
  const output = path.join(root, "must-not-exist");
  const database = "postgresql://backup-user:synthetic-backup-password@database.invalid:5432/postgres";
  const result = await run("create", {
    BACKUP_DATABASE_URL: database,
    BACKUP_RECIPIENT_FILE: recipientFile,
    BACKUP_DIRECTORY: output,
    BACKUP_SOURCE_LABEL: "test-source",
    BACKUP_RETENTION_DAYS: "7",
    BACKUP_MINIMUM_COPIES: "2",
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /"event":"backup.create","result":"error"/);
  await assert.rejects(lstat(output), { code: "ENOENT" });
  assert.deepEqual(await readdir(root), ["recipient.txt"]);
  noSecrets(result, [database, "synthetic-backup-password", identity, recipientFile, output]);
});

test("backup CLI generates private keys only in a new external directory and never overwrites them", async (t) => {
  const root = await fixtureRoot(t);
  const keyDirectory = path.join(root, "offline-keys");
  const first = await run("keys", { BACKUP_KEY_DIRECTORY: keyDirectory });
  assert.equal(first.code, 0);
  assert.match(first.stdout, /"event":"backup.keys","result":"success"/);
  const identityFile = path.join(keyDirectory, "backup-identity.txt");
  const recipientFile = path.join(keyDirectory, "backup-recipient.txt");
  const identity = (await readFile(identityFile, "utf8")).trim();
  const recipient = (await readFile(recipientFile, "utf8")).trim();
  assert.match(identity, /^AGE-SECRET-KEY-1/);
  assert.equal(await identityToRecipient(identity), recipient);
  assert.deepEqual((await readdir(keyDirectory)).sort(), ["backup-identity.txt", "backup-recipient.txt"]);
  if (process.platform !== "win32") {
    assert.equal((await lstat(keyDirectory)).mode & 0o077, 0);
    assert.equal((await lstat(identityFile)).mode & 0o077, 0);
  }
  const second = await run("keys", { BACKUP_KEY_DIRECTORY: keyDirectory });
  assert.equal(second.code, 1);
  assert.equal((await readFile(identityFile, "utf8")).trim(), identity);
  assert.equal((await readFile(recipientFile, "utf8")).trim(), recipient);
  for (const result of [first, second]) noSecrets(result, [identity, recipient, keyDirectory]);

  const existing = path.join(root, "existing");
  await mkdir(existing);
  const refused = await run("keys", { BACKUP_KEY_DIRECTORY: existing });
  assert.equal(refused.code, 1);
  assert.deepEqual(await readdir(existing), []);
  const inCheckout = await run("keys", { BACKUP_KEY_DIRECTORY: repository });
  assert.equal(inCheckout.code, 1);
  const relative = await run("keys", { BACKUP_KEY_DIRECTORY: "relative-offline-keys" });
  assert.equal(relative.code, 1);
});

test("backup CLI check cannot report success for a missing directory", async (t) => {
  const root = await fixtureRoot(t);
  const directory = path.join(root, "missing-backups");
  const result = await run("check", {
    BACKUP_DIRECTORY: directory,
    BACKUP_SOURCE_LABEL: "test-source",
    BACKUP_MAX_AGE_HOURS: "24",
  });
  if (result.stdout.trim()) {
    assert.equal(result.code, 2, "an unhealthy watchdog result uses the scheduler's nonzero alert code");
    assert.deepEqual(JSON.parse(result.stdout), {
      event: "backup.health", healthy: false, reason: "missing", latestCreatedAt: null, ageHours: null,
    });
  } else {
    assert.equal(result.code, 1, "a missing-root filesystem failure must also fail closed");
    assert.match(result.stderr, /"event":"backup.check","result":"error"/);
  }
  await assert.rejects(lstat(directory), { code: "ENOENT" });
  noSecrets(result, [directory]);
});
