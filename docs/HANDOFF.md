# Development handoff

Updated: 2026-10-21.

## Current objective

**Open decision:** the platform choice (Render + Auth0 + R2) is provisional; the user wants to revisit it before opening accounts. See "What depends on the provider choice" in [m3-platform-options.md](architecture/m3-platform-options.md).

M1 and M2 are implemented. The user wants milestone-based progress in [aionogi/aisistent](https://github.com/aionogi/aisistent) so Claude or another AI agent can continue from GitHub. M3 (persistent platform and production security) is in progress. On 2026-10-21 the user chose combination A from [m3-platform-options.md](architecture/m3-platform-options.md): Render in Frankfurt for hosting and Postgres, Auth0 with an EU tenant for identity, and Cloudflare R2 with EU jurisdiction for private files.

M3 checkpoint 1 adds the Node.js deployment configuration and the database tenancy foundation with tested row-level security. Nothing is deployed yet: the user must first open the provider accounts (see "Provider setup" below). M3 checkpoint 2 adds Auth0 sign-in with server-side sessions stored encrypted in PostgreSQL, user provisioning at sign-in, and an account page where a verified user creates an organization. It is tested end to end against a local mock identity provider.

M3 checkpoint 3 connects the M2 workspace screens to organization data: `/org/<id>/` reuses the same onboarding and workspace components, loads the configuration and knowledge from PostgreSQL for verified members, and saves edits automatically through a Server Action with optimistic revisions. The demo at `/workspace/` is unchanged.

M3 checkpoint 4 adds team management: owners invite people by link, change roles, and remove members; owners and admins read the organization's activity log.

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
  - `proxy.ts` sets a per-request nonce Content-Security-Policy; `next.config.ts` adds static security headers (HSTS in production, nosniff, frame denial, referrer and permissions policies). Pages render dynamically so scripts carry the nonce.
  - `/api/health/` liveness endpoint for Render.
  - Database schema `app` (users, organizations, memberships, assistant configs, knowledge entries, audit events) with RLS, a NOLOGIN `aisistent_runtime` role, and a restricted `aisistent_app` login that is not a member of the owner role.
  - Tenant-scoped data access (`withUser`, `withOrganization`) with transaction-local context and live membership checks; repositories for configuration (optimistic revisions), knowledge, memberships, and audit events.
  - Migration runner with checksums and an advisory lock; `npm run db:migrate` runs as Render's preDeployCommand.
  - 20 integration tests against a real PostgreSQL 17 server (`npm test`).
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
  - Roles: owner (team and everything), admin (configuration and knowledge), member (read only). The last owner cannot be demoted or removed; owner rows are locked so concurrent changes cannot remove every owner.
  - Removal takes effect on the member's next request because every organization request re-checks membership; their sign-in session is not ended, since it may serve other organizations.
  - Pages: `/org/<id>/team/` (members; owners also invite, change roles, remove, and revoke), `/org/<id>/activity/` (owners and admins; last 100 events with actor names), `/invite/<token>/` (sign in, preview, accept). Team changes require MFA when `AUTH_REQUIRE_MFA=true`.
  - Autosave writes at most one `workspace.save` audit entry per person per 15 minutes.
  - `npm run dev:local-auth` accepts `/auth/login?login_hint=<name>@example.test` to sign in as another mock user.
- Production architecture and security requirements in the documents linked below.

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
- There is no authentication, persistent organization state, pricing, checkout, billing, or subscription enforcement. The workspace is open to anyone who loads the page and contains only browser-local example data.
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
| `demo/proxy.ts` | Per-request nonce Content-Security-Policy |
| `demo/app/api/health/route.ts` | Liveness endpoint for Render |
| `demo/db/migrations/` | Ordered SQL migrations; never edit an applied file, add a new one |
| `demo/lib/db/config.ts` | Role names and connection-string derivation (restricted runtime vs. owner) |
| `demo/lib/db/context.ts` | `withUser` / `withOrganization` transactions with RLS context |
| `demo/lib/db/repositories.ts` | Tenant-scoped data access |
| `demo/lib/db/migrator.ts`, `demo/scripts/db/migrate.ts` | Migration runner and the deploy command |
| `demo/lib/db/pool.ts` | Shared pool for the application login, or null without a database |
| `demo/tests/db/` | PostgreSQL test harness and integration tests |
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
| `demo/components/workspace/team/` | Team view and styles |
| `render.yaml` | Render Blueprint for the Frankfurt staging environment |
| `demo/AGENTS.md` | Next.js-generated guidance for the installed version |

Read [PRODUCT.md](../PRODUCT.md) for current requirements, [MILESTONES.md](MILESTONES.md) for acceptance criteria, and [security-and-billing.md](architecture/security-and-billing.md) before adding protected data or payment features. The older [Serbian plan](../ai-asistent-plan.md) contains future proposals; its planned monorepo structure is not the current file tree.

## Verification record

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

The CI template at `docs/ci/demo-checks.yml.example` repeats dependency installation, TypeScript checks, and the production build. It is not enabled: the existing GitHub credential can push source but lacks the `workflow` scope. Local checks passed; no GitHub Actions run is claimed.

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
4. Next M3 step: operational safeguards that do not need provider accounts: rate limits for Server Actions and `/auth/*` (per IP and per user, stored in PostgreSQL), structured server logs without personal data or tokens, a scheduled purge of expired sessions and invitations, and a written backup/restore and incident/rollback runbook.
5. Needs accounts or decisions: confirm the platform, then deploy staging, run a restore drill, choose an email provider for invitations, enable `AUTH_REQUIRE_MFA=true`, and enable the CI template.
6. Later in M3: R2 private storage with short-lived signed URLs, a backup and restore drill (database and objects), observability, an incident and rollback runbook, and enabling the CI template.

Local testing: `npm run dev:local-auth` and `npm run test:e2e` each start their own `next dev`; stop any other dev server for this project first, because two dev servers on one project directory conflict.

Known risks to resolve during M3: the web service environment contains `DATABASE_ADMIN_URL` because Render's preDeployCommand needs it (consider a separate migration job); `ALTER ROLE ... PASSWORD` could appear in server logs if statement logging is enabled; styles allow `'unsafe-inline'` in the CSP; the CI template's `npm test` step has never run in GitHub.

Do not add real payment collection or live provider calls merely to make the UI appear complete. Those belong to their milestones and require the corresponding controls.

## GitHub handoff

Target remote: `https://github.com/aionogi/aisistent.git`.

The root repository tracks `demo/` as ordinary files, with no nested Git repository. Private preview publishing uses ignored `.site-publish/` staging so its separate source workflow does not replace the GitHub remote.

Use small, descriptive commits and milestone tags named `milestone-N-name`. Published tags: `milestone-1-interactive-demo` and `milestone-2-app-shell`. Only mark future milestones released after their source and tag are pushed successfully. Never commit `.env` files, provider credentials, `node_modules`, `.next`, `out`, or local runtime helpers such as `.claude/launch.json`.

## Suggested continuation instruction

Read `AGENTS.md`, `CLAUDE.md`, `docs/HANDOFF.md`, `docs/MILESTONES.md`, `PRODUCT.md`, `demo/DESIGN.md`, `docs/architecture/security-and-billing.md`, and `docs/architecture/m3-platform-options.md`. M1 and M2 are complete; M3 is in progress on Render + Auth0 (EU) + Cloudflare R2 (EU) with the database tenancy foundation in place. Continue with the next M3 step in this handoff. Preserve the M2 onboarding and workspace UI. Do not start real AI calls, telephony, pricing, or payments. Finish each checkpoint with checks, an updated handoff, a commit, and a push. If context is nearly exhausted, record a coherent partial checkpoint honestly rather than marking incomplete acceptance criteria complete.

## Open decisions for later phases

Production hosting, identity provider, database/storage, AI and telephony providers, retention/recovery targets, merchant approval, prices, currencies, and trial/grace policies remain open. Provider references in the architecture document are research candidates and need current verification when that phase begins.
