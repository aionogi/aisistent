"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { HANDOFF_LABELS, suggestGreeting, TONE_LABELS, UNKNOWN_ANSWER_LABELS } from "../../../lib/workspace/templates";
import type { AssistantBehavior, AssistantTone, HandoffTopic, UnknownAnswerAction } from "../../../lib/workspace/types";
import { LIMITS, type FieldErrors } from "../../../lib/workspace/validation";
import { useDraft } from "../DraftProvider";
import { TextField } from "../FormControls";
import styles from "../forms.module.css";

const tones = Object.keys(TONE_LABELS) as AssistantTone[];
const topics = Object.keys(HANDOFF_LABELS) as HandoffTopic[];
const unknownActions = Object.keys(UNKNOWN_ANSWER_LABELS) as UnknownAnswerAction[];

export default function AssistantForm({ errors, showErrors }: { errors: FieldErrors; showErrors: boolean }) {
  const { draft, updateDraft } = useDraft();
  const { assistant } = draft;
  const [status, setStatus] = useState("");
  const errorFor = (path: string) => (showErrors ? errors[path] : undefined);

  const setAssistant = (patch: Partial<AssistantBehavior>) =>
    updateDraft((current) => ({ ...current, assistant: { ...current.assistant, ...patch } }));

  function toggleTopic(topic: HandoffTopic, checked: boolean) {
    updateDraft((current) => {
      const selected = new Set(current.assistant.handoffTopics);
      if (checked) selected.add(topic);
      else selected.delete(topic);
      return { ...current, assistant: { ...current.assistant, handoffTopics: topics.filter((item) => selected.has(item)) } };
    });
  }

  function proposeGreeting() {
    setAssistant({ greeting: suggestGreeting(assistant.tone, draft.business.name, assistant.name) });
    setStatus(`Pozdrav je predložen za ton „${TONE_LABELS[assistant.tone].label}“. Možete ga dalje menjati.`);
  }

  return (
    <div className={styles.formStack}>
      <div className={styles.fieldGrid}>
        <TextField path="assistant.name" label="Ime asistenta" value={assistant.name} onChange={(name) => setAssistant({ name })} error={errorFor("assistant.name")} maxLength={LIMITS.assistantName} hint="Asistent se predstavlja ovim imenom i navodi da je AI asistent." />
      </div>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Ton razgovora</legend>
        <div className={styles.toneGrid}>
          {tones.map((tone) => (
            <label key={tone} className={`${styles.choiceCard} ${styles.compactChoice} ${assistant.tone === tone ? styles.choiceSelected : ""}`}>
              <input type="radio" name="assistant-tone" value={tone} checked={assistant.tone === tone} onChange={() => setAssistant({ tone })} className={styles.visuallyHidden} />
              <span className={styles.choiceText}><strong>{TONE_LABELS[tone].label}</strong><span>{TONE_LABELS[tone].description}</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className={styles.greetingBlock}>
        <TextField path="assistant.greeting" label="Pozdrav na početku razgovora" multiline rows={3} showCount value={assistant.greeting} onChange={(greeting) => setAssistant({ greeting })} error={errorFor("assistant.greeting")} maxLength={LIMITS.greeting} placeholder="Npr. Dobar dan, dobili ste Studio Mila…" />
        <div className={styles.hoursToolbar}>
          <button type="button" className={styles.secondaryButton} onClick={proposeGreeting}><Sparkles size={15} aria-hidden="true" />Predloži pozdrav prema tonu</button>
          <p className={styles.inlineStatus} role="status">{status}</p>
        </div>
      </div>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Zakazivanje</legend>
        <label className={styles.switchRow}>
          <input type="checkbox" role="switch" checked={assistant.bookingEnabled} onChange={(event) => setAssistant({ bookingEnabled: event.target.checked })} />
          <span className={styles.switchTrack} aria-hidden="true"><span /></span>
          <span className={styles.choiceText}><strong>Asistent predlaže slobodne termine</strong><span>{assistant.bookingEnabled ? "Uključeno: u primeru razgovora asistent nudi termin." : "Isključeno: asistent zahteve za termin prosleđuje timu."}</span></span>
        </label>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Kada prepušta razgovor timu</legend>
        <p className={styles.legendHint}>U ovim situacijama asistent beleži sažetak i prosleđuje razgovor vašem timu.</p>
        <div className={styles.checkGrid}>
          {topics.map((topic) => (
            <label key={topic} className={styles.checkRow}>
              <input type="checkbox" checked={assistant.handoffTopics.includes(topic)} onChange={(event) => toggleTopic(topic, event.target.checked)} />
              <span>{HANDOFF_LABELS[topic]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Kada ne zna odgovor</legend>
        <div className={styles.toneGrid}>
          {unknownActions.map((action) => (
            <label key={action} className={`${styles.choiceCard} ${styles.compactChoice} ${assistant.unknownAnswer === action ? styles.choiceSelected : ""}`}>
              <input type="radio" name="assistant-unknown" value={action} checked={assistant.unknownAnswer === action} onChange={() => setAssistant({ unknownAnswer: action })} className={styles.visuallyHidden} />
              <span className={styles.choiceText}><strong>{UNKNOWN_ANSWER_LABELS[action].label}</strong><span>{UNKNOWN_ANSWER_LABELS[action].description}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
