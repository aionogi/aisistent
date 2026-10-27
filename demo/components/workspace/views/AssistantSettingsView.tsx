"use client";

import Link from "next/link";
import { CircleAlert, CircleCheck } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { formatUpdatedAt } from "../../../lib/workspace/format";
import type { StepId } from "../../../lib/workspace/types";
import { validateAssistant, validateBusiness, validateDraft, validateHours, validateIndustry, type FieldErrors } from "../../../lib/workspace/validation";
import AssistantPreview from "../AssistantPreview";
import ConfigSummary from "../ConfigSummary";
import { useDraft } from "../DraftProvider";
import { Notice } from "../FormControls";
import { onboardingStartHref } from "../../../lib/workspace/steps";
import { PageHeader } from "../PageParts";
import { useWorkspaceEnvironment } from "../WorkspaceEnvironment";
import AssistantForm from "../sections/AssistantForm";
import BusinessForm from "../sections/BusinessForm";
import HoursForm from "../sections/HoursForm";
import IndustryPicker from "../sections/IndustryPicker";
import styles from "../pages.module.css";

type TabId = "business" | "hours" | "behavior" | "review";

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "business", label: "Posao" },
  { id: "hours", label: "Radno vreme" },
  { id: "behavior", label: "Ponašanje" },
  { id: "review", label: "Pregled" },
];

const tabForStep: Record<Exclude<StepId, "review">, TabId> = { industry: "business", business: "business", hours: "hours", assistant: "behavior" };

function tabErrors(tab: TabId, errors: { industry: FieldErrors; business: FieldErrors; hours: FieldErrors; assistant: FieldErrors }): number {
  if (tab === "business") return Object.keys(errors.industry).length + Object.keys(errors.business).length;
  if (tab === "hours") return Object.keys(errors.hours).length;
  if (tab === "behavior") return Object.keys(errors.assistant).length;
  return 0;
}

/**
 * Edits the same draft as onboarding. Changes apply immediately and validation is always visible.
 * Read-only sessions get the summary instead of forms that would ignore their input.
 */
export default function AssistantSettingsView() {
  const { draft, readOnly } = useDraft();
  const environment = useWorkspaceEnvironment();
  const [active, setActive] = useState<TabId>("business");
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({ business: null, hours: null, behavior: null, review: null });
  const errors = { industry: validateIndustry(draft), business: validateBusiness(draft), hours: validateHours(draft), assistant: validateAssistant(draft) };
  const allErrors = validateDraft(draft);
  const problemCount = Object.keys(allErrors).length;

  function selectTab(tab: TabId, focus = false) {
    setActive(tab);
    if (focus) tabRefs.current[tab]?.focus();
  }

  function handleKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
      : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length
        : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    selectTab(tabs[next].id, true);
  }

  return (
    <>
      <PageHeader
        title="Podešavanje asistenta"
        badge={environment.mode === "demo" ? "Primer podataka" : "Podaci firme"}
        description={environment.mode === "demo" ? "Izmene se odmah primenjuju na nacrt u ovoj kartici i na primere razgovora."
          : readOnly ? "Pregled podešavanja asistenta vaše firme." : "Izmene se automatski čuvaju za vašu firmu i odmah se vide u primerima razgovora."}
      />

      {!draft.onboardingCompleted && !readOnly && (
        <Notice tone="info" title="Početno podešavanje nije završeno" action={<Link href={onboardingStartHref(environment.onboardingBasePath)} className={styles.noticeLink}>Nastavi korak po korak</Link>}>
          Podatke možete uređivati i ovde. Vođeno podešavanje vas vodi redom do završnog pregleda.
        </Notice>
      )}

      <div className={styles.saveStatus} role="status">
        {problemCount === 0
          ? <span className={styles.statusOk}><CircleCheck size={14} aria-hidden="true" />Konfiguracija je potpuna · {formatUpdatedAt(draft.updatedAt)}</span>
          : <span className={styles.statusWarn}><CircleAlert size={14} aria-hidden="true" />{problemCount === 1 ? "1 polje treba ispraviti" : `${problemCount} polja treba ispraviti`} · {formatUpdatedAt(draft.updatedAt)}</span>}
      </div>

      <div className={styles.settingsLayout}>
        <div className={styles.settingsMain}>
          {readOnly ? <div className={styles.tabPanel}><ConfigSummary readOnly /></div> : <>
          <div className={styles.tabs} role="tablist" aria-label="Delovi podešavanja">
            {tabs.map((tab, index) => {
              const count = tabErrors(tab.id, errors);
              return (
                <button
                  key={tab.id}
                  ref={(node) => { tabRefs.current[tab.id] = node; }}
                  type="button"
                  role="tab"
                  id={`settings-tab-${tab.id}`}
                  aria-controls={`settings-panel-${tab.id}`}
                  aria-selected={active === tab.id}
                  tabIndex={active === tab.id ? 0 : -1}
                  onClick={() => selectTab(tab.id)}
                  onKeyDown={(event) => handleKey(event, index)}
                >
                  {tab.label}
                  {count > 0 && <span className={styles.tabBadge}><span aria-hidden="true">{count}</span><span className="visually-hidden">, problema: {count}</span></span>}
                </button>
              );
            })}
          </div>
          <div id={`settings-panel-${active}`} role="tabpanel" aria-labelledby={`settings-tab-${active}`} className={styles.tabPanel} tabIndex={0}>
            {active === "business" && <><IndustryPicker errors={errors.industry} showErrors /><BusinessForm errors={errors.business} showErrors /></>}
            {active === "hours" && <HoursForm errors={errors.hours} showErrors />}
            {active === "behavior" && <AssistantForm errors={errors.assistant} showErrors />}
            {active === "review" && <ConfigSummary onEdit={(step) => selectTab(tabForStep[step], true)} />}
          </div>
          </>}
        </div>
        <AssistantPreview />
      </div>
    </>
  );
}
