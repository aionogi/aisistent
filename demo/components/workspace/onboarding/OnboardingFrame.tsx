"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { Check, LayoutDashboard, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { blockingStep, isStepId, onboardingHref, STEPS } from "../../../lib/workspace/steps";
import { isStepComplete } from "../../../lib/workspace/validation";
import Brand from "../../Brand";
import { useDraft } from "../DraftProvider";
import { DraftNotices } from "../StatusViews";
import styles from "./onboarding.module.css";

export default function OnboardingFrame({ children }: { children: ReactNode }) {
  const segment = useSelectedLayoutSegment();
  const current = segment && isStepId(segment) ? segment : null;
  const currentIndex = current ? STEPS.findIndex((step) => step.id === current) : -1;
  const { draft, ready } = useDraft();

  return (
    <div className={styles.frame}>
      <a className="skip-link" href="#onboarding-main">Pređi na sadržaj</a>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brandLink} aria-label="aisistent početna"><Brand /></Link>
        <div className={styles.topbarTitle}>
          <strong>Podešavanje asistenta</strong>
          <span className={styles.exampleBadge}><span aria-hidden="true" />Demo · primer podataka</span>
        </div>
        <Link href="/workspace/" className={styles.exitLink}><LayoutDashboard size={16} aria-hidden="true" /><span>Radni prostor</span></Link>
      </header>

      <nav className={styles.stepper} aria-label="Koraci podešavanja">
        {currentIndex >= 0 && <p className={styles.stepCount}>Korak {currentIndex + 1} od {STEPS.length}<span> · {STEPS[currentIndex].label}</span></p>}
        <ol>
          {STEPS.map((step, index) => {
            const isCurrent = step.id === current;
            const done = ready && step.id !== "review" && isStepComplete(step.id, draft) && !isCurrent;
            const locked = !ready || Boolean(blockingStep(step.id, draft));
            const content = (
              <>
                <span className={styles.stepMarker} aria-hidden="true">{done ? <Check size={14} /> : locked && !isCurrent ? <Lock size={12} /> : index + 1}</span>
                <span className={styles.stepLabel}>{step.label}</span>
                {done && <span className="visually-hidden"> (završeno)</span>}
              </>
            );
            return (
              <li key={step.id} className={`${styles.step} ${isCurrent ? styles.currentStep : ""} ${done ? styles.doneStep : ""}`}>
                {locked && !isCurrent
                  ? <span className={styles.stepLink} aria-disabled="true">{content}<span className="visually-hidden"> (dostupno posle prethodnih koraka)</span></span>
                  : <Link href={onboardingHref(step.id)} className={styles.stepLink} aria-current={isCurrent ? "step" : undefined}>{content}</Link>}
              </li>
            );
          })}
        </ol>
      </nav>

      <main id="onboarding-main" className={styles.main}>
        <DraftNotices />
        {children}
      </main>

      <footer className={styles.footer}>
        Demo bez prijave. Podaci su primeri i čuvaju se samo u ovoj kartici pregledača, dok je ne zatvorite. Ništa se ne šalje na server.
      </footer>
    </div>
  );
}
