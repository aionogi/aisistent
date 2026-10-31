# Delivery milestones

Updated: 2026-10-28.

The user requested a demo first, followed by security, then pricing and recurring revenue. The phases below preserve that order. No delivery dates or provider commitments are assigned.

| Milestone | Status | Depends on | Checkpoint tag |
| --- | --- | --- | --- |
| [M1 — Interactive website demo](https://github.com/aionogi/aisistent/milestone/1) | Complete and pushed | None | `milestone-1-interactive-demo` |
| [M2 — App shell and onboarding UI](https://github.com/aionogi/aisistent/milestone/2) | Complete and pushed | M1 | `milestone-2-app-shell` |
| [M3 — Persistent platform and production security](https://github.com/aionogi/aisistent/milestone/3) | In progress; synthetic logical recovery verified; deployment/managed recovery gates pending | M2 | `milestone-3-secure-platform` |
| [M4 — Live AI and telephony](https://github.com/aionogi/aisistent/milestone/4) | Planned; deferred | M3 safeguards | `milestone-4-live-assistant` |
| [M5 — Pricing and subscriptions](https://github.com/aionogi/aisistent/milestone/5) | Planned; deferred | M3, M4, merchant approval | `milestone-5-subscriptions` |

The M1 tag is published at commit `0517b631fc31d7b579cc089a40eb9d404f70e72f`. The M2 tag is published at commit `479188b983699114e0393875592292f109273dbe`. M3-M5 tags are planned names, not published releases. Create each future tag only after its acceptance criteria pass.

## M1 — Interactive website demo

Goal: show the product's visual direction and let someone try the proposed experience without providing credentials, payment details, or microphone access.

- [x] Next.js/React/TypeScript implementation in `demo/`.
- [x] Responsive Serbian landing page using call0.ai as design inspiration and original aisistent branding.
- [x] Four industry scenarios: salon, clinic, auto service, and restaurant.
- [x] Scripted conversation playback with pause, resume, and replay.
- [x] Dashboard overview, selectable conversation summaries, and temporary knowledge entries.
- [x] Clearly labeled simulations and illustrative metrics.
- [x] Mobile navigation and expandable FAQ answers.
- [x] Browser checks at 1440 px and 390 px with no horizontal overflow after layout corrections.
- [x] Initial production build and TypeScript validation.
- [x] Final production build after the latest changes.
- [x] Final verification recorded in `docs/HANDOFF.md`.
- [x] Source pushed to GitHub with the M1 checkpoint tag.

Completion does not imply production authentication, data persistence, live calls, or payment readiness.

## M2 — App shell and onboarding UI

Goal: make the proposed application navigable and testable before connecting real services.

- [x] Create a dedicated app shell with navigation for overview, conversations, assistant setup, and knowledge (`/workspace/`).
- [x] Add onboarding for business details, working hours, industry, and assistant behavior (`/onboarding/`, five steps).
- [x] Support editing and reviewing a complete example configuration (onboarding review step and the workspace assistant editor).
- [x] Preserve draft state across navigation and clearly explain its temporary storage behavior (`sessionStorage`, this tab only).
- [x] Include empty, loading, validation, and error states appropriate to the demonstrated flow.
- [x] Keep example data labeled; do not imply real login, saved server data, active integrations, or paid access.
- [x] Verify mobile layouts, keyboard navigation, and the complete onboarding path (session checks recorded in `docs/HANDOFF.md`).
- [x] Update the handoff and publish the checkpoint.

The M1 landing dashboard preview was left intact; the workspace reuses its visual language and shares the `Brand` component rather than its fixtures. No payment or authentication dependency was added. Completion does not imply persistence beyond the browser tab, real accounts, or live integrations.

## M3 — Persistent platform and production security

Goal: support real organizations and data through the requested Next.js/Node.js stack.

- [ ] Record hosting, managed identity, database, and private storage decisions. *(Decided 2026-10-28 in [m3-platform-options.md](architecture/m3-platform-options.md#decision-2026-10-28): Vercel (Hobby during development, a paid plan before commercial use), Supabase PostgreSQL in Frankfurt as a database only, Auth0 EU. Private storage is still open, so this item stays unchecked.)*
- [ ] Replace static-only deployment with a suitable Node.js deployment when server features are introduced. *(Vercel project deployed by the user and running in Frankfurt; the Supabase database has all migrations since 2026-10-31, the deployed app's connection to it is not verified yet; `demo/vercel.json` (region `fra1`, daily cleanup cron), CSP and security headers. Database and sign-in on the deployment are not verified yet.)*
- [ ] Implement organizations, memberships, roles, and durable assistant/knowledge/conversation records. *(Schema, RLS, and repositories for organizations, memberships, roles, configuration, knowledge, and audit events exist, and the M2 workspace now saves organization configuration and knowledge at `/org/<id>/`; invitations, roles, member removal, and owner export, leaving, and deletion exist; conversation records with transcripts, per-organization retention, cleanup, export and deletion exist since checkpoint 13, but nothing writes them until M4's ingestion path is granted `app.record_conversation`.)*
- [ ] Enforce server-side authorization and tenant isolation on each protected operation. *(Organization pages and the save action verify session, membership, and role on the server, with RLS underneath; remaining operations come with their features.)*
- [ ] Implement secure sessions, required privileged-account MFA, revocation, and sensitive-action checks. *(Auth0 sign-in with encrypted server-side sessions, logout, back-channel revocation, user-initiated sign-out on all devices, and an MFA gate for organization creation exist; MFA is off until the tenant has a factor; team changes also require MFA when it is on; removed members lose access on their next request through live membership checks.)*
- [ ] Protect imports, uploads, secrets, logs, and private file access. *(Allowlisted operational logging and request limits implemented. Knowledge import reads CSV/text files in the browser only, with size, encoding, binary, length, duplicate and count checks, and the server revalidates every save. Since checkpoint 15, owners and admins also import from one public web page through a server-side fetch with SSRF controls (public addresses checked when connecting, redirects rechecked, standard ports, 10 s and 2 MB limits, no credentials). Ingress trust/provider logging, network egress rules, uploads and private storage remain.)*
- [ ] Establish migrations, backups, recovery tests, observability, and incident/rollback procedures. *(Migrations, bounded cleanup, [runbook](operations/RUNBOOK.md) and a passing isolated synthetic logical restore rehearsal implemented; scheduler, alert sink, managed backups/PITR and deployed restore drills remain.)*
- [ ] Test unauthorized access and cross-tenant operations against the actual data access paths. *(Latest evidence: 71 unit/database tests at checkpoint 5 and 13 HTTP tests after the invitation follow-up; includes workspace MFA denial, removed-member denial, concurrent ownership changes, request limits and current-session email verification for invitations. Deployed-provider and future-feature coverage remains.)*
- [ ] Record the applicable security evidence and unresolved risks. *(Local evidence and a risk register with owners are in [m3-evidence.md](security/m3-evidence.md) since checkpoint 14; deployed evidence is still missing.)*

The detailed baseline is [security-and-billing.md](architecture/security-and-billing.md). Its requirements are proposed controls, not controls already present in M1.

Checkpoint 5 reviews `ec549e3` and adds operational safeguards plus fixes for queued stale-owner authorization, duplicate invitation races and missing workspace-save MFA. This is a partial M3 checkpoint; do not publish `milestone-3-secure-platform` or close the GitHub M3 milestone until all remaining criteria pass. The browser visual/keyboard follow-up was completed in checkpoint 7.

Checkpoint 6 adds `npm run test:recovery`: real PostgreSQL dump/restore between two disposable clusters, snapshot and security-definition comparisons, restricted credentials, tenant isolation, restored-session/invitation invalidation, and usable recovered saves/audit sequence. All 6 reported recovery tests and the 71 unit/database + 13 HTTP regression tests pass locally. This is synthetic recovery evidence, not a production recovery guarantee; provider recovery objectives and post-snapshot authorization reconciliation remain operator responsibilities.

Checkpoint 7 completes the non-MFA notice browser check and fixes what it found: read-only sessions no longer see inputs or team controls the server refuses, and the MFA step-up link returns to the organization. The step-up round trip is now covered by an HTTP test against the mock provider (14 HTTP tests, 71 unit/database tests). A real Auth0 MFA factor remains unverified.

Checkpoint 8 adds organization data rights without provider accounts: owners export all organization data as JSON and delete the organization permanently (exact name, MFA when required); members leave, except the last owner. 83 unit/database and 17 HTTP tests pass locally. Backup retention for deleted data is still an open decision.

Checkpoint 9 adds knowledge import from CSV or text files with a preview of added and skipped rows; the file stays in the browser and saves go through the existing validated path. 92 unit/database and 17 HTTP tests pass locally.

Checkpoint 10 adds the account page's list of active sign-ins and "sign out on all devices", which ends every application session of the user at once. 95 unit/database and 18 HTTP tests pass locally. Ending identity-provider sessions on other devices waits for the provider decision.

Checkpoint 11 removes `'unsafe-inline'` from the production style policy (fixed sizes in CSS, dynamic widths through the CSSOM, Serbian 404 and error pages instead of Next.js's inline-styled defaults) and adds a test that keeps components free of inline styles. 98 unit/database and 18 HTTP tests pass locally.

Checkpoint 12 is an accessibility pass over all public and signed-in pages at desktop and phone widths: decorative icons hidden from screen readers, ARIA references fixed, four low-contrast texts darkened, and heading order corrected, with a test that keeps icons hidden. No screen reader test was done. 99 unit/database and 18 HTTP tests pass locally.

Checkpoint 13 adds durable conversation records: transcripts per organization under RLS, deletion by owners and admins, a retention period owners choose (default 90 days) with cleanup, and inclusion in export and organization deletion. The web runtime cannot create records; M4's ingestion will. 108 unit/database, 20 HTTP and 6 recovery tests pass locally.

Checkpoint 14 stores the application database password only as a SCRAM verifier and records the M3 security evidence and risk register. 111 unit/database, 20 HTTP and 6 recovery tests pass locally.

Checkpoint 16 prepares the Vercel and Supabase deployment: region and daily cleanup cron, a protected cron route, TLS verification against the provider's CA, role-level timeouts for the transaction pooler, and migrations outside the build. 135 unit/database, 22 HTTP and 6 recovery tests pass locally; nothing is connected to Supabase yet.

Checkpoint 15 adds knowledge import from one public web page with SSRF controls and a checkbox preview for every import. A quadratic duplicate-key regex found during testing is fixed. 126 unit/database, 21 HTTP and 6 recovery tests pass locally.

CI follow-up: the inactive workflow template now installs PostgreSQL 17 client tools and requires the recovery rehearsal. Static/script-syntax validation is recorded in [CI setup](ci/README.md); workflow activation and a successful GitHub run remain pending. This does not close M3.

## M4 — Live AI and telephony

Goal: conduct bounded, authorized live calls, preserve useful conversation outcomes, and answer visitors' questions on the aisistent website through an AI support chat.

- [ ] Select approved AI/speech and telephony providers and record their operational constraints.
- [ ] Add a Node.js voice gateway if persistent audio connections require it.
- [ ] Verify incoming provider events and bind media connections to authorized call sessions.
- [ ] Connect approved business knowledge and validated tools through tenant-aware services.
- [ ] Implement interruption, timeout, completion, and human-handoff paths.
- [ ] Apply duration, concurrency, destination, usage, and spending limits with an emergency stop.
- [ ] Keep recordings/transcripts private and implement applicable retention/redaction behavior.
- [ ] Verify prompt-injection boundaries, unauthorized actions, provider failures, and concurrent usage.
- [ ] Run a controlled pilot before general availability.

### Website support chat (requested 2026-10-28)

An AI support assistant on the public aisistent website that answers visitors' questions about the product. The user's reference is the support chat on call0.ai: a floating panel with the assistant's name and an "AI assistant" label, a greeting, suggested questions, a message field, new-conversation and close buttons, and a privacy link. Use Serbian Latin text and original aisistent branding; do not copy wording or assets.

- [ ] Chat button on public pages opening a panel with a greeting, about three suggested questions (for example "Kako se podešava aisistent?", "Šta asistent može da radi?", "Želim demo"), a message field, new conversation, close, and a "Privatnost" link. Keyboard, screen reader, and 390 px phone use verified.
- [ ] Answers come only from an approved aisistent knowledge base (product, setup, security, and FAQ content) through the selected AI provider. When the answer is not there, the assistant says so and offers contact with the team instead of guessing.
- [ ] It never invents prices, discounts, availability, or legal and security promises; until M5 publishes prices it says pricing is not public yet.
- [ ] Clearly labeled as AI. A short privacy notice is visible before the first message, visitors are asked not to share sensitive data, transcript retention and deletion are decided and implemented, and conversations are not used for model training without approval.
- [ ] Demo and contact requests hand off to a form or email the team receives; no calendar booking until an integration is chosen.
- [ ] No file attachments until upload validation and private storage (M3) exist.
- [ ] Abuse and cost limits: per-visitor and per-IP message budgets, message length limits, a daily spending cap, and an emergency stop that falls back to a static FAQ and contact link.
- [ ] Prompt-injection and off-topic tests pass; the assistant reads only public product content and has no tools or customer data; logs exclude message content and personal data.
- [ ] The widget calls a same-origin API under the existing CSP; no third-party chat script without approval.

**Interface built early (2026-10-28, at the user's request), without AI:** the public pages (landing page, `/account/`, and the "Stranica nije pronađena" page) have a "Pomoć" button at the bottom right that opens the panel described in the first item. Until an AI provider is chosen it answers only from prepared answers in `demo/lib/support/faq.ts` (keyword matching, Latin or Cyrillic), labels itself "Unapred napisani odgovori · nije AI", shows the privacy notice before the first message, sends nothing to a server and keeps nothing after the page closes, answers that prices are not public, and replies to contact details or card-like numbers with a privacy reminder. Keyboard use and the 390 px phone layout were checked in a browser; no screen reader test was done, so the first item stays open. The remaining items need the AI provider, a same-origin API, budgets, and a team contact (form or email) that does not exist yet; no item is complete.

The landing page's "Chatbot za sajt — Uskoro" card announces a different, later channel: a chat that customers embed on their own websites. It may reuse this widget but is not part of this item.

This phase may require a Node.js worker and queue. Add those processes when the workload needs them; a Python pipeline requires separate justification.

## M5 — Pricing and subscriptions

Goal: support reliable monthly billing for the confirmed Serbian merchant.

- [ ] Validate and approve the merchant account, recurring methods, supported currencies, and commercial terms.
- [ ] Set prices, included usage, overages, renewal, cancellation, trial/grace, and refund rules.
- [ ] Integrate one approved provider through a narrow TypeScript adapter.
- [ ] Keep card entry in provider-controlled checkout; exclude raw card data from application handling.
- [ ] Implement verified event intake, idempotency, durable processing, reconciliation, and authoritative entitlements.
- [ ] Provide secure invoice, payment-method, plan-change, and cancellation flows.
- [ ] Verify the payment lifecycle and duplicate, forged, late, and out-of-order events.
- [ ] Complete every paid-launch gate in [security-and-billing.md](architecture/security-and-billing.md).
- [ ] Record provider approval and deployment/security review evidence before accepting real payments.

Provider candidates in the architecture document require current eligibility and contract verification. No provider, price, currency, or launch date is finalized.

## Checkpoint protocol

For every completed milestone:

1. Keep source, lockfiles, and documentation in the same reviewable commit sequence.
2. Record commands and browser flows actually checked, including any gaps.
3. Update milestone status and the next concrete task in `docs/HANDOFF.md`.
4. Push the branch to `https://github.com/aionogi/aisistent.git`.
5. Create and push the corresponding immutable `milestone-N-name` tag.

Use a follow-up commit/tag for corrections; do not move an existing published milestone tag. Exclude secrets, dependencies, build output, caches, and local runtime helpers from source control.
