import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { listBackups, makeBackupId, pruneBackups, type BackupManifest } from "../../lib/backup/storage.ts";

const now = new Date("2024-06-30T12:00:00.000Z");
const day = 24 * 60 * 60 * 1000;

async function fixture(t: TestContext) {
  const temporaryRoot = await realpath(os.tmpdir());
  const directory = await mkdtemp(path.join(temporaryRoot, "aisistent-backup-storage-"));
  const root = path.join(directory, "backups");
  await mkdir(root);
  t.after(async () => {
    const canonical = await realpath(directory);
    assert.equal(canonical, directory);
    assert.equal(path.dirname(canonical), temporaryRoot);
    assert.ok(path.basename(canonical).startsWith("aisistent-backup-storage-"));
    assert.equal((await lstat(canonical)).isSymbolicLink(), false);
    await rm(canonical, { recursive: true, force: true });
  });
  return { directory, root };
}

async function completed(root: string, createdAt = new Date(now.getTime() - 40 * day), options: {
  idDate?: Date;
  mutate?: (manifest: BackupManifest) => unknown;
} = {}) {
  const id = makeBackupId(options.idDate ?? createdAt);
  const directory = path.join(root, id);
  await mkdir(directory);
  const files: BackupManifest["files"] = [];
  for (const name of ["app.dump.age", "migrations.dump.age"] as const) {
    const bytes = Buffer.from(`age-encryption.org/v1\ntest ciphertext ${name}`);
    await writeFile(path.join(directory, name), bytes);
    files.push({ name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  const manifest: BackupManifest = {
    version: 1, id, createdAt: createdAt.toISOString(), sourceLabel: "synthetic-test",
    restoreRoles: ["aisistent_runtime"], files,
  };
  const value = options.mutate ? options.mutate(manifest) : manifest;
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify(value));
  return { directory, manifest };
}

test("backup IDs use a canonical UTC timestamp and a fresh version-four UUID", () => {
  const first = makeBackupId(now);
  assert.match(first, /^backup-20240630T120000000Z-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.notEqual(first, makeBackupId(now));
  assert.throws(() => makeBackupId(new Date("invalid")));
  assert.throws(() => makeBackupId(new Date("+010000-01-01T00:00:00.000Z")));
});

test("listing returns verified completed copies newest first and supports separate completion times", async (t) => {
  const { root } = await fixture(t);
  const older = await completed(root, new Date("2024-01-01T00:00:00.000Z"));
  const newer = await completed(root, new Date("2024-02-01T01:00:00.000Z"), { idDate: new Date("2024-02-01T00:00:00.000Z") });
  assert.deepEqual(await listBackups(root), [newer, older]);
});

test("missing roots are empty and ordinary files cannot be backup roots", async (t) => {
  const { directory, root } = await fixture(t);
  assert.deepEqual(await listBackups(path.join(directory, "missing")), []);
  assert.deepEqual(await pruneBackups(path.join(directory, "missing"), { retentionDays: 30, minimumCopies: 1, now }), { deleted: 0, kept: 0 });
  assert.deepEqual(await listBackups(root), []);
  const file = path.join(directory, "ordinary-file");
  await writeFile(file, "keep");
  await assert.rejects(listBackups(file), /regular directory/);
});

test("unknown and incomplete directories are ignored and retain all their contents", async (t) => {
  const { root } = await fixture(t);
  const valid = await completed(root);
  const unknown = path.join(root, "family-photos");
  await mkdir(unknown);
  await writeFile(path.join(unknown, "keep.txt"), "keep");
  const unfinished = path.join(root, makeBackupId(new Date("2024-01-01T00:00:00.000Z")));
  await mkdir(unfinished);
  await writeFile(path.join(unfinished, "app.dump.age"), "unfinished");
  const extra = await completed(root);
  await writeFile(path.join(extra.directory, "keep.txt"), "keep");
  const subdirectory = await completed(root);
  await mkdir(path.join(subdirectory.directory, "photos"));
  assert.deepEqual(await listBackups(root), [valid]);
  assert.deepEqual(await pruneBackups(root, { retentionDays: 1, minimumCopies: 1, now }), { deleted: 0, kept: 1 });
  assert.equal(await readFile(path.join(unknown, "keep.txt"), "utf8"), "keep");
  assert.equal(await readFile(path.join(extra.directory, "keep.txt"), "utf8"), "keep");
  assert.equal(await readFile(path.join(unfinished, "app.dump.age"), "utf8"), "unfinished");
  assert.equal((await lstat(path.join(subdirectory.directory, "photos"))).isDirectory(), true);
});

test("manifest schemas reject extra fields, unsafe metadata and noncanonical dates", async (t) => {
  const { root } = await fixture(t);
  const invalid: Array<(manifest: BackupManifest) => unknown> = [
    (manifest) => ({ ...manifest, version: 2 }),
    (manifest) => ({ ...manifest, id: makeBackupId(new Date("2024-01-01T00:00:00.000Z")) }),
    (manifest) => ({ ...manifest, sourceLabel: "person@example.test" }),
    (manifest) => ({ ...manifest, sourceLabel: "../other" }),
    (manifest) => ({ ...manifest, sourceLabel: "x".repeat(41) }),
    (manifest) => ({ ...manifest, createdAt: "2024-02-30T00:00:00.000Z" }),
    (manifest) => ({ ...manifest, createdAt: "2024-01-01T00:00:00Z" }),
    (manifest) => ({ ...manifest, createdAt: "2024-01-01T00:00:00.000+00:00" }),
    (manifest) => ({ ...manifest, unexpected: "keep" }),
    (manifest) => ({ ...manifest, files: [manifest.files[0], manifest.files[0]] }),
    (manifest) => ({ ...manifest, files: [{ ...manifest.files[0], name: "../other.age" }, manifest.files[1]] }),
    (manifest) => ({ ...manifest, files: [{ ...manifest.files[0], bytes: 0 }, manifest.files[1]] }),
    (manifest) => ({ ...manifest, files: [{ ...manifest.files[0], bytes: 1.5 }, manifest.files[1]] }),
    (manifest) => ({ ...manifest, files: [{ ...manifest.files[0], sha256: "a".repeat(63) }, manifest.files[1]] }),
    (manifest) => ({ ...manifest, files: [{ ...manifest.files[0], sha256: "A".repeat(64) }, manifest.files[1]] }),
    (manifest) => ({ ...manifest, files: [{ ...manifest.files[0], unexpected: true }, manifest.files[1]] }),
  ];
  for (const mutate of invalid) await completed(root, undefined, { mutate });
  const malformed = await completed(root);
  await writeFile(path.join(malformed.directory, "manifest.json"), "{incomplete");
  const oversized = await completed(root);
  await writeFile(path.join(oversized.directory, "manifest.json"), " ".repeat(16 * 1024 + 1));
  assert.deepEqual(await listBackups(root), []);
  assert.deepEqual(await pruneBackups(root, { retentionDays: 1, minimumCopies: 1, now }), { deleted: 0, kept: 0 });
  assert.equal((await readdir(root)).length, invalid.length + 2);
});

test("restore roles must be bounded, unique simple identifiers including the runtime role", async (t) => {
  const { root } = await fixture(t);
  const invalid = [
    undefined, [], ["other"], ["aisistent_runtime", "aisistent_runtime"],
    ["aisistent_runtime", "has space"], ["aisistent_runtime", "public; DROP ROLE other"],
    ["aisistent_runtime", "a".repeat(64)], ["aisistent_runtime", ...Array.from({ length: 50 }, (_, index) => `role_${index}`)],
  ];
  for (const restoreRoles of invalid) await completed(root, undefined, { mutate: (manifest) => ({ ...manifest, restoreRoles }) });
  const valid = await completed(root, undefined, { mutate: (manifest) => ({ ...manifest, restoreRoles: ["aisistent_runtime", "provider_reader", "_MixedCase9"] }) });
  const copies = await listBackups(root);
  assert.equal(copies.length, 1);
  assert.equal(copies[0].manifest.id, valid.manifest.id);
});

test("encrypted file sizes and actual content digests must match the manifest", async (t) => {
  const { root } = await fixture(t);
  const truncated = await completed(root);
  await writeFile(path.join(truncated.directory, "app.dump.age"), "short");
  const changed = await completed(root);
  const original = await readFile(path.join(changed.directory, "app.dump.age"));
  original[original.length - 1] ^= 1;
  await writeFile(path.join(changed.directory, "app.dump.age"), original);
  await completed(root, undefined, { mutate: (manifest) => ({ ...manifest, files: [{ ...manifest.files[0], sha256: "0".repeat(64) }, manifest.files[1]] }) });
  const empty = await completed(root);
  await writeFile(path.join(empty.directory, "app.dump.age"), "");
  assert.deepEqual(await listBackups(root), []);
  assert.deepEqual(await pruneBackups(root, { retentionDays: 1, minimumCopies: 1, now }), { deleted: 0, kept: 0 });
  assert.equal((await readdir(root)).length, 4);
});

test("future completion and ID timestamps are ignored rather than extending the minimum-copy count", async (t) => {
  const { root } = await fixture(t);
  await completed(root, new Date("9999-01-01T00:00:00.000Z"), { idDate: new Date("2024-01-01T00:00:00.000Z") });
  await completed(root, new Date("2024-01-01T00:00:00.000Z"), { idDate: new Date("9999-01-01T00:00:00.000Z") });
  const kept = await completed(root);
  assert.deepEqual(await listBackups(root), [kept]);
  assert.deepEqual(await pruneBackups(root, { retentionDays: 1, minimumCopies: 1, now }), { deleted: 0, kept: 1 });
  assert.equal((await readdir(root)).length, 3);
});

test("retention deletes only expired completed copies and preserves the newest minimum", async (t) => {
  const { root } = await fixture(t);
  const copies = [];
  for (const age of [90, 60, 45, 20, 1]) copies.push(await completed(root, new Date(now.getTime() - age * day)));
  assert.deepEqual(await pruneBackups(root, { retentionDays: 30, minimumCopies: 3, now }), { deleted: 2, kept: 3 });
  assert.deepEqual((await listBackups(root)).map((copy) => copy.manifest.id), copies.slice(2).reverse().map((copy) => copy.manifest.id));
  assert.deepEqual(await pruneBackups(root, { retentionDays: 30, minimumCopies: 3, now }), { deleted: 0, kept: 3 });
});

test("source-scoped retention preserves each label's minimum independently", async (t) => {
  const { root } = await fixture(t);
  const primary = [];
  const secondary = [];
  for (const age of [90, 60, 45]) primary.push(await completed(root, new Date(now.getTime() - age * day)));
  for (const age of [40, 35, 31]) secondary.push(await completed(root, new Date(now.getTime() - age * day), {
    mutate: (manifest) => ({ ...manifest, sourceLabel: "secondary-source" }),
  }));
  assert.deepEqual(await pruneBackups(root, { retentionDays: 30, minimumCopies: 2, sourceLabel: "synthetic-test", now }), { deleted: 1, kept: 2 });
  let remaining = await listBackups(root);
  assert.deepEqual(remaining.filter((copy) => copy.manifest.sourceLabel === "synthetic-test").map((copy) => copy.manifest.id), primary.slice(1).reverse().map((copy) => copy.manifest.id));
  assert.deepEqual(remaining.filter((copy) => copy.manifest.sourceLabel === "secondary-source").map((copy) => copy.manifest.id), secondary.slice().reverse().map((copy) => copy.manifest.id));
  assert.deepEqual(await pruneBackups(root, { retentionDays: 30, minimumCopies: 2, sourceLabel: "secondary-source", now }), { deleted: 1, kept: 2 });
  remaining = await listBackups(root);
  assert.equal(remaining.length, 4);
  for (const sourceLabel of ["synthetic-test", "secondary-source"]) {
    assert.equal(remaining.filter((copy) => copy.manifest.sourceLabel === sourceLabel).length, 2);
  }
  assert.deepEqual(await pruneBackups(root, { retentionDays: 30, minimumCopies: 1, sourceLabel: "absent-source", now }), { deleted: 0, kept: 0 });
  assert.equal((await listBackups(root)).length, 4);
});

test("corrupt and incomplete copies cannot satisfy a source's minimum or be deleted", async (t) => {
  const { root } = await fixture(t);
  const valid = await completed(root, new Date(now.getTime() - 90 * day));
  const corrupted = await completed(root, new Date(now.getTime() - 45 * day));
  await writeFile(path.join(corrupted.directory, "app.dump.age"), "corrupt");
  const incomplete = await completed(root, new Date(now.getTime() - 35 * day));
  await rm(path.join(incomplete.directory, "manifest.json"));
  await completed(root, new Date(now.getTime() - 31 * day), { mutate: (manifest) => ({ ...manifest, sourceLabel: "other-source" }) });
  assert.deepEqual(await pruneBackups(root, { retentionDays: 30, minimumCopies: 1, sourceLabel: "synthetic-test", now }), { deleted: 0, kept: 1 });
  assert.equal((await lstat(valid.directory)).isDirectory(), true);
  assert.equal(await readFile(path.join(corrupted.directory, "app.dump.age"), "utf8"), "corrupt");
  assert.equal((await readdir(incomplete.directory)).length, 2);
  assert.equal((await readdir(root)).length, 4);
});

test("a copy exactly on the retention boundary remains until it is older", async (t) => {
  const { root } = await fixture(t);
  const boundary = await completed(root, new Date(now.getTime() - 30 * day));
  await completed(root, new Date(now.getTime() - day));
  assert.deepEqual(await pruneBackups(root, { retentionDays: 30, minimumCopies: 1, now }), { deleted: 0, kept: 2 });
  assert.deepEqual(await pruneBackups(root, { retentionDays: 30, minimumCopies: 1, now: new Date(now.getTime() + 1) }), { deleted: 1, kept: 1 });
  await assert.rejects(lstat(boundary.directory), { code: "ENOENT" });
});

test("retention validates integer bounds and dates before deleting anything", async (t) => {
  const { root } = await fixture(t);
  await completed(root);
  for (const retentionDays of [-1, 0, 0.5, 3651, NaN, Infinity]) {
    await assert.rejects(pruneBackups(root, { retentionDays, minimumCopies: 1, now }), /Retention/);
  }
  for (const minimumCopies of [-1, 0, 0.5, 1001, NaN, Infinity]) {
    await assert.rejects(pruneBackups(root, { retentionDays: 30, minimumCopies, now }), /Minimum/);
  }
  for (const sourceLabel of ["", "Uppercase", "../other", "a".repeat(41), "person@example.test"]) {
    await assert.rejects(pruneBackups(root, { retentionDays: 30, minimumCopies: 1, sourceLabel, now }), /source label/);
  }
  await assert.rejects(pruneBackups(root, { retentionDays: 30, minimumCopies: 1, now: new Date("invalid") }), /valid retention date/);
  assert.equal((await readdir(root)).length, 1);
});

test("a retention pass is bounded to 100 deletions and removes the oldest copies first", async (t) => {
  const { root } = await fixture(t);
  const copies = [];
  for (let index = 0; index < 103; index++) copies.push(await completed(root, new Date(now.getTime() - (index + 40) * day)));
  assert.deepEqual(await pruneBackups(root, { retentionDays: 30, minimumCopies: 1, now }), { deleted: 100, kept: 3 });
  assert.deepEqual((await listBackups(root)).map((copy) => copy.manifest.id), copies.slice(0, 3).map((copy) => copy.manifest.id));
  assert.deepEqual(await pruneBackups(root, { retentionDays: 30, minimumCopies: 1, now }), { deleted: 2, kept: 1 });
});

test("directory links are rejected as roots and ignored as children without touching their targets", async (t) => {
  const { directory, root } = await fixture(t);
  const external = path.join(directory, "external");
  await mkdir(external);
  const outside = await completed(external);
  await writeFile(path.join(external, "sentinel.txt"), "keep");
  const rootLink = path.join(directory, "linked-root");
  try {
    await symlink(external, rootLink, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("Creating directory links is not permitted in this Windows environment.");
      return;
    }
    throw error;
  }
  await assert.rejects(listBackups(rootLink), /regular directory/);
  await assert.rejects(pruneBackups(rootLink, { retentionDays: 1, minimumCopies: 1, now }), /regular directory/);
  await symlink(outside.directory, path.join(root, outside.manifest.id), process.platform === "win32" ? "junction" : "dir");
  const valid = await completed(root);
  assert.deepEqual(await listBackups(root), [valid]);
  assert.deepEqual(await pruneBackups(root, { retentionDays: 1, minimumCopies: 1, now }), { deleted: 0, kept: 1 });
  assert.equal(await readFile(path.join(external, "sentinel.txt"), "utf8"), "keep");
  assert.equal((await readdir(outside.directory)).length, 3);
});

test("a file link inside a completed directory makes the entire candidate ineligible", async (t) => {
  const { directory, root } = await fixture(t);
  const copy = await completed(root);
  const target = path.join(directory, "ciphertext.age");
  await writeFile(target, await readFile(path.join(copy.directory, "app.dump.age")));
  await rm(path.join(copy.directory, "app.dump.age"));
  try {
    await symlink(target, path.join(copy.directory, "app.dump.age"), "file");
  } catch (error) {
    if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("Creating file symlinks requires Windows Developer Mode or permission.");
      return;
    }
    throw error;
  }
  assert.deepEqual(await listBackups(root), []);
  assert.deepEqual(await pruneBackups(root, { retentionDays: 1, minimumCopies: 1, now }), { deleted: 0, kept: 0 });
  assert.ok((await readFile(target)).length > 0);
  assert.equal((await lstat(path.join(copy.directory, "app.dump.age"))).isSymbolicLink(), true);
});
