# Development handoff

Updated: 2026-10-28.

## Current objective

**Open decision:** the platform choice (Render + Auth0 + R2) is provisional; the user wants to revisit it before opening accounts. See "What depends on the provider choice" in [m3-platform-options.md](architecture/m3-platform-options.md).

M1 and M2 are implemented. The user wants milestone-based progress in [aionogi/aisistent](https://github.com/aionogi/aisistent) so Claude or another AI agent can continue from GitHub. M3 (persistent platform and production security) is in progress. On 2026-10-21 the user chose combination A from [m3-platform-options.md](architecture/m3-platform-options.md): Render in Frankfurt for hosting and Postgres, Auth0 with an EU tenant for identity, and Cloudflare R2 with EU jurisdiction for private files.

M3 checkpoint 1 adds the Node.js deployment configuration and the database tenancy foundation with tested row-level security. Nothing is deployed yet: the user must first open the provider accounts (see "Provider setup" below). M3 checkpoint 2 adds Auth0 sign-in with server-side sessions stored encrypted in PostgreSQL, user provisioning at sign-in, and an account page where a verified user creates an organization. It is tested end to end against a local mock identity provider.

M3 checkpoint 3 connects the M2 workspace screens to organization data: `/org/<id>/` reuses the same onboarding and workspace components, loads the configuration and knowledge from PostgreSQL for verified members, and saves edits automatically through a Server Action with optimistic revisions. The demo at `/workspace/` is unchanged.

M3 checkpoint 4 adds team management: owners invite people by link, change roles, and remove members; owners and admins read the organization's activity log.

M3 checkpoint 5 reviews Claude's `ec549e3`, fixes confirmed authorization/concurrency defects, and adds provider-neutral operational safeguards. M3 remains incomplete; there is no deployed production environment, active cleanup schedule, configured alert sink, managed restore-drill evidence, or approved hosting choice. See [operations/RUNBOOK.md](operations/RUNBOOK.md).

**Current checkpoint 6 (2026-10-22):** `npm run test:recovery` now performs a real logical backup/restore using synthetic data in two disposable local PostgreSQL clusters. It checks data/migration digests, security definitions, fresh database credentials, RLS and restored-session/invitation invalidation, followed by new session storage and saves. This completes the previously listed provider-independent recovery task. It does not prove managed backups, deployed recovery, full restored-target OIDC sign-in or production recovery objectives. The next steps are the outstanding notice browser check and the provider/deployment gates below.

**Current checkpoint 11 (2026-10-28):** the production Content-Security-Policy no longer allows inline styles. Fixed bar heights moved into CSS, the two dynamic progress bars set their width through the CSSOM, and Serbian 404 and error pages replace Next.js's defaults, which relied on inline styles. Development keeps `'unsafe-inline'` for styles and `'unsafe-eval'` for scripts, which the Next.js dev overlay and hot reloading need. See the verification record below.

**Checkpoint 10 (2026-10-28):** the account page lists the signed-in user's active sign-ins (times only) and offers "Odjavi me sa svih uređaja", which ends every application session of that user immediately and then signs this browser out at the identity provider. Sessions at the provider on other devices are not ended; that needs the provider's management API after the identity decision. See the verification record below.

**Checkpoint 9 (2026-10-27):** owners and admins import knowledge from a CSV or text file. The file is read in the browser only; a preview lists what will be added and which rows are skipped and why, and accepted entries join the draft and are saved through the existing, server-validated workspace save. Works in the demo workspace too. See the verification record below.

**Checkpoint 8 (2026-10-27):** organization data rights, built and tested locally without provider accounts. A new **Firma** page lets owners download everything the organization holds as JSON and permanently delete the organization by repeating its name; every member can leave, except the last owner. Migration `0006_organization_data.sql` adds the database functions under the existing lock order. See the verification record below.

**Checkpoint 7 (2026-10-27):** the outstanding browser check of the non-MFA owner notice is done, and it found three real defects, now fixed: read-only sessions (members, and owners/admins without MFA) saw assistant forms that silently ignored typing; owners without MFA saw team controls whose every action failed; and the MFA step-up link had never completed a sign-in locally because the mock provider omitted `auth_time`, which `max_age=0` requires. Step-up now returns to the organization and is covered end to end. See the verification record below. Next work needs the provider decision (see "Next agent's first steps").

Small follow-up: the inactive CI template now includes PostgreSQL 17 client installation and a required recovery-test step on `ubuntu-24.04`. See [CI setup](ci/README.md). Activating the workflow and obtaining a passing GitHub run are still pending.

Earlier checkpoint 5: [`9e813b3`](https://github.com/aionogi/aisistent/commit/9e813b3685413b4ce72558ab442c1876693b535c), pushed to `main`. Subsequent startup-documentation cleanup and invitation HTTP authorization coverage are recorded below. Checkpoint 6 supersedes the earlier next-task recommendation; use the current next-agent steps.

The earlier uncommitted local M2 draft was preserved in a local Git stash named `preserve pre-Claude local M2 draft before ec549e3 sync` before fast-forwarding to Claude's work. It is obsolete relative to the shipped M2 implementation; do not apply it to current `main`. It is not part of the GitHub handoff.

- M1 tag: [`milestone-1-interactive-demo`](https://github.com/aionogi/aisistent/tree/milestone-1-interactive-demo) at `0517b631fc31d7b579cc089a40eb9d404f70e72f`.
- M2 tag: [`milestone-2-app-shell`](https://github.com/aionogi/aisistent/tree/milestone-2-app-shell) at `479188b983699114e0393875592292f109273dbe`, pushed on 2026-10-21 together with `main`. The implementation commit is `fbd4ae8`.
- Private demo: [aisistent](https://aisistent-demo.cheery-pin-9983.chatgpt.site), owner-only access. It was published from M1 and has **not** been republished with M2; the M2 screens are available by running the source locally.
- Continue from current `main`.

The user explicitly deferred production security implementation, pricing, and monthly recurring billing until after the demo. Strong security remains a requirement before real customer data and paid use. The merchant company is based in Serbia.

## What exists

- A Next.js 16 App Router application in `demo/`, with React 19, TypeScript, Lucide icons, and self-hosted Manrope.
- **Landing page (M1)** at `/`: Serbian marketing page, four scripted industry conversations with playback controls, example dashboard preview, FAQ, mobile navigation. M2 added links to the workspace and onboarding. A channels strip between the workflow steps and the conversation demo (`components/AssistantChannels.tsx`) offers "Započnite podešavanje" and "Pogledajte demo"; the phone assistant card links to the simulation, while WhatsApp, e-mail, and website chatbot are marked "Uskoro" because they are not built.
- **Guided onboarding (M2)** at `/onboarding/`: five steps (`industry`, `business`, `hours`, `assistant`, `review`), each a static route generated from `[step]`. `/onboarding/` resumes at the first incomplete step.
  - Industry choice fills an example template (salon, clinic, auto service, restaurant, or an empty "other"). While the draft is still an unedited template, switching industry replaces it silently; after edits, an inline confirmation asks whether to replace or keep the user's details.
  - Business details with up to eight services, working hours per day with "copy Monday to weekdays", and assistant behavior (name, tone, greeting with a tone-based suggestion, booking on/off, handoff topics, unknown-answer rule).
  - Review shows the full configuration with per-section status and edit links, next to a rule-based reply preview.
  - Steps unlock in order. Blocked "next" reveals inline errors and an error summary whose links focus the affected field.
- **Workspace shell (M2)** at `/workspace/` with sidebar navigation (horizontal tab row below 860 px):
  - Overview: setup checklist and "load complete example" before onboarding is finished; afterwards status cards, recent example conversations, and the greeting.
  - Conversations: five example conversations assembled from the draft (services, hours, knowledge, handoff and unknown-answer rules), with search, status filters, detail and transcript.
  - Assistant: tabbed editor (business, hours, behavior, review) reusing the onboarding forms, with live validation, problem counts per tab, and the reply preview.
  - Knowledge: add, edit, delete (with confirmation), search, and restore industry examples.
  - Reset: "Obriši nacrt" clears the draft after a native modal confirmation.
- **M3 foundation:**
  - Node.js server deployment (`next start`) instead of static export; `render.yaml` defines a Frankfurt staging web service and a PostgreSQL 17 database with no external access.
  - `proxy.ts` sets a per-request nonce Content-Security-Policy built by `lib/security/content-security-policy.ts` (production: `style-src 'self' 'nonce-…'`, no inline style attributes, no `'unsafe-eval'`; checkpoint 11); `next.config.ts` adds static security headers (HSTS in production, nosniff, frame denial, referrer and permissions policies). Pages render dynamically so scripts carry the nonce.
  - `/api/health/` liveness endpoint for Render.
  - Database schema `app` (users, organizations, memberships, assistant configs, knowledge entries, audit events) with RLS, a NOLOGIN `aisistent_runtime` role, and a restricted `aisistent_app` login that is not a member of the owner role.
  - Tenant-scoped data access (`withUser`, `withOrganization`) with transaction-local context and live membership checks; repositories for configuration (optimistic revisions), knowledge, memberships, and audit events.
  - Migration runner with checksums and an advisory lock; `npm run db:migrate` runs as Render's preDeployCommand.
  - Real PostgreSQL 17 integration tests run through `npm test`; see the latest verification record for the current suite count and coverage.
- **M3 sign-in (checkpoint 2):**
  - `@auth0/nextjs-auth0` v4 mounted from `proxy.ts` (login, callback, logout, back-channel logout); the client-side access-token endpoint is disabled and no refresh tokens are requested.
  - Stateful sessions: the cookie holds only the SDK's encrypted session id; `app.auth_sessions` stores its SHA-256 hash and an AES-256-GCM payload (key derived from `AUTH0_SECRET`, bound to the id hash). 12 h inactivity, 3 days absolute. The runtime role reaches the table only through SECURITY DEFINER functions.
  - Only `sub`, `name`, `email`, `email_verified`, and `amr` are kept in the session. A verified sign-in calls `provisionUser`; `getCurrentAccount()` resolves the user from the session and database on every request.
  - `/account/`: signed-out, not-configured, and signed-in states; membership list; organization creation through a Server Action that rechecks identity, email verification, MFA (when `AUTH_REQUIRE_MFA=true`), and the name on the server. MFA step-up uses Auth0's `acr_values` redirect.
  - `returnTo` is limited to same-origin paths; provider error text is never shown.
  - `npm run dev:local-auth` runs the signed-in app locally with a temporary database and a mock OpenID Connect provider (`oauth2-mock-server`); `npm run test:e2e` drives the full sign-in round trip.
- **Organization workspace (checkpoint 3):**
  - Routes under `app/(platform)/org/[organizationId]/`: overview, conversations, assistant, knowledge, and onboarding with the same components as the demo. The layout verifies the session and membership on the server; unknown ids and non-members get the same 404.
  - `WorkspaceEnvironment` tells shared components whether they run in the demo (`/workspace`, browser-tab draft) or for an organization (`/org/<id>`, server data), and supplies paths, organization name, and role.
  - `OrganizationDraftProvider` implements the same draft context as the demo provider: edits apply immediately and are saved 0.7 s later, one request at a time; new knowledge entries receive server ids from the response; a revision conflict, lost session, or lost permission stops saving and shows a notice; leaving with unsaved changes triggers the browser warning.
  - `saveWorkspaceAction` re-reads the signed-in user, re-parses the draft (`parseDraft`), checks size limits (`checkDraftLimits`), requires owner or admin, and calls `saveWorkspace`, which stores the configuration with a revision check, reconciles knowledge rows by id (foreign ids become new rows), and writes a `workspace.save` audit event.
  - Members (role `member`) see a read-only workspace; onboarding redirects them to the overview.
  - Creating an organization on `/account/` now opens its onboarding; the account page links to each organization.
- Conversations and statistics in the organization workspace are still examples built from the configuration; no calls or messages exist.
- **Team management (checkpoint 4):**
  - Migration `0003_team_management.sql`: `app.invitations` (token stored only as SHA-256; the application cannot read hashes) and SECURITY DEFINER functions that re-check the caller's role: `create_invitation`, `revoke_invitation`, `invitation_preview`, `accept_invitation`, `change_member_role`, `remove_member`, `list_members`, `audit_log`.
  - Invitations: owner only; 7-day links; a new invitation for the same address replaces the open one; existing members cannot be re-invited. Accepting requires the signed-in user's **verified** email to equal the invited address, so a forwarded link is useless to anyone else. Email sending is not connected: the owner copies the link (shown once).
  - Roles: owner (team and everything), admin (configuration and knowledge), member (read only). The last owner cannot be demoted or removed. Checkpoint 5 serializes team mutations on the organization row and rechecks ownership after lock waits, in addition to protecting the last owner.
  - Removal takes effect on the member's next request because every organization request re-checks membership; their sign-in session is not ended, since it may serve other organizations.
  - Pages: `/org/<id>/team/` (members; owners also invite, change roles, remove, and revoke), `/org/<id>/activity/` (owners and admins; last 100 events with actor names), `/invite/<token>/` (sign in, preview, accept). Team changes require MFA when `AUTH_REQUIRE_MFA=true`.
  - Autosave writes at most one `workspace.save` audit entry per person per 15 minutes.
  - `npm run dev:local-auth` accepts `/auth/login?login_hint=<name>@example.test` to sign in as another mock user.
- Production architecture and security requirements in the documents linked below.

- **Operational safeguards and review fixes (checkpoint 5):**
  - Migration `0004_operational_safeguards.sql`: atomic PostgreSQL fixed-window rate buckets with no direct runtime table access, and bounded expiry cleanup. Raw IPs/user IDs are replaced with secret-keyed digests in rate storage.
  - `/auth/*` and page POST requests are limited before the identity SDK; prefetch headers cannot bypass the proxy. Actions additionally limit the server-resolved user across sessions/organizations. Login, callback and logout budgets are separate. Rejections use 429 plus retry headers; missing configuration/database capability fails closed with 503.
  - `RATE_LIMIT_SECRET` is required whenever database-backed operations are enabled. It is generated in the provisional Render template and disposable local test stack. `RATE_LIMIT_IP_HEADER` is deliberately unset until ingress overwrite and origin isolation are verified; an unset/invalid address uses a shared conservative bucket, not untrusted forwarded headers.
  - Allowlisted JSON operational logs replace raw error messages on handled mutation/callback failures. They exclude request content, tokens, cookies, URLs, emails and raw IPs. Framework/provider/access/database logs need separate deployment redaction; see the runbook.
  - `npm run ops:cleanup` is a one-shot, provider-neutral command using the restricted `DATABASE_URL`; it deletes expired sessions, invitations and rate buckets in bounded batches, preserving memberships and audit history. It has no public endpoint. A scheduler is documented but not activated. Random sign-in cleanup was removed, also resolving the observed flaky session-purge test.
  - Migration `0005_team_authorization_lock.sql` fixes two reproduced races: queued mutations by a demoted/removed owner and duplicate active invitations with different roles. Mutations serialize per organization and recheck ownership after waiting; invitation acceptance follows the same lock order. Existing duplicate pending links are reconciled, keeping the newest and auditing older revocations.
  - Workspace saves now enforce the configured MFA policy. A non-MFA privileged session sees a read-only view and step-up link. Invitation acceptance explicitly rechecks current-session email verification as well as the database email match.
- **Read-only views and MFA step-up (checkpoint 7):**
  - Read-only sessions get no inputs that would ignore them: the assistant page shows the configuration summary (`ConfigSummary readOnly`) instead of the tabbed forms; overview links read "Pogledaj"; onboarding links and the sidebar setup card are hidden; the sidebar says "Samo pregled".
  - The team page shows owner controls only when `canChange` (owner, and MFA when `AUTH_REQUIRE_MFA=true`); otherwise roles appear as chips and pending invitations without "Opozovi". The server actions still enforce the same rule.
  - `mfaStepUpPath(returnTo)` in `lib/auth/auth0.ts` builds the step-up link; the organization notice returns to `/org/<id>/` instead of `/account/`.
  - The local mock provider adds `auth_time`, so `max_age=0` step-ups validate as they would with Auth0.
  - On narrow screens, notices with a text link put the link below the message.
- **Organization data (checkpoint 8):**
  - Migration `0006_organization_data.sql`: `app.export_organization()` (owner), `app.leave_organization()` (any member; `last_owner` refused), and `app.delete_organization(confirm_name)` (owner; exact name after trimming). Each takes the organization row lock first and rechecks the role after it, like migration 0005.
  - Export: `GET /org/<id>/export/` returns `aisistent-podaci-firme-<date>.json` (`format: aisistent.organization-export`, `version: 1`) with organization, members (names, emails, roles), invitations (no token hashes), assistant configuration, knowledge, and activity. Owner only, MFA when required, refused when the browser marks the request cross-site, `Cache-Control: no-store`, budget `organization.export` (10 per hour per user), and an `organization.export` audit event.
  - Deletion: Server Action with the native form; owner, MFA when required, budget `organization.delete` (10 per hour). Memberships, configuration, knowledge, and invitations go by cascade; the organization's activity log is deleted too, and one `organization.delete` event without an organization (target = deleted id, actor, time) remains. User accounts are kept.
  - Leaving: Server Action from a confirmation dialog, budget `team.change`, `member.leave` audit event; no MFA needed because it only gives up access.
  - Navigation: "Firma" for every role (`/org/<id>/settings/`). On narrow screens the tab row uses rows of four, or three when six items fill them evenly. `/account/` shows "Napustili ste firmu" or "Firma i njeni podaci su trajno obrisani" afterwards.
- **Knowledge import (checkpoint 9):**
  - `lib/workspace/knowledge-import.ts` (pure, unit-tested): files up to 256 KB; UTF-8 (BOM optional), UTF-16 with BOM (Excel "Unicode text"), otherwise Windows-1250 (Excel's Serbian Latin CSV); files with NUL bytes (xlsx, pdf, images) are refused as binary. CSV follows RFC 4180 (quotes, doubled quotes, line breaks in quotes) with comma, semicolon or tab detected from the first line and an optional `Pitanje;Odgovor` header; a `.txt` file is a table when most lines contain a tab, otherwise question/answer blocks separated by blank lines (`P:`/`O:` and `1.` prefixes are removed).
  - Rows are skipped, never shortened, for a missing question or answer, a question over 120 or answer over 400 characters, a duplicate (case, spacing and final punctuation ignored, against the base and within the file), or the 200-entry limit. Control characters are removed and whitespace collapsed.
  - `components/workspace/KnowledgeImport.tsx`: "Uvezi iz fajla" on the knowledge page and its empty state (hidden for read-only sessions); format help, a Serbian file button (the browser's own button text follows the browser language), summary, first five entries, skipped rows with line numbers and reasons, and "Dodaj N odgovora". Adding re-checks duplicates and the limit against the current draft.
  - Nothing new reaches the server: imported entries are ordinary draft edits, and `saveWorkspaceAction` still re-parses and size-checks every save (`parseDraft`, `checkDraftLimits`) under the database constraints. There is no separate audit event; an import appears as `workspace.save`.
- **Account sessions (checkpoint 10):**
  - Migration `0007_account_sessions.sql`: `app.my_sessions()` (created, last refreshed, and expiry times of the user's unexpired sessions) and `app.end_my_sessions()` (deletes all of the user's session rows, returns the count, and records `auth.sessions_end` with the count and no organization). Both resolve the user from the `withUser` context, never from a subject the caller passes. No device, browser, or location data is collected.
  - `/account/` section "Prijave na uređajima": the list (times in Europe/Belgrade), advice for lost devices and suspected password leaks, and the button. `signOutEverywhereAction` (budget `account.sessions`, 10 per hour, no MFA because it only removes access) ends the sessions; the form then navigates to `/auth/logout`. Other devices are signed out on their next request.

All example business names, conversations, outcomes, and usage metrics are illustrative. There are no verified customer testimonials or security certifications.

## Draft state decision (M2)

One `WorkspaceDraft` object (`demo/lib/workspace/types.ts`) holds the whole example configuration. `DraftProvider` lives in the `app/(product)/layout.tsx` route-group layout, so onboarding and the workspace share it during client navigation.

- Storage: `sessionStorage` key `aisistent.workspace-draft.v1`. The draft survives navigation and reloads in the same tab and disappears when the tab closes. Nothing is sent to a server. The UI states this in the onboarding footer, workspace sidebar, and landing-page link.
- Loading: the draft is read after hydration, so prerendered pages show a loading state first.
- Errors: a stored value with an unexpected shape is discarded and the user sees a notice. If storage is blocked or a write fails, the draft continues in memory and a warning explains that a reload loses it.
- Validation rules live in `demo/lib/workspace/validation.ts` and are shared by onboarding and the workspace. The parser in `storage.ts` accepts only the current shape (`version: 1`); M3 should replace this with server-side validation and persistence rather than extend it.

## Known boundaries

- Conversations are scripted or rule-assembled text. There is no microphone, audio recording, live AI request, or telephony connection. The "reply preview" and example conversations are deterministic templates filled from the draft, not AI output.
- The workspace shows "Telefonska linija: Nije povezana"; no integration exists.
- The public `/workspace/` demo remains open and browser-local. `/org/<id>/` has server-side identity, organization storage and authorization when configured. Pricing, checkout, billing and subscription enforcement do not exist.
- The M1 landing dashboard preview (`DashboardPreview.tsx`) keeps its own fixtures and temporary knowledge editor; it is independent of the M2 draft.
- The app now needs a Node.js server; `npm run build` no longer produces `demo/out/`, so the private Sites static demo cannot be refreshed from this source as before. `demo/.openai/hosting.json` describes that retired static path.
- The metadata requests no indexing. Preview metadata and production indexing need an explicit launch decision later.
- The demo is not evidence that the proposed security architecture has been implemented or audited.

## Start locally

Use Node.js 22.18 or newer (the database scripts and tests run TypeScript directly through Node's type stripping); the current work was developed with Node.js 24. Run from the repository root:

```sh
cd demo
npm ci
npm run dev
```

Local URLs: [http://127.0.0.1:4310](http://127.0.0.1:4310), [/onboarding/](http://127.0.0.1:4310/onboarding/), [/workspace/](http://127.0.0.1:4310/workspace/).

Run validation from `demo/`:

```sh
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run start
```

`npm test` starts a temporary PostgreSQL 17 server from the binaries installed with the `embedded-postgres` dev dependency (no Docker needed), runs the migrations as a Render-like non-superuser owner, and tests tenant isolation through the restricted application login. On Windows the binaries are copied to a short path under the temp folder, because Windows cannot load their DLLs from very long directories. Set `PG_BIN_DIR` to use other PostgreSQL 17 binaries.

The app runs without any database or `.env`; database code activates only when `DATABASE_URL` (local) or `DATABASE_ADMIN_URL` plus `DATABASE_APP_PASSWORD` (Render) are set. `npm run start` serves the production build on `PORT` (default 3000). Use `package-lock.json` through `npm ci` to reproduce the dependency versions.

## Source guide

| Path | Responsibility |
| --- | --- |
| `demo/app/page.tsx` | Landing-page structure, mobile-menu state, links into the workspace |
| `demo/app/globals.css` | Shared tokens and landing design; M2 added status/danger tokens and `.visually-hidden` |
| `demo/app/layout.tsx` | Font, Serbian language, metadata, global styles |
| `demo/app/(product)/layout.tsx` | Route group that mounts the shared `DraftProvider` |
| `demo/app/(product)/onboarding/` | Onboarding frame, resume page, and `[step]` static routes |
| `demo/app/(product)/workspace/` | Workspace shell layout and the four workspace pages |
| `demo/components/Brand.tsx` | Wordmark shared by the landing page, onboarding, and workspace |
| `demo/components/ConversationDemo.tsx` | M1 scripted conversations, playback timer, accessible industry tabs |
| `demo/components/DashboardPreview.tsx` | M1 landing dashboard preview |
| `demo/components/workspace/DraftProvider.tsx` | Draft state, sessionStorage sync, notices, flash messages |
| `demo/components/workspace/sections/` | Industry, business, hours, and assistant forms used in both flows |
| `demo/components/workspace/onboarding/` | Onboarding frame, step component, resume redirect |
| `demo/components/workspace/views/` | Overview, conversations, assistant settings, knowledge pages |
| `demo/components/workspace/*.module.css` | `forms`, `shell`, `pages`, and `onboarding` styles |
| `demo/lib/workspace/` | Types, industry templates, validation, storage, steps, formatting, example conversations |
| `demo/next.config.ts` | Static security headers and routing options |
| `demo/proxy.ts`, `demo/lib/security/content-security-policy.ts` | Per-request nonce Content-Security-Policy |
| `demo/components/ProgressFill.tsx` | Progress bar fill sized through the CSSOM (no inline style attributes) |
| `demo/app/not-found.tsx`, `demo/app/error.tsx`, `demo/app/global-error.tsx` | Serbian 404 and error pages styled with global classes |
| `demo/app/api/health/route.ts` | Liveness endpoint for Render |
| `demo/db/migrations/` | Ordered SQL migrations; never edit an applied file, add a new one |
| `demo/lib/db/config.ts` | Role names and connection-string derivation (restricted runtime vs. owner) |
| `demo/lib/db/context.ts` | `withUser` / `withOrganization` transactions with RLS context |
| `demo/lib/db/repositories.ts` | Tenant-scoped data access |
| `demo/lib/db/migrator.ts`, `demo/scripts/db/migrate.ts` | Migration runner and the deploy command |
| `demo/lib/db/pool.ts` | Shared pool for the application login, or null without a database |
| `demo/tests/db/` | PostgreSQL test harness and integration tests |
| `demo/tests/recovery/` | Separate synthetic logical dump/restore rehearsal; requires PostgreSQL 17 client tools |
| `demo/db/migrations/0002_auth_sessions.sql` | Encrypted session table and its access functions |
| `demo/lib/auth/auth0.ts` | Auth0 client (or null when not configured), hooks, `safeReturnPath`, MFA settings |
| `demo/lib/auth/session-store.ts` | PostgreSQL session store with hashing and AES-256-GCM |
| `demo/lib/auth/account.ts` | `getCurrentAccount()` for Server Components and Actions |
| `demo/app/(platform)/account/` | Account page and the create-organization Server Action |
| `demo/components/account/` | Account styles and the organization form |
| `demo/tests/support/local-auth-stack.ts`, `demo/scripts/dev/local-auth.ts` | Local database + mock identity provider + `next dev` |
| `demo/tests/e2e/login.test.ts` | End-to-end sign-in, session, and logout tests |
| `demo/app/(platform)/org/[organizationId]/` | Organization layout (load + membership check), save Server Action, workspace and onboarding pages |
| `demo/components/workspace/WorkspaceEnvironment.tsx` | Demo vs organization paths, name, and role for shared components |
| `demo/components/workspace/OrganizationDraftProvider.tsx` | Server-backed draft context with debounced, serialized saves |
| `demo/lib/workspace/persistence.ts` | Draft ↔ stored configuration, size limits, save result type |
| `demo/tests/unit/` | Pure-function tests (`npm test` runs these with the database tests) |
| `demo/db/migrations/0003_team_management.sql` | Invitations, roles, removal, member list, audit log view |
| `demo/lib/db/team.ts` | Team operations and `TeamError` codes |
| `demo/app/(platform)/org/[organizationId]/(shell)/team/`, `.../activity/` | Team page with Server Actions; activity log |
| `demo/app/(platform)/invite/[token]/` | Invitation preview and acceptance |
| `demo/components/workspace/team/` | Team view and styles; `OrganizationView` for the Firma page |
| `demo/db/migrations/0006_organization_data.sql` | Organization export, leaving, and deletion functions |
| `demo/app/(platform)/org/[organizationId]/(shell)/settings/` | Firma page with leave and delete Server Actions |
| `demo/app/(platform)/org/[organizationId]/export/route.ts` | JSON export download for owners |
| `demo/lib/workspace/knowledge-import.ts` | Knowledge file decoding and parsing (CSV/text) |
| `demo/components/workspace/KnowledgeImport.tsx` | Knowledge import panel with preview |
| `demo/db/migrations/0007_account_sessions.sql`, `demo/lib/db/sessions.ts` | The user's own session list and sign-out on all devices |
| `demo/components/account/SignOutEverywhereForm.tsx` | Sign-out-everywhere form that finishes at `/auth/logout` |
| `render.yaml` | Render Blueprint for the Frankfurt staging environment |
| `demo/AGENTS.md` | Next.js-generated guidance for the installed version |

Read [PRODUCT.md](../PRODUCT.md) for current requirements, [MILESTONES.md](MILESTONES.md) for acceptance criteria, and [security-and-billing.md](architecture/security-and-billing.md) before adding protected data or payment features. The older [Serbian plan](../ai-asistent-plan.md) contains future proposals; its planned monorepo structure is not the current file tree.

## Verification record

### M3 checkpoint 11 — production CSP without inline styles (2026-10-28)

| Check | Evidence |
| --- | --- |
| TypeScript, build | `npm run typecheck` and `npm run build` passed |
| Unit tests | `npm test`: **98/98** (3 new): the production policy has nonce-only `script-src` and `style-src`, no `'unsafe-inline'` or `'unsafe-eval'`, `frame-ancestors 'none'`, `object-src 'none'` and `upgrade-insecure-requests`; development keeps inline styles and eval; no `.tsx` file under `app/` or `components/` contains a `style` attribute or `dangerouslySetInnerHTML` |
| HTTP tests | `npm run test:e2e`: **18/18** (development server, unchanged) |
| Production server (`next start`, no database or sign-in) | `/`, `/workspace/`, `/workspace/knowledge/`, `/onboarding/`, `/account/` and an unknown path (404) send `style-src 'self' 'nonce-…'`, and their HTML contained no `style="` attribute and no `<style>` element; after the fix below, `/`, `/workspace/`, `/onboarding/business/`, `/account/` and the 404 page also had no stylesheet preload. In the browser: bar heights and animation delays of the hero, small wave, voice lines and conversation waveform equal the previous inline values; the conversation progress bar advanced (39% after 6 s, 100% at the end) with its width set through the CSSOM; the demo setup bar showed 4 of 4 at full width; a `securitypolicyviolation` listener recorded nothing and the console was empty on a fresh tab; the 404 page renders the Serbian card |
| Found and fixed during the check | The first version of `app/error.tsx` imported the account CSS module; as the root error boundary it made Next.js preload that stylesheet on every page (a console warning). The error and 404 pages now use global classes |
| Not verified | The error page and `global-error` were not triggered in the browser; organization and account pages were not loaded under the production policy (they need the sign-in stack, which runs only in development), but they share the checked components and the source test covers them |

### M3 checkpoint 10 — account sessions and sign-out on all devices (2026-10-28)

| Check | Evidence |
| --- | --- |
| TypeScript, build | `npm run typecheck` and `npm run build` passed |
| Database tests | `npm test`: **95/95** (3 new): users list only their own unexpired sessions and only times; without a user context nothing is listed and ending is refused; ending removes all of that user's rows (expired included), leaves another user's session, records `auth.sessions_end` with the count, and is harmless to repeat |
| HTTP tests | `npm run test:e2e`: **18/18** (1 new): two sign-ins of one user and one of another; the account page shows "Aktivnih prijava: 2"; the real Server Action returns `done`; both of the user's devices are signed out on their next request; the other user stays signed in; the audit count is 2 |
| Browser (local stack) | A second device signed in with `curl`, then the browser: "Aktivnih prijava: 2" with Belgrade times. Clicking the button ended both sessions, went through `/auth/logout` and the mock provider to `/`; the `curl` device then got the sign-in page; `/account/` in the browser showed "Prijavite se". After signing in again: "Trenutno ste prijavljeni samo ovde." No horizontal overflow at 390 px |
| Recovery rehearsal | `npm run test:recovery`: **6/6** on 2026-10-28 with all 7 migrations, so it now also covers 0006 (checkpoint 8) and 0007. Tools: EDB `pg_dump`/`pg_restore` 17.11 from the official Windows zip `postgresql-17.11-1-windows-x64-binaries.zip` (get.enterprisedb.com over HTTPS, 340,719,294 bytes, SHA-256 `6eabdf00d2893713b75db4336a23c3fdf505f056e217ec6e2e95d901750cfea3`); only `pgsql/bin` was extracted. The PostgreSQL binaries in that zip carry no Authenticode signature (only StackBuilder does); the user approved using them. Restore 247 ms, whole run 15.3 s, archive SHA-256 `22792877b4d9cc183e231bab8c79ba6d03877c90c693d4b630810d6e0ba6bb38`, 10 tables including 7 migration records. The zip was deleted afterwards; the extracted tools stay outside the repository in `%TEMP%\aisistent-pg17-client\extract\pgsql\bin` |

Limitations: sessions at the identity provider (Auth0 single sign-on) on other devices remain, so such a device can sign in again without a password until that session ends; the list cannot say which entry is this device, because no device data is stored and the current session's id is not exposed by the SDK.

### M3 checkpoint 9 — knowledge import from files (2026-10-27)

| Check | Evidence |
| --- | --- |
| TypeScript, build | `npm run typecheck` and `npm run build` passed |
| Unit tests | `npm test`: **92/92** (9 new parser tests): CSV with header, comma or semicolon, quotes, doubled quotes and line breaks in quotes; no header, blank rows, extra columns, line numbers of skipped rows; tab-separated `.txt` as a table and text blocks with `P:`/`O:` and numbering prefixes; too-long values skipped, not shortened; duplicates against the base and within the file regardless of case, spacing and final punctuation; the overall limit; control characters; UTF-8 with and without BOM, UTF-16 with BOM, Windows-1250; empty, over-256 KB and binary (ZIP/xlsx signature) files refused |
| HTTP tests | `npm run test:e2e`: **17/17**, unchanged. Import runs in the browser; its saves use the existing, HTTP-tested Server Action |
| Browser (local stack, synthetic "Salon Ana" with 3 entries) | Files were supplied to the file input as `File` objects from page scripts, not through the operating system's file dialog. Semicolon CSV: preview of 2 entries, 3 skipped with reasons (an existing question written without "?", an answer over 400 characters, a missing answer); "Dodaj 2 odgovora" shows the status, returns focus to "Uvezi iz fajla", autosave reports "Sačuvano", and a reload shows 5 entries from the server. Windows-1250 CSV: correct č, ć, š, đ, ž plus the encoding note. Text file with `P:`/`O:` and `1.` prefixes: 2 entries. `.xlsx`: "Ovo nije tekstualni fajl". 300 KB: size message. The same CSV again: "Nema novih odgovora za uvoz" and no add button. Real Tab from the panel heading reaches the format help, then the file picker, whose label shows the focus ring. 390 px: no horizontal overflow; long file names wrap. Demo `/workspace/knowledge/`: the empty state offers import; a text file adds 2 entries to the tab's draft in `sessionStorage`. Member Mila: no import button and no file input |
| Not run | `npm run test:recovery` (no PostgreSQL 17 client tools on this machine); this checkpoint changes no database code |

Limitations: no import from a website URL and no `.xlsx` reading (save as CSV first); existing answers are never replaced (duplicates are skipped); imports have no audit event of their own.

### M3 checkpoint 8 — organization export, leaving, and deletion (2026-10-27)

| Check | Evidence |
| --- | --- |
| TypeScript, build | `npm run typecheck` and `npm run build` passed; `/org/[organizationId]/settings` and `/org/[organizationId]/export` render dynamically |
| Database tests | `npm test`: **83/83** (12 new). Export holds the organization's members, invitations, configuration, knowledge, and activity, and none of: token hashes, sign-in subjects, other organizations' data; export is audited; admins, members, and non-members cannot export. Members leave and lose access; the last owner cannot leave until another owner exists; non-members cannot leave. Deletion refuses admins, a wrong or empty name, and non-members; the runtime role cannot delete organizations directly; a successful deletion removes memberships, configuration, knowledge, invitations, and the activity log, keeps one deletion event, keeps user accounts, and leaves other organizations untouched. Concurrency: two owners leaving at once keep one owner; a deletion queued behind the deleting owner's demotion is refused |
| HTTP tests | `npm run test:e2e`: **17/17** (3 new) through the real SDK, proxy, Server Actions, and mock provider. Export: owner download with JSON, attachment name, and `no-store`; cross-site `Sec-Fetch-Site` 403; admin 403; non-member 404; signed out 401; owner without MFA 403; only the successful export audited. Deletion through the native form: wrong name refused, owner without MFA sees no form and is refused when posting it, exact name gives 303 to `/account/?status=organization-deleted`, data gone, organization pages 404. Leaving through the Server Action: last owner refused, member leaves and then gets 404 |
| Browser (local stack, synthetic "Salon Ana") | Owner page at desktop width: export, leave note for the only owner, delete section. Export fetched from the page: 200, attachment name, three members, three knowledge entries (not saved to disk). Delete button stays disabled for "Salon An" and enables for the exact name; the disabled style is grey. Member Mila: "Podatke firme preuzima vlasnik", no delete section; leaving with real Tab/Enter in the dialog lands on `/account/?status=left` without the organization. Admin Marko: no export or delete. At 390 px: seven tabs in rows of four and three, no horizontal overflow; deletion with typed name, Tab, Enter lands on the account page with the confirmation |
| Not run | `npm run test:recovery` (no PostgreSQL 17 client tools on this machine). The rehearsal reads tables and migrations generically, so migration 0006 needs no change there, but it has not been executed with it |

Limitations: deleted data stays in database backups until they expire, and no backup retention period has been chosen (see the runbook). Export is JSON for machines and support, not a re-import format; there is no import. Email notifications to other members about a deletion do not exist.

### M3 checkpoint 7 — read-only views and MFA step-up (2026-10-27)

Checked in the Claude desktop app's built-in browser against `next dev` with a temporary database and the mock provider, seeded with synthetic data ("Salon Ana": owner Ana, admin Marko, member Mila; complete example configuration). MFA on the mock was switched per sign-in.

| Check | Evidence |
| --- | --- |
| Non-MFA owner notice (the open follow-up) | Shown on overview, assistant, and team. Real Tab presses from the page start: skip link, wordmark, six navigation links, "Nalog i firme", then "Dvofaktorska potvrda" (10th stop) with a visible 3px focus ring. At 390 px the link now sits under the message (before: text squeezed into a narrow column); no horizontal overflow |
| Defects found and fixed | (1) Assistant page in read-only mode rendered editable-looking inputs; typing changed nothing. Now a read-only summary. (2) Team page for a non-MFA owner showed role selects, remove buttons, and the invite form; every action returned the MFA error. Now read-only until step-up. (3) Clicking "Dvofaktorska potvrda" ended at `/account/?status=login-failed`: `max_age=0` makes the SDK require `auth_time`, which the mock omitted (Auth0 includes it). Mock fixed; step-up returns to the organization |
| Step-up in the browser | Non-MFA owner → "Dvofaktorska potvrda" → MFA sign-in → `/org/<id>/` with the notice gone, "Uredi odgovore" back, and the team invite form present |
| Member view | Mila: "Samo pregled" notice, assistant summary instead of forms, "Pogledaj odgovore" / "Pogledaj podešavanje asistenta", sidebar "Samo pregled" text, no step-up notice; no overflow at 390 px |
| Tests | `npm run typecheck` and `npm run build` passed. `npm test`: **71/71**. `npm run test:e2e`: **14/14**, including the new "workspace step-up link signs in again with MFA and returns to the organization with editing restored"; with `auth_time` removed from the mock that test fails, so it guards the fix |
| Not run | `npm run test:recovery`: this machine has no PostgreSQL 17 client tools (`pg_dump`). No migration, database function, session, or authorization rule changed, only UI gating and the test mock |

Dev-only observation: right after `next dev` starts (or restarts while a tab from the previous server is open), an organization page can reload in a loop. The server log shows repeated `✓ Compiled in 0ms` and GET lines, with no browser error; reading Next 16.4.2's dev server, the likeliest cause is its Turbopack "HMR hash mismatch" reload when compiling the page bumps the HMR version. It never occurred on `/`. Closing the tab and opening the page again (once needed twice) ended it. `next build`/`next start` are unaffected; no app change is needed.

### CI recovery follow-up (2026-10-22)

Updated `docs/ci/demo-checks.yml.example` to use `ubuntu-24.04`, install only PostgreSQL 17 clients from the official signed repository, select the versioned client directory, and run `npm run test:recovery` before the HTTP suite and build. Template changes now match the push/PR path filters. Static review, installation-block `bash -n` and `git diff --check` passed. No application changes, dependency changes or deployment occurred; application test suites were not rerun. The Ubuntu install and workflow have not executed on GitHub, and workflow-write access is still required for activation.

The separate notice browser check remains open: the browser tool refused access to the local tab under its URL security policy on this attempt. No alternate browser access was attempted and no new visual/keyboard pass is claimed.

### M3 checkpoint 6 — synthetic logical recovery (2026-10-22)

- `npm run test:recovery`: **6/6 passed** (one parent test and five scenario subtests), PostgreSQL 17 disposable servers with EDB `pg_dump`/`pg_restore` **17.11** on Windows. Synthetic archive snapshot: `2026-10-22T08:26:53.027Z`; SHA-256 `53c337adda2a965c2be4945ed6529db62259ea6bbe8e78b76377a49ecc3ce594`. Restore command: **194 ms**; whole test run including teardown: **12.31 s**. These timings are not a production RTO estimate.
- Exact snapshot counts/digests matched for all 10 tables: 2 organizations, 4 users, 2 memberships, 2 configs, 2 knowledge entries, 8 audit events, 1 session, 2 invitations, 1 rate bucket and 5 migration records. Ownership, effective ACLs, RLS policies, function definitions, indexes and constraints matched before migration verification or access cleanup.
- Different application password worked; the source password failed on the target. Owner escalation, direct session/rate-table access, forged cross-tenant access and pre-snapshot removed-member access were denied. A post-snapshot config edit was intentionally absent from the recovered snapshot.
- Sessions/invitations revoked after the snapshot were demonstrably revived by a raw restore, then invalidated by explicit target-only cleanup. Fresh session-store writes and repository saves worked, including the restored audit identity sequence. Session storage is not a full identity-provider sign-in test. Post-snapshot membership/role/identity revocations still require external reconciliation before traffic resumes.
- Existing regressions: `npm test` **71/71 passed**, `npm run test:e2e` **13/13 passed**. No dependencies, production code, migrations or UI changed. Existing installed dependencies were reused; `npm ci` was not repeated for this checkpoint.
- `npm run typecheck`, `npm run build` and `git diff --check` passed after the implementation. The build remains a Node.js application; no deployment or UI/browser acceptance is claimed for this checkpoint.
- Test teardown removed both temporary clusters and the dump. No customer data, provider credentials or deployed service were used. The client tools were obtained from the official EDB portable archive and kept only in ignored local tooling; future agents need their own PostgreSQL 17 clients as described in the runbook. Managed backup encryption/retention, PITR, real recovery targets, object files and the existing small browser notice follow-up remain unverified.

### M3 follow-up — invitation HTTP authorization (2026-10-21)

A new regression calls the real invitation Server Action through HTTP. It rejects anonymous callers, a verified user with the wrong email, and an older unverified session even after another session of the same user verifies the shared database profile. Denied requests leave both membership and invitation acceptance unchanged; the verified matching session then accepts successfully and receives exactly the invited role. All identities and data are synthetic.

Validation: `npm run test:e2e` **13/13 passed** and `npm run typecheck` passed. Only test code and documentation changed; the 71-test unit/database suite and production build were not rerun for this follow-up. M3 remains open and its next implementation task is unchanged.

### M3 checkpoint 5 — review and operational safeguards (2026-10-21)

| Check | Evidence |
| --- | --- |
| Dependency installation | `npm ci` passed from the lockfile; npm reported zero known vulnerabilities at installation time. This is not an independent security audit. |
| Claude baseline | First 51-test run had one flaky purge assertion caused by random sign-in cleanup. The original seven HTTP tests passed. New deterministic expiry fixture and removal of random cleanup resolve that failure. |
| Unit/database regression suite | `npm test`: **71/71 passed** against disposable PostgreSQL 17. Covers atomic admission under concurrency, bounded counters, expiry, ACLs, cleanup batching/locks/preservation, CLI least privilege, redacted errors, team races, upgrade reconciliation and previous tenant/session tests. |
| HTTP integration suite | `npm run test:e2e`: **12/12 passed** through the real SDK, Next proxy/actions and mock identity provider. Includes native forms, user budgets across sessions, independent users, 429/retry headers, prefetch/XFF spoofing, 503 failure/recovery, actual workspace save without MFA and removed-member denial. |
| TypeScript and production build | `npm run typecheck` and `npm run build` passed after implementation and the final test-only TypeScript annotation fix. |
| Targeted browser check | Non-MFA owner view displayed the warning and step-up link; editing controls absent. DOM measurements at 1440 and 390 px found no horizontal document overflow. |
| Browser limitations | Screenshot capture and keyboard traversal were interrupted by browser-tool context/capture errors. Full visual/keyboard confirmation of this small notice remains pending; no screenshot review or complete accessibility audit is claimed. |
| Production evidence | No real provider tenant, deployment, ingress trust test, scheduled cleanup, alert-delivery test or backup restore drill. The runbook describes required operator actions and evidence. |

The HTTP test agent reached its usage limit after writing tests. The primary agent completed trailing-slash corrections, test isolation, the actual workspace-action MFA regression, TypeScript fixes and all final checks. Historical checkpoint verification below describes the earlier source, not current full launch readiness.

### M3 checkpoint 4 — team management (2026-10-21)

| Check | Evidence |
| --- | --- |
| TypeScript, build | Passed; `/invite/[token]`, `/org/[organizationId]/team`, `/org/[organizationId]/activity` render dynamically |
| Tests | `npm test`: 51 of 51 (15 new team tests: hashed tokens not readable by the app; preview; wrong or unverified email cannot accept; accepting once, idempotent for the same user, rejected for others; no re-invite of members; revoked and expired links rejected; a new invitation replaces the open one; only owners invite, revoke, change roles, or remove, including against other organizations; last-owner protection; removal ends access; invalid roles; audit log contents and member denial). `npm run test:e2e`: 7 of 7 |
| Browser, two to four mock users | Ana creates "Salon Ana", invites Marko (admin) and Petar (member); signed out, the invite page reveals nothing; Jelena with Marko's link sees "Prijavljeni ste drugim nalogom" and no accept button; Marko accepts and sees Tim (read-only) and Aktivnost; Ana demotes Marko, is refused when demoting herself as the last owner (message shown, select reverts), removes Marko; the activity log lists the changes with names; Marko then gets 404 and no organization on `/account/`; Mila (member) sees "Samo pregled", no Aktivnost, no knowledge editing, and onboarding redirects to the overview; at 390 px the six-item navigation uses three columns without overflow |
| Bug found and fixed | The invitation page set `referrer: no-referrer`, which makes browsers send `Origin: null` on a no-JavaScript form POST; Next.js then rejected the Server Action ("Invalid Server Actions request"). Reproduced with a native `form.submit()`, removed the meta, and the same native submit then joined the organization |

Not verified: real email delivery (not built), invitation links over https on a deployed host, and MFA-gated team changes with a real tenant.

### M3 checkpoint 3 — organization workspace (2026-10-21)

| Check | Evidence |
| --- | --- |
| TypeScript and build | `npm run typecheck` and `npm run build` passed; `/org/[organizationId]` routes render dynamically |
| Tests | `npm test`: 36 of 36 (4 new unit tests for stored-config round trip, shape rejection, and limits; 5 new database tests: first save assigns server ids and writes an audit event, later saves update/delete/add by id, stale revision rejected with no changes, members cannot save, another organization's knowledge ids become new rows and the original is untouched). `npm run test:e2e`: 7 of 7 still pass |
| Browser (local sign-in stack) | Sign-in → create "Salon Ana" → redirected to its onboarding → salon template, name edit, review, finish → overview shows "Salon Ana · Vlasnik" and "Sačuvano"; adding a knowledge entry and reloading the page keeps all four entries and nothing is in sessionStorage; unknown and malformed organization ids return 404 without leaking names; two tabs: tab B's save persists, tab A's stale save shows the conflict notice and does not overwrite; the demo `/workspace/` still uses sessionStorage, keeps its reset and example buttons, and links to `/workspace/...`; no horizontal overflow at 390 px with the compact save status visible |

Not verified: a member's read-only view in the browser (no invitations yet, covered only by database tests), very slow networks, and simultaneous edits of the same knowledge entry beyond the revision check.

### M3 checkpoint 2 — sign-in (2026-10-21)

| Check | Evidence |
| --- | --- |
| TypeScript and build | `npm run typecheck` and `npm run build` passed; `/account` renders dynamically behind the proxy |
| Database tests | `npm test`: 27 of 27 passed, including 7 session-store tests (round trip; hashed id and encrypted payload; inactivity and absolute expiry; expired, tampered, wrong-key, and swapped payloads rejected; update-only-existing; delete; back-channel logout by `sid`/`sub`; no direct table access for the runtime role; purge) |
| End-to-end | `npm run test:e2e`: 7 of 7 passed through the real SDK, proxy, session store, and database with a mock OpenID Connect provider: signed-out page; sign-in creates the user, one server-side session, and an `HttpOnly`, `SameSite=Lax` cookie; the table contains neither the email nor the cookie value; altered cookies are signed out; logout deletes the session and an old cookie cannot be replayed; without MFA the page asks for step-up; `returnTo` to another site stays on this origin; `/auth/access-token` is disabled |
| Browser | With `npm run dev:local-auth`: sign-in, a too-short organization name showing an inline error with the value kept, creating "Studio Mila" (listed as Vlasnik), and logout; `document.cookie` was empty while signed in; no console errors; no horizontal overflow at 529 px |

Not verified: a real Auth0 tenant, Universal Login, passkeys or OTP enrollment, back-channel logout from Auth0, production cookies over https, and Render. The dev server briefly reloaded the page in a loop right after startup in the hidden browser pane, then settled; this did not occur in the production build.

### M3 checkpoint 1 (2026-10-21)

| Check | Evidence |
| --- | --- |
| TypeScript and build | `npm run typecheck` and `npm run build` passed; all pages render dynamically behind the CSP proxy; `/api/health` is a dynamic route |
| Database tests | `npm test`: 20 of 20 passed against PostgreSQL 17.10, with migrations run by a non-superuser `CREATEROLE` owner like Render's default user |
| Roles | The app login is not superuser, lacks BYPASSRLS, is not a member of the owner, cannot `SET ROLE` to it, cannot disable RLS, and cannot write memberships directly |
| Tenant isolation | No rows without context; non-members cannot open another organization; a forged `app.organization_id` still hides and protects other tenants' rows; inserts into another tenant fail RLS; updates and deletes affect 0 rows |
| Roles in an organization | Members read but cannot change configuration or knowledge and cannot read the audit log; audit events cannot name another actor; a removed member is refused on the next request |
| Writes | Optimistic configuration revisions reject stale saves; transaction-local context does not leak between pooled transactions; malformed ids are rejected before SQL |
| Deploy command | `node scripts/db/migrate.ts` with Render-style environment applies migrations, is idempotent, and creates a working `aisistent_app` login reachable through the derived connection string |
| Production server | `next start` locally: CSP nonce on every page script (15 of 15), security headers present, health returns `{"status":"ok"}` with `no-store`; landing playback, workspace example loading, and conversations work with no console errors |

Not yet verified: any Render deployment (no account exists yet), whether Render's default user has `CREATEROLE` (needed by migration 0001), Auth0, R2, backups and restore, and HTTP-level authorization (no API routes yet).

### M2 (2026-10-21)

Checked in the Claude desktop app's built-in browser against `next dev` on port 4311 (port 4310 was occupied by another local process). The browser pane was hidden for most of the session, so most interactions were driven through DOM events and accessibility-tree reads; real keyboard input was used where noted.

| Check | Evidence |
| --- | --- |
| TypeScript and production build | `npm run typecheck` and `npm run build` passed after the final changes; static export generated 14 routes, including five onboarding steps and four workspace pages |
| Complete onboarding path | Empty draft → industry → business → hours → assistant → review → "Završi podešavanje" → workspace overview with confirmation message |
| Validation states | Missing industry, short business name, invalid website, service row without a name, no services, end time before start, no open days, short greeting, empty knowledge question/answer; error summary focus and summary links focusing fields; errors clear as fields are fixed |
| Step gating | Direct load of `/onboarding/hours/` on an empty draft shows the blocked notice; `/onboarding/` resumes at the first incomplete step |
| Industry templates | Switching between unedited templates replaces silently; after an edit, the replace/keep/cancel confirmation appears and "keep" preserves entered details |
| Draft persistence | Data survives client navigation between onboarding and workspace and a full reload in the same tab |
| Error and loading states | Malformed stored draft discarded with a dismissible notice; simulated storage write failure shows the in-memory warning; loading state renders before hydration |
| Empty states | Workspace before onboarding, conversations before onboarding, conversation search with no results, empty knowledge base, knowledge search with no results |
| Workspace pages | Conversation filters, search, selection; assistant tabs with live validation and per-tab problem counts; review tab edit buttons; knowledge add/edit/delete/search/restore; draft reset dialog; complete-example loading; flash message cleared on navigation |
| Keyboard | Real Tab/Arrow/Enter input in onboarding (radio cards selectable with arrows, Enter submits, focus moves to the next step heading); tablist Arrow/Home/End handling; native dialog Escape returns focus; skip links present |
| Layout | No horizontal page overflow at 390 px for all workspace pages, assistant tabs, all onboarding steps, and the landing page; desktop checked at 1440 px for overview, conversations, and review |
| Contrast | New text/surface pairs computed at 4.9:1 or higher (status chips, warnings, errors, placeholders, locked steps); disabled controls are below that by design |
| Console | No errors logged during the session |

Limitations: no automated end-to-end or accessibility test suite exists; no screen reader was used; time inputs follow the browser's locale (an English-locale browser showed 12-hour format); the M1 landing interactions were not re-tested beyond rendering and overflow, as their code is unchanged except for the shared `Brand` extraction and new links.

### M1

| Check | Evidence |
| --- | --- |
| Production build and TypeScript | Passed on 2026-10-21, including static export |
| Desktop/mobile layout | Browser checked at 1440 px and 390 px; no horizontal overflow after corrections |
| Interactions | Four scenarios, playback controls, knowledge editor, conversation selection, mobile navigation, FAQ |
| Contrast correction | Secondary labels darkened; reviewer scored the targeted correction resolved at 4.83:1 to 5.95:1 |
| Production integrations/security | Not implemented or tested |

The CI template at `docs/ci/demo-checks.yml.example` includes dependency installation, TypeScript, unit/database, synthetic recovery, HTTP checks and the production build. It is not enabled: the existing GitHub credential can push source but lacks the `workflow` scope. Local application checks are recorded above; no GitHub Actions run is claimed.

## Provider setup (user actions)

Agents must not create accounts or handle credentials. The user opens these in the company's name, with a company email and card, MFA on, and a second owner where supported:

1. **Render:** create a workspace (Pro for 7-day PITR before real data), connect the GitHub repository, and create a Blueprint from `render.yaml`. Confirm both resources show region Frankfurt. The first deploy runs `npm run db:migrate`; if it fails with a permission error on `CREATE ROLE`, Render's default user lacks `CREATEROLE` and the role setup must be adjusted.
2. **Auth0:** create a tenant with the **EU** locality, then:
   - Applications → Create Application → **Regular Web Application** (e.g. "aisistent staging").
   - Allowed Callback URLs: `https://<render-host>/auth/callback`. Allowed Logout URLs: `https://<render-host>/`. Leave Allowed Web Origins empty.
   - Authentication: keep the Username-Password database connection; email verification emails are on by default. Optional: Google.
   - Optional now, required before real data: an MFA factor (Auth0 lists passkeys on the Free plan and its "Pro MFA factors" only on paid plans; confirm which factor sets the `mfa` amr value), then set `AUTH_REQUIRE_MFA=true` on Render.
   - Optional: Back-Channel Logout URI `https://<render-host>/auth/backchannel-logout`.
   - In Render's dashboard set `APP_BASE_URL` (`https://<render-host>`, no trailing slash), `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, and `AUTH0_CLIENT_SECRET`. If the Blueprint was created before these were added to `render.yaml`, also add `AUTH0_SECRET` (a random value of at least 32 characters) and `AUTH_REQUIRE_MFA=false`. Never paste these values into chat or commits.
3. **Cloudflare:** create an account; R2 buckets (EU jurisdiction) are needed only when file uploads start.
4. Sign each provider's DPA and keep copies; prepare Serbian Commissioner SCCs where a provider may process data outside the EU.

## Next agent's first steps

1. Inspect `git status`, the current branch, and remote before editing. Preserve any unfinished changes.
2. Read this handoff, `AGENTS.md`, `docs/MILESTONES.md`, `docs/architecture/security-and-billing.md`, and `docs/architecture/m3-platform-options.md`.
3. Install locked dependencies and run `npm run typecheck`, `npm test`, and `npm run build`. Read the relevant installed Next.js guide before framework changes.
4. Checkpoint 11 removed inline styles from the production CSP and added Serbian 404/error pages; checkpoint 10 added the account session list and sign-out on all devices; checkpoint 9 added knowledge import from CSV/text files; checkpoint 8 added organization export, leaving, and deletion. The non-MFA owner notice check is complete (checkpoint 7). Read-only sessions must not see inputs or actions that the server will refuse: keep using `readOnly` from the draft context and `canChange` on the team page for new screens.
5. The provider-independent logical backup/restore rehearsal is complete. Keep `npm run test:recovery` passing when migrations or authorization/session behavior changes; provide PostgreSQL 17 client tools first (runbook setup). Do not recreate the rehearsal or treat it as production recovery proof.
6. Needs decisions/accounts: confirm hosting/identity, then deploy staging, configure the trusted ingress IP header and `RATE_LIMIT_SECRET`, activate restricted cleanup, configure/verify alerts, perform the managed-platform restore drill, and enable MFA and CI. Choose an invitation email provider only after approval. Private object storage and its restore test still need implementation; provider choice remains open. After the identity decision, also end the provider's sessions when a user signs out everywhere (checkpoint 10 ends only application sessions).

Local testing: `npm run dev:local-auth` and `npm run test:e2e` each start their own `next dev`; stop any other dev server for this project first, because two dev servers on one project directory conflict. If an organization page keeps reloading right after the dev server starts, close the tab and open it again (see checkpoint 7). Stopping `npm run dev:local-auth` with Ctrl+C removes its temporary database; killing the process instead leaves `%TEMP%\aisistent-pgdata-*` folders, which are safe to delete when no `postgres` process is running (ten such folders were removed on 2026-10-28).

Known risks to resolve during M3: the web service environment contains `DATABASE_ADMIN_URL` because Render's preDeployCommand needs it (consider a separate migration job); `ALTER ROLE ... PASSWORD` could appear in server logs if statement logging is enabled; the development CSP still allows `'unsafe-inline'` styles and `'unsafe-eval'` (production does not); the CI template's `npm test` step has never run in GitHub; deleted organizations remain in backups until backup retention expires, and a restore must reapply deletions made after the snapshot (runbook).

Do not add real payment collection or live provider calls merely to make the UI appear complete. Those belong to their milestones and require the corresponding controls.

## GitHub handoff

Target remote: `https://github.com/aionogi/aisistent.git`.

The root repository tracks `demo/` as ordinary files, with no nested Git repository. Private preview publishing uses ignored `.site-publish/` staging so its separate source workflow does not replace the GitHub remote.

Use small, descriptive commits and milestone tags named `milestone-N-name`. Published tags: `milestone-1-interactive-demo` and `milestone-2-app-shell`. Only mark future milestones released after their source and tag are pushed successfully. Never commit `.env` files, provider credentials, `node_modules`, `.next`, `out`, or local runtime helpers such as `.claude/launch.json`.

## Suggested continuation instruction

Read `AGENTS.md`, `CLAUDE.md`, `docs/HANDOFF.md`, `docs/MILESTONES.md`, `PRODUCT.md`, `demo/DESIGN.md`, `docs/architecture/security-and-billing.md`, `docs/architecture/m3-platform-options.md`, and `docs/operations/RUNBOOK.md`. Continue from current main: M1/M2 complete, M3 checkpoint 11 (production CSP without inline styles) implemented, hosting and identity still provisional. Staging work needs the provider decision and user-created accounts; ask the user before starting provider-independent items from "Known risks". Do not redo the limiter, logs, cleanup, fixed team races or restore rehearsal. Keep recovery tests current when protected data paths change. Do not deploy, create provider accounts, choose billing, or add live AI/telephony. Finish with actual checks, a clear partial/completed checkpoint, updated handoff, commit and push.

## Open decisions for later phases

Production hosting, identity provider, database/storage, AI and telephony providers, retention/recovery targets, merchant approval, prices, currencies, and trial/grace policies remain open. Provider references in the architecture document are research candidates and need current verification when that phase begins.
