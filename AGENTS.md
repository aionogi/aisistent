# Working on aisistent

## Read first

- `PRODUCT.md`: confirmed product requirements and current scope.
- `docs/HANDOFF.md`: implementation state, validation, and immediate next task.
- `docs/MILESTONES.md`: dependencies and acceptance criteria.
- `demo/AGENTS.md`: installed Next.js guidance.

The current application lives in `demo/`. The older `ai-asistent-plan.md` is an architecture proposal; do not treat proposed components as implemented or create its entire future structure as part of a small task.

## Product constraints

- Product name: **aisistent**, lowercase.
- Use Next.js, Node.js, and TypeScript. Add Python only for a specific justified pipeline that the Node.js stack cannot reasonably provide.
- Keep source code, identifiers, comments, and implementation documentation in English. Current UI copy is Serbian Latin.
- The website takes inspiration from call0.ai; preserve aisistent's own copy and identity.
- The interactive demo (M1) and app-shell/onboarding UI (M2) are complete. Persistent platform and security (M3), live integrations, pricing, and subscriptions follow their documented milestones.
- The merchant company is based in Serbia. Revalidate provider availability and approval before choosing a payment integration.

## Implementation boundaries

- Keep simulations and illustrative records clearly labeled.
- Do not request real credentials, payment details, or microphone access in the demo.
- Do not claim real AI, telephony, persistent data, customer adoption, or implemented security from fixture behavior.
- Introduce production controls alongside the features they protect. Follow `docs/architecture/security-and-billing.md` before handling real customer data or payments.
- Read the relevant versioned documentation under `demo/node_modules/next/dist/docs/` before changing Next.js behavior. Preserve the generated instructions in `demo/AGENTS.md`.
- Avoid unrelated rewrites and dependencies. Reuse the current design language and components where appropriate.

## Validation

From `demo/`:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

The dev server is `http://127.0.0.1:4310` (landing `/`, onboarding `/onboarding/`, workspace `/workspace/`); the build output is `demo/out/`. No environment configuration is needed for the current demo.

For UI changes, check the affected interactions at desktop and mobile sizes, including horizontal overflow and keyboard access. Record checks actually performed and their limitations. Do not present proposed security gates as passing tests.

## Handoff and source control

- Before changing files, inspect the working tree and preserve unrelated work.
- Keep commits reviewable. Update `docs/HANDOFF.md` and milestone status when delivering a checkpoint.
- Use immutable checkpoint tags following `milestone-N-name`, such as `milestone-1-interactive-demo`, after acceptance checks pass.
- Target repository: `https://github.com/aionogi/aisistent.git`. Verify the remote and branch before pushing.
- Do not force-push or move published tags as a routine update.
- Exclude secrets, environment files, dependencies, build artifacts, caches, and local runtime helpers from commits.
- Never mark a push, deployment, or milestone complete without the corresponding successful result.
