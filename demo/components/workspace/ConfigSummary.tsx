"use client";

import Link from "next/link";
import { CircleAlert, CircleCheck, PencilLine } from "lucide-react";
import type { ReactNode } from "react";
import { summarizeHours } from "../../lib/workspace/format";
import { HANDOFF_LABELS, INDUSTRY_LABELS, TONE_LABELS, UNKNOWN_ANSWER_LABELS } from "../../lib/workspace/templates";
import type { StepId } from "../../lib/workspace/types";
import { validateStep } from "../../lib/workspace/validation";
import { useDraft } from "./DraftProvider";
import styles from "./pages.module.css";

type SectionStep = Exclude<StepId, "review">;

// `readOnly` shows the same summary without edit controls.
type EditTarget = { editHref: (step: SectionStep) => string } | { onEdit: (step: SectionStep) => void } | { readOnly: true };

function SummarySection({ step, title, target, children }: { step: SectionStep; title: string; target: EditTarget; children: ReactNode }) {
  const { draft } = useDraft();
  const problems = Object.keys(validateStep(step, draft)).length;
  return (
    <section className={styles.summarySection} aria-labelledby={`summary-${step}`}>
      <header>
        <h2 id={`summary-${step}`}>{title}</h2>
        {problems === 0
          ? <span className={styles.statusOk}><CircleCheck size={14} aria-hidden="true" />Spremno</span>
          : <span className={styles.statusWarn}><CircleAlert size={14} aria-hidden="true" />{problems === 1 ? "1 problem" : `${problems} problema`}</span>}
        {"editHref" in target
          ? <Link href={target.editHref(step)} className={styles.editLink} aria-label={`Izmeni: ${title}`}><PencilLine size={14} aria-hidden="true" />Izmeni</Link>
          : "onEdit" in target && <button type="button" onClick={() => target.onEdit(step)} className={styles.editLink} aria-label={`Izmeni: ${title}`}><PencilLine size={14} aria-hidden="true" />Izmeni</button>}
      </header>
      {children}
    </section>
  );
}

const show = (value: string) => value.trim() || <span className={styles.missing}>Nije uneto</span>;

/** Read-only review of the complete example configuration with links back to each editor. */
export default function ConfigSummary(target: EditTarget) {
  const { draft } = useDraft();
  const { business, assistant } = draft;
  const services = business.services.filter((service) => service.name.trim());

  return (
    <div className={styles.summaryGrid}>
      <SummarySection step="industry" title="Delatnost" target={target}>
        <p className={styles.summaryValue}>{draft.industry ? INDUSTRY_LABELS[draft.industry].label : <span className={styles.missing}>Nije izabrano</span>}</p>
      </SummarySection>

      <SummarySection step="business" title="Podaci o poslu" target={target}>
        <dl className={styles.definitionList}>
          <div><dt>Naziv</dt><dd>{show(business.name)}</dd></div>
          <div><dt>Mesto</dt><dd>{show([business.address, business.city].filter((part) => part.trim()).join(", "))}</dd></div>
          {business.website.trim() && <div><dt>Sajt</dt><dd>{business.website}</dd></div>}
          {business.description.trim() && <div><dt>Opis</dt><dd>{business.description}</dd></div>}
          <div><dt>Usluge</dt><dd>{services.length ? services.map((service) => service.duration.trim() ? `${service.name} (${service.duration})` : service.name).join(", ") : <span className={styles.missing}>Nema usluga</span>}</dd></div>
        </dl>
      </SummarySection>

      <SummarySection step="hours" title="Radno vreme" target={target}>
        <ul className={styles.hoursSummary}>
          {summarizeHours(draft.hours).map((line) => <li key={line.days} className={line.open ? "" : styles.closedLine}><span>{line.days}</span><span>{line.hours}</span></li>)}
        </ul>
      </SummarySection>

      <SummarySection step="assistant" title="Ponašanje asistenta" target={target}>
        <dl className={styles.definitionList}>
          <div><dt>Ime i ton</dt><dd>{show(assistant.name)} · {TONE_LABELS[assistant.tone].label}</dd></div>
          <div><dt>Pozdrav</dt><dd>{assistant.greeting.trim() ? `„${assistant.greeting.trim()}“` : <span className={styles.missing}>Nije unet</span>}</dd></div>
          <div><dt>Zakazivanje</dt><dd>{assistant.bookingEnabled ? "Predlaže slobodne termine" : "Prosleđuje zahteve timu"}</dd></div>
          <div><dt>Prepušta timu</dt><dd>{assistant.handoffTopics.length ? assistant.handoffTopics.map((topic) => HANDOFF_LABELS[topic]).join(", ") : "Nijedna tema"}</dd></div>
          <div><dt>Bez odgovora</dt><dd>{UNKNOWN_ANSWER_LABELS[assistant.unknownAnswer].label}</dd></div>
        </dl>
      </SummarySection>
    </div>
  );
}
