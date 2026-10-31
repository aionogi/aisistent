---
name: aisistent
description: A light, conversational interface with azure accents and a blue voice orb.
colors:
  blue: "#2159e8"
  blue-dark: "#1749c8"
  ink: "#142038"
  muted: "#62708a"
  secondary-text: "#5c6d86"
  speaker-text: "#496798"
  success-detail: "#4d6a5b"
  line: "#e6eaf0"
  surface: "#f5f7fb"
  white: "#ffffff"
  call-surface: "#f1f5ff"
  selected: "#edf3ff"
  positive: "#307c5b"
  positive-surface: "#eaf5ed"
  pending: "#9b6720"
  pending-surface: "#fff4e7"
  pending-text: "#84561b"
  danger: "#b42318"
  danger-surface: "#fdf1f0"
typography:
  display:
    fontFamily: '"Manrope Variable", Manrope, sans-serif'
    fontSize: "clamp(48px, 4.65vw, 68px)"
    fontWeight: 650
    lineHeight: 1.105
    letterSpacing: "-0.04em"
  headline:
    fontFamily: '"Manrope Variable", Manrope, sans-serif'
    fontSize: "clamp(32px, 3.4vw, 46px)"
    fontWeight: 650
    lineHeight: 1.18
    letterSpacing: "-0.035em"
  title:
    fontFamily: '"Manrope Variable", Manrope, sans-serif'
    fontSize: "16px"
    fontWeight: 700
    letterSpacing: "-0.025em"
  body:
    fontFamily: '"Manrope Variable", Manrope, sans-serif'
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.75
  control:
    fontFamily: '"Manrope Variable", Manrope, sans-serif'
    fontSize: "13px"
    fontWeight: 700
rounded:
  field: "5px"
  control: "8px"
  large-control: "9px"
  illustration: "12px"
  panel: "16px"
  pill: "24px"
  header: "42px"
  circle: "50%"
spacing:
  compact: "8px"
  small: "12px"
  base: "16px"
  medium: "20px"
  panel: "24px"
  large: "32px"
components:
  button-primary:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.white}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "13px 19px"
  button-primary-hover:
    backgroundColor: "{colors.blue-dark}"
  button-white:
    backgroundColor: "{colors.white}"
    textColor: "{colors.blue-dark}"
    rounded: "{rounded.large-control}"
    padding: "13px 23px"
  playback-button:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
    width: "100%"
  knowledge-input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "10px"
  pill-navigation:
    backgroundColor: "rgba(255,255,255,0.96)"
    textColor: "{colors.ink}"
    rounded: "{rounded.header}"
    padding: "0 26px"
  scenario-tab:
    backgroundColor: "{colors.white}"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "0 20px"
  scenario-tab-selected:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.blue}"
  outcome-chip:
    backgroundColor: "{colors.positive-surface}"
    textColor: "{colors.positive}"
    rounded: "4px"
    padding: "4px 6px"
  conversation-detail:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "16px"
  voice-orb:
    rounded: "{rounded.circle}"
    size: "245px"
---

# Design System: aisistent

## Overview

**Creative North Star: "A clear voice in a light workspace"**

This phrase describes the implemented system rather than a separately approved brand slogan. The interface uses white space, dark blue text, azure actions, and a softly lit voice orb to make a conversational product approachable. The user selected call0.ai as visual inspiration; aisistent retains its lowercase identity and its own Serbian Latin copy.

The landing page has generous spacing and large, closely tracked headings. The embedded conversation and dashboard previews use denser rows, quiet dividers, and pale blue selection states. Decorative depth belongs mainly to the hero illustration; working panels stay restrained. These notes capture the static Next.js prototype, whose example records and scripted interactions remain clearly labeled.

**Key Characteristics:**

- White surfaces, azure actions, and muted blue-gray supporting text.
- Self-hosted Manrope for headings, body text, and controls.
- A pill-shaped header and a CSS voice orb with orbit lines and floating conversation cards.
- Compact, bordered demo panels with visible selection and keyboard focus.

Sources: `app/globals.css`, `app/page.tsx`, `app/layout.tsx`, the `ConversationDemo` and `DashboardPreview` component files, and (since M2) `components/workspace/*.module.css`. Most frontmatter values are literal colors in the CSS; since M2, `:root` in `globals.css` also exposes `--secondary-text`, `--selected`, the positive/pending pairs, and `--danger`/`--danger-surface` as variables. The sidecar (`.impeccable/design.json`) was generated before M2 and does not yet include `pending-text`, `danger`, or `danger-surface`; its tonal ramps are generated previews, not shipped tokens.

## Colors

White and pale blue surfaces give the saturated action color room to stand out.

### Primary

- **Azure** (`blue`): primary actions, selected controls, brand details, progress, and headline emphasis.
- **Deep Azure** (`blue-dark`): primary action hover and text on the closing white button.
- **Conversation Blue** (`call-surface`) and **Selected Blue** (`selected`): the call panel, assistant messages, and selected scenario tabs.

### Secondary

- **Outcome Green** (`positive`, `positive-surface`): successful illustrative conversation outcomes.
- **Pending Amber** (`pending`, `pending-surface`): example outcomes that need attention. Small amber text on the pale amber surface uses **Pending Text** (`pending-text`, 5.8:1) rather than `pending` (4.4:1). These status colors are not competing brand accents.
- **Error Red** (`danger`, `danger-surface`): validation messages, the error summary, problem counts on tabs, and destructive confirmations in the M2 screens. Always paired with a written message.

### Neutral

- **Ink** (`ink`): headings and principal content.
- **Blue Gray** (`muted`): supporting copy and quieter controls.
- **Secondary Text** (`secondary-text`): small workflow, FAQ, footer, timer, and supporting labels. **Speaker Text** (`speaker-text`) is tinted for the pale blue transcript surface; **Success Detail** (`success-detail`) supports the green completion message. These values reflect the final contrast correction.
- **Divider Gray** (`line`): panel boundaries and separators.
- **Cloud** (`surface`): detail panels and the knowledge form.
- **White** (`white`): the page, navigation, fields, and primary panel surfaces.

**The State Has a Label Rule.** Pair outcome colors with their written status; retain selected-state semantics on interactive controls.

## Typography

**Display Font:** Manrope Variable, with Manrope and sans-serif fallbacks.
**Body Font:** The same family, self-hosted through `@fontsource-variable/manrope`.

The rounded letterforms keep the interface conversational. Headings use tight spacing and intermediate variable weights; controls are more compact and heavier. Time and count readouts use tabular numerals where implemented.

### Hierarchy

- **Display:** the frontmatter's display role is the desktop hero. The existing responsive overrides use a medium-width headline (55px), a fluid mobile headline (`clamp(40px, 7.5vw, 58px)`), and a small-screen headline (41px).
- **Headline:** the shared section heading role. The conversation section has a local variation (`clamp(32px, 4vw, 44px)`) with tighter tracking.
- **Title:** the workflow step headings. Dashboard headings and call-panel titles have larger local sizes appropriate to their panels.
- **Body:** the shared prose baseline. The hero uses a larger introduction (16px, line height 1.8) within a readable width (430px).
- **Control:** the shared landing action. Scenario and playback controls use a slightly lighter weight (600).

Small illustration annotations and dashboard microcopy exist in the source, but are not a recommended general text scale for future application screens.

## Layout

The landing container is centered, capped at 1140px, and keeps 32px desktop side gutters. The rounded header is wider, capped at 1304px with 24px outer gutters. The hero divides copy and illustration into near-equal columns; workflow steps form three columns. The simulator and dashboard are capped at 1120px.

The simulator separates the call controls from the transcript in a `.91fr / 1.09fr` grid. The dashboard places a 190px sidebar alongside a flexible content pane. Interior spacing repeatedly uses the compact-to-large values in the frontmatter; major sections use generous, individually tuned vertical padding rather than a universal section token.

At 1100px the hero illustration and header spacing tighten. At 800px the landing page gains 20px side gutters, stacks the hero, and reveals a menu button. At 780px the simulator stacks its panels and retains four scenario choices in one row. At 700px dashboard navigation moves above its content. At 520px workflow steps become rows with a thumbnail beside their text. Additional 390px and 380px rules compact the dashboard and simulator respectively. A 960px dashboard breakpoint narrows its sidebar; a 1500px minimum-width rule gives the hero more height.

## Elevation & Depth

Most functional surfaces use pale fills and thin borders. The hero adds translucent white cards, diffuse shadows, elliptical orbit strokes, and a blue radial gradient with inset highlights. This keeps the strongest dimensional treatment around the illustrative voice rather than everyday controls.

### Shadow Vocabulary

- **Floating question** (`0 8px 28px #244d8a0a`): the small tilted conversation prompt.
- **Hero call card** (`0 22px 58px -17px #1d4b962b`): the principal floating conversation example.
- **Appointment chip** (`0 12px 38px #254c7b14`): the smaller outcome card.
- **Phone ring** (`0 0 0 10px #e8eeff`): a tonal ring around the simulator phone icon; playback adds another pale ring.

**The Illustration Carries Depth Rule.** Preserve the hero's soft dimensional artwork and the working panels' quieter borders and tonal separation.

## Shapes

The header is a long pill. Common controls use modest rounded corners, fields use tighter corners, and major demo panels use the panel radius. Circular silhouettes belong to the orb, phone indicator, avatars, and status dots. Message bubbles have asymmetric corners to distinguish assistant and caller sides.

The blue voice orb is CSS artwork: a circular gradient body, a tilted internal ring, a blurred highlight, and seven white waveform bars. Fine orbit lines and slightly tilted cards complete the illustration. Lucide icons and the landing brand's inline SVG provide the line-art vocabulary.

## Components

### Buttons

Azure buttons carry the principal action; a white variant appears on the azure closing section. The shared control has a minimum height (44px), while the large action increases it (54px). The header action uses a pill radius. Hover shifts shared buttons upward (2px) and changes their fill; global keyboard focus uses a blue outline (3px) with separation (5px).

The simulator's full-width playback button has its own minimum height (48px), smaller upward hover movement (1px), and a pressed state that returns to its starting position. Its label and icon reflect play, pause, resume, or replay.

### Chips

Scenario choices are rounded rectangular tabs with an icon, a written label, and a pale selected fill. They use a tablist with arrow-key navigation, Home/End handling, and a focusable associated panel. Outcome chips in the dashboard use green or amber plus written status; they are informational, not buttons.

### Cards / Containers

The simulator and dashboard are white bordered panels with rounded outer corners and clipped internal divisions. Conversation rows highlight on hover and selection. The selected conversation's detail card uses the Cloud fill, a small outlined icon tile, a heading, a summary, and an outcome line. Hero cards use the separate floating shadow vocabulary.

### Inputs / Fields

The knowledge editor uses visible labels, white fields, a thin cool-gray border, and the field radius. Input and textarea content has internal padding (10px). Keyboard focus uses an outlined ring (3px, offset 3px). The fields are required and have length limits; the textarea resizes vertically. No bespoke invalid or disabled visual treatment is defined. Added entries remain temporary example data.

### Navigation

The landing header combines the lowercase wordmark, compact section links, and a demo action. Mobile navigation opens beneath the header with a bordered white surface; link activation closes it. The dashboard uses vertical icon-and-label buttons on desktop and a horizontal row on mobile, with pale azure selection. The page includes a focus-revealed skip link.

### Voice Orb and Conversation

The orb floats slowly (7s); its bars move gently (2.2s). The simulator has a separate active waveform (0.85s), a progress indicator, timed messages, and a completion outcome. These animations visualize scripted text; they do not represent captured audio or a live call.

The application disables animations and transitions under `prefers-reduced-motion: reduce`, including smooth scrolling. The transcript uses a polite live region, and FAQ disclosures use native `details` and `summary` elements.

## Application screens (M2)

The onboarding (`/onboarding/`) and workspace (`/workspace/`) reuse the landing palette and Manrope, but at working density: 14px base text, 13px labels, and 24–30px page titles instead of the landing display scale. Global `h2` sizing from `globals.css` is overridden in each module.

- **Shell:** a 248px sidebar (`#fbfcfe`, divider border) with the wordmark, a workspace card, icon-and-label navigation in pale azure selection, a setup-progress card while onboarding is unfinished, and the storage note with "Obriši nacrt". Below 860px the sidebar becomes a header with a four-column tab row; the reset action becomes an icon button.
- **Onboarding:** a white top bar, a five-item step indicator (current step outlined in azure, completed steps in Outcome Green, locked steps dashed), and one white card per step on the Cloud background. Below 720px the step labels collapse to numbers with a "Korak N od 5" line, and actions stack full width.
- **Forms:** visible labels, 44px minimum control height, 6px field radius, azure focus ring, red border plus written message for invalid fields, and an error summary with links that focus each field. Choices use radio cards with a pale azure selected state; booking uses a switch. Inputs use 16px text on narrow screens to avoid mobile zoom.
- **Feedback:** notices in info (pale azure), success (pale green), and warning (pale amber) variants; native `<dialog>` confirmations for destructive actions; a skeleton loading state while the browser-tab draft is read.
- **Read-only sessions (M3):** members, and owners/admins who still need the MFA step-up, see summaries and labels instead of inputs that would ignore them: the assistant page shows the configuration summary, team roles appear as chips, edit links read "Pogledaj", and the sidebar says "Samo pregled". The step-up notice is a warning with a "Dvofaktorska potvrda" link that returns to the organization.
- **Organization page (M3):** "Firma" in the navigation for every role. White panels for export (secondary button) and leaving (text button behind a native confirmation dialog), and for owners a delete panel with a light red border, the organization name typed into a field, and a red button that stays grey and disabled until the name matches.
- **Knowledge import:** "Uvezi iz fajla" (demo) or "Uvezi odgovore" (organization), secondary, beside "Dodaj odgovor" opens a pale azure panel like the knowledge editor. In an organization a segmented control picks "Iz fajla" or "Sa stranice sajta". File: a short hint, collapsible format examples in monospace boxes, a Serbian file button with the chosen file name. Web page: a hint that only that one public page is read, an "Adresa stranice" field and "Učitaj stranicu"; the summary names the page title and host and reminds that site text may be outdated. Both: a bold summary, a white scrollable list (max 420 px) of every entry with an 18 px checkbox, the question in bold and the answer muted, an "Izaberi sve" / "Poništi izbor" text button, collapsible skipped rows or items with reasons, and "Dodaj N odgovora" (ticked entries) / "Otkaži".
- **Account sessions:** a white "Prijave na uređajima" card on `/account/` with a bordered list (bold sign-in time, small grey activity and expiry line), a short advice note, and an outlined "Odjavi me sa svih uređaja" button.
- **Stored conversations:** the same list and detail layout as the examples, with the "Podaci firme" badge, the retention period in the description, outcome chips (green for booked/answered, amber for handoff/unanswered), Belgrade times, and an outlined "Obriši razgovor" button with a confirmation dialog for owners and admins. Contacts without a name show "?" initials.
- **Icons and contrast:** every lucide icon gets `aria-hidden="true"` unless it carries its own `aria-label` (a unit test checks this). Small grey text on tinted backgrounds needs at least 4.5:1; use `#505e76` on `#e6ebf3` counts, `#56637a` for initials on `#e9edf5`, `#8a5a18` on the pale amber chip, and `#5c6d86` for 10–12 px notes.
- **No inline styles:** the production CSP blocks `style` attributes. Put fixed sizes in CSS (for example `:nth-child` heights for waveform bars) and set changing sizes through the CSSOM (`components/ProgressFill.tsx`).
- **404 and error pages:** a centred white card on the Cloud background with the wordmark, a title, one sentence, and a blue primary plus an outlined secondary action (global `.status-*` classes).
- **Help chat (landing, account and 404 pages):** an azure pill "Pomoć" button fixed 24 px from the bottom right (16 px on phones) opens a white 380 px panel with a 16 px radius and the hero-card shadow: a header with a pale azure chat icon, "Pomoć za aisistent", the grey line "Unapred napisani odgovori · nije AI", and icon buttons for a new conversation and closing; a light message area with a bordered privacy notice, pale azure replies on the left and azure visitor messages on the right; white pill links and suggested questions with azure text; a 44 px field with an azure send button; and a footer line with a "Privatnost" text button that expands a grey note. On phones the panel becomes a full-width bottom sheet and the button hides while it is open.
- **Firm overview:** a real organization's Pregled has its name as the title with the "Podaci firme" badge, four status cards (Danas, Baza znanja, Tim, Razgovori; the last muted while empty), a "Šta dalje" list beside "Kako se asistent javlja", and a full-width "Poslednji razgovori" panel with a dashed empty state. No invented data; only the demo shows examples. Workspace content is at most 1240 px wide and centered in the space beside the sidebar.
- **Example labels:** every demo workspace page header carries a "Primer podataka" badge; reply previews and example conversations state that they are rule-assembled and not AI output or real calls.

## Do's and Don'ts

### Do:

- **Do** preserve lowercase aisistent branding and Serbian Latin interface copy.
- **Do** reuse azure actions, white surfaces, pale selections, and the existing Manrope hierarchy.
- **Do** keep example labels beside simulated conversations, records, and outcomes.
- **Do** preserve keyboard focus, written status labels, and reduced-motion behavior.

### Don't:

- **Don't** present the illustrated orb or animated waveform as evidence of a live microphone or call.
- **Don't** turn fixture metrics, status chips, or temporary knowledge entries into claims of customers, durable storage, or production readiness.
- **Don't** infer pricing, payment, security, or integration implementation from the prototype's visual polish.
