import assert from "node:assert/strict";
import { generateIdentity, identityToRecipient } from "age-encryption";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { BackupError, createBackup } from "../../lib/backup/create.ts";
import { decryptBackup } from "../../lib/backup/encryption.ts";
import { listBackups } from "../../lib/backup/storage.ts";
import { withOrganization } from "../../lib/db/context.ts";
import { createOrganization, provisionUser, saveWorkspace } from "../../lib/db/repositories.ts";
import { MIGRATIONS_DIR, startTestDatabase } from "../db/harness.ts";
import { dataSnapshot } from "./snapshots.ts";
import { verifyEncryptedBackup } from "./verify-encrypted.ts";

test("encrypted backups restore the exact shared snapshot and failed runs preserve prior copies", { timeout: 240_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aisistent-backup-integration-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const source = await startTestDatabase();
  t.after(() => source.stop());
  const user = await provisionUser(source.appPool, { subject: "backup|owner", email: "backup@example.test", displayName: "Backup Owner" });
  const org = await createOrganization(source.appPool, user, "Synthetic backup firm");
  await withOrganization(source.appPool, { userId: user, organizationId: org }, (client) => saveWorkspace(client, {
    expectedRevision: 0, config: { business: { name: "Original snapshot" } }, knowledge: [{ id: "new", question: "Synthetic?", answer: "Synthetic answer" }],
  }));
  const identity = await generateIdentity();
  const recipient = await identityToRecipient(identity);
  const outputDirectory = path.join(root, "copies");
  const options = { sourceUrl: source.adminUrl, outputDirectory, recipient, sourceLabel: "synthetic", retentionDays: 7, minimumCopies: 2,
    toolsDirectory: process.env.PG_CLIENT_BIN_DIR ?? process.env.PG_BIN_DIR };
  const snapshot = await dataSnapshot(source.admin);
  const created = await createBackup({ ...options, afterArchive: async (index) => {
    if (index === 0) {
      // Commit between the two exports: both must still use the original exported snapshot.
      await source.admin.query("UPDATE app.assistant_configs SET config = '{\"business\":{\"name\":\"After snapshot\"}}'::jsonb");
      await source.admin.query("UPDATE public.schema_migrations SET applied_at = applied_at + interval '1 second'");
    }
  } });
  assert.equal(created.manifest.files.length, 2);
  assert.deepEqual((await readdir(created.directory)).sort(), ["app.dump.age", "manifest.json", "migrations.dump.age"]);
  assert.equal((await listBackups(outputDirectory)).length, 1);
  for (const { name } of created.manifest.files) {
    const bytes = await readFile(path.join(created.directory, name));
    assert.ok(bytes.subarray(0, 32).toString().startsWith("age-encryption.org/v1"));
    assert.ok(!bytes.includes(Buffer.from("Synthetic answer")));
  }
  const verified = await verifyEncryptedBackup({ directory: outputDirectory, id: created.manifest.id, identity, toolsDirectory: options.toolsDirectory,
    afterRestore: async (database) => assert.deepEqual(await dataSnapshot(database.admin), snapshot),
  });
  assert.equal(verified.verified, true);
  assert.ok(verified.isolationChecks > 0);
  assert.equal((await source.admin.query("SELECT config #>> '{business,name}' AS name FROM app.assistant_configs")).rows[0].name, "After snapshot");

  await assert.rejects(createBackup({ ...options, afterArchive: async () => { throw new Error("synthetic private failure"); } }), BackupError);
  assert.equal((await listBackups(outputDirectory)).length, 1, "failed run never replaces or prunes a valid copy");
  assert.deepEqual((await readdir(outputDirectory)).filter((name) => name.startsWith(".pending-") || name === ".aisistent-backup.lock"), []);
  await writeFile(path.join(outputDirectory, ".aisistent-backup.lock"), "held", { flag: "wx" });
  await assert.rejects(createBackup(options), /locked/);
  await rm(path.join(outputDirectory, ".aisistent-backup.lock"));

  const bad = path.join(root, "wrong.dump");
  await assert.rejects(decryptBackup(path.join(created.directory, "app.dump.age"), bad, await generateIdentity()));
  assert.ok(!(await readdir(root)).includes("wrong.dump"));
  const archive = path.join(created.directory, "app.dump.age");
  await writeFile(archive, (await readFile(archive)).subarray(0, 32));
  assert.equal((await listBackups(outputDirectory)).length, 0, "damaged copies cannot count as healthy or satisfy retention");
  await assert.rejects(verifyEncryptedBackup({ directory: outputDirectory, id: created.manifest.id, identity, toolsDirectory: options.toolsDirectory }), /checksum/);
});

test("backup configuration fails before database access or artifacts for unsafe destinations", async () => {
  const recipient = await identityToRecipient(await generateIdentity());
  const options = { sourceUrl: "postgresql://user:synthetic-password@db.example.test/app", recipient, sourceLabel: "synthetic", retentionDays: 7, minimumCopies: 1,
    outputDirectory: path.resolve(MIGRATIONS_DIR, "backup-output") };
  await assert.rejects(createBackup(options), /CA certificate/);
  await assert.rejects(createBackup({ ...options, sourceUrl: "postgresql://user:synthetic@127.0.0.1/app", retentionDays: 0 }), /retention/);
  await assert.rejects(createBackup({ ...options, sourceUrl: "postgresql://user:synthetic@127.0.0.1/app?sslmode=disable" }), /query parameters/);
});
