import { listBackups } from "./storage.ts";

export type BackupHealth = {
  healthy: boolean;
  reason: "ok" | "missing" | "stale";
  latestCreatedAt: string | null;
  ageHours: number | null;
};

/**
 * Read-only watchdog check for a separate scheduler. A job cannot detect its
 * own absence; a completed copy must pass the storage module's hash checks.
 * No database connection, decryption identity or provider credential is used.
 */
export async function checkBackupHealth(directory: string, options: {
  sourceLabel: string;
  maxAgeHours: number;
  now?: Date;
}): Promise<BackupHealth> {
  const { sourceLabel, maxAgeHours, now = new Date() } = options;
  if (typeof sourceLabel !== "string" || !/^[a-z0-9-]{1,40}$/.test(sourceLabel)) throw new Error("A valid backup source label is required.");
  if (!Number.isInteger(maxAgeHours) || maxAgeHours < 1 || maxAgeHours > 8760) {
    throw new Error("Maximum backup age must be an integer from 1 to 8760 hours.");
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || now.getUTCFullYear() < 0 || now.getUTCFullYear() > 9999) {
    throw new Error("A valid backup check time is required.");
  }

  const backups = (await listBackups(directory))
    .filter(({ manifest }) => manifest.sourceLabel === sourceLabel && Date.parse(manifest.createdAt) <= now.getTime())
    .sort((first, second) => Date.parse(second.manifest.createdAt) - Date.parse(first.manifest.createdAt));
  const latest = backups[0]?.manifest.createdAt;
  if (!latest) return { healthy: false, reason: "missing", latestCreatedAt: null, ageHours: null };
  const ageHours = (now.getTime() - Date.parse(latest)) / (60 * 60 * 1000);
  const healthy = ageHours <= maxAgeHours;
  return { healthy, reason: healthy ? "ok" : "stale", latestCreatedAt: latest, ageHours };
}
