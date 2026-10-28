# Development handoff

Updated: 2026-10-28.

## Current objective

**Platform decided (2026-10-28):** Vercel (Hobby while the site is built, a paid plan before commercial use), Supabase PostgreSQL in Frankfurt used only as a database, Auth0 EU; Resend, Cloudflare DNS and Sentry; PostHog later; no Upstash or Pinecone; private storage when uploads start. Details, constraints and sources: [m3-platform-options.md](architecture/m3-platform-options.md#decision-2026-10-28). No account is open and nothing is deployed yet.

M1 and M2 are implemented. The user wants milestone-based progress in [aionogi/aisistent](https://github.com/aionogi/aisistent) so Claude or another AI agent can continue from GitHub. M3 (persistent platform and production security) is in progress. On 2026-10-21 the user chose combination A from [m3-platform-options.md](architecture/m3-platform-options.md): Render in Frankfurt for hosting and Postgres, Auth0 with an EU tenant for identity, and Cloudflare R2 with EU jurisdiction for private files.

M3 checkpoint 1 adds the Node.js deployment configuration and the database tenancy foundation with tested row-level security. Nothing is deployed yet: the user must first open the provider accounts (see "Provider setup" below). M3 checkpoint 2 adds Auth0 sign-in with server-side sessions stored encrypted in PostgreSQL, user provisioning at sign-in, and an account page where a verified user creates an organization. It is tested end to end against a local mock identity provider.

M3 checkpoint 3 connects the M2 workspace screens to organization data: `/org/<id>/` reuses the same onboarding and workspace components, loads the configuration and knowledge from PostgreSQL for verified members, and saves edits automatically through a Server Action with optimistic revisions. The demo at `/workspace/` is unchanged.

M3 checkpoint 4 adds team management: owners invite people by link, change roles, and remove members; owners and admins read the organization's activity log.

M3 checkpoint 5 reviews Claude's `ec549e3`, fixes confirmed authorization/concurrency defects, and adds provider-neutral operational safeguards. M3 remains incomplete; there is no deployed production environment, active cleanup schedule, configured alert sink, managed restore-drill evidence, or approved hosting choice. See [operations/RUNBOOK.md](operations/RUNBOOK.md).

**Current checkpoint 6 (2026-10-22):** `npm run test:recovery` now performs a real logical backup/restore using synthetic data in two disposable local PostgreSQL clusters. It checks data/migration digests, security definitions, fresh database credentials, RLS and restored-session/invitation invalidation, followed by new session storage and saves. This completes the previously listed provider-independent recovery task. It does not prove managed backups, deployed recovery, full restored-target OIDC sign-in or production recovery objectives. The next steps are the outstanding notice browser check and the provider/deployment gates below.

**Current checkpoint 16 (2026-10-29):** the Vercel and Supabase configuration. The user's Vercel project runs the demo without a database. The repository now has `demo/vercel.json` (functions in `fra1`, a daily cleanup cron), a cleanup route behind `CRON_SECRET`, TLS verification against the database provider's CA (`DATABASE_CA_CERT`), statement and idle-transaction timeouts as role settings so they survive Supabase's transaction pooler, a configurable pool size, and migrations run from a trusted computer instead of the build; `render.yaml` is removed. The user's next steps are in the runbook section ["Vercel and Supabase setup"](operations/RUNBOOK.md#vercel-and-supabase-setup). Nothing is connected to Supabase yet.

**Checkpoint 15 (2026-10-28):** knowledge import from a public web page. In an organization, "Uvezi odgovore" now offers "Sa stranice sajta": the server fetches the one page at the address given and suggests question/answer pairs from FAQ data, `<details>`, definition lists, tables and headings; the person ticks what to add, and the normal validated save stores it. The fetch follows the OWASP SSRF guidance (see the verification record). The preview now has checkboxes for file imports too. This closes the "URL import" gap in the security evidence; uploads and private storage remain.

**Checkpoint 14 (2026-10-28):** two provider-independent M3 closings. The migrator now sets the application login's password as a SCRAM-SHA-256 verifier, so the plain password never reaches SQL text or statement logs (this resolves the logged `ALTER ROLE ... PASSWORD` risk). [docs/security/m3-evidence.md](security/m3-evidence.md) maps each security requirement to local evidence and gaps and keeps a risk register (R1-R15) with owners. See the verification record below.

**Checkpoint 13 (2026-10-28):** durable conversation records. Migration `0008_conversations.sql` stores conversations and transcripts per organization with RLS, a retention period that owners set on the Firma page (default 90 days), cleanup of expired conversations, and inclusion in export and organization deletion. The Razgovori page shows stored conversations when there are any and the examples otherwise. Nothing creates records yet: `app.record_conversation()` is granted to no role until M4's ingestion path exists. See the verification record below.

**Checkpoint 12 (2026-10-28):** an accessibility pass over every page, public and signed-in, at 1280 and 390 px, with an in-page audit script (duplicate ids, broken ARIA references, unnamed controls and fields, exposed icons, heading order, `main`/`lang`, positive `tabindex`, text contrast, and WCAG 2.5.8 target size with its spacing exception). Fixed: 35 decorative icons exposed to screen readers, `aria-controls` pointing at elements that were not rendered, four small texts below 4.5:1 plus a logo mark, and a skipped heading level in the configuration summary. The platform decision is on hold until the user has talked to their team. See the verification record below.

**Checkpoint 11 (2026-10-28):** the production Content-Security-Policy no longer allows inline styles. Fixed bar heights moved into CSS, the two dynamic progress bars set their width through the CSSOM, and Serbian 404 and error pages replace Next.js's defaults, which relied on inline styles. Development keeps `'unsafe-inline'` for styles and `'unsafe-eval'` for scripts, which the Next.js dev overlay and hot reloading need. See the verification record below.

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
  - Node.js server deployment instead of static export. Since checkpoint 16 `demo/vercel.json` runs the functions in `fra1` with a daily cleanup cron; the Render Blueprint (`render.yaml`) was removed.
  - `proxy.ts` sets a per-request nonce Content-Security-Policy built by `lib/security/content-security-policy.ts` (production: `style-src 'self' 'nonce-…'`, no inline style attributes, no `'unsafe-eval'`; checkpoint 11); `next.config.ts` adds static security headers (HSTS in production, nosniff, frame denial, referrer and permissions policies). Pages render dynamically so scripts carry the nonce.
  - `/api/health/` liveness endpoint; `/api/cron/cleanup/` runs the bounded cleanup for Vercel Cron behind `CRON_SECRET` (checkpoint 16).
  - Database schema `app` (users, organizations, memberships, assistant configs, knowledge entries, audit events) with RLS, a NOLOGIN `aisistent_runtime` role, and a restricted `aisistent_app` login that is not a member of the owner role.
  - Tenant-scoped data access (`withUser`, `withOrganization`) with transaction-local context and live membership checks; repositories for configuration (optimistic revisions), knowledge, memberships, and audit events.
  - Migration runner with checksums and an advisory lock; `npm run db:migrate` runs from a trusted computer before a deploy, never in the Vercel build (runbook "Vercel and Supabase setup").
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
  - `RATE_LIMIT_SECRET` is required whenever database-backed operations are enabled. It is set in Vercel's environment and generated by the disposable local test stack. `RATE_LIMIT_IP_HEADER` is deliberately unset until ingress overwrite and origin isolation are verified; an unset/invalid address uses a shared conservative bucket, not untrusted forwarded headers.
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
  - Since checkpoint 15 the preview lists every entry with a checkbox (all ticked) instead of the first five; "Izaberi sve" / "Poništi izbor" toggles them and "Dodaj N odgovora" counts the ticked ones.
  - Nothing new reaches the server: imported entries are ordinary draft edits, and `saveWorkspaceAction` still re-parses and size-checks every save (`parseDraft`, `checkDraftLimits`) under the database constraints. There is no separate audit event; an import appears as `workspace.save`.
- **Knowledge import from a web page (checkpoint 15):**
  - `lib/import/destination.ts`: `parseImportUrl` (http/https only, a missing scheme means https, no credentials, default ports only, fragment dropped, single-label and internal suffixes such as `.local` or `.internal` refused) and `isPublicAddress` (IANA special-purpose IPv4 ranges, multicast and reserved space refused; IPv6 must be global unicast `2000::/3` minus Teredo/IETF, documentation and 6to4 prefixes, so loopback, link-local, ULA, IPv4-mapped and NAT64 forms are refused).
  - `lib/import/fetch-page.ts`: `fetchPublicPage` uses `node:http`/`node:https` with its own `lookup`: every resolved address must be public or the connection is refused, and the socket connects to the address that was checked (one resolution per connection, so DNS rebinding cannot swap it). GET only, no cookies or credentials, `agent: false`, at most 5 redirects (each target parsed and checked again), one 10 s deadline, 2 MB for both transferred and decompressed bytes (gzip, deflate, br; a decompression bomb stops at the limit), status 200 and HTML, plain text or CSV only. Charset from the header, a `<meta>` tag, or UTF-8 with a Windows-1250 fallback.
  - `lib/import/web-knowledge.ts`: a bounded tolerant HTML parser (100 000 elements, depth 200; scripts, styles, templates, SVG and iframes skipped) and extraction in order: schema.org `FAQPage` JSON-LD, `<details>`/`<summary>`, `<dl>`, two-or-more-column data tables (a short table directly under a heading answers it), then headings or lines ending in "?" followed by text. Navigation, site header/footer, forms, sidebars and banner/dialog roles are skipped; `<main>` is preferred. At most 300 suggestions, fields capped one character past the limits so the preview reports them as too long. Text and CSV pages use the file import's parser.
  - `importKnowledgeFromUrlAction` (`app/(platform)/org/[organizationId]/actions.ts`): signed-in user, budget `knowledge.import` (20 per hour per user), MFA when required, owner/admin role checked in its own short transaction (the fetch never holds a database connection), then the fetch. It writes nothing; logs record only the operation and outcome (`denied` for refused or failed fetches), never the address. It is passed to the client through `WorkspaceEnvironment.importFromUrl`; the demo has no URL import.
- **Conversation records (checkpoint 13):**
  - Migration `0008_conversations.sql`: `app.conversations` (channel call/message, outcome booked/answered/handoff/unanswered, optional customer name, contact and summary, start/end times) and `app.conversation_messages` (ordered speaker/body, up to 500 per conversation). A composite foreign key keeps each transcript in its conversation's organization. Members read, owners and admins delete (RLS and grants); the runtime has no INSERT or UPDATE.
  - `app.record_conversation(organization, record jsonb)` is the only writer and has no grants: in M3 only the migration owner (tests) can call it. Give M4's ingestion role EXECUTE when it exists; never grant it to `aisistent_runtime`.
  - `organizations.conversation_retention_days` (7-730, default 90); `app.set_conversation_retention()` for owners with an `organization.retention_change` audit event; `app.purge_expired_conversations()` runs in `npm run ops:cleanup` (new `conversations` count in its output).
  - `app.export_organization()` now includes conversations with transcripts and the retention period; deleting an organization deletes its conversations.
  - UI: `/org/<id>/conversations/` lists stored conversations (newest first, search, `?c=<id>` opens one, deletion with confirmation for owners and admins with MFA when required, `conversation.delete` audit event); with none stored it keeps the example view. Firma has "Čuvanje razgovora" (30, 90, 180 or 365 days) for owners.
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

Sign-in with the real Auth0 tenant on this computer: `npm run dev:auth0` starts a temporary PostgreSQL database (discarded on Ctrl+C) and `next dev` at `http://127.0.0.1:4320` with the tenant settings from `demo/.env.auth0.local` (git-ignored, not loaded by `npm run dev`): `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, optionally `AUTH0_SECRET` and `AUTH_REQUIRE_MFA`. The Auth0 application needs `http://127.0.0.1:4320/auth/callback` as a callback URL and `http://127.0.0.1:4320/` as a logout URL. Stop other dev servers of the same checkout first. Checked on 2026-10-28 against Auth0's public `samples.auth0.com` with a dummy client: the account page offers sign-in, `/auth/login/` redirects there with `redirect_uri=http://127.0.0.1:4320/auth/callback` and scope `openid profile email`, the secret never appears in the output, and the temporary database is removed. A real sign-in needs the user's own tenant. `npm run dev:local-auth` stays the account-free option with a mock provider.

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
| `demo/components/workspace/KnowledgeImport.tsx` | Knowledge import panel (file or web page) with a checkbox preview |
| `demo/lib/import/` | URL import: destination policy, SSRF-safe page fetch, HTML question/answer extraction |
| `demo/db/migrations/0007_account_sessions.sql`, `demo/lib/db/sessions.ts` | The user's own session list and sign-out on all devices |
| `demo/db/migrations/0008_conversations.sql`, `demo/lib/db/conversations.ts` | Conversation records, retention, cleanup, export |
| `demo/components/workspace/views/StoredConversationsView.tsx`, `.../(shell)/conversations/` | Stored conversations page and delete action |
| `demo/components/account/SignOutEverywhereForm.tsx` | Sign-out-everywhere form that finishes at `/auth/logout` |
| `demo/components/support/SupportChat.tsx`, `demo/lib/support/faq.ts` | Website help chat (bottom right on the landing, account and 404 pages) and its prepared answers; no AI or server calls until M4 |
| `demo/vercel.json`, `demo/app/api/cron/cleanup/route.ts`, `demo/lib/operations/cleanup.ts` | Vercel region and daily cleanup cron, the protected cron route, and the cleanup shared with `npm run ops:cleanup` |
| `demo/lib/db/config.ts` (`connectionOptions`, `poolSize`) | TLS verification with `DATABASE_CA_CERT` and the per-instance pool size |
| `demo/AGENTS.md` | Next.js-generated guidance for the installed version |

Read [PRODUCT.md](../PRODUCT.md) for current requirements, [MILESTONES.md](MILESTONES.md) for acceptance criteria, and [security-and-billing.md](architecture/security-and-billing.md) before adding protected data or payment features. The older [Serbian plan](../ai-asistent-plan.md) contains future proposals; its planned monorepo structure is not the current file tree.

## Verification record

### M3 checkpoint 16 — Vercel and Supabase configuration (2026-10-29)

| Check | Evidence |
| --- | --- |
| Unit tests | `npm test`: **135/135**, twice in a row (3 new in `database-config.test.ts`: URL used as given without a CA; with `DATABASE_CA_CERT` TLS verification is forced and URL TLS options such as `sslmode=no-verify` are removed while other parameters and the `aisistent_app.<project-ref>` user stay; escaped single-line PEM accepted; non-PEM refused; pool size bounds) |
| Database tests | The migration command now leaves `statement_timeout = 10s` and `idle_in_transaction_session_timeout = 30s` on `aisistent_app` (checked with `SHOW` as that login). The cleanup command keeps its count-only output and refuses the owner, empty and invalid URLs |
| Flaky start fixed | Two full runs each failed one different database test file after ~10 s: the harness allowed PostgreSQL 10 s to start while ten servers start in parallel. It now waits up to 60 s by the clock; both following runs passed |
| Real TLS | A throwaway PostgreSQL that accepts TLS only, with a certificate from a throwaway CA: no CA → refused by the server; right CA → connected with TLS; right CA and `?sslmode=disable` → still TLS; escaped PEM → connected; wrong CA → `UNABLE_TO_VERIFY_LEAF_SIGNATURE`; `localhost` instead of the certificate's `127.0.0.1` → `ERR_TLS_CERT_ALTNAME_INVALID` |
| HTTP tests | `npm run test:e2e`: **22/22**. New: `/api/cron/cleanup/` answers 401 without the header, with a wrong secret, a longer secret, the secret without `Bearer` and lowercase `bearer`; with the secret it returns only the count fields, `Cache-Control: no-store`, and removes an expired rate bucket |
| Recovery and build | `npm run test:recovery` **6/6**; `npm run build` lists `/api/cron/cleanup` as a dynamic route |
| Not verified | Any connection to Supabase (pooler login as `aisistent_app.<project-ref>`, the downloaded certificate's format), Vercel's cron call and its `CRON_SECRET` header, and `x-forwarded-for` on Vercel; these are the runbook checks after the user's setup |

### Website help chat interface, without AI (M4 preview, 2026-10-28)

Built at the user's request after checkpoint 15; M3 remains the current milestone.

| Check | Evidence |
| --- | --- |
| Unit tests | `npm test`: **132/132** (6 new in `support-faq.test.ts`): every listed and suggested question gets its own answer; typed variants (case, diacritics, Cyrillic, word forms) reach the right topic; greetings and thanks get short replies and anything else admits there is no answer and links to the page FAQ; emails and phone- or card-like numbers (8+ digits) get the privacy reminder while times, dates and prices do not; no answer contains an amount; links stay on the site and the `#demo` / `#questions` anchors exist |
| Browser, dev (1280 px) | Real clicks and typing: "Pomoć" opens the panel with focus in the field; "Koliko košta?" + Enter answers that prices are not published; an unrelated question gets the no-answer reply, a link to the page FAQ and the suggestions again; a phone number gets the privacy reminder; "Privatnost" expands the note; Escape closes and returns focus to "Pomoć" with the conversation kept; Enter reopens; "Novi razgovor" clears it; "Želim demo" answers with links to the simulation and the demo workspace |
| In-page links | Following "Isprobajte simulaciju" from the panel first closed the panel without scrolling. The link now closes the panel, focuses the `#demo` section and scrolls to it (instant with reduced motion); verified by the call and by `scrollY` once the hidden pane drew frames. The pane often ran at 2 frames per second, so smooth-scroll checks there are unreliable |
| Phone (390 px) | Bottom sheet 390 × 640 px, no horizontal overflow, the button hides while it is open and gets focus back on close, 16 px field text. At the page bottom the button covered "Na vrh" and the footer note; the footer now has 80 px bottom space (no overlap at 390 or 1280 px) |
| Accessibility | The in-page audit with the panel open (messages, links, privacy note) found no issues: names, labels, ARIA references, hidden icons, heading order, contrast, target sizes. No screen reader test |
| Production CSP | `npm run build` + `next start`: `style-src 'self' 'nonce-…'`, no violation while opening the panel, asking, and expanding the privacy note; no `style` attribute in the panel |
| HTTP tests | `npm run test:e2e`: **21/21** |
| Other public pages (follow-up) | The chat also appears on `/account/` and the 404 page. Its section links now point to `/#demo` and `/#questions`: on the landing page they stay on the page (panel closes, section focused, scroll started from a timeout so it also runs in background tabs); elsewhere they open the landing page, which scrolls to the section once the browser draws (seen at 110 px from the top for `#questions`). The account footer gained bottom space: at 390 px its note ends 25 px above the button. Both pages: no duplicate ids or broken ARIA references, one `main` and `h1`, no horizontal overflow; the panel opens with focus in the field and returns focus on close. 132 unit/database and 21 HTTP tests pass; build passes |
| Limits | Prepared answers only, no AI, no message delivery to the team (no contact channel exists yet); not on the demo onboarding and workspace screens, whose own controls sit at the bottom right |

### M3 checkpoint 15 — knowledge import from a web page (2026-10-28)

| Check | Evidence |
| --- | --- |
| Unit tests | `npm test`: **126/126** (15 new). `url-import.test.ts`: the public/internal address table (including 169.254.169.254, `::ffff:127.0.0.1`, NAT64, 6to4, Teredo, `fd00:ec2::254`), URL parsing (schemes, credentials, ports, `localhost`, `.local`, `.internal`, numeric forms such as `2130706433` and `0x7f.1`), and a local HTTP server reached only through an explicit test allowance: one DNS resolution per connection, no cookies or authorization sent, a name resolving to `127.0.0.1` or to a mix of public and loopback addresses refused with no request received, redirects to metadata, internal names, `file:` and credentials refused before they are requested, a redirect loop stopped after 5, 404, image and missing types, unknown encodings, declared and streamed bodies over 2 MB, a 20 MB gzip bomb, a hanging server (timeout) and a closed port. `web-knowledge.test.ts`: JSON-LD with `@graph` and HTML answers, details, definition lists with `div` groups, accordion buttons and checkbox-label accordions, headings and question lines, price and opening-hours tables, layout tables, skipped site chrome, entities, broken markup, duplicates, field caps, 300-entry cap, 50 000 nested elements, and pathological inputs (100 000 attributes, unclosed quotes, punctuation runs) |
| Fix found while testing | `questionKey` used `/[\s?!.:;,]+$/u`, which is quadratic on long punctuation runs: a heading of 80 000 "?" took 5.3 s, so a 2 MB page could block a server thread for about an hour. It now trims in a loop (80 000 characters: 1 ms), and web suggestions are capped before the duplicate check. A regression test covers 500 000 characters |
| HTTP tests | `npm run test:e2e`: **21/21**. New: through the compiled Server Action, an owner is refused `http://127.0.0.1/`, `169.254.169.254`, `[::1]`, `localhost`, `2130706433` and `10.0.0.1` with the private-network message, the app's own port with the port message, and `file:` with the scheme message; a member, an owner without MFA, and a non-member organization id get `forbidden` before any fetch; members see no import button |
| Real pages | Through the production policy from this machine: `https://example.com/` (0 suggestions), `letsencrypt.org/docs/faq/` (19), `www.rust-lang.org/learn/get-started` (11, after a redirect to `rust-lang.org`), an MDN page (196 KB); an image URL was refused as an unsupported type and an unknown host as not found |
| Browser (local stack, synthetic "Salon Ana") | The app window was minimized, so clicks were dispatched from page scripts and fields set through the form tool; a screenshot was taken afterwards. Owner Ana: "Uvezi odgovore" → "Uvoz odgovora" with "Iz fajla" / "Sa stranice sajta" (`aria-pressed`); an empty address shows the field error and focuses the field; `http://169.254.169.254/latest/meta-data/` shows the private-network alert; `letsencrypt.org/docs/faq/` (no scheme) previews 14 entries and 5 skipped as too long with the page title and host; unticking "FAQ" changes the button to "Dodaj 13 odgovora"; adding shows "Uvezeno je 13 odgovora.", autosave reports "Sačuvano", focus returns to "Uvezi odgovore", and a reload shows 16 entries from the server. The same page again: 1 new entry, 18 skipped (13 duplicates). 390 px: no horizontal overflow. File import: 2 of 3 CSV rows offered, one unticked gives "Dodaj 1 odgovor" and "Izaberi sve". The demo `/workspace/knowledge/` keeps "Uvezi iz fajla" without the source switch or address field. The audit script reported only the 18 px checkboxes, which meet WCAG 2.5.8 through its spacing exception, and a 21 px summary, now 25 px |
| Build | `npm run typecheck` and `npm run build` passed; `npm run test:recovery` **6/6** (no migration since checkpoint 14) |
| Limits | One page per import; no crawling, no PDF or Office files, no JavaScript rendering (pages that build their content in the browser yield nothing). Network-level egress rules depend on the hosting decision (risk R16) |

### M3 checkpoint 14 — SCRAM password and security evidence (2026-10-28)

| Check | Evidence |
| --- | --- |
| Unit tests | `npm test`: **111/111** (3 new): `scramVerifier` reproduces the RFC 7677 SCRAM-SHA-256 example (its server signature verifies), salts differ per call, passwords with spaces or non-ASCII characters are refused (PostgreSQL would SASLprep them); `ensureAppLogin` sends no statement containing the plain password, for a new and an existing role |
| Real logins | Every database test logs in as `aisistent_app` with a verifier set this way; `npm run test:e2e` **20/20**; `npm run test:recovery` **6/6** (a fresh target password works and the source password fails) |
| Build | `npm run typecheck` and `npm run build` passed |
| Evidence document | `docs/security/m3-evidence.md`: every row cites a test or checkpoint; it records only local evidence |

### M3 checkpoint 13 — conversation records (2026-10-28)

| Check | Evidence |
| --- | --- |
| TypeScript, build | `npm run typecheck` and `npm run build` passed |
| Database tests | `npm test`: **108/108** (9 new): members read conversations and ordered transcripts; other organizations see nothing, also by id or with a forged organization context; the runtime cannot insert, update, add messages, or call the recorder; invalid channel, end before start, blank message, over 500 messages, and a transcript pointing at another organization are refused without leftovers; members cannot delete, admins can (transcript removed, audited); only owners set the retention, invalid values refused, direct updates denied, change audited; cleanup removes conversations past each organization's own period in bounded batches; the export includes conversations, transcripts and retention without other tenants; organization deletion removes them. The cleanup CLI test now expects `conversations: 0` |
| HTTP tests | `npm run test:e2e`: **20/20** (2 new): stored conversations render for owner and member (newest open, `?c=` selects, a foreign id shows nothing), the member has no delete control and the real delete action refuses them and a foreign id, the owner's delete redirects and removes the transcript; retention through the native form (invalid 45 refused, 30 saved; an admin sees the value without the form and posting the owner's form is refused) |
| Recovery | `npm run test:recovery`: **6/6** with all 8 migrations (the synthetic dataset has no conversations; the new tables, policies, grants and functions are compared like the others) |
| Browser (local stack, three synthetic conversations) | Desktop: list with outcome chips and Belgrade times, transcript with assistant name, selecting another conversation via `?c=`, deletion with real Enter/Tab/Enter in the dialog (list then shows 2), no duplicate ids, broken ARIA references, unnamed controls or exposed icons, headings h1→h2. Firma: retention changed to 30 and 180 days; the conversations header then said "Čuvaju se 180 dana". 390 px: no horizontal overflow |
| Found and fixed | Initials of a contact-only conversation showed "+6" (now "?"); after saving the retention the select jumped back to the old value because React resets the form after an action (the select now remounts with the saved value); the delete dialog's hidden text appeared for members (the dialog now renders only for those who may delete) |

Not done: no production writer exists, so real calls or messages cannot appear until M4; the cleanup schedule is still not active (provider decision).

### M3 checkpoint 12 — accessibility pass (2026-10-28)

| Check | Evidence |
| --- | --- |
| Pages audited | Local sign-in stack (`next dev`) with synthetic data. Public: `/`, `/workspace/` (before and after loading the example), its conversations, assistant (business and review tabs) and knowledge pages, all five onboarding steps, `/account/` and an invitation link while signed out, and the 404 page. Signed in as the owner: `/account/`, organization overview, team, activity, Firma and knowledge with the import panel and both details open. At 390 px: `/`, organization overview and assistant, demo conversations |
| Found and fixed | (1) 35 lucide icons had no `aria-hidden` (29 on the landing page, the rest in the conversation demo, onboarding step markers and the setup checklist); lucide-react 0.468 does not add it. All lucide icons now carry `aria-hidden="true"` unless they have their own label. (2) `aria-controls` referenced elements that were not rendered: the landing dashboard's "Dodaj primer" form and the assistant tabs' inactive panels; now set only when the target exists. (3) Contrast below 4.5:1: conversation demo note (4.39), dashboard initials (4.03) and "Za vaš tim" chip (4.44), conversation filter counts (4.17); colours darkened to 4.9–5.5:1. The demo's "ai" footer mark is part of the logo and is now `aria-hidden`. (4) Configuration summary sections were `h3` directly under the page `h1`; now `h2`, styled as before |
| After the fixes | The audit reports no issues on any of the pages above. A new unit test fails when a lucide icon has neither `aria-hidden` nor `aria-label` (confirmed against the previous `app/page.tsx`) |
| Tests | `npm run typecheck`, `npm test` **99/99**, `npm run test:e2e` **18/18**, `npm run build` passed |
| Audit caveat | The built-in browser pane sometimes reported a 0×0 window, which produced false small-target and heading findings; the audit was repeated with a fixed 1280×800 or 390×844 viewport |

Not done: no screen reader was used, and automated checks cannot judge reading order, link wording or keyboard flows; the keyboard checks from M2 and checkpoints 7–10 still apply. Contrast was measured on solid backgrounds only; text over gradients (the landing hero) was skipped.

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

The Vercel project exists and runs the demo without a database (user, 2026-10-28). The configuration for the database is in the repository since checkpoint 16; the exact steps, variables and checks are in the runbook section ["Vercel and Supabase setup"](operations/RUNBOOK.md#vercel-and-supabase-setup).

1. **Supabase:** project in **Frankfurt**, Data API off, SSL enforced; download the CA certificate; session-pooler URL for migrations, transaction-pooler URL with `aisistent_app.<project-ref>` for the app (runbook).
2. **Vercel:** Hobby during development (non-commercial use only; Pro before launch or when a second person needs access). Root directory `demo`; Production variables from the runbook table; redeploy after setting them.
3. **Auth0:** create a tenant with the **EU** locality, then:
   - Applications → Create Application → **Regular Web Application** (e.g. "aisistent staging").
   - Allowed Callback URLs: `https://<vercel-host>/auth/callback`. Allowed Logout URLs: `https://<vercel-host>/`. Leave Allowed Web Origins empty.
   - Authentication: keep the Username-Password database connection; email verification emails are on by default. Optional: Google.
   - Optional now, required before real data: an MFA factor (Auth0 lists passkeys on the Free plan and its "Pro MFA factors" only on paid plans; confirm which factor sets the `mfa` amr value), then set `AUTH_REQUIRE_MFA=true` in Vercel.
   - Optional: Back-Channel Logout URI `https://<vercel-host>/auth/backchannel-logout`.
   - For local tests with `npm run dev:auth0`, also add `http://127.0.0.1:4320/auth/callback` (callback) and `http://127.0.0.1:4320/` (logout).
   - Enter the Auth0 values in Vercel as listed in the runbook. Never paste these values into chat or commits.
4. **Later:** Resend for invitation emails, Sentry (EU region) for errors and alerts, Cloudflare DNS for the domain. Private storage (Supabase Storage or R2) only when uploads start.
5. Sign each provider's DPA and keep copies; prepare Serbian Commissioner SCCs where a provider may process data outside the EU.

## Next agent's first steps

1. Inspect `git status`, the current branch, and remote before editing. Preserve any unfinished changes.
2. Read this handoff, `AGENTS.md`, `docs/MILESTONES.md`, `docs/architecture/security-and-billing.md`, and `docs/architecture/m3-platform-options.md`.
3. Install locked dependencies and run `npm run typecheck`, `npm test`, and `npm run build`. Read the relevant installed Next.js guide before framework changes.
4. Checkpoint 15 added knowledge import from a public web page (`lib/import/`; keep its SSRF checks and tests); checkpoint 14 added the SCRAM password and the [security evidence and risk register](security/m3-evidence.md); checkpoint 13 added durable conversation records (writer granted in M4); checkpoint 12 was an accessibility pass; checkpoint 11 removed inline styles from the production CSP and added Serbian 404/error pages; checkpoint 10 added the account session list and sign-out on all devices; checkpoint 9 added knowledge import from CSV/text files; checkpoint 8 added organization export, leaving, and deletion. The non-MFA owner notice check is complete (checkpoint 7). Read-only sessions must not see inputs or actions that the server will refuse: keep using `readOnly` from the draft context and `canChange` on the team page for new screens.
5. The provider-independent logical backup/restore rehearsal is complete. Keep `npm run test:recovery` passing when migrations or authorization/session behavior changes; provide PostgreSQL 17 client tools first (runbook setup). Do not recreate the rehearsal or treat it as production recovery proof.
6. Next, with the user's accounts (checkpoint 16 prepared the configuration): run the migrations against Supabase, set the Vercel variables, redeploy, and run the runbook checks (sign-in, organization, cron run). Then configure/verify alerts (Sentry), perform the managed-platform restore drill, and enable MFA and CI. Choose an invitation email provider only after approval. Private object storage and its restore test still need implementation; provider choice remains open. After the identity decision, also end the provider's sessions when a user signs out everywhere (checkpoint 10 ends only application sessions).

Local testing: `npm run dev:local-auth` and `npm run test:e2e` each start their own `next dev`; stop any other dev server for this project first, because two dev servers on one project directory conflict. If an organization page keeps reloading right after the dev server starts, close the tab and open it again (see checkpoint 7). If it keeps happening, stop the dev server and delete `demo/.next/dev`: on 2026-10-28 a 603 MB cache shared by earlier dev and test servers kept the loop going, and a fresh cache ended it. Stopping `npm run dev:local-auth` with Ctrl+C removes its temporary database; killing the process instead leaves `%TEMP%\aisistent-pgdata-*` folders, which are safe to delete when no `postgres` process is running (ten such folders were removed on 2026-10-28).

Known risks to resolve during M3: the owner URL stays out of the web environment as long as migrations run outside the Vercel build (checkpoint 16); the logged `ALTER ROLE ... PASSWORD` risk is resolved (SCRAM verifier, checkpoint 14); URL imports make outbound requests from the web service, so the deployed network should also block private ranges and metadata addresses (R16); the development CSP still allows `'unsafe-inline'` styles and `'unsafe-eval'` (production does not); the CI template's `npm test` step has never run in GitHub; deleted organizations remain in backups until backup retention expires, and a restore must reapply deletions made after the snapshot (runbook).

Do not add real payment collection or live provider calls merely to make the UI appear complete. Those belong to their milestones and require the corresponding controls.

## GitHub handoff

Target remote: `https://github.com/aionogi/aisistent.git`.

The root repository tracks `demo/` as ordinary files, with no nested Git repository. Private preview publishing uses ignored `.site-publish/` staging so its separate source workflow does not replace the GitHub remote.

Use small, descriptive commits and milestone tags named `milestone-N-name`. Published tags: `milestone-1-interactive-demo` and `milestone-2-app-shell`. Only mark future milestones released after their source and tag are pushed successfully. Never commit `.env` files, provider credentials, `node_modules`, `.next`, `out`, or local runtime helpers such as `.claude/launch.json`.

## Suggested continuation instruction

Read `AGENTS.md`, `CLAUDE.md`, `docs/HANDOFF.md`, `docs/MILESTONES.md`, `PRODUCT.md`, `demo/DESIGN.md`, `docs/architecture/security-and-billing.md`, `docs/architecture/m3-platform-options.md`, and `docs/operations/RUNBOOK.md`. Continue from current main: M1/M2 complete, M3 checkpoint 15 (knowledge import from a web page with SSRF controls) implemented, hosting and identity still provisional. Staging work needs the provider decision and user-created accounts; ask the user before starting provider-independent items from "Known risks". Do not redo the limiter, logs, cleanup, fixed team races or restore rehearsal. Keep recovery tests current when protected data paths change. Do not deploy, create provider accounts, choose billing, or add live AI/telephony. Finish with actual checks, a clear partial/completed checkpoint, updated handoff, commit and push.

## Open decisions for later phases

Planned in M4 since 2026-10-28: an AI support chat on the aisistent website for visitors' questions (acceptance criteria in [MILESTONES.md](MILESTONES.md#website-support-chat-requested-2026-10-28)); it needs the AI provider decision. At the user's request its interface already exists without AI (see "Website help chat interface" in the verification record). Open user decision: a contact email or form the team receives for demo and contact requests; until then the chat says contacting the team through the site is not available.

Private storage, AI and telephony providers, retention/recovery targets, merchant approval, prices, currencies, and trial/grace policies remain open. Provider references in the architecture document are research candidates and need current verification when that phase begins.
