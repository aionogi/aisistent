# Claude handoff

Read `AGENTS.md`, `docs/HANDOFF.md`, `docs/MILESTONES.md`, `PRODUCT.md`, and `demo/DESIGN.md` before implementation. Those files are the shared source of truth for every coding agent.

Continue from the current `main` branch. The next milestone is M2: a dedicated app shell and a complete onboarding flow using clearly labeled example data. Preserve the landing-page demo. Security implementation, real AI/telephony, pricing, and payments belong to later milestones.

Finish one milestone at a time. Before context or token limits, stop at a coherent checkpoint, record completed work, actual validation, limitations, and the next concrete step in `docs/HANDOFF.md`, then commit and push to `https://github.com/aionogi/aisistent.git`. Never mark unfinished acceptance criteria complete. Do not move published milestone tags.

Use English code and documentation, Serbian Latin UI, Next.js and Node.js. Start with `cd demo`, `npm ci`, `npm run typecheck`, and `npm run build`. No provider credentials are needed for this prototype.
