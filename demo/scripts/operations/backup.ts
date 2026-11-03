// Trusted-worker commands only. No environment file, database URL or key is inferred from the web app.
import { generateIdentity, identityToRecipient } from "age-encryption";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BackupError, createBackup } from "../../lib/backup/create.ts";
import { checkBackupHealth } from "../../lib/backup/health.ts";

const command = process.argv[2];
const value = (name: string) => process.env[name]?.trim() ?? "";
const required = (name: string) => {
  const result = value(name);
  if (!result) throw new BackupError(`Missing ${name}.`);
  return result;
};
const number = (name: string) => Number(required(name));
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function privateFile(name: string): Promise<string> {
  const file = required(name);
  if (!path.isAbsolute(file) || !(await lstat(file)).isFile() || (await lstat(file)).isSymbolicLink()) throw new BackupError(`${name} must name a regular absolute file.`);
  return (await readFile(file, "utf8")).trim();
}

try {
  if (command === "keys") {
    const directory = path.resolve(required("BACKUP_KEY_DIRECTORY"));
    const relative = path.relative(project, directory);
    if (!path.isAbsolute(required("BACKUP_KEY_DIRECTORY")) || (!path.isAbsolute(relative) && !relative.startsWith(`..${path.sep}`)) || /(?:^|[\\/])OneDrive(?:$|[\\/ -])/i.test(directory)) {
      throw new BackupError("Choose a new absolute key directory outside the checkout and OneDrive.");
    }
    // Never overwrite or rotate an existing identity implicitly. The parent must already exist.
    const parent = await realpath(path.dirname(directory));
    if (parent !== path.dirname(directory)) throw new BackupError("Key directory parent must not use symbolic links.");
    await mkdir(directory, { mode: 0o700 });
    const identity = await generateIdentity();
    const recipient = await identityToRecipient(identity);
    await writeFile(path.join(directory, "backup-identity.txt"), `${identity}\n`, { flag: "wx", mode: 0o600 });
    await writeFile(path.join(directory, "backup-recipient.txt"), `${recipient}\n`, { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ event: "backup.keys", result: "success", note: "Keep the identity offline; only the recipient belongs on the backup worker." }));
  } else if (command === "create") {
    const result = await createBackup({ sourceUrl: required("BACKUP_DATABASE_URL"),
      caCert: value("BACKUP_CA_CERT_FILE") ? await privateFile("BACKUP_CA_CERT_FILE") : undefined,
      recipient: await privateFile("BACKUP_RECIPIENT_FILE"), outputDirectory: required("BACKUP_DIRECTORY"),
      sourceLabel: required("BACKUP_SOURCE_LABEL"), retentionDays: number("BACKUP_RETENTION_DAYS"), minimumCopies: number("BACKUP_MINIMUM_COPIES"),
      toolsDirectory: value("PG_CLIENT_BIN_DIR") || undefined });
    console.log(JSON.stringify({ event: "backup.create", result: "success", id: result.manifest.id, createdAt: result.manifest.createdAt, files: result.manifest.files.length, pruned: result.pruned }));
  } else if (command === "check") {
    const result = await checkBackupHealth(required("BACKUP_DIRECTORY"), { sourceLabel: required("BACKUP_SOURCE_LABEL"), maxAgeHours: number("BACKUP_MAX_AGE_HOURS") });
    console.log(JSON.stringify({ event: "backup.health", ...result }));
    if (!result.healthy) process.exitCode = 2;
  } else if (command === "verify") {
    const { verifyEncryptedBackup } = await import("../../tests/recovery/verify-encrypted.ts");
    const result = await verifyEncryptedBackup({ directory: required("BACKUP_DIRECTORY"), id: required("BACKUP_RUN_ID"), identity: await privateFile("BACKUP_IDENTITY_FILE"), toolsDirectory: value("PG_CLIENT_BIN_DIR") || undefined });
    console.log(JSON.stringify({ event: "backup.verify", result: "success", ...result }));
  } else throw new BackupError("Use create, check, keys or verify.");
} catch (error) {
  // No raw SQL/driver/tool output, file paths, database URLs or key material in scheduler logs.
  console.error(JSON.stringify({ event: `backup.${["create", "check", "keys", "verify"].includes(command) ? command : "configuration"}`, result: "error" }));
  if (error instanceof BackupError && error.message.startsWith("Missing BACKUP_")) console.error(error.message);
  process.exitCode = 1;
}
