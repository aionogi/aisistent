# Delivery milestones

Updated: 2026-10-21.

The user requested a demo first, followed by security, then pricing and recurring revenue. The phases below preserve that order. No delivery dates or provider commitments are assigned.

| Milestone | Status | Depends on | Checkpoint tag |
| --- | --- | --- | --- |
| [M1 — Interactive website demo](https://github.com/aionogi/aisistent/milestone/1) | Complete and pushed | None | `milestone-1-interactive-demo` |
| [M2 — App shell and onboarding UI](https://github.com/aionogi/aisistent/milestone/2) | Complete; checkpoint tag on the M2 commit | M1 | `milestone-2-app-shell` |
| [M3 — Persistent platform and production security](https://github.com/aionogi/aisistent/milestone/3) | Next; awaiting hosting, identity, and database decisions | M2 | `milestone-3-secure-platform` |
| [M4 — Live AI and telephony](https://github.com/aionogi/aisistent/milestone/4) | Planned; deferred | M3 safeguards | `milestone-4-live-assistant` |
| [M5 — Pricing and subscriptions](https://github.com/aionogi/aisistent/milestone/5) | Planned; deferred | M3, M4, merchant approval | `milestone-5-subscriptions` |

The M1 tag is published at commit `0517b631fc31d7b579cc089a40eb9d404f70e72f`. The M2 tag marks the commit that adds the app shell and onboarding; `docs/HANDOFF.md` records its push. M3-M5 tags are planned names, not published releases. Create each future tag only after its acceptance criteria pass.

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

- [ ] Record hosting, managed identity, database, and private storage decisions.
- [ ] Replace static-only deployment with a suitable Node.js deployment when server features are introduced.
- [ ] Implement organizations, memberships, roles, and durable assistant/knowledge/conversation records.
- [ ] Enforce server-side authorization and tenant isolation on each protected operation.
- [ ] Implement secure sessions, required privileged-account MFA, revocation, and sensitive-action checks.
- [ ] Protect imports, uploads, secrets, logs, and private file access.
- [ ] Establish migrations, backups, recovery tests, observability, and incident/rollback procedures.
- [ ] Test unauthorized access and cross-tenant operations against the actual data access paths.
- [ ] Record the applicable security evidence and unresolved risks.

The detailed baseline is [security-and-billing.md](architecture/security-and-billing.md). Its requirements are proposed controls, not controls already present in M1.

## M4 — Live AI and telephony

Goal: conduct bounded, authorized live calls and preserve useful conversation outcomes.

- [ ] Select approved AI/speech and telephony providers and record their operational constraints.
- [ ] Add a Node.js voice gateway if persistent audio connections require it.
- [ ] Verify incoming provider events and bind media connections to authorized call sessions.
- [ ] Connect approved business knowledge and validated tools through tenant-aware services.
- [ ] Implement interruption, timeout, completion, and human-handoff paths.
- [ ] Apply duration, concurrency, destination, usage, and spending limits with an emergency stop.
- [ ] Keep recordings/transcripts private and implement applicable retention/redaction behavior.
- [ ] Verify prompt-injection boundaries, unauthorized actions, provider failures, and concurrent usage.
- [ ] Run a controlled pilot before general availability.

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
