"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, BookOpen, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { blockingStep, onboardingHref, STEPS } from "../../../lib/workspace/steps";
import type { StepId } from "../../../lib/workspace/types";
import { validateStep } from "../../../lib/workspace/validation";
import AssistantPreview from "../AssistantPreview";
import ConfigSummary from "../ConfigSummary";
import { useDraft } from "../DraftProvider";
import { ErrorSummary, Notice } from "../FormControls";
import AssistantForm from "../sections/AssistantForm";
import BusinessForm from "../sections/BusinessForm";
import HoursForm from "../sections/HoursForm";
import IndustryPicker from "../sections/IndustryPicker";
import { DraftLoading } from "../StatusViews";
import styles from "./onboarding.module.css";

export default function OnboardingStep({ step }: { step: StepId }) {
  const { draft, ready, updateDraft, setFlash } = useDraft();
  const router = useRouter();
  // Each blocked "next" attempt bumps this, which reveals errors and moves focus to the summary.
  const [attempts, setAttempts] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const index = STEPS.findIndex((item) => item.id === step);
  const definition = STEPS[index];
  const previous = STEPS[index - 1];
  const next = STEPS[index + 1];
  const errors = validateStep(step, draft);
  const errorCount = Object.keys(errors).length;

  // After in-app navigation the pressed button unmounts; move focus to the new step's heading.
  useEffect(() => {
    if (ready && (document.activeElement === document.body || document.activeElement === null)) headingRef.current?.focus();
  }, [ready, step]);

  useEffect(() => {
    if (attempts > 0) summaryRef.current?.focus();
  }, [attempts]);

  if (!ready) return <DraftLoading />;

  const blocker = blockingStep(step, draft);
  if (blocker) {
    return (
      <section className={styles.card} aria-labelledby="step-title">
        <h1 id="step-title" ref={headingRef} tabIndex={-1} className={styles.stepTitle}>{definition.title}</h1>
        <Notice tone="warning" title="Ovaj korak još nije dostupan" action={<Link href={onboardingHref(blocker.id)} className={styles.noticeLink}>Idi na korak „{blocker.label}“</Link>}>
          Prvo popunite korak „{blocker.label}“. Koraci se otključavaju redom, da bi pregled na kraju bio potpun.
        </Notice>
      </section>
    );
  }

  function goNext() {
    if (errorCount > 0) {
      setAttempts((count) => count + 1);
      return;
    }
    if (step === "review") {
      updateDraft((current) => ({ ...current, onboardingCompleted: true }));
      setFlash("Podešavanje je završeno. Konfiguracija postoji samo u ovom demo nacrtu; asistent nije povezan sa telefonom niti aktiviran.");
      router.push("/workspace/");
      return;
    }
    router.push(onboardingHref(next.id));
  }

  const showErrors = attempts > 0;

  return (
    <section className={styles.card} aria-labelledby="step-title">
      <div className={styles.stepIntro}>
        <h1 id="step-title" ref={headingRef} tabIndex={-1} className={styles.stepTitle}>{definition.title}</h1>
        <p>{definition.description}</p>
      </div>

      {showErrors && step !== "review" && <ErrorSummary ref={summaryRef} errors={errors} />}
      {showErrors && step === "review" && errorCount > 0 && (
        <div ref={summaryRef} tabIndex={-1} role="alert">
          <Notice tone="warning" title="Podešavanje još nije potpuno">Otvorite sekcije označene upozorenjem i ispravite navedena polja.</Notice>
        </div>
      )}

      <form
        className={styles.stepForm}
        noValidate
        onSubmit={(event) => { event.preventDefault(); goNext(); }}
      >
        {step === "industry" && <IndustryPicker errors={errors} showErrors={showErrors} />}
        {step === "business" && <BusinessForm errors={errors} showErrors={showErrors} />}
        {step === "hours" && <HoursForm errors={errors} showErrors={showErrors} />}
        {step === "assistant" && <AssistantForm errors={errors} showErrors={showErrors} />}
        {step === "review" && (
          <div className={styles.reviewLayout}>
            <div className={styles.reviewMain}>
              <ConfigSummary editHref={onboardingHref} />
              <div className={styles.knowledgeNote}>
                <BookOpen size={17} aria-hidden="true" />
                <p>
                  <strong>Baza znanja: {draft.knowledge.length === 1 ? "1 odgovor" : `${draft.knowledge.length} odgovora`} iz primera.</strong>
                  {" "}Odgovore dodajete i menjate u radnom prostoru, posle podešavanja.
                </p>
              </div>
            </div>
            <AssistantPreview />
          </div>
        )}

        <div className={styles.actions}>
          {previous
            ? <Link href={onboardingHref(previous.id)} className={styles.backButton}><ArrowLeft size={16} aria-hidden="true" />Nazad</Link>
            : <Link href="/workspace/" className={styles.backButton}><ArrowLeft size={16} aria-hidden="true" />Radni prostor</Link>}
          <button type="submit" className={styles.nextButton}>
            {step === "review"
              ? <>{draft.onboardingCompleted ? "Sačuvaj i otvori radni prostor" : "Završi podešavanje"}<Check size={16} aria-hidden="true" /></>
              : <>Dalje: {next.label}<ArrowRight size={16} aria-hidden="true" /></>}
          </button>
        </div>
      </form>
    </section>
  );
}
