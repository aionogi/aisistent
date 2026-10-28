# M3 operations runbook

Status: implemented local safeguards and a passing synthetic logical restore rehearsal. No production deployment, scheduler, alert destination, managed backup or deployed restore drill has been configured. Hosting and identity remain provisional. This document is an executable checklist for the eventual staging operator, not evidence of production readiness.

## Vercel and Supabase setup

The platform decision (2026-10-28) is Vercel for the app and Supabase PostgreSQL in Frankfurt as the database. The repository contains the configuration (`demo/vercel.json`: functions in `fra1`, a daily cleanup cron); the user opens the accounts and enters every secret. Never paste secrets into chat, commits or screenshots.

### Supabase project

1. Region **Central EU (Frankfurt)**, Data API **off**, "Automatically expose new tables" **off**, automatic RLS **off** (the migrations enable RLS themselves), Postgres (not OrioleDB). Under Database settings turn on **Enforce SSL**.
2. Download the project's **CA certificate** (Database settings, SSL configuration). Its PEM text is `DATABASE_CA_CERT`. With it every connection uses TLS and verifies the server; TLS options in a connection URL are ignored, so they cannot weaken this.
3. From the **Connect** dialog copy two connection strings into a password manager:
   - **Session pooler** (port 5432, user `postgres.<project-ref>`): `DATABASE_ADMIN_URL`, for migrations only. The migrator needs a session (advisory lock, `CREATE ROLE`), so do not use the transaction pooler for it. URL-encode special characters in the password.
   - **Transaction pooler** (port 6543): the app's `DATABASE_URL`, after replacing the user `postgres.<project-ref>` with **`aisistent_app.<project-ref>`** and the password with `DATABASE_APP_PASSWORD`. The project ref suffix is required on the shared pooler; without it Supabase answers "Tenant or user not found".
4. Generate `DATABASE_APP_PASSWORD` (32+ printable ASCII characters, no spaces), for example: `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Generate `RATE_LIMIT_SECRET`, `CRON_SECRET` and `AUTH0_SECRET` the same way, each separately.

### Migrations (from a trusted computer, never in the Vercel build)

PowerShell, from `demo/` in an up-to-date checkout:

```powershell
$env:DATABASE_ADMIN_URL = "<session pooler URL>"
$env:DATABASE_APP_PASSWORD = "<generated app password>"
$env:DATABASE_CA_CERT = Get-Content -Raw "<path to the downloaded CA certificate>"
npm run db:migrate
```

Expected output: the applied migrations and "Application database login is up to date." Then close the terminal so the owner URL does not stay in its environment. Rerun the same command before deploying any commit that adds a migration. The command also sets `statement_timeout = 10s` and `idle_in_transaction_session_timeout = 30s` on `aisistent_app`; they are role settings because the transaction pooler drops connection options.

### Vercel project

Import the GitHub repository with **Root Directory `demo`** (Next.js preset, default build and install commands), Node.js 24. Set these variables for the **Production** environment only; preview deployments have other addresses and stay demo-only without them:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Transaction pooler URL with `aisistent_app.<project-ref>` and the app password |
| `DATABASE_CA_CERT` | The Supabase CA certificate (PEM text) |
| `DATABASE_POOL_MAX` | `3` (each function instance has its own pool; Supavisor shares the database connections) |
| `RATE_LIMIT_SECRET` | Generated, 32+ characters |
| `RATE_LIMIT_IP_HEADER` | `x-forwarded-for` (Vercel overwrites it with the client address to prevent spoofing; a value that is not a single address falls back to the shared budget) |
| `CRON_SECRET` | Generated, 32+ characters; Vercel sends it to the cleanup route |
| `APP_BASE_URL` | `https://<project>.vercel.app` (the production address, no trailing slash) |
| `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET` | From the Auth0 application |
| `AUTH0_SECRET` | Generated, 32+ characters |
| `AUTH_REQUIRE_MFA` | `false` until the tenant has an MFA factor |

Never set `DATABASE_ADMIN_URL` or `DATABASE_APP_PASSWORD` in Vercel. After saving the variables, **redeploy** (variables apply to new deployments only). In the Auth0 application add `https://<project>.vercel.app/auth/callback` (callback) and `https://<project>.vercel.app/` (logout).

### Checks after the deploy

1. `/api/health/` returns `{"status":"ok"}`; `/account/` shows "Prijava".
2. Sign up, confirm the email, create an organization, add a knowledge entry, reload: it is still there.
3. Vercel → Settings → Cron Jobs → run `/api/cron/cleanup/` once; the logs show `{"event":"operations.cleanup","result":"success",…}`. Without `CRON_SECRET` the route answers 503, with a wrong one 401.
4. Supabase → Database → roles: `aisistent_app` exists, is not a superuser and has no BYPASSRLS.

## Release and configuration

`npm run db:migrate` sets the `aisistent_app` password as a SCRAM-SHA-256 verifier, so statement logs never contain it. `DATABASE_APP_PASSWORD` must be at least 32 printable ASCII characters without spaces (a generated random value). The current risk register is [m3-evidence.md](../security/m3-evidence.md).

Use Node.js 24 and PostgreSQL 17. Run from `demo/`: `npm ci`, `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run build`. Stop this project's development server before the HTTP suite; it starts its own disposable database, mock identity provider and Next server. Tests use example identities only.

Before staging receives traffic:

1. Record the release commit and a verified database backup. Apply migrations with `npm run db:migrate` using a separate migration identity where possible. Migrations are ordered, checksum checked and transactional. Never edit an already applied SQL file.
2. Supply a restricted `DATABASE_URL` for `aisistent_app` to the web service, never the owner URL (on Vercel and Supabase: see "Vercel and Supabase setup" above). `appConnectionString` can still derive the URL from `DATABASE_ADMIN_URL` and `DATABASE_APP_PASSWORD` for hosts that need it, but that puts the owner credential into the web process; do not use it on Vercel.
3. Set `RATE_LIMIT_SECRET` to an independently generated random secret of at least 32 characters, identical across all replicas. Keep it in the deployment secret store, separate from `AUTH0_SECRET`. Missing/short secrets or an unavailable limiter return 503 for protected requests. Do not disable this behavior to resolve an incident.
4. Leave `RATE_LIMIT_IP_HEADER` unset until the selected ingress is verified to **overwrite** that header with a single canonical IP and direct access to the origin is blocked. On Vercel use `x-forwarded-for`, which Vercel documents as overwritten to prevent spoofing; keep Cloudflare in DNS-only mode so no second proxy changes it. The implementation does not trust `X-Forwarded-For` by default or parse chains. Missing/invalid addresses use one shared `unknown-client` budget. This protects against spoofing but can throttle unrelated visitors, so ingress verification is a staging gate.
5. Configure the identity callback/logout addresses and require privileged-account MFA before real data. `AUTH_REQUIRE_MFA=true` gates organization creation, team changes and workspace writes. Check fresh MFA and non-MFA sessions against actual HTTP operations.
6. Configure cleanup and alerts below. Confirm `/api/health/` responds, then test sign-in, organization save, invite/accept, role change and removed-member denial. Health is liveness only; it does not prove database or identity availability.

No new provider account, paid service or public deployment is authorized by this runbook. The existing private Sites preview still shows M1; this application now requires a Node.js server and must not be republished as a static export.

## Request limits

The PostgreSQL limiter atomically admits a bounded number of requests per fixed window across all replicas. A window begins with its first request. Rejected requests do not extend it. The database stores only an HMAC digest, counter and expiry; neither raw IP addresses nor user identifiers are stored in these rows. Digests are pseudonymous operational data, not guaranteed anonymous data.

| Scope | Budget | Identity |
| --- | --- | --- |
| Login | 30 / minute | Ingress IP or shared fallback |
| Callback | 60 / minute | Ingress IP or shared fallback |
| Logout and back-channel logout | 120 / minute | Ingress IP or shared fallback |
| Other `/auth/*` paths | 60 / minute | Ingress IP or shared fallback |
| Every page POST, including native forms | 180 / minute | Ingress IP or shared fallback |
| Organization creation | 5 / hour | Verified server-resolved account |
| Workspace saves | 90 / minute | Verified server-resolved account |
| Team changes | 30 / minute | Verified server-resolved account |
| Invitation acceptance | 20 / minute | Verified server-resolved account |
| Organization export | 10 / hour | Verified server-resolved account |
| Organization deletion | 10 / hour | Verified server-resolved account |
| Sign-out on all devices | 10 / hour | Verified server-resolved account |
| Knowledge import from a web page | 20 / hour | Verified server-resolved account |

User budgets span organizations and sessions. Callbacks and logout have separate budgets so a login burst does not consume their quota. Proxy rejection returns 429 and `Retry-After`, `Cache-Control: no-store`, and a server-generated `x-request-id`. Limiter failures return 503 with a 30-second retry instruction. Action-level rejections use the existing Serbian form/save error UI; they perform no write. Unsaved editor changes remain in browser memory; after waiting, editing again triggers another save.

URL knowledge imports make outbound GET requests from the web service: standard ports only, public addresses only (checked when connecting), at most 10 s and 2 MB per import, no cookies or credentials, and the address is never logged. When hosting is chosen, allow outbound 80/443 and block private ranges and metadata addresses at the network level as a second layer (risk R16). A spike of `knowledge.import` outcomes `denied` can mean someone is probing internal addresses; check the request IDs and the user's activity.

These are staging defaults, not measured production capacity. Set ingress connection/body limits and DDoS controls when hosting is chosen: a database limiter alone cannot protect network or connection saturation. Unauthenticated GET pages and `/api/health/` are not globally throttled. Future APIs, downloads, uploads and integrations need their own budgets. Observe legitimate shared-IP usage before tuning limits in `lib/operations/rate-limits.ts`.

## Cleanup job

On Vercel, `demo/vercel.json` calls `/api/cron/cleanup/` daily at 03:15 UTC (Hobby runs cron jobs at most once a day, within the hour). The route runs only with `Authorization: Bearer <CRON_SECRET>` (Vercel adds it when `CRON_SECRET` is set; 503 without a configured secret, 401 otherwise) and returns counts only. Daily is enough at the current scale: expired sessions and invitations are already refused when read; cleanup only removes them. Move to a shorter interval with a paid plan if tables grow.

Elsewhere, run `npm run ops:cleanup` from `demo/` with **only the restricted `DATABASE_URL`** (plus `DATABASE_CA_CERT` for Supabase). Both paths use `lib/operations/cleanup.ts`, which refuses an owner, superuser, BYPASSRLS or owner-role-member connection. A cron entry on a Node host could be:

```cron
*/15 * * * * cd /srv/aisistent/demo && npm run ops:cleanup
```

Inject the connection secret through the scheduler's secret store, never the cron line. This schedule is a proposed staging default and **has not been activated**.

Each pass removes at most 500 expired sessions, 500 expired invitations and 500 expired rate buckets; a run stops after at most 20 passes. Accepted/revoked invitation rows are retained until their original expiry. Member access and audit records remain. Expired or purged links cannot be accepted; a purged link shows “not found” rather than “expired”. There is no general customer-data or audit-retention policy yet.

The command prints count-only `operations.cleanup` JSON and exits nonzero on failure. `reachedPassLimit=true` means another run may be needed. Locked rows are skipped and picked up on later runs; a low count alone does not prove an empty backlog. Parallel runs safely skip each other's locked rows. Failed statements roll back their transaction; rerunning is safe. Sign-in no longer performs random cleanup.

## Logs and alerts

Application operational events use an allowlist: timestamp, severity, fixed event/operation, success/denied/error, generated request ID and bounded retry time. They never serialize arbitrary exception messages, SQL parameters, tokens, cookies, invitation links, emails, workspace contents or raw IPs. Team audit records are separate, access-controlled business records and still contain actor/target references.

Relevant events: `request.blocked`, `rate_limit.unavailable`, `action.completed`, `action.failed`, `auth.callback_failed`, `database.idle_error`, and the count-only cleanup result. SDK, Next development output, reverse-proxy access logs and database statement logs are outside this serializer. Configure those sinks to redact query strings, auth callbacks, cookies and `/invite/<token>/` paths. Keep SQL statement/parameter logging off around credentials and session payloads. Do not send debug logs to an external service without reviewing that service and its retention/access controls. These exclusions follow [OWASP logging guidance](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).

Before staging, name a primary and backup operator and configure a restricted log sink and alert destination. Suggested initial alerts, to be tuned with real staging data:

- Any repeated `rate_limit.unavailable`, idle database error, or failed cleanup: investigate immediately.
- No successful cleanup for 45 minutes: check scheduler, network and database access.
- `reachedPassLimit` on two consecutive runs: inspect expiry backlog and scheduler frequency.
- Repeated action/callback failures or a sudden sustained increase in 429s: distinguish misconfiguration, legitimate shared-IP traffic and abuse before changing budgets.

Verify alerts reach an operator. Record the test timestamp and recipient in the release evidence; no alert-delivery test has yet been performed.

## Backups and isolated restore drill

Choose and record recovery point/time objectives, backup frequency, retention, encryption and access ownership before real data. Managed point-in-time recovery and an independently accessible encrypted backup are deployment decisions still pending. A database backup does not include future object-storage files.

### Repeatable local rehearsal

From `demo/`, run `npm run test:recovery`. It uses two disposable PostgreSQL 17 clusters, a generated synthetic dataset and a temporary custom-format archive. It accepts no source/target connection arguments and does not read application database URLs or `.env` files. The archive and clusters are removed by test teardown, including after assertion failures. Abruptly terminating Node or the machine can leave temporary files; this is never a production backup command.

Prerequisite: install PostgreSQL **17** client tools (`pg_dump` and `pg_restore`). The existing `embedded-postgres` dependency supplies the server, but its Windows package does not include these tools. Put them on `PATH`, or set `PG_CLIENT_BIN_DIR` to the absolute directory containing both tools; `PG_BIN_DIR` is also supported when a complete PostgreSQL installation is used. Missing/wrong-major tools fail explicitly rather than skipping the test. Do not commit executables or archives. Official [Windows packages](https://www.postgresql.org/download/windows/) include the EDB portable archive; there is no automatic download in the test. Only its `pgsql/bin` folder is needed. The PostgreSQL executables in that zip are not Authenticode-signed (only StackBuilder is), so check that the download came from `get.enterprisedb.com` over HTTPS with the expected size, record its SHA-256, and get the owner's approval; the signed EDB installer is the alternative where installing software is acceptable.

PowerShell example with a locally installed client directory:

```powershell
$env:PG_CLIENT_BIN_DIR = 'C:\Program Files\PostgreSQL\17\bin'
npm run test:recovery
```

The rehearsal runs the real `pg_dump --format=custom` / `pg_restore --no-owner --exit-on-error --single-transaction` tools as a non-superuser owner, preserving ACLs. It creates fresh runtime/login roles on the empty target, with a different application password. The assertions cover:

- Every application table plus migration history: row counts and SHA-256 digests match before cleanup or migrations can repair anything.
- Migration source checksums, ownership, effective ACLs (including PostgreSQL's equivalent default ACL representation), RLS policies, function definitions, constraints and indexes survive restoration.
- The old database password fails; the app role cannot assume ownership, disable RLS, or directly read session/rate-limit storage. Missing context, forged organization context and pre-snapshot removed membership cannot access tenant data.
- A session and invitation revoked **after** the snapshot are initially live again in the raw restore. Explicit deletion of restored sessions/invitations prevents reuse, including with the old session encryption key. Expiry cleanup alone would not do this.
- Fresh session storage, configuration/knowledge saves and audit-sequence advancement work after recovery. Full OIDC sign-in on the restored target is a separate staging check.

The test prints only versions, snapshot time, archive checksum, table counts and elapsed times. It intentionally demonstrates that a post-snapshot configuration edit is lost. This small local dataset does not establish production recovery time/point objectives, backup encryption/retention, provider PITR, cross-platform portability or object-file recovery. See [the verification record](../HANDOFF.md#verification-record) for actual results. It is separate from `npm test`; the inactive [CI template](../ci/README.md) provisions PostgreSQL 17 clients and requires the recovery step when enabled.

### Managed-environment drill

For a PostgreSQL logical backup, use a protected PostgreSQL service/passfile configuration for a backup identity with access to the full database. Never place passwords in commands, chat or committed files. Example commands using configured service names:

```sh
pg_dump --dbname=service=aisistent_backup --format=custom --file=aisistent-backup.dump
pg_restore --list aisistent-backup.dump
```

Encrypt the artifact, verify its checksum and restrict access; do not put dumps in this repository. A successful dump/list is not a recovery test. PostgreSQL documents the ownership/role prerequisites and consistent-snapshot behavior in its [backup guide](https://www.postgresql.org/docs/17/backup-dump.html).

For each drill:

1. Create a separate empty PostgreSQL 17 restore target with no production traffic or outbound integrations. Never restore over the running database. Record backup ID, snapshot time, target and start time.
2. Prepare the non-superuser migration owner, `aisistent_runtime` NOLOGIN role and restricted `aisistent_app` login with a **new** password. Restore roles/privileges intentionally; do not use `--no-acl` and accidentally remove access controls. Do not expose the original production passwords to the drill.
3. Restore into that empty target as its migration owner:

   ```sh
   pg_restore --dbname=service=aisistent_restore --no-owner --exit-on-error --single-transaction aisistent-backup.dump
   ```

4. Check `schema_migrations` checksums against the matching source release before applying later migrations. Verify tables, indexes, functions, RLS policies and grants. `aisistent_app` must be non-owner and unable to bypass RLS or assume the owner role.
5. Remove restored login sessions and invitations in the isolated target before enabling traffic, and generate fresh application/identity secrets. Restoring old sessions could revive a session revoked after the backup. Use test identities and synthetic organization records for the drill.
6. Reconcile membership removals, role changes and identity revocations made **after** the snapshot against an authoritative source outside that backup before reopening traffic. Session/invitation invalidation does not reconcile restored membership rights. Then connect a separate test app to the restored target. Verify two organizations cannot cross-read/write, removed members remain denied, configuration and knowledge agree with the snapshot, and fresh sign-in plus save works. Record row counts/checksums without copying customer content into logs. Also reapply organization deletions and departures made after the snapshot: `organization.delete` events (no organization, target = the deleted id) and `member.leave` events in the live database, if it is still readable, or in another authoritative record. A restore must not bring a deleted organization back.
7. Once files exist, separately restore an object snapshot and reconcile authorized object references and actual file bytes. This is not implemented yet.
8. Record finish time, observed data loss, recovery duration, failures and accountable owner. Destroy the isolated environment through the approved provider procedure after retaining sanitized evidence. Only then mark the drill passed.

## Organization data requests

Conversations are kept for each organization's retention period (owners choose 30, 90, 180 or 365 days on the Firma page; default 90) and removed by `npm run ops:cleanup` (reported as `conversations`). Until the cleanup job is scheduled, nothing removes them automatically.

Owners export an organization from **Firma → Preuzmi podatke (JSON)** (`/org/<id>/export/`; MFA when required; 10 per hour per user) and delete it on the same page by repeating its name (10 per hour). Members leave there too; the last owner cannot. Deletion removes the organization's rows and activity log at once and keeps one `organization.delete` audit event (actor, time, deleted id). Copies remain in database backups until they expire. No backup retention period has been chosen yet, so do not promise a deletion deadline that includes backups. After any restore, reapply deletions recorded after the snapshot (managed drill, step 6).

## Incident and rollback

1. Record incident time, release SHA, affected fixed operation and request IDs. Preserve restricted logs and a backup without collecting cookies, tokens or personal data into chat.
2. Contain: stop deploys, restrict ingress or place the service into maintenance at the hosting layer. For suspected credential compromise, disable affected identity access and rotate credentials through the provider; revoke application sessions as well. Users can end all of their own application sessions from **Nalog → Prijave na uređajima → Odjavi me sa svih uređaja**; this records an `auth.sessions_end` audit event but does not end identity-provider sessions on other devices. Keep callback/logout availability in mind when tightening request limits.
3. Triage 503s by checking database connectivity, migration state and `RATE_LIMIT_SECRET` presence/length without printing values. For 429s, check shared-IP fallback and ingress configuration. Do not accept user-supplied IP headers as a quick fix.
4. Roll back application code to the last verified compatible immutable commit. Migrations are forward-only; do not delete `schema_migrations` entries, alter old migration files or run destructive down scripts. If the old app is not compatible with the current schema, use a reviewed forward fix or restore into a separate database with an explicitly approved cutover and data-loss assessment.
5. For data compromise, coordinate with the responsible business/legal owner on notifications and retention. This runbook does not define legal deadlines.
6. Recheck sign-in, role/MFA enforcement, cross-tenant isolation, saves, cleanup, alerts and security headers before reopening traffic. Record root cause, fix SHA, timeline, impact and follow-up tests.

Rotating `RATE_LIMIT_SECRET` resets effective budgets until old digests expire; coordinate all replicas. Rotating `AUTH0_SECRET` invalidates cookies and encrypted stored sessions; plan forced reauthentication. Rotating the database password requires updating every web/cleanup connection and testing new connections before retiring the old credential. Never log old/new secret values.
