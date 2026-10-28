# M3 security evidence and risk register

Updated: 2026-10-28 (M3 checkpoint 14). Scope: the Next.js application in `demo/`, PostgreSQL schema `app`, and the local test stack. Nothing is deployed and no provider account exists, so every entry below is **local evidence only**. Requirements come from [security-and-billing.md](../architecture/security-and-billing.md); checkpoint details are in the [handoff verification record](../HANDOFF.md#verification-record).

Status values: **Done locally** (implemented and tested against real PostgreSQL and the real Next.js/Auth0 SDK code paths with a mock identity provider), **Partial**, **Not started**, **Needs provider** (blocked on the hosting/identity decision).

## Requirements and evidence

| Requirement | Status | Evidence | Gap |
| --- | --- | --- | --- |
| Managed identity, verified email | Done locally | Auth0 SDK v4 (`lib/auth/auth0.ts`); organization creation and invitation acceptance require a verified email from the current session (e2e "invitation acceptance requires the current session's verified matching email…") | Real Auth0 tenant, Universal Login, email delivery |
| MFA for owners and privileged changes | Partial | `AUTH_REQUIRE_MFA` gates organization creation, workspace saves, team changes, export, deletion, retention and conversation deletion; read-only views and step-up round trip (checkpoint 7, e2e "workspace step-up link…") | Off until the tenant has an MFA factor; factor recovery and per-action reauthentication (`max_age`) beyond the step-up are untested with a real provider |
| Server-managed sessions, opaque `HttpOnly` cookie | Done locally | Encrypted PostgreSQL session store, SHA-256 id hashes, AES-256-GCM bound to the hash, 12 h inactivity / 3 days absolute (`tests/db/auth-sessions.test.ts`, e2e sign-in/logout/forged cookie) | `Secure` cookie over HTTPS on a deployed host |
| Session revocation | Done locally | Logout deletes the row; back-channel logout by `sid`/`sub`; "Odjavi me sa svih uređaja" ends every session of the user (checkpoint 10, `tests/db/account-sessions.test.ts`, e2e "signing out everywhere…") | Identity-provider sessions on other devices remain (R3) |
| CSRF | Done locally | Next.js Server Action origin check, `SameSite=Lax`, the export GET refuses `Sec-Fetch-Site: cross-site` (e2e) | — |
| Authorization on every operation | Done locally | `withOrganization` re-reads membership and role per request; every Server Action and the export route re-check identity, role and MFA; database functions re-check the caller (`tests/db/team*.test.ts`, `organization-data`, `conversations`, e2e native-form and Server Action tests) | Future features must follow the same pattern |
| Tenant isolation (RLS, exports) | Done locally | RLS on every tenant table including conversations and transcripts; forged organization context returns nothing; the export contains only the owner's organization (`tenancy`, `conversations`, `organization-data` tests; recovery rehearsal re-checks RLS after restore) | Object storage, vectors and jobs do not exist yet |
| Non-bypassing database roles | Done locally | `aisistent_app` is not the owner, has no `BYPASSRLS`, cannot `SET ROLE` to the owner; SECURITY DEFINER functions pin `search_path`; `app.record_conversation` has no grants (`migrate-command`, recovery "fresh application credentials…") | — |
| Removed members lose access | Done locally | Live membership checks; queued requests of demoted/removed owners are refused (`team-concurrency`) | Sessions are intentionally kept for other organizations |
| No secrets or personal data in logs | Partial | Allowlisted JSON events (`lib/operations/logging.ts`, unit tests); the application database password is now sent as a SCRAM-SHA-256 verifier, so statement logging cannot capture it (checkpoint 14) | Hosting/provider log redaction and access (R8) |
| Retention and deletion | Partial | Conversation retention per organization with cleanup; organization deletion; expired sessions, invitations and rate buckets purged by `npm run ops:cleanup` | Cleanup not scheduled (R6); backup retention undecided (R7) |
| Imports | Partial | Knowledge CSV/text import parsed in the browser with size, encoding, binary, length, duplicate and count limits; every save re-validated on the server (checkpoint 9) | URL import with SSRF controls not built |
| Private uploads and files | Not started | — | Needs the storage decision (R15) |
| Browser hardening | Done locally | Per-request nonce CSP without inline scripts or styles in production, `frame-ancestors 'none'`, `object-src 'none'`, HSTS in production, nosniff, referrer and permissions policies (checkpoint 11, unit tests) | Development CSP is looser (R10) |
| Abuse limits | Partial | PostgreSQL rate buckets for `/auth/*`, every POST and per-user action budgets; fails closed with 503 (e2e) | Client IP header trust waits for the ingress (R4) |
| Backup and recovery | Partial | Synthetic logical dump/restore rehearsal: digests, ACLs, RLS, fresh credentials, session/invitation invalidation (`npm run test:recovery`, 6/6 with 8 migrations) | Managed backups, PITR and a deployed restore drill (R7) |
| Incident and rollback procedures | Partial | [Runbook](../operations/RUNBOOK.md) | Not exercised; no alert sink (R8) |
| Independent assessment | Not started | — | After deployment (R12) |

## Risk register

| ID | Risk | Impact | Current mitigation | Next step and owner |
| --- | --- | --- | --- | --- |
| R1 | Hosting and identity are not chosen; nothing is deployed | No production control is verified | All code paths run locally against real PostgreSQL and the real SDK | The user's team decides; then staging deploy |
| R2 | MFA is off (`AUTH_REQUIRE_MFA=false`) | Owners can change data with a password only | Gate, read-only views and step-up are implemented and tested | Enable after the tenant has an MFA factor (user) |
| R3 | "Sign out everywhere" leaves identity-provider sessions | A lost device with a live provider session can sign in again without a password | Application sessions end at once; the page advises a password change | Call the provider's session revocation API after the identity decision (agent) |
| R4 | `RATE_LIMIT_IP_HEADER` unset | All clients share one per-IP budget; a burst can slow sign-in for everyone | Conservative shared bucket; per-user budgets still apply | Configure once the ingress overwrites the header (agent + user) |
| R5 | The web service receives `DATABASE_ADMIN_URL` (Render pre-deploy) | A web compromise could reach owner credentials | Provider-specific; documented | Separate migration job when the platform is chosen (agent) |
| R6 | Cleanup is not scheduled | Expired sessions, invitations and conversations accumulate | Bounded one-shot command exists | Schedule `npm run ops:cleanup` at deploy (agent + user) |
| R7 | Backup retention and recovery objectives are undecided | Deleted data persists in backups; recovery time unknown | Runbook requires reapplying deletions after a restore | Decide retention/RPO/RTO; run a managed restore drill (user + agent) |
| R8 | No alert sink or provider log redaction | Incidents may go unnoticed; platform logs may hold personal data | Application logs are allowlisted | Configure with the platform (user + agent) |
| R9 | CI workflow is not active | Regressions are caught only by local runs | Template with all suites, including recovery | Enable with a token that has the `workflow` scope (user) |
| R10 | Development CSP allows `'unsafe-inline'` styles and `'unsafe-eval'` | Only in `next dev` | Production policy is strict and unit-tested | None needed for production |
| R11 | A leaked database log could contain the app password | Database takeover | Mitigated in checkpoint 14: SCRAM verifier only; password must be at least 32 printable ASCII characters | Keep generated random passwords |
| R12 | No independent security review | Unknown issues remain | Automated tests and internal reviews | Assessment of the deployed staging system (user) |
| R13 | Recovery test tools come from an unsigned EDB zip | Tooling supply chain (tests only) | Official HTTPS source, size and SHA-256 recorded; user approval | Prefer signed packages in CI |
| R14 | Invitation links are copied by hand | Links may travel over insecure channels | Links work only for the invited verified email; 7-day expiry; revocable | Email delivery after a provider is approved (user) |
| R15 | Uploads, URL imports and private storage are not built | Their controls are untested | Features absent; knowledge import is file-only and client-side | Implement with the storage decision (agent) |

Passing these local checks reduces demonstrated risk; it does not establish production security. Update this file when a risk changes status or after deployment.
