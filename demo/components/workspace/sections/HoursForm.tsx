"use client";

import { Copy } from "lucide-react";
import { useState } from "react";
import { DAY_IDS, DAY_LABELS } from "../../../lib/workspace/templates";
import type { DayHours, DayId } from "../../../lib/workspace/types";
import type { FieldErrors } from "../../../lib/workspace/validation";
import { useDraft } from "../DraftProvider";
import { FieldMessage, fieldId } from "../FormControls";
import styles from "../forms.module.css";

const weekdays: DayId[] = ["mon", "tue", "wed", "thu", "fri"];

export default function HoursForm({ errors, showErrors }: { errors: FieldErrors; showErrors: boolean }) {
  const { draft, updateDraft } = useDraft();
  const [status, setStatus] = useState("");
  const errorFor = (path: string) => (showErrors ? errors[path] : undefined);
  const groupError = errorFor("hours");

  const setDay = (day: DayId, patch: Partial<DayHours>) =>
    updateDraft((current) => ({ ...current, hours: { ...current.hours, [day]: { ...current.hours[day], ...patch } } }));

  function copyMondayToWeekdays() {
    updateDraft((current) => {
      const monday = current.hours.mon;
      const hours = { ...current.hours };
      weekdays.forEach((day) => { hours[day] = { ...monday }; });
      return { ...current, hours };
    });
    setStatus("Radno vreme ponedeljka primenjeno je na sve radne dane.");
  }

  return (
    <fieldset className={styles.fieldset} aria-describedby={groupError ? `${fieldId("hours")}-error` : undefined}>
      <legend className={styles.legend}>Radno vreme</legend>
      <p className={styles.legendHint}>Asistent prema ovome odgovara na pitanja o radnom vremenu i predlaže termine.</p>
      <div className={styles.hoursToolbar}>
        <button type="button" className={styles.secondaryButton} onClick={copyMondayToWeekdays}><Copy size={15} aria-hidden="true" />Primeni ponedeljak na radne dane</button>
        <p className={styles.inlineStatus} role="status">{status}</p>
      </div>
      <ul className={styles.hoursList}>
        {DAY_IDS.map((day, index) => {
          const entry = draft.hours[day];
          const dayError = errorFor(`hours.${day}`);
          const fromId = fieldId(`hours.${day}`);
          const toId = `${fromId}-to`;
          const checkboxId = index === 0 ? fieldId("hours") : `${fromId}-open`;
          return (
            <li key={day} className={`${styles.hoursRow} ${entry.open ? "" : styles.closedRow}`}>
              <label className={styles.dayToggle} htmlFor={checkboxId}>
                <input type="checkbox" id={checkboxId} checked={entry.open} onChange={(event) => setDay(day, { open: event.target.checked })} />
                <span>{DAY_LABELS[day].long}</span>
              </label>
              {entry.open ? (
                <div className={styles.timeRange}>
                  <label className={styles.visuallyHidden} htmlFor={fromId}>{DAY_LABELS[day].long}, od</label>
                  <input type="time" id={fromId} value={entry.from} onChange={(event) => setDay(day, { from: event.target.value })} aria-invalid={dayError ? true : undefined} aria-describedby={dayError ? `${fromId}-error` : undefined} />
                  <span aria-hidden="true">–</span>
                  <label className={styles.visuallyHidden} htmlFor={toId}>{DAY_LABELS[day].long}, do</label>
                  <input type="time" id={toId} value={entry.to} onChange={(event) => setDay(day, { to: event.target.value })} aria-invalid={dayError ? true : undefined} aria-describedby={dayError ? `${fromId}-error` : undefined} />
                </div>
              ) : (
                <span className={styles.closedLabel}>Zatvoreno</span>
              )}
              <FieldMessage id={fromId} error={dayError} />
            </li>
          );
        })}
      </ul>
      <FieldMessage id={fieldId("hours")} error={groupError} />
    </fieldset>
  );
}
