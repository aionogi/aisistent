# Encrypted backups and an independent watchdog

Status: implemented and tested with synthetic data. No live backup job, offsite destination, retention policy or alert delivery is activated by this checkpoint. Choose these before real customer data. A passing restore drill deletes its copies; it is not a backup schedule.

## Worker and keys

Run these commands from `demo/` on a trusted, dedicated worker with Node.js 24, `npm ci`, and PostgreSQL 17 `pg_dump` / `pg_restore`. They are plain Node.js commands, not Vercel functions. Set `PG_CLIENT_BIN_DIR` to the tools' absolute directory if they are not on PATH. No web-app environment file is loaded, and the commands never fall back to `DATABASE_URL`, Auth0 credentials or Supabase setup files.

Encryption uses the standard [age file format and its TypeScript implementation](https://github.com/FiloSottile/typage), pinned in the lockfile. Generate an identity once on an offline/trusted recovery computer, in a **new** directory outside the checkout and OneDrive:

```powershell
$env:BACKUP_KEY_DIRECTORY = 'D:\aisistent-recovery-keys'
npm run ops:backup:keys
```

This creates `backup-identity.txt` (secret, for recovery) and `backup-recipient.txt` (public). Existing directories/identities are never overwritten. Keep the secret identity in protected offline storage with a separately controlled recovery copy. Copy only the public recipient to the backup worker. Do not put identities, database credentials, archives or manifests in Git, screenshots or chat. On Unix files/directories are private to their owner; Windows requires an operator-verified private ACL and encrypted disk. Rotating recipients does not let a new identity decrypt old copies: retain old identities until their copies expire.

## Create a backup

Provide configuration through the worker's protected environment/secret store. Values below are names/examples, not production credentials or an approved policy:

| Variable | Meaning |
| --- | --- |
| `BACKUP_DATABASE_URL` | Explicit owner/backup connection with full read access to `app` and `public.schema_migrations`; Supabase session pooler, never the transaction pooler; no query parameters |
| `BACKUP_CA_CERT_FILE` | Absolute path to the database CA PEM; required remotely, with TLS name/certificate verification |
| `BACKUP_DIRECTORY` | Dedicated absolute directory outside the checkout and OneDrive; private writable offsite-backed volume or protected local staging with a separately configured verified offsite transfer |
| `BACKUP_RECIPIENT_FILE` | Absolute regular file containing only the public native `age1…` recipient |
| `BACKUP_SOURCE_LABEL` | Non-personal label, lowercase letters/digits/hyphens, 1–40 characters; one source per directory |
| `BACKUP_RETENTION_DAYS` | Explicit integer 1–3650, chosen with deletion/recovery requirements |
| `BACKUP_MINIMUM_COPIES` | Explicit integer 1–1000, preserved for that source even when older than retention |
| `PG_CLIENT_BIN_DIR` | Optional absolute directory containing PostgreSQL 17 clients |

Run `npm run ops:backup`. It:

1. Checks configuration, tool versions and the destination, then acquires an exclusive directory lock. A source marker prevents mixing different databases under one policy label.
2. Exports a single read-only consistent snapshot and streams two `pg_dump` archives through age encryption: schema `app` and migration history. No plaintext dump is written during creation. Remote connections verify TLS; inherited libpq options and unrelated deployment secrets are excluded from child processes.
3. Requires both exports and encryption streams to finish without tool warnings. Ciphertext is synced; a private manifest records ciphertext sizes/checksums, snapshot time and required NOLOGIN restore-role names. It is published by a same-directory atomic rename only after completion.
4. Checks completed copies and prunes expired ones only after successful publication, preserving the minimum copies for the same source. It verifies hashes, ignores corrupt/incomplete/unknown entries and symlinks, and removes at most 100 expired copies per run. It never recursively deletes a supplied directory. More than the configured minimum may remain when extra passes are needed.

Each successful directory contains exactly `app.dump.age`, `migrations.dump.age`, and `manifest.json`. A safe JSON receipt is printed; failure exits 1 without raw SQL/tool errors, database addresses, file paths or key material. Failed runs do not publish a complete copy or prune earlier ones. A lock left by a machine/process crash requires an operator to verify no worker is active before removing that exact lock; it is never broken automatically. Interrupted `.pending-*` directories are ignored and need operator cleanup, not blind wildcard deletion.

The scope is application data and migration history, not all Supabase services, cluster role passwords or future object files. Row contents and session payloads are inside the encrypted dumps; the manifest has operational metadata only. Keep the entire directory private. age authentication and checksums detect damage, but do not prove the origin of a wholesale replacement created with a public recipient: protect write credentials, enable versioning/immutability at the chosen destination, and retain a separately protected receipt/checksum.

## Schedule and retention activation

Choose a frequency, retention, minimum copies and maximum acceptable age, then configure a protected OS/service scheduler to execute `npm run ops:backup` in `demo/`. The database credentials and public recipient belong on that worker; the decryption identity does not. Neither a scheduler nor an account is created by the repository. The Next.js cleanup cron cannot run PostgreSQL client backups or retain files on Vercel's ephemeral disk.

For example, a **proposed** daily schedule with seven days' retention, two minimum copies and a 26-hour age threshold is a starting point for discussion, not an activated or guaranteed recovery objective. More frequent copies, deletion requests and longer minimum retention must be reconciled with the business's actual policy. A local disk on the app/database computer is not an independent offsite backup. When using a staging directory, verify transfer completion and object hashes before treating it as offsite; configure storage lifecycle/version expiry consistently with the approved retention. This checkpoint has no upload adapter or cloud credentials.

## Missing-run watchdog

On a **separate** scheduler/monitor with read-only access to the completed backup directory, set `BACKUP_DIRECTORY`, `BACKUP_SOURCE_LABEL`, and an explicit integer `BACKUP_MAX_AGE_HOURS` (1–8760), then run:

```sh
npm run ops:backup:check
```

It reads and hashes completed ciphertext files and emits only `healthy`, `reason`, latest snapshot time and age. Exit 0 means a recent intact copy; exit 2 means missing/stale; exit 1 means configuration or I/O failure. An invalid recent copy cannot hide an older stale copy. This check needs no database connection or decryption identity. Route **both nonzero exits and a missing watchdog heartbeat** to the chosen alert destination and verify actual delivery. Running it only at the end of the backup job would not detect a scheduler that never ran. Hashing all retained copies has I/O cost; size the independent worker accordingly.

This is backup availability monitoring, not proof of decryption/recovery, and it does not yet monitor a missed application cleanup cron. Cleanup freshness/alert delivery is the next operational step after backup activation.

## Offline restore verification

On a trusted recovery computer with the matching source checkout and dev dependencies installed, provide the completed `BACKUP_DIRECTORY`, `BACKUP_RUN_ID` (the directory name), `BACKUP_IDENTITY_FILE` (absolute private identity file), and PostgreSQL clients. Run:

```sh
npm run ops:backup:verify
```

It validates ciphertext hashes, fully authenticates/decrypts both archives in a new private system-temporary directory, restores into a disposable PostgreSQL 17 database with random administrator credentials, and reuses the full isolation/migration/session/save rehearsal on that isolated copy. No supplied target URL or public web server exists. It removes temporary plaintext and clusters on completion/failure; abruptly killing the process or machine may still leave recovery files needing protected operator cleanup. Windows ACL/disk protection also applies to those files. Never run an untrusted or replaced dump: PostgreSQL restore executes SQL from its source.

The command verifies the backup can be restored and its schema matches the release. It does not reopen production, send emails, perform real Auth0 sign-in, copy object files or reconcile changes after the backup. Follow [runbook step 6](RUNBOOK.md#managed-environment-drill) and stop writes through cutover before any real recovery. Retain sanitized verification evidence outside the backup worker and periodically repeat it. A stored age key and a successful export alone are insufficient.

## Activation checklist

- [ ] Approve offsite destination, region, access ownership and storage/worker costs.
- [ ] Protect the private recovery identity separately and prove it decrypts a copy.
- [ ] Set frequency, retention, minimum copies and RPO/RTO; verify storage/version deletion rules.
- [ ] Configure the worker's least-privilege read identity, verified CA, public recipient and private destination.
- [ ] Execute and verify a real backup, separately verify transfer/offsite availability and an offline restore.
- [ ] Activate independent scheduling/watchdog alerts; simulate a stale/missing copy and confirm alert delivery.
- [ ] Record actual timestamps, release, checksums and limitations in `docs/HANDOFF.md` before claiming backup coverage.
