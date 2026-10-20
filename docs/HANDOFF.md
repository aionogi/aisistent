# Development handoff

Updated: 2026-10-21.

## Current objective

M1 and M2 are implemented. The user wants milestone-based progress in [aionogi/aisistent](https://github.com/aionogi/aisistent) so Claude or another AI agent can continue from GitHub. The next milestone is M3: persistent platform and production security. M3 starts with decisions the user must make (hosting, identity provider, database/storage); do not implement M3 infrastructure before those are recorded.

- M1 tag: [`milestone-1-interactive-demo`](https://github.com/aionogi/aisistent/tree/milestone-1-interactive-demo) at `0517b631fc31d7b579cc089a40eb9d404f70e72f`.
- M2 tag: [`milestone-2-app-shell`](https://github.com/aionogi/aisistent/tree/milestone-2-app-shell) at `479188b983699114e0393875592292f109273dbe`, pushed on 2026-10-21 together with `main`. The implementation commit is `fbd4ae8`.
- Private demo: [aisistent](https://aisistent-demo.cheery-pin-9983.chatgpt.site), owner-only access. It was published from M1 and has **not** been republished with M2; the M2 screens are available by running the source locally.
- Continue from current `main`.

The user explicitly deferred production security implementation, pricing, and monthly recurring billing until after the demo. Strong security remains a requirement before real customer data and paid use. The merchant company is based in Serbia.

## What exists

- A Next.js 16 App Router application in `demo/`, with React 19, TypeScript, Lucide icons, and self-hosted Manrope.
- **Landing page (M1)** at `/`: Serbian marketing page, four scripted industry conversations with playback controls, example dashboard preview, FAQ, mobile navigation. M2 added links to the workspace and onboarding.
- **Guided onboarding (M2)** at `/onboarding/`: five steps (`industry`, `business`, `hours`, `assistant`, `review`), each a static route generated from `[step]`. `/onboarding/` resumes at the first incomplete step.
  - Industry choice fills an example template (salon, clinic, auto service, restaurant, or an empty "other"). While the draft is still an unedited template, switching industry replaces it silently; after edits, an inline confirmation asks whether to replace or keep the user's details.
  - Business details with up to eight services, working hours per day with "copy Monday to weekdays", and assistant behavior (name, tone, greeting with a tone-based suggestion, booking on/off, handoff topics, unknown-answer rule).
  - Review shows the full configuration with per-section status and edit links, next to a rule-based reply preview.
  - Steps unlock in order. Blocked "next" reveals inline errors and an error summary whose links focus the affected field.
- **Workspace shell (M2)** at `/workspace/` with sidebar navigation (horizontal tab row below 860 px):
  - Overview: setup checklist and "load complete example" before onboarding is finished; afterwards status cards, recent example conversations, and the greeting.
  - Conversations: five example conversations assembled from the draft (services, hours, knowledge, handoff and unknown-answer rules), with search, status filters, detail and transcript.
  - Assistant: tabbed editor (business, hours, behavior, review) reusing the onboarding forms, with live validation, problem counts per tab, and the reply preview.
  - Knowledge: add, edit, delete (with confirmation), search, and restore industry examples.
  - Reset: "Obriši nacrt" clears the draft after a native modal confirmation.
- Static export configuration. There is no backend API or database.
- Production architecture and security requirements in the documents linked below.

All example business names, conversations, outcomes, and usage metrics are illustrative. There are no verified customer testimonials or security certifications.

## Draft state decision (M2)

One `WorkspaceDraft` object (`demo/lib/workspace/types.ts`) holds the whole example configuration. `DraftProvider` lives in the `app/(product)/layout.tsx` route-group layout, so onboarding and the workspace share it during client navigation.

- Storage: `sessionStorage` key `aisistent.workspace-draft.v1`. The draft survives navigation and reloads in the same tab and disappears when the tab closes. Nothing is sent to a server. The UI states this in the onboarding footer, workspace sidebar, and landing-page link.
- Loading: the draft is read after hydration, so prerendered pages show a loading state first.
- Errors: a stored value with an unexpected shape is discarded and the user sees a notice. If storage is blocked or a write fails, the draft continues in memory and a warning explains that a reload loses it.
- Validation rules live in `demo/lib/workspace/validation.ts` and are shared by onboarding and the workspace. The parser in `storage.ts` accepts only the current shape (`version: 1`); M3 should replace this with server-side validation and persistence rather than extend it.

## Known boundaries

- Conversations are scripted or rule-assembled text. There is no microphone, audio recording, live AI request, or telephony connection. The "reply preview" and example conversations are deterministic templates filled from the draft, not AI output.
- The workspace shows "Telefonska linija: Nije povezana"; no integration exists.
- There is no authentication, persistent organization state, pricing, checkout, billing, or subscription enforcement. The workspace is open to anyone who loads the page and contains only browser-local example data.
- The M1 landing dashboard preview (`DashboardPreview.tsx`) keeps its own fixtures and temporary knowledge editor; it is independent of the M2 draft.
- `demo/next.config.ts` uses `output: "export"`. Server APIs and production sessions will require a deployment/configuration decision in M3.
- The metadata requests no indexing. Preview metadata and production indexing need an explicit launch decision later.
- The demo is not evidence that the proposed security architecture has been implemented or audited.

## Start locally

Use Node.js 22 LTS or newer; the current work was developed with Node.js 24. Run from the repository root:

```sh
cd demo
npm ci
npm run dev
```

Local URLs: [http://127.0.0.1:4310](http://127.0.0.1:4310), [/onboarding/](http://127.0.0.1:4310/onboarding/), [/workspace/](http://127.0.0.1:4310/workspace/).

Run validation from `demo/`:

```sh
npm run typecheck
npm run build
```

`npm run build` writes the static export to `demo/out/` (14 static routes in M2). No provider keys or `.env` file are necessary. Use `package-lock.json` through `npm ci` to reproduce the dependency versions.

## Source guide

| Path | Responsibility |
| --- | --- |
| `demo/app/page.tsx` | Landing-page structure, mobile-menu state, links into the workspace |
| `demo/app/globals.css` | Shared tokens and landing design; M2 added status/danger tokens and `.visually-hidden` |
| `demo/app/layout.tsx` | Font, Serbian language, metadata, global styles |
| `demo/app/(product)/layout.tsx` | Route group that mounts the shared `DraftProvider` |
| `demo/app/(product)/onboarding/` | Onboarding frame, resume page, and `[step]` static routes |
| `demo/app/(product)/workspace/` | Workspace shell layout and the four workspace pages |
| `demo/components/Brand.tsx` | Wordmark shared by the landing page, onboarding, and workspace |
| `demo/components/ConversationDemo.tsx` | M1 scripted conversations, playback timer, accessible industry tabs |
| `demo/components/DashboardPreview.tsx` | M1 landing dashboard preview |
| `demo/components/workspace/DraftProvider.tsx` | Draft state, sessionStorage sync, notices, flash messages |
| `demo/components/workspace/sections/` | Industry, business, hours, and assistant forms used in both flows |
| `demo/components/workspace/onboarding/` | Onboarding frame, step component, resume redirect |
| `demo/components/workspace/views/` | Overview, conversations, assistant settings, knowledge pages |
| `demo/components/workspace/*.module.css` | `forms`, `shell`, `pages`, and `onboarding` styles |
| `demo/lib/workspace/` | Types, industry templates, validation, storage, steps, formatting, example conversations |
| `demo/next.config.ts` | Static export settings |
| `demo/AGENTS.md` | Next.js-generated guidance for the installed version |

Read [PRODUCT.md](../PRODUCT.md) for current requirements, [MILESTONES.md](MILESTONES.md) for acceptance criteria, and [security-and-billing.md](architecture/security-and-billing.md) before adding protected data or payment features. The older [Serbian plan](../ai-asistent-plan.md) contains future proposals; its planned monorepo structure is not the current file tree.

## Verification record

### M2 (2026-10-21)

Checked in the Claude desktop app's built-in browser against `next dev` on port 4311 (port 4310 was occupied by another local process). The browser pane was hidden for most of the session, so most interactions were driven through DOM events and accessibility-tree reads; real keyboard input was used where noted.

| Check | Evidence |
| --- | --- |
| TypeScript and production build | `npm run typecheck` and `npm run build` passed after the final changes; static export generated 14 routes, including five onboarding steps and four workspace pages |
| Complete onboarding path | Empty draft → industry → business → hours → assistant → review → "Završi podešavanje" → workspace overview with confirmation message |
| Validation states | Missing industry, short business name, invalid website, service row without a name, no services, end time before start, no open days, short greeting, empty knowledge question/answer; error summary focus and summary links focusing fields; errors clear as fields are fixed |
| Step gating | Direct load of `/onboarding/hours/` on an empty draft shows the blocked notice; `/onboarding/` resumes at the first incomplete step |
| Industry templates | Switching between unedited templates replaces silently; after an edit, the replace/keep/cancel confirmation appears and "keep" preserves entered details |
| Draft persistence | Data survives client navigation between onboarding and workspace and a full reload in the same tab |
| Error and loading states | Malformed stored draft discarded with a dismissible notice; simulated storage write failure shows the in-memory warning; loading state renders before hydration |
| Empty states | Workspace before onboarding, conversations before onboarding, conversation search with no results, empty knowledge base, knowledge search with no results |
| Workspace pages | Conversation filters, search, selection; assistant tabs with live validation and per-tab problem counts; review tab edit buttons; knowledge add/edit/delete/search/restore; draft reset dialog; complete-example loading; flash message cleared on navigation |
| Keyboard | Real Tab/Arrow/Enter input in onboarding (radio cards selectable with arrows, Enter submits, focus moves to the next step heading); tablist Arrow/Home/End handling; native dialog Escape returns focus; skip links present |
| Layout | No horizontal page overflow at 390 px for all workspace pages, assistant tabs, all onboarding steps, and the landing page; desktop checked at 1440 px for overview, conversations, and review |
| Contrast | New text/surface pairs computed at 4.9:1 or higher (status chips, warnings, errors, placeholders, locked steps); disabled controls are below that by design |
| Console | No errors logged during the session |

Limitations: no automated end-to-end or accessibility test suite exists; no screen reader was used; time inputs follow the browser's locale (an English-locale browser showed 12-hour format); the M1 landing interactions were not re-tested beyond rendering and overflow, as their code is unchanged except for the shared `Brand` extraction and new links.

### M1

| Check | Evidence |
| --- | --- |
| Production build and TypeScript | Passed on 2026-10-21, including static export |
| Desktop/mobile layout | Browser checked at 1440 px and 390 px; no horizontal overflow after corrections |
| Interactions | Four scenarios, playback controls, knowledge editor, conversation selection, mobile navigation, FAQ |
| Contrast correction | Secondary labels darkened; reviewer scored the targeted correction resolved at 4.83:1 to 5.95:1 |
| Production integrations/security | Not implemented or tested |

The CI template at `docs/ci/demo-checks.yml.example` repeats dependency installation, TypeScript checks, and the production build. It is not enabled: the existing GitHub credential can push source but lacks the `workflow` scope. Local checks passed; no GitHub Actions run is claimed.

## Next agent's first steps

1. Inspect `git status`, the current branch, and remote before editing. Preserve any unfinished changes.
2. Read this handoff, `AGENTS.md`, `docs/MILESTONES.md`, and `docs/architecture/security-and-billing.md`.
3. Install locked dependencies and run the checks above. Read the relevant installed Next.js guide before framework changes.
4. M3 needs the user's decisions first: production hosting, managed identity provider, database and private storage. Present options with current provider verification and record the choices in `docs/` before writing server code.
5. When M3 starts, replace `output: "export"` with a Node.js deployment, move the `WorkspaceDraft` shape to server-validated persisted records per organization, and keep the M2 UI as the client of those APIs.
6. Keep the M2 demo path available (or clearly separated) until real accounts exist, so example data never mixes with customer data.

Do not add real authentication, payment collection, or live provider calls merely to make the UI appear complete. Those belong to their milestones and require the corresponding controls.

## GitHub handoff

Target remote: `https://github.com/aionogi/aisistent.git`.

The root repository tracks `demo/` as ordinary files, with no nested Git repository. Private preview publishing uses ignored `.site-publish/` staging so its separate source workflow does not replace the GitHub remote.

Use small, descriptive commits and milestone tags named `milestone-N-name`. Published tags: `milestone-1-interactive-demo` and `milestone-2-app-shell`. Only mark future milestones released after their source and tag are pushed successfully. Never commit `.env` files, provider credentials, `node_modules`, `.next`, `out`, or local runtime helpers such as `.claude/launch.json`.

## Suggested continuation instruction

Read `AGENTS.md`, `CLAUDE.md`, `docs/HANDOFF.md`, `docs/MILESTONES.md`, `PRODUCT.md`, `demo/DESIGN.md`, and `docs/architecture/security-and-billing.md`. M1 and M2 are complete. Prepare M3 by presenting hosting, identity, and database options for a Serbian merchant with current provider verification, and ask the user to choose before implementing. Preserve the M2 onboarding and workspace UI. Do not start real AI calls, telephony, pricing, or payments. Finish each checkpoint with checks, an updated handoff, a commit, and a push. If context is nearly exhausted, record a coherent partial checkpoint honestly rather than marking incomplete acceptance criteria complete.

## Open decisions for later phases

Production hosting, identity provider, database/storage, AI and telephony providers, retention/recovery targets, merchant approval, prices, currencies, and trial/grace policies remain open. Provider references in the architecture document are research candidates and need current verification when that phase begins.
