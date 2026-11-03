import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { checkBackupHealth } from "../../lib/backup/health.ts";
import { makeBackupId, type BackupManifest } from "../../lib/backup/storage.ts";

// Historical values keep fixtures independent of the machine's current clock.
const NOW = new Date("2020-01-10T12:00:00.000Z");
const POLICY = { sourceLabel: "prod-eu", maxAgeHours: 24, now: NOW };

async function fixtureRoot(t: TestContext): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "aisistent-backup-health-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return root;
}

async function backup(root: string, createdAt: string, sourceLabel = POLICY.sourceLabel, damage?: "missing" | "corrupt") {
  const id = makeBackupId(new Date(createdAt));
  const directory = path.join(root, id);
  await mkdir(directory);
  const files: BackupManifest["files"] = [];
  for (const name of ["app.dump.age", "migrations.dump.age"] as const) {
    const content = Buffer.from(`synthetic encrypted fixture ${name}`);
    files.push({ name, bytes: content.length, sha256: createHash("sha256").update(content).digest("hex") });
    if (name === "app.dump.age" && damage === "missing") continue;
    const stored = name === "app.dump.age" && damage === "corrupt" ? Buffer.alloc(content.length, "x") : content;
    await writeFile(path.join(directory, name), stored);
  }
  const manifest: BackupManifest = { version: 1, id, createdAt, sourceLabel, restoreRoles: ["aisistent_runtime"], files };
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest));
  return directory;
}

test("backup watchdog reports missing when there is no completed copy", async (t) => {
  const root = await fixtureRoot(t);
  const missing = { healthy: false, reason: "missing", latestCreatedAt: null, ageHours: null };
  assert.deepEqual(await checkBackupHealth(root, POLICY), missing);
  assert.deepEqual(await checkBackupHealth(path.join(root, "not-created"), POLICY), missing);
});

test("backup watchdog accepts the newest verified copy for the requested source only", async (t) => {
  const root = await fixtureRoot(t);
  await backup(root, "2020-01-09T00:00:00.000Z");
  await backup(root, "2020-01-10T00:00:00.000Z");
  await backup(root, "2020-01-10T11:00:00.000Z", "other-source");
  assert.deepEqual(await checkBackupHealth(root, POLICY), {
    healthy: true, reason: "ok", latestCreatedAt: "2020-01-10T00:00:00.000Z", ageHours: 12,
  });
  assert.equal((await checkBackupHealth(root, { ...POLICY, sourceLabel: "unknown" })).reason, "missing");
});

test("backup watchdog flags stale copies and treats the exact age boundary as healthy", async (t) => {
  const root = await fixtureRoot(t);
  const createdAt = "2020-01-09T12:00:00.000Z";
  await backup(root, createdAt);
  assert.deepEqual(await checkBackupHealth(root, POLICY), { healthy: true, reason: "ok", latestCreatedAt: createdAt, ageHours: 24 });
  const stale = await checkBackupHealth(root, { ...POLICY, now: new Date(NOW.getTime() + 1) });
  assert.equal(stale.healthy, false);
  assert.equal(stale.reason, "stale");
  assert.equal(stale.latestCreatedAt, createdAt);
  assert.ok(stale.ageHours! > 24);
});

test("missing or corrupted newest archives cannot mask an older stale copy", async (t) => {
  const root = await fixtureRoot(t);
  await backup(root, "2020-01-08T12:00:00.000Z");
  await backup(root, "2020-01-10T00:00:00.000Z", POLICY.sourceLabel, "missing");
  await backup(root, "2020-01-10T01:00:00.000Z", POLICY.sourceLabel, "corrupt");
  assert.deepEqual(await checkBackupHealth(root, POLICY), {
    healthy: false, reason: "stale", latestCreatedAt: "2020-01-08T12:00:00.000Z", ageHours: 48,
  });
});

test("future-dated copies and unrelated copies cannot satisfy the watchdog", async (t) => {
  const root = await fixtureRoot(t);
  await backup(root, "2020-01-10T13:00:00.000Z");
  await backup(root, "2020-01-10T11:00:00.000Z", "other-source");
  assert.deepEqual(await checkBackupHealth(root, POLICY), { healthy: false, reason: "missing", latestCreatedAt: null, ageHours: null });
});

test("backup watchdog rejects invalid policies and propagates filesystem failures", async (t) => {
  const root = await fixtureRoot(t);
  for (const sourceLabel of ["", "Prod", "prod/eu", "x".repeat(41), undefined, null, 12]) {
    await assert.rejects(checkBackupHealth(root, { ...POLICY, sourceLabel: sourceLabel as string }), /source label/);
  }
  for (const maxAgeHours of [0, -1, 8761, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(checkBackupHealth(root, { ...POLICY, maxAgeHours }), /Maximum backup age/);
  }
  await assert.rejects(checkBackupHealth(root, { ...POLICY, now: new Date(Number.NaN) }), /check time/);
  assert.equal((await checkBackupHealth(root, { ...POLICY, sourceLabel: "x", maxAgeHours: 1 })).reason, "missing");
  assert.equal((await checkBackupHealth(root, { ...POLICY, sourceLabel: "x".repeat(40), maxAgeHours: 8760 })).reason, "missing");
  const file = path.join(root, "not-a-directory");
  await writeFile(file, "synthetic fixture");
  await assert.rejects(checkBackupHealth(file, POLICY), /regular directory/);
});
