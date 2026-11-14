import assert from "node:assert/strict";
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { migrate, migrationChecksums } from "../../lib/db/migrator.ts";
import { MIGRATIONS_DIR, startTestDatabase, type TestDatabase } from "./harness.ts";

// The live database (2026-11-14) holds checksums of CRLF files for most
// migrations and of LF files for 0004 and 0005, because they were applied from
// different checkouts; a Windows checkout with core.autocrlf has CRLF files.

let db: TestDatabase;
let crlfDir: string;

before(async () => {
  db = await startTestDatabase();
  crlfDir = await mkdtemp(path.join(os.tmpdir(), "aisistent-crlf-"));
  for (const name of await readdir(MIGRATIONS_DIR)) {
    const text = (await readFile(path.join(MIGRATIONS_DIR, name), "utf8")).replace(/\r\n/g, "\n");
    await writeFile(path.join(crlfDir, name), text.replace(/\n/g, "\r\n"));
  }
});
after(async () => {
  await db?.stop();
  if (crlfDir) await rm(crlfDir, { recursive: true, force: true });
});

const crlfChecksum = (text: string) => [...migrationChecksums(text).accepted].find((value) => value !== migrationChecksums(text).checksum)!;

test("a migration's checksum ignores line endings but not content", () => {
  const lf = migrationChecksums("SELECT 1;\nSELECT 2;\n");
  const crlf = migrationChecksums("SELECT 1;\r\nSELECT 2;\r\n");
  assert.equal(lf.checksum, crlf.checksum);
  assert.deepEqual([...lf.accepted], [...crlf.accepted]);
  assert.equal(lf.accepted.size, 2);
  assert.notEqual(migrationChecksums("SELECT 1;\nSELECT 3;\n").checksum, lf.checksum);
});

test("a database with checksums from both kinds of checkout accepts a CRLF checkout and an LF one", async () => {
  // Store CRLF checksums for 0001 and 0002, as a Windows checkout did; the rest stay LF.
  for (const version of ["0001_core_tenancy", "0002_auth_sessions"]) {
    const text = await readFile(path.join(MIGRATIONS_DIR, `${version}.sql`), "utf8");
    await db.admin.query("UPDATE public.schema_migrations SET checksum = $1 WHERE version = $2", [crlfChecksum(text), version]);
  }
  assert.deepEqual((await migrate(db.admin, crlfDir)).applied, []);
  assert.deepEqual((await migrate(db.admin, MIGRATIONS_DIR)).applied, []);
});

test("a real change to an applied migration is still refused, and new migrations store the LF checksum", async () => {
  const changedDir = await mkdtemp(path.join(os.tmpdir(), "aisistent-changed-"));
  try {
    await cp(crlfDir, changedDir, { recursive: true });
    const file = path.join(changedDir, "0004_operational_safeguards.sql");
    await writeFile(file, `${await readFile(file, "utf8")}\r\n-- edited\r\n`);
    await assert.rejects(migrate(db.admin, changedDir), /0004_operational_safeguards was changed after it was applied/);

    await cp(crlfDir, changedDir, { recursive: true, force: true });
    await writeFile(path.join(changedDir, "9999_line_ending_probe.sql"), "SELECT 1;\r\n");
    assert.deepEqual((await migrate(db.admin, changedDir)).applied, ["9999_line_ending_probe"]);
    const { rows } = await db.admin.query("SELECT checksum FROM public.schema_migrations WHERE version = '9999_line_ending_probe'");
    assert.equal(rows[0].checksum, migrationChecksums("SELECT 1;\n").checksum);
  } finally {
    await rm(changedDir, { recursive: true, force: true });
    await db.admin.query("DELETE FROM public.schema_migrations WHERE version = '9999_line_ending_probe'");
  }
});
