# aisistent interactive demo

A Next.js/React/TypeScript prototype with Serbian UI, self-hosted Manrope typography, and responsive desktop/mobile layouts.

## Run

Install dependencies with `npm ci`, then run `npm run dev`. Local address: `http://127.0.0.1:4310`.

`npm run typecheck` checks TypeScript. `npm run build` produces the Node.js application in `.next/`; `npm run start` serves it. Static export is no longer configured. `npm test` runs unit/database tests and `npm run test:e2e` runs a disposable local identity/database/server stack. Stop any development server for this project before running the HTTP suite.

`npm run test:recovery` rehearses a logical backup/restore with synthetic data in two temporary databases. It additionally requires PostgreSQL 17 `pg_dump` and `pg_restore` on `PATH` or in `PG_CLIENT_BIN_DIR`; see the [runbook](../docs/operations/RUNBOOK.md#repeatable-local-rehearsal). It never uses an application database URL.

## Demo behavior

- Landing page (`/`): four industry-specific text conversation simulations with pause, resume, and replay; a dashboard preview with a local-only FAQ editor (entries reset when switching away from its tab or reloading); mobile navigation and expandable FAQ answers.
- Onboarding (`/onboarding/`): five guided steps for industry, business details and services, working hours, assistant behavior, and a final review.
- Workspace (`/workspace/`): overview, example conversations built from the configuration, an assistant settings editor, and a knowledge base editor.
- The onboarding and workspace share one draft stored in `sessionStorage`: it survives navigation and reloads in the same tab and is cleared when the tab closes or with "Obriši nacrt".

Demo business names and conversation records are illustrative. No microphone, live telephony, payment, pricing, subscription or external AI connection exists. M3 additionally provides configured sign-in, organization storage and team management at `/account/` and `/org/<id>/`; these routes are separate from the public demo. Hosting/identity remain provisional and nothing is deployed for production.

Database-backed requests require `RATE_LIMIT_SECRET` (32+ characters, shared across replicas). `npm run dev:local-auth` configures a mock identity provider, disposable PostgreSQL and a temporary secret automatically. `npm run ops:cleanup` runs bounded expiry cleanup with the restricted `DATABASE_URL`; an external scheduler still needs configuration. Read [the handoff](../docs/HANDOFF.md) and [operations runbook](../docs/operations/RUNBOOK.md) before deployment.
