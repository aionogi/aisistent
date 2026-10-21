# aisistent

An AI assistant for business calls and messages. The current deliverable is an interactive website demo with Serbian UI, built with Next.js, React, TypeScript, and Node.js.

The landing page includes four scripted industry conversations, playback controls, an example dashboard, mobile navigation, and FAQ answers. A separate demo workspace (`/workspace/`) and guided onboarding (`/onboarding/`) let you configure an example assistant: industry, business details, services, working hours, tone, greeting, handoff rules, and a knowledge base. The configuration stays in the current browser tab. Its businesses, conversations, and metrics are illustrative. It does not connect to real AI, telephony, accounts, or payments.

[Open the private demo](https://aisistent-demo.cheery-pin-9983.chatgpt.site) (M1 version; not yet republished with M2). Access remains limited to the owner's Sites account; GitHub source can be run locally without that account.

## Run locally

Use Node.js 22 LTS or newer and npm. Development has been checked with Node.js 24.

```sh
cd demo
npm ci
npm run dev
```

Open [http://127.0.0.1:4310](http://127.0.0.1:4310), or go straight to [/onboarding/](http://127.0.0.1:4310/onboarding/) or [/workspace/](http://127.0.0.1:4310/workspace/).

```sh
npm run typecheck
npm test
npm run build
npm run start
```

Run these commands from `demo/`. `npm test` starts a temporary PostgreSQL 17 server for the database tests (no Docker needed). `npm run dev:local-auth` runs the signed-in app locally with a mock identity provider at http://127.0.0.1:4313/account/, and `npm run test:e2e` tests the sign-in flow end to end. The app runs without environment variables or provider accounts; database features activate only when a database is configured. Deployment uses `render.yaml` (Render, Frankfurt).

## Project map

| Path | Purpose |
| --- | --- |
| `demo/app/` | Landing page, shared styles, layout, and metadata |
| `demo/components/ConversationDemo.tsx` | Scripted conversations for four industries |
| `demo/components/DashboardPreview.tsx` | Landing-page dashboard preview with temporary knowledge entries |
| `demo/app/(product)/` | Onboarding and workspace routes sharing one browser-tab draft |
| `demo/components/workspace/` | App shell, onboarding steps, setup forms, and workspace pages |
| `demo/lib/workspace/` | Draft types, industry templates, validation, storage, and example conversations |
| [PRODUCT.md](PRODUCT.md) | Confirmed requirements and current scope |
| [docs/MILESTONES.md](docs/MILESTONES.md) | Delivery checkpoints, dependencies, and acceptance criteria |
| [docs/HANDOFF.md](docs/HANDOFF.md) | Current state, verification evidence, and next-agent starting point |
| [CLAUDE.md](CLAUDE.md) | Entry point for continuing development with Claude |
| [demo/DESIGN.md](demo/DESIGN.md) | Current design tokens and component conventions |
| [docs/architecture/security-and-billing.md](docs/architecture/security-and-billing.md) | Proposed production controls and paid-launch gates |
| [ai-asistent-plan.md](ai-asistent-plan.md) | Earlier Serbian product and architecture proposal |

## Delivery sequence

1. **M1 — Interactive website demo:** complete; pushed as `milestone-1-interactive-demo`.
2. **M2 — App shell and onboarding UI:** complete, using clearly labeled example data; tagged `milestone-2-app-shell`.
3. **M3 — Persistent platform and production security:** in progress on Render (Frankfurt), Auth0 (EU), and Cloudflare R2 (EU); database tenancy foundation with tested row-level security is in place.
4. **M4 — Live AI and telephony:** controlled provider integrations after the platform safeguards.
5. **M5 — Pricing and subscriptions:** approved recurring-payment integration for the Serbian merchant after security readiness.

Security, live integrations, pricing, and recurring billing are future milestones. They must not be inferred from the demo's appearance.

## Continuing development

Start with [AGENTS.md](AGENTS.md) and [docs/HANDOFF.md](docs/HANDOFF.md). Source is maintained in [aionogi/aisistent](https://github.com/aionogi/aisistent). Use small commits and immutable milestone tags following `milestone-N-name`, such as `milestone-1-interactive-demo`. Each checkpoint should state what works, how it was checked, and what remains.

Code, identifiers, comments, and implementation documentation are English. The product name is **aisistent**, lowercase. Python requires a documented need that cannot reasonably be met with the existing Node.js stack.
