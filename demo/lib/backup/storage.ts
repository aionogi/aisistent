import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import path from "node:path";

const encryptedNames = ["app.dump.age", "migrations.dump.age"] as const;
const completedNames = [...encryptedNames, "manifest.json"];
const backupIdPattern = /^backup-(\d{8}T\d{9}Z)-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const dayMilliseconds = 24 * 60 * 60 * 1000;

export type BackupManifest = {
  version: 1;
  id: string;
  createdAt: string;
  sourceLabel: string;
  restoreRoles: string[];
  files: Array<{ name: typeof encryptedNames[number]; bytes: number; sha256: string }>;
};

type CompletedBackup = { directory: string; manifest: BackupManifest };

function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime()) && value.getUTCFullYear() >= 0 && value.getUTCFullYear() <= 9999;
}

function compactTimestamp(value: Date): string {
  return value.toISOString().replace(/[-:.]/g, "");
}

export function makeBackupId(now = new Date()): string {
  if (!validDate(now)) throw new Error("A valid backup date is required.");
  return `backup-${compactTimestamp(now)}-${randomUUID()}`;
}

function objectHasKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validTimestamp(value: unknown, now: Date): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return validDate(parsed) && parsed.toISOString() === value && parsed.getTime() <= now.getTime();
}

function validId(id: string, now: Date): boolean {
  const compact = backupIdPattern.exec(id)?.[1];
  if (!compact) return false;
  const iso = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T${compact.slice(9, 11)}:${compact.slice(11, 13)}:${compact.slice(13, 15)}.${compact.slice(15, 18)}Z`;
  return validTimestamp(iso, now);
}

function parseManifest(value: unknown, id: string, now: Date): BackupManifest | null {
  if (!objectHasKeys(value, ["version", "id", "createdAt", "sourceLabel", "restoreRoles", "files"])) return null;
  if (value.version !== 1 || value.id !== id || !validTimestamp(value.createdAt, now)) return null;
  if (typeof value.sourceLabel !== "string" || !/^[a-z0-9-]{1,40}$/.test(value.sourceLabel)) return null;
  if (!Array.isArray(value.restoreRoles) || value.restoreRoles.length < 1 || value.restoreRoles.length > 50
    || !value.restoreRoles.every((role) => typeof role === "string" && /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(role))
    || new Set(value.restoreRoles).size !== value.restoreRoles.length || !value.restoreRoles.includes("aisistent_runtime")) return null;
  if (!Array.isArray(value.files) || value.files.length !== encryptedNames.length) return null;
  const names = new Set<string>();
  for (const file of value.files) {
    if (!objectHasKeys(file, ["name", "bytes", "sha256"]) || !encryptedNames.includes(file.name as typeof encryptedNames[number])
      || !Number.isSafeInteger(file.bytes) || (file.bytes as number) <= 0
      || typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256) || names.has(file.name as string)) return null;
    names.add(file.name as string);
  }
  return value as BackupManifest;
}

function isInside(root: string, child: string): boolean {
  const relative = path.relative(root, child);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function backupRoot(directory: string): Promise<string | null> {
  const absolute = path.resolve(directory);
  try {
    const entry = await lstat(absolute);
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error("The backup root must be a regular directory.");
    return await realpath(absolute);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function safeChild(root: string, directory: string): Promise<boolean> {
  const rootEntry = await lstat(root);
  if (rootEntry.isSymbolicLink() || !rootEntry.isDirectory() || await realpath(root) !== root) return false;
  const entry = await lstat(directory);
  if (entry.isSymbolicLink() || !entry.isDirectory()) return false;
  const canonical = await realpath(directory);
  return canonical === directory && isInside(root, canonical) && path.dirname(canonical) === root;
}

// Check a handle against lstat before reading. O_NOFOLLOW adds protection where
// supported; Windows additionally relies on the regular-file and identity checks.
async function readRegularFile<T>(file: string, read: (handle: Awaited<ReturnType<typeof open>>) => Promise<T>): Promise<T | null> {
  const before = await lstat(file);
  if (before.isSymbolicLink() || !before.isFile()) return null;
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) return null;
    const result = await read(handle);
    const after = await lstat(file);
    if (after.isSymbolicLink() || !after.isFile() || after.dev !== before.dev || after.ino !== before.ino
      || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) return null;
    return result;
  } finally {
    await handle.close();
  }
}

async function readCompletedBackup(root: string, id: string, now: Date): Promise<CompletedBackup | null> {
  if (!validId(id, now)) return null;
  const directory = path.join(root, id);
  try {
    if (!await safeChild(root, directory)) return null;
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.length !== completedNames.length || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink() || !completedNames.includes(entry.name))) return null;
    const manifest = await readRegularFile(path.join(directory, "manifest.json"), async (handle) => {
      if ((await handle.stat()).size > 16 * 1024) return null;
      return parseManifest(JSON.parse(await handle.readFile("utf8")), id, now);
    });
    if (!manifest) return null;
    for (const file of manifest.files) {
      const matches = await readRegularFile(path.join(directory, file.name), async (handle) => {
        if ((await handle.stat()).size !== file.bytes) return false;
        const hash = createHash("sha256");
        for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
        return hash.digest("hex") === file.sha256;
      });
      if (!matches) return null;
    }
    return await safeChild(root, directory) ? { directory, manifest } : null;
  } catch {
    // An unreadable, incomplete or changing directory is never a completed copy.
    return null;
  }
}

async function scanBackups(root: string, now: Date): Promise<CompletedBackup[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const completed: CompletedBackup[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const backup = await readCompletedBackup(root, entry.name, now);
    if (backup) completed.push(backup);
  }
  return completed.sort((first, second) => second.manifest.createdAt.localeCompare(first.manifest.createdAt)
    || second.manifest.id.localeCompare(first.manifest.id));
}

export async function listBackups(directory: string): Promise<CompletedBackup[]> {
  const root = await backupRoot(directory);
  return root ? scanBackups(root, new Date()) : [];
}

export async function pruneBackups(directory: string, options: {
  retentionDays: number;
  minimumCopies: number;
  sourceLabel?: string;
  now?: Date;
}): Promise<{ deleted: number; kept: number }> {
  const { retentionDays, minimumCopies, sourceLabel, now = new Date() } = options;
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) throw new Error("Retention must be an integer from 1 to 3650 days.");
  if (!Number.isInteger(minimumCopies) || minimumCopies < 1 || minimumCopies > 1000) throw new Error("Minimum copies must be an integer from 1 to 1000.");
  if (sourceLabel !== undefined && (typeof sourceLabel !== "string" || !/^[a-z0-9-]{1,40}$/.test(sourceLabel))) throw new Error("The source label must contain 1 to 40 lowercase letters, digits or hyphens.");
  if (!validDate(now)) throw new Error("A valid retention date is required.");
  const root = await backupRoot(directory);
  if (!root) return { deleted: 0, kept: 0 };
  const completed = (await scanBackups(root, now)).filter((backup) => sourceLabel === undefined || backup.manifest.sourceLabel === sourceLabel);
  const cutoff = now.getTime() - retentionDays * dayMilliseconds;
  const candidates = completed.slice(minimumCopies).filter((backup) => new Date(backup.manifest.createdAt).getTime() < cutoff).slice(-100);
  let deleted = 0;
  for (const candidate of candidates.reverse()) {
    // Revalidate after selection. Never recursively remove: only the three known
    // regular files can be unlinked, and rmdir refuses any unexpected contents.
    const current = await readCompletedBackup(root, candidate.manifest.id, now);
    if (!current || JSON.stringify(current.manifest) !== JSON.stringify(candidate.manifest)) continue;
    for (const name of completedNames) {
      if (!await safeChild(root, current.directory)) throw new Error("The backup directory changed during retention.");
      const file = path.join(current.directory, name);
      const entry = await lstat(file);
      if (entry.isSymbolicLink() || !entry.isFile()) throw new Error("A backup file changed during retention.");
      await unlink(file);
    }
    await rmdir(current.directory);
    deleted += 1;
  }
  return { deleted, kept: completed.length - deleted };
}
