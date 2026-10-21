"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, Bot, CalendarClock, Check, ChevronRight, Circle, MessageSquare, PhoneOff, Sparkles } from "lucide-react";
import { useState } from "react";
import { buildExampleConversations } from "../../../lib/workspace/conversations";
import { todayHours } from "../../../lib/workspace/format";
import { onboardingHref, onboardingStartHref, STEPS } from "../../../lib/workspace/steps";
import { createCompleteExample, matchesIndustryTemplate, TONE_LABELS } from "../../../lib/workspace/templates";
import { isStepComplete, validateDraft } from "../../../lib/workspace/validation";
import ConfirmDialog from "../ConfirmDialog";
import { useDraft } from "../DraftProvider";
import { Notice } from "../FormControls";
import { PageHeader } from "../PageParts";
import { useWorkspaceEnvironment, workspacePath } from "../WorkspaceEnvironment";
import styles from "../pages.module.css";

function SetupChecklist() {
  const { draft, replaceDraft, setFlash, readOnly } = useDraft();
  const environment = useWorkspaceEnvironment();
  const isDemo = environment.mode === "demo";
  const [confirmExample, setConfirmExample] = useState(false);
  const editable = STEPS.filter((step) => step.id !== "review");
  const hasOwnData = !matchesIndustryTemplate(draft);

  function loadExample() {
    replaceDraft(createCompleteExample());
    setFlash("Učitan je kompletan primer salona „Studio Mila“. Sve podatke možete menjati.");
  }

  return (
    <>
      <PageHeader
        title={isDemo ? "Dobro došli u radni prostor" : environment.organizationName ?? "Radni prostor firme"}
        badge={isDemo ? "Primer podataka" : "Podaci firme"}
        description={isDemo ? "Podesite asistenta u nekoliko koraka ili učitajte kompletan primer da biste odmah istražili radni prostor." : "Podesite asistenta za vašu firmu u nekoliko koraka. Izmene se čuvaju automatski."}
      />
      <section className={styles.setupPanel} aria-labelledby="setup-title">
        <div className={styles.setupIntro}>
          <span className={styles.setupIcon}><Sparkles size={20} aria-hidden="true" /></span>
          <h2 id="setup-title">Podešavanje asistenta</h2>
          <p>Delatnost, podaci o poslu, radno vreme i način razgovora. Na kraju pregledate celu konfiguraciju.</p>
          <div className={styles.inlineButtons}>
            {!readOnly && <Link href={onboardingStartHref(environment.onboardingBasePath)} className={styles.primaryLink}>{draft.industry ? "Nastavi podešavanje" : "Započni podešavanje"}<ArrowRight size={16} aria-hidden="true" /></Link>}
            {isDemo && <button type="button" className={styles.secondaryAction} onClick={() => (hasOwnData ? setConfirmExample(true) : loadExample())}>Učitaj kompletan primer</button>}
          </div>
        </div>
        <ol className={styles.checklist}>
          {editable.map((step, index) => {
            const done = step.id !== "review" && isStepComplete(step.id, draft);
            return (
              <li key={step.id} className={done ? styles.checkDone : undefined}>
                <span className={styles.checkMarker} aria-hidden="true">{done ? <Check size={14} /> : <Circle size={10} />}</span>
                <span><strong>{index + 1}. {step.label}</strong><span>{done ? "Spremno" : "Čeka unos"}</span></span>
                <Link href={onboardingHref(step.id, environment.onboardingBasePath)} className={styles.checkLink} aria-label={`Otvori korak: ${step.label}`}><ChevronRight size={16} aria-hidden="true" /></Link>
              </li>
            );
          })}
        </ol>
      </section>
      <ConfirmDialog open={confirmExample} title="Zameniti nacrt primerom?" confirmLabel="Učitaj primer" onClose={() => setConfirmExample(false)} onConfirm={loadExample}>
        <p>Podaci koje ste uneli u ovoj kartici zameniće se kompletnim primerom salona „Studio Mila“.</p>
      </ConfirmDialog>
    </>
  );
}

export default function OverviewView() {
  const { draft } = useDraft();
  const environment = useWorkspaceEnvironment();
  if (!draft.onboardingCompleted) return <SetupChecklist />;

  const { business, assistant } = draft;
  const conversations = buildExampleConversations(draft);
  const teamCount = conversations.filter((conversation) => conversation.status === "team").length;
  const today = todayHours(draft.hours, new Date());
  const problems = Object.keys(validateDraft(draft)).length;

  return (
    <>
      <PageHeader title={business.name || "Vaš radni prostor"} description="Primer kako bi izgledao vaš radni dan sa asistentom. Brojke i razgovori su izmišljeni." />

      {problems > 0 && (
        <Notice tone="warning" title={problems === 1 ? "Podešavanje ima 1 problem" : `Podešavanje ima ${problems} problema`} action={<Link href={workspacePath(environment, "assistant")} className={styles.noticeLink}>Ispravi</Link>}>
          Neko polje je u međuvremenu ostalo prazno ili neispravno. Primeri odgovora koriste trenutne vrednosti.
        </Notice>
      )}

      <div className={styles.statusGrid}>
        <div className={styles.statusCard}>
          <span className={styles.statusIcon}><Bot size={18} aria-hidden="true" /></span>
          <span className={styles.statusLabel}>Asistent</span>
          <strong>{assistant.name || "Bez imena"}</strong>
          <span className={styles.statusMeta}>{TONE_LABELS[assistant.tone].label} ton · {assistant.bookingEnabled ? "zakazuje termine" : "prosleđuje zahteve"}</span>
        </div>
        <div className={styles.statusCard}>
          <span className={styles.statusIcon}><CalendarClock size={18} aria-hidden="true" /></span>
          <span className={styles.statusLabel}>Danas</span>
          <strong>{today.open ? "Otvoreno" : "Zatvoreno"}</strong>
          <span className={styles.statusMeta}>{today.label}</span>
        </div>
        <div className={styles.statusCard}>
          <span className={styles.statusIcon}><BookOpen size={18} aria-hidden="true" /></span>
          <span className={styles.statusLabel}>Baza znanja</span>
          <strong>{draft.knowledge.length === 1 ? "1 odgovor" : `${draft.knowledge.length} odgovora`}</strong>
          <Link href={workspacePath(environment, "knowledge")} className={styles.statusLink}>Uredi odgovore</Link>
        </div>
        <div className={`${styles.statusCard} ${styles.statusMuted}`}>
          <span className={styles.statusIcon}><PhoneOff size={18} aria-hidden="true" /></span>
          <span className={styles.statusLabel}>Telefonska linija</span>
          <strong>Nije povezana</strong>
          <span className={styles.statusMeta}>Povezivanje poziva dolazi u kasnijoj fazi.</span>
        </div>
      </div>

      <div className={styles.overviewColumns}>
        <section className={styles.panel} aria-labelledby="recent-title">
          <div className={styles.panelHeading}>
            <h2 id="recent-title">Poslednji razgovori</h2>
            <span>{conversations.length} primera · {teamCount} za vaš tim</span>
          </div>
          <ul className={styles.compactList}>
            {conversations.slice(0, 3).map((conversation) => (
              <li key={conversation.id}>
                <span className={styles.initials} aria-hidden="true">{conversation.initials}</span>
                <span className={styles.compactPerson}><strong>{conversation.name}</strong><span>{conversation.channel === "call" ? "Poziv" : "Poruka"} · {conversation.time}</span></span>
                <span className={`${styles.chip} ${conversation.status === "team" ? styles.chipPending : ""}`}>{conversation.outcome}</span>
              </li>
            ))}
          </ul>
          <Link href={workspacePath(environment, "conversations")} className={styles.panelLink}><MessageSquare size={15} aria-hidden="true" />Svi primeri razgovora<ArrowRight size={15} aria-hidden="true" /></Link>
        </section>

        <section className={styles.panel} aria-labelledby="greeting-title">
          <div className={styles.panelHeading}>
            <h2 id="greeting-title">Kako se asistent javlja</h2>
            <span>Iz podešavanja</span>
          </div>
          <div className={`${styles.bubble} ${styles.assistantBubble}`}>
            <span className={styles.bubbleSpeaker}>{assistant.name || "Asistent"}</span>
            <p>{assistant.greeting || <em>Pozdrav još nije unet.</em>}</p>
          </div>
          <Link href={workspacePath(environment, "assistant")} className={styles.panelLink}><Bot size={15} aria-hidden="true" />Uredi ponašanje asistenta<ArrowRight size={15} aria-hidden="true" /></Link>
        </section>
      </div>
    </>
  );
}
