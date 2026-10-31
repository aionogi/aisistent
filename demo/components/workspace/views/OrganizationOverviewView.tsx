"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, Bot, CalendarClock, Check, ChevronRight, Circle, Clock, MessageSquare, Phone, Users } from "lucide-react";
import { hoursForDay } from "../../../lib/workspace/format";
import { conversationsLabel, membersLabel, nextSteps } from "../../../lib/workspace/organization-overview";
import type { DayId } from "../../../lib/workspace/types";
import { useDraft } from "../DraftProvider";
import { PageHeader } from "../PageParts";
import { useWorkspaceEnvironment, workspacePath } from "../WorkspaceEnvironment";
import styles from "../pages.module.css";
import { SetupChecklist } from "./OverviewView";
import { displayName, initials, OUTCOMES, timeFormat, type ConversationRow } from "./StoredConversationsView";

/** A real organization's overview. Everything shown comes from its own data; the examples stay in the demo. */
export default function OrganizationOverviewView({ today, members, pendingInvitations, conversationCount, recent }: {
  today: DayId;
  members: number;
  pendingInvitations: number;
  conversationCount: number;
  recent: ConversationRow[];
}) {
  const { draft, readOnly } = useDraft();
  const environment = useWorkspaceEnvironment();
  if (!draft.onboardingCompleted) return <SetupChecklist />;

  const hours = hoursForDay(draft.hours, today);
  const answers = draft.knowledge.length;
  const steps = nextSteps(draft, { members, pendingInvitations });
  const remaining = steps.filter((step) => step.state === "todo").length;
  const canInvite = environment.role === "owner" && !readOnly;

  return (
    <>
      <PageHeader title={environment.organizationName ?? "Vaša firma"} badge="Podaci firme" description="Pregled vaše firme i sledeći koraci do prvog razgovora sa klijentima." />

      <div className={styles.statusGrid}>
        <div className={styles.statusCard}>
          <span className={styles.statusIcon}><CalendarClock size={18} aria-hidden="true" /></span>
          <span className={styles.statusLabel}>Danas</span>
          <strong>{hours.open ? "Otvoreno" : "Zatvoreno"}</strong>
          <span className={styles.statusMeta}>{hours.label}</span>
        </div>
        <div className={styles.statusCard}>
          <span className={styles.statusIcon}><BookOpen size={18} aria-hidden="true" /></span>
          <span className={styles.statusLabel}>Baza znanja</span>
          <strong>{answers === 1 ? "1 odgovor" : `${answers} odgovora`}</strong>
          <Link href={workspacePath(environment, "knowledge")} className={styles.statusLink}>{readOnly ? "Pogledaj odgovore" : "Uredi odgovore"}</Link>
        </div>
        <div className={styles.statusCard}>
          <span className={styles.statusIcon}><Users size={18} aria-hidden="true" /></span>
          <span className={styles.statusLabel}>Tim</span>
          <strong>{membersLabel(members)}</strong>
          <Link href={workspacePath(environment, "team")} className={styles.statusLink}>{canInvite ? "Pozovite člana" : "Pogledaj tim"}</Link>
        </div>
        <div className={`${styles.statusCard} ${conversationCount === 0 ? styles.statusMuted : ""}`}>
          <span className={styles.statusIcon}><MessageSquare size={18} aria-hidden="true" /></span>
          <span className={styles.statusLabel}>Razgovori</span>
          <strong>{conversationCount === 0 ? "Još nema" : conversationsLabel(conversationCount)}</strong>
          <span className={styles.statusMeta}>{conversationCount === 0 ? "Telefon još nije povezan." : "Sačuvani razgovori vaše firme."}</span>
        </div>
      </div>

      <div className={styles.overviewColumns}>
        <section className={styles.panel} aria-labelledby="next-title">
          <div className={styles.panelHeading}>
            <h2 id="next-title">Šta dalje</h2>
            <span>{remaining === 0 ? "Sve je spremno za sada" : `Preostalo: ${remaining}`}</span>
          </div>
          <ul className={styles.checklist}>
            {steps.map((step) => (
              <li key={step.id} className={step.state === "done" ? styles.checkDone : undefined}>
                <span className={styles.checkMarker} aria-hidden="true">
                  {step.state === "done" ? <Check size={14} aria-hidden="true" /> : step.state === "soon" ? <Phone size={12} aria-hidden="true" /> : <Circle size={10} aria-hidden="true" />}
                </span>
                <span><strong>{step.title}</strong><span>{step.detail}</span></span>
                {step.page
                  ? <Link href={workspacePath(environment, step.page)} className={styles.checkLink} aria-label={`Otvori: ${step.title}`}><ChevronRight size={16} aria-hidden="true" /></Link>
                  : <span className={`${styles.chip} ${styles.chipPending}`}>Uskoro</span>}
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.panel} aria-labelledby="greeting-title">
          <div className={styles.panelHeading}>
            <h2 id="greeting-title">Kako se asistent javlja</h2>
            <span>Iz podešavanja</span>
          </div>
          <div className={`${styles.bubble} ${styles.assistantBubble}`}>
            <span className={styles.bubbleSpeaker}>{draft.assistant.name || "Asistent"}</span>
            <p>{draft.assistant.greeting || <em>Pozdrav još nije unet.</em>}</p>
          </div>
          <Link href={workspacePath(environment, "assistant")} className={styles.panelLink}><Bot size={15} aria-hidden="true" />{readOnly ? "Pogledaj podešavanje asistenta" : "Uredi ponašanje asistenta"}<ArrowRight size={15} aria-hidden="true" /></Link>
        </section>
      </div>

      <section className={styles.panel} aria-labelledby="recent-title">
        <div className={styles.panelHeading}>
          <h2 id="recent-title">Poslednji razgovori</h2>
          {conversationCount > 0 && <span>{conversationsLabel(conversationCount)}</span>}
        </div>
        {recent.length === 0 ? (
          <div className={styles.panelEmpty}>
            <span className={styles.statusIcon}><Clock size={18} aria-hidden="true" /></span>
            <div>
              <strong>Još nema razgovora</strong>
              <p>Pojaviće se ovde kad povežemo telefon. Do tada možete da pogledate kako će izgledati.</p>
            </div>
          </div>
        ) : (
          <ul className={styles.compactList}>
            {recent.map((row) => {
              const outcome = OUTCOMES[row.outcome];
              return (
                <li key={row.id}>
                  <span className={styles.initials} aria-hidden="true">{initials(displayName(row))}</span>
                  <span className={styles.compactPerson}><strong>{displayName(row)}</strong><span>{row.channel === "call" ? "Poziv" : "Poruka"} · {timeFormat.format(new Date(row.startedAt))}</span></span>
                  <span className={`${styles.chip} ${outcome.pending ? styles.chipPending : ""}`}>{outcome.label}</span>
                </li>
              );
            })}
          </ul>
        )}
        <Link href={workspacePath(environment, "conversations")} className={styles.panelLink}><MessageSquare size={15} aria-hidden="true" />{recent.length === 0 ? "Pogledajte primer razgovora" : "Svi razgovori"}<ArrowRight size={15} aria-hidden="true" /></Link>
      </section>
    </>
  );
}
