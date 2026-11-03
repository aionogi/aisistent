import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { BackupError, checkPostgresTools, postgresEnvironment, postgresTool } from "../../lib/backup/create.ts";
import { decryptBackup } from "../../lib/backup/encryption.ts";
import { listBackups } from "../../lib/backup/storage.ts";
import { ensureAppLogin } from "../../lib/db/migrator.ts";
import { MIGRATIONS_DIR, startTestDatabase, type TestDatabase } from "../db/harness.ts";
import { runRestoreDrill } from "./drill.ts";

const execute = promisify(execFile);

/** Offline check only: no supplied target URL, no web server and no live database writes. */
export async function verifyEncryptedBackup(options: { directory: string; id: string; identity: string; toolsDirectory?: string; /** Tests only. */ afterRestore?: (database: TestDatabase) => Promise<void> }) {
  const backup = (await listBackups(options.directory)).find(({ manifest }) => manifest.id === options.id);
  if (!backup) throw new BackupError("Completed backup not found or its checksum is invalid.");
  await checkPostgresTools(options.toolsDirectory);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "aisistent-backup-verify-"));
  let target: TestDatabase | undefined;
  let step = "decryption";
  try {
    // Authenticate and fully finish both decryptions before any SQL is executed.
    for (const { name } of backup.manifest.files) {
      await decryptBackup(path.join(backup.directory, name), path.join(temporary, name.replace(/\.age$/, "")), options.identity);
    }
    step = "isolated restore";
    const appPassword = randomBytes(32).toString("base64url");
    target = await startTestDatabase({ migrate: false, appPassword });
    for (const role of backup.manifest.restoreRoles) {
      if (!(await target.admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role])).rowCount) {
        await target.admin.query(`CREATE ROLE ${target.admin.escapeIdentifier(role)} NOLOGIN`);
      }
    }
    await ensureAppLogin(target.admin, appPassword);
    const env = postgresEnvironment(new URL(target.adminUrl));
    delete env.PGOPTIONS;
    for (const { name } of backup.manifest.files) {
      const { stderr } = await execute(postgresTool("pg_restore", options.toolsDirectory), [
        "--no-password", `--dbname=${decodeURIComponent(new URL(target.adminUrl).pathname.slice(1))}`, "--no-owner", "--exit-on-error", "--single-transaction", path.join(temporary, name.replace(/\.age$/, "")),
      ], { env, timeout: 600_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
      if (stderr.trim()) throw new BackupError("Restored archive emitted a warning.");
    }
    await options.afterRestore?.(target);
    step = "security rehearsal";
    // Reuse the complete tenant/security/session/save rehearsal on this isolated copy.
    const { report } = await runRestoreDrill({ sourceUrl: target.adminUrl, migrationsDir: MIGRATIONS_DIR, toolsDirectory: options.toolsDirectory });
    return { verified: true, tables: report.tables.length, isolationChecks: report.isolationChecks };
  } catch {
    throw new BackupError(`Encrypted restore verification failed during ${step}; no live target was changed.`);
  } finally {
    try { await target?.stop(); }
    finally {
      // Only this mkdtemp result is removed. Decrypted dumps never enter the source checkout.
      await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
}
