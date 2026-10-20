# aisistent

An AI assistant for business calls and messages. The current deliverable is an interactive website demo with Serbian UI, built with Next.js, React, TypeScript, and Node.js.

The demo includes four scripted industry conversations, playback controls, an example dashboard, a temporary knowledge editor, mobile navigation, and FAQ answers. Its businesses, conversations, and metrics are illustrative. It does not connect to real AI, telephony, accounts, or payments.

## Run locally

Use Node.js 22 LTS or newer and npm. Development has been checked with Node.js 24.

```sh
cd demo
npm ci
npm run dev
```

Open [http://127.0.0.1:4310](http://127.0.0.1:4310).

```sh
npm run typecheck
npm run build
```

Run these commands from `demo/`. The production build exports the static site to `demo/out/`. No environment variables or provider accounts are needed for this demo.

## Project map

| Path | Purpose |
| --- | --- |
| `demo/app/` | Landing page, shared styles, layout, and metadata |
| `demo/components/ConversationDemo.tsx` | Scripted conversations for four industries |
| `demo/components/DashboardPreview.tsx` | Example dashboard, conversations, and temporary knowledge entries |
| [PRODUCT.md](PRODUCT.md) | Confirmed requirements and current scope |
| [docs/MILESTONES.md](docs/MILESTONES.md) | Delivery checkpoints, dependencies, and acceptance criteria |
| [docs/HANDOFF.md](docs/HANDOFF.md) | Current state, verification evidence, and next-agent starting point |
| [CLAUDE.md](CLAUDE.md) | Entry point for continuing development with Claude |
| [demo/DESIGN.md](demo/DESIGN.md) | Current design tokens and component conventions |
| [docs/architecture/security-and-billing.md](docs/architecture/security-and-billing.md) | Proposed production controls and paid-launch gates |
| [ai-asistent-plan.md](ai-asistent-plan.md) | Earlier Serbian product and architecture proposal |

## Delivery sequence

1. **M1 — Interactive website demo:** implemented and checked locally; GitHub release checkpoint pending.
2. **M2 — App shell and onboarding UI:** next, using clearly labeled example data.
3. **M3 — Persistent platform and production security:** Next.js/Node.js services, identity, tenant boundaries, and operations.
4. **M4 — Live AI and telephony:** controlled provider integrations after the platform safeguards.
5. **M5 — Pricing and subscriptions:** approved recurring-payment integration for the Serbian merchant after security readiness.

Security, live integrations, pricing, and recurring billing are future milestones. They must not be inferred from the demo's appearance.

## Continuing development

Start with [AGENTS.md](AGENTS.md) and [docs/HANDOFF.md](docs/HANDOFF.md). Source is maintained in [aionogi/aisistent](https://github.com/aionogi/aisistent). Use small commits and immutable milestone tags following `milestone-N-name`, such as `milestone-1-interactive-demo`. Each checkpoint should state what works, how it was checked, and what remains.

Code, identifiers, comments, and implementation documentation are English. The product name is **aisistent**, lowercase. Python requires a documented need that cannot reasonably be met with the existing Node.js stack.
