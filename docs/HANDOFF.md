# Development handoff

Updated: 2026-10-21.

## Current objective

Finish and checkpoint M1, the interactive aisistent website demo. The user wants milestone-based progress in [aionogi/aisistent](https://github.com/aionogi/aisistent) so another AI agent can continue from GitHub. The next implementation milestone is M2: an app shell and onboarding UI.

The user explicitly deferred production security implementation, pricing, and monthly recurring billing until after the demo. Strong security remains a requirement before real customer data and paid use. The merchant company is based in Serbia.

## What exists

- A Next.js App Router application in `demo/`, with React, TypeScript, Lucide icons, and self-hosted Manrope.
- A Serbian landing page with mobile navigation, product workflow, demo, dashboard preview, FAQ, and calls to try the demo.
- Four timed text conversation scenarios with play, pause, resume, and replay.
- An example dashboard with overview, conversation selection, and a small knowledge editor.
- Static export configuration for preview hosting. There is no backend API or database.
- Production architecture and security requirements in the documents linked below.

All example business names, conversations, outcomes, and usage metrics are illustrative. There are no verified customer testimonials or security certifications.

## Known boundaries

- Conversations are scripted text animations. There is no microphone, audio recording, live AI request, or telephony connection.
- Dashboard records and metrics are fixtures, not customer data.
- Added knowledge entries exist only in the currently mounted preview. Leaving that view or reloading the page resets them. They do not change the scripted conversation responses.
- There is no authentication, persistent organization state, pricing, checkout, billing, or subscription enforcement.
- `demo/next.config.ts` uses `output: "export"`. Server APIs and production sessions will require a deployment/configuration decision in M3.
- The metadata currently requests no indexing. Preview metadata and production indexing need an explicit launch decision later.
- The demo is not evidence that the proposed security architecture has been implemented or audited.

## Start locally

Use Node.js 22 LTS or newer; the current work was developed with Node.js 24. Run from the repository root:

```sh
cd demo
npm ci
npm run dev
```

Local URL: [http://127.0.0.1:4310](http://127.0.0.1:4310).

Run validation from `demo/`:

```sh
npm run typecheck
npm run build
```

`npm run build` writes the static export to `demo/out/`. No provider keys or `.env` file are necessary. Use `package-lock.json` through `npm ci` to reproduce the dependency versions.

## Source guide

| File | Responsibility |
| --- | --- |
| `demo/app/page.tsx` | Landing-page structure and mobile-menu state |
| `demo/app/globals.css` | Shared design, hero artwork, layout, responsive behavior |
| `demo/app/layout.tsx` | Font, Serbian language, metadata, and global styles |
| `demo/components/ConversationDemo.tsx` | Scenario content, playback timer, accessible industry tabs |
| `demo/components/ConversationDemo.module.css` | Conversation simulator layout and presentation |
| `demo/components/DashboardPreview.tsx` | Overview, conversation details, and temporary knowledge editor |
| `demo/components/DashboardPreview.module.css` | Dashboard layout and responsive styles |
| `demo/next.config.ts` | Static export settings |
| `demo/AGENTS.md` | Next.js-generated guidance for the installed version |

Read [PRODUCT.md](../PRODUCT.md) for current requirements, [MILESTONES.md](MILESTONES.md) for acceptance criteria, and [security-and-billing.md](architecture/security-and-billing.md) before adding protected data or payment features. The older [Serbian plan](../ai-asistent-plan.md) contains future proposals; its planned monorepo structure is not the current file tree.

## Verification record

| Check | Current evidence |
| --- | --- |
| Production build and TypeScript | Final production build passed on 2026-10-21, including TypeScript and static export; standalone typecheck also passed after adding route type generation |
| Desktop layout | Browser checked at 1440 px; no horizontal overflow after corrections |
| Mobile layout | Browser checked at 390 px; no horizontal overflow after corrections |
| Industry choices | Four scenarios available and checked |
| Playback | Start, pause, resume, completion, and replay checked |
| Knowledge editor | Example entry accepted and shown in the active preview |
| Conversation selection | Selecting a different row updates its detail |
| Mobile navigation | Open/close and navigation checked |
| FAQ | Expand/collapse checked |
| Contrast correction | Secondary labels darkened; reviewer scored the targeted correction resolved at 4.83:1 to 5.95:1 against cited surfaces |
| Production integrations/security | Not implemented or tested |

These are implementation-session checks, not a maintained end-to-end test suite or comprehensive accessibility audit. The CI template at `docs/ci/demo-checks.yml.example` repeats dependency installation, TypeScript checks, and the production build. It is not enabled: the existing GitHub credential can push source but lacks the `workflow` scope. GitHub rejected the initial push containing an active workflow, so the configuration was preserved as documentation. Local checks passed; no GitHub Actions run is claimed.

The design documentation agent wrote `demo/DESIGN.md` and its sidecar before reaching a usage limit. The primary agent completed the final token updates and checked that the sidecar parses as JSON. The contrast verdict is scoped to the reported correction, not a comprehensive accessibility certification.

## Next agent's first steps

1. Inspect `git status`, the current branch, and remote before editing. Preserve any unfinished changes.
2. Read this handoff, `AGENTS.md`, and the milestone acceptance criteria.
3. Install locked dependencies and run the checks above. Read the relevant installed Next.js guide before framework changes.
4. If M1 still has unchecked release gates, finish those first and record the exact result.
5. Begin M2 with a dedicated app shell and a complete example onboarding flow. Reuse the visual language and the useful parts of the existing dashboard; preserve the landing-page demo.
6. Decide and document temporary draft-state behavior. Keep example/unsaved state clear in the UI.
7. Verify the full flow on desktop and mobile, then update these documents and publish a reviewable checkpoint.

Do not add real authentication, payment collection, or live provider calls merely to make the UI appear complete. Those belong to their later milestone and require the corresponding controls.

## GitHub handoff

Target remote: `https://github.com/aionogi/aisistent.git`.

The root repository tracks `demo/` as ordinary files, with no nested Git repository. Private preview publishing uses ignored `.site-publish/` staging so its separate source workflow does not replace the GitHub remote.

The repository began from `main` at `f6f9a2d` (initial repository commit). Subsequent commit hashes and tags are the source of truth; do not reset a newer checkout to that initial commit.

Use small, descriptive commits and milestone tags named `milestone-N-name`. M1's planned tag is `milestone-1-interactive-demo`. Only mark a milestone released after its source and tag are pushed successfully. Never commit `.env` files, provider credentials, `node_modules`, `.next`, `out`, or local runtime helpers.

## Open decisions for later phases

Production hosting, identity provider, database/storage, AI and telephony providers, retention/recovery targets, merchant approval, prices, currencies, and trial/grace policies remain open. Provider references in the architecture document are research candidates and need current verification when that phase begins.
