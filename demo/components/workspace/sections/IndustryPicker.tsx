"use client";

import { useState } from "react";
import { Briefcase, Scissors, Stethoscope, UtensilsCrossed, Wrench, type LucideIcon } from "lucide-react";
import { applyIndustryTemplate, chooseIndustry, INDUSTRY_LABELS, matchesIndustryTemplate } from "../../../lib/workspace/templates";
import type { IndustryId } from "../../../lib/workspace/types";
import type { FieldErrors } from "../../../lib/workspace/validation";
import { useDraft } from "../DraftProvider";
import { FieldMessage, fieldId } from "../FormControls";
import { useWorkspaceEnvironment } from "../WorkspaceEnvironment";
import styles from "../forms.module.css";

export const INDUSTRY_ICONS: Record<IndustryId, LucideIcon> = {
  salon: Scissors,
  clinic: Stethoscope,
  garage: Wrench,
  restaurant: UtensilsCrossed,
  other: Briefcase,
};

const industryIds = Object.keys(INDUSTRY_LABELS) as IndustryId[];

/**
 * Industry choice. In the demo, while the draft still holds an unedited example,
 * a choice fills it from that industry's template; after edits, the user decides
 * whether to replace them. In an organization a choice never invents business
 * data or replaces anything entered (see `chooseIndustry`), so it needs no confirmation.
 */
export default function IndustryPicker({ errors, showErrors }: { errors: FieldErrors; showErrors: boolean }) {
  const { draft, updateDraft } = useDraft();
  const environment = useWorkspaceEnvironment();
  const isDemo = environment.mode === "demo";
  const [pending, setPending] = useState<IndustryId | null>(null);
  const hasOwnDetails = !matchesIndustryTemplate(draft);
  const error = showErrors ? errors.industry : undefined;

  function choose(industry: IndustryId) {
    if (industry === draft.industry) {
      setPending(null);
      return;
    }
    if (!isDemo) {
      updateDraft((current) => chooseIndustry(current, industry, environment.organizationName));
      return;
    }
    if (hasOwnDetails) {
      setPending(industry);
      return;
    }
    updateDraft((current) => applyIndustryTemplate(current, industry));
  }

  return (
    <fieldset className={styles.fieldset} aria-describedby={error ? `${fieldId("industry")}-error` : undefined}>
      <legend className={styles.legend}>Delatnost</legend>
      <p className={styles.legendHint}>{isDemo
        ? "Primer podataka za izabranu delatnost možete kasnije menjati u svakom koraku."
        : "Prema delatnosti predlažemo radno vreme, ton, česte usluge i pitanja klijenata. Ništa se ne upisuje umesto vas: predlog primenjujete jednim klikom."}</p>
      <div className={styles.industryGrid}>
        {industryIds.map((industry, index) => {
          const Icon = INDUSTRY_ICONS[industry];
          const checked = (pending ?? draft.industry) === industry;
          return (
            <label key={industry} className={`${styles.choiceCard} ${checked ? styles.choiceSelected : ""}`}>
              <input
                type="radio"
                name="industry"
                value={industry}
                id={index === 0 ? fieldId("industry") : undefined}
                checked={checked}
                onChange={() => choose(industry)}
                className={styles.visuallyHidden}
              />
              <span className={styles.choiceIcon}><Icon size={20} strokeWidth={1.8} aria-hidden="true" /></span>
              <span className={styles.choiceText}>
                <strong>{INDUSTRY_LABELS[industry].label}</strong>
                <span>{INDUSTRY_LABELS[industry].description}</span>
              </span>
            </label>
          );
        })}
      </div>
      <FieldMessage id={fieldId("industry")} error={error} />

      {isDemo && pending && (
        <div className={styles.inlineConfirm} role="group" aria-labelledby="industry-confirm-title">
          <p id="industry-confirm-title">
            <strong>Popuniti primerom za „{INDUSTRY_LABELS[pending].label}“?</strong>
            Zamenićete podatke o poslu, radno vreme, ton i bazu znanja u ovom nacrtu.
          </p>
          <div className={styles.inlineActions}>
            <button type="button" className={styles.primaryButton} onClick={() => { updateDraft((current) => applyIndustryTemplate(current, pending)); setPending(null); }}>Zameni primerom</button>
            <button type="button" className={styles.secondaryButton} onClick={() => { updateDraft((current) => ({ ...current, industry: pending })); setPending(null); }}>Zadrži moje podatke</button>
            <button type="button" className={styles.textButton} onClick={() => setPending(null)}>Otkaži</button>
          </div>
        </div>
      )}
    </fieldset>
  );
}
