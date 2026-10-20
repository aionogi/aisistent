# aisistent interactive demo

A Next.js/React/TypeScript prototype with Serbian UI, self-hosted Manrope typography, and responsive desktop/mobile layouts.

## Run

Install dependencies with `npm ci`, then run `npm run dev`. Local address: `http://127.0.0.1:4310`.

`npm run typecheck` checks TypeScript. `npm run build` produces a static Next.js export in `out/`, used for the private Sites demo.

## Demo behavior

- Landing page (`/`): four industry-specific text conversation simulations with pause, resume, and replay; a dashboard preview with a local-only FAQ editor (entries reset when switching away from its tab or reloading); mobile navigation and expandable FAQ answers.
- Onboarding (`/onboarding/`): five guided steps for industry, business details and services, working hours, assistant behavior, and a final review.
- Workspace (`/workspace/`): overview, example conversations built from the configuration, an assistant settings editor, and a knowledge base editor.
- The onboarding and workspace share one draft stored in `sessionStorage`: it survives navigation and reloads in the same tab and is cleared when the tab closes or with "Obriši nacrt".

All business names and conversation records are illustrative. There is no microphone access, live telephony, account, payment, pricing, subscription, or external AI connection. Production security and billing remain future work per the user's revised scope.
