# Claude handoff

Read `AGENTS.md`, `docs/HANDOFF.md`, `docs/MILESTONES.md`, `PRODUCT.md`, and `demo/DESIGN.md` before implementation. Those files are the shared source of truth for every coding agent.

Continue from the current `main` branch. M1 (landing demo) and M2 (workspace shell and onboarding with example data) are complete. The next milestone is M3: persistent platform and production security. The platform choice (Render Frankfurt, Render Postgres, Auth0 EU, Cloudflare R2 EU) is provisional and the user wants to revisit it; keep provider-specific code isolated as listed in `docs/architecture/m3-platform-options.md`. The database tenancy foundation and sign-in exist; continue from the next step in `docs/HANDOFF.md`. Never create provider accounts or handle credentials; the user does that. Preserve the landing page and the M2 workspace. Real AI/telephony, pricing, and payments belong to later milestones.

Finish one milestone at a time. Before context or token limits, stop at a coherent checkpoint, record completed work, actual validation, limitations, and the next concrete step in `docs/HANDOFF.md`, then commit and push to `https://github.com/aionogi/aisistent.git`. Never mark unfinished acceptance criteria complete. Do not move published milestone tags.

Current checkpoint: M3 operations and review fixes after Claude's `ec549e3`. Rate limits, redacted operational logs, bounded cleanup and the operations runbook are implemented; team concurrency and workspace MFA defects are fixed. Current evidence: 71 unit/database tests and 12 HTTP tests pass. Do not recreate these features. Follow `docs/HANDOFF.md` for the remaining browser check, synthetic backup/restore rehearsal and deployment decisions. M3 is not complete.

Use English code and documentation, Serbian Latin UI, Next.js and Node.js. Start with `cd demo`, `npm ci`, `npm run typecheck`, `npm test`, and `npm run build`. No provider credentials are needed to develop or test.
