"use client";

import { Plus, Trash2 } from "lucide-react";
import { createId } from "../../../lib/workspace/templates";
import type { BusinessDetails, ServiceItem } from "../../../lib/workspace/types";
import { LIMITS, type FieldErrors } from "../../../lib/workspace/validation";
import { useDraft } from "../DraftProvider";
import { FieldMessage, TextField, fieldId } from "../FormControls";
import styles from "../forms.module.css";

export default function BusinessForm({ errors, showErrors }: { errors: FieldErrors; showErrors: boolean }) {
  const { draft, updateDraft } = useDraft();
  const { business } = draft;
  const errorFor = (path: string) => (showErrors ? errors[path] : undefined);

  const setField = (key: Exclude<keyof BusinessDetails, "services">) => (value: string) =>
    updateDraft((current) => ({ ...current, business: { ...current.business, [key]: value } }));

  const setServices = (recipe: (services: ServiceItem[]) => ServiceItem[]) =>
    updateDraft((current) => ({ ...current, business: { ...current.business, services: recipe(current.business.services) } }));

  function addService() {
    const service = { id: createId("service"), name: "", duration: "" };
    setServices((services) => [...services, service]);
    window.setTimeout(() => document.getElementById(fieldId(`services.${service.id}.name`))?.focus(), 0);
  }

  function removeService(id: string) {
    setServices((services) => services.filter((item) => item.id !== id));
    // The removed row held focus; return it to the stable "add" control.
    window.setTimeout(() => document.getElementById(fieldId("business.services"))?.focus(), 0);
  }

  return (
    <div className={styles.formStack}>
      <div className={styles.fieldGrid}>
        <TextField path="business.name" label="Naziv posla" value={business.name} onChange={setField("name")} error={errorFor("business.name")} maxLength={LIMITS.businessName} placeholder="Npr. Studio Mila" autoComplete="organization" />
        <TextField path="business.city" label="Grad" value={business.city} onChange={setField("city")} error={errorFor("business.city")} maxLength={LIMITS.city} placeholder="Npr. Novi Sad" />
        <TextField path="business.address" label="Adresa" optional value={business.address} onChange={setField("address")} error={errorFor("business.address")} maxLength={LIMITS.address} placeholder="Ulica i broj" hint="Asistent je navodi kada klijent pita gde se nalazite." />
        <TextField path="business.website" label="Sajt" optional value={business.website} onChange={setField("website")} error={errorFor("business.website")} maxLength={LIMITS.website} placeholder="vasposao.rs" inputMode="url" />
      </div>
      <TextField path="business.description" label="Kratak opis" optional multiline rows={3} showCount value={business.description} onChange={setField("description")} error={errorFor("business.description")} maxLength={LIMITS.description} placeholder="Čime se bavite, u jednoj ili dve rečenice." />

      <fieldset className={styles.fieldset} aria-describedby={errorFor("business.services") ? `${fieldId("business.services")}-error` : undefined}>
        <legend className={styles.legend}>Usluge</legend>
        <p className={styles.legendHint}>Asistent ih pominje kada klijenti pitaju šta radite. Dodajte do {LIMITS.maxServices} usluga.</p>
        {business.services.length === 0 ? (
          <p className={styles.emptyLine}>Još nema usluga.</p>
        ) : (
          <ul className={styles.serviceList}>
            {business.services.map((service, index) => {
              const nameError = errorFor(`services.${service.id}.name`);
              const durationError = errorFor(`services.${service.id}.duration`);
              return (
                <li key={service.id} className={styles.serviceRow}>
                  <div className={styles.serviceField}>
                    <label className={styles.label} htmlFor={fieldId(`services.${service.id}.name`)}>Usluga {index + 1}</label>
                    <input id={fieldId(`services.${service.id}.name`)} value={service.name} maxLength={LIMITS.serviceName} placeholder="Naziv usluge" autoComplete="off" aria-invalid={nameError ? true : undefined} aria-describedby={nameError ? `${fieldId(`services.${service.id}.name`)}-error` : undefined}
                      onChange={(event) => setServices((services) => services.map((item) => item.id === service.id ? { ...item, name: event.target.value } : item))} />
                    <FieldMessage id={fieldId(`services.${service.id}.name`)} error={nameError} />
                  </div>
                  <div className={styles.serviceField}>
                    <label className={styles.label} htmlFor={fieldId(`services.${service.id}.duration`)}>Trajanje ili napomena</label>
                    <input id={fieldId(`services.${service.id}.duration`)} value={service.duration} maxLength={LIMITS.serviceDuration} placeholder="Npr. 45 min" autoComplete="off" aria-invalid={durationError ? true : undefined} aria-describedby={durationError ? `${fieldId(`services.${service.id}.duration`)}-error` : undefined}
                      onChange={(event) => setServices((services) => services.map((item) => item.id === service.id ? { ...item, duration: event.target.value } : item))} />
                    <FieldMessage id={fieldId(`services.${service.id}.duration`)} error={durationError} />
                  </div>
                  <button type="button" className={styles.iconButton} aria-label={`Ukloni uslugu ${service.name.trim() || index + 1}`} onClick={() => removeService(service.id)}>
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <button type="button" id={fieldId("business.services")} className={styles.secondaryButton} onClick={addService} disabled={business.services.length >= LIMITS.maxServices}>
          <Plus size={15} aria-hidden="true" />Dodaj uslugu
        </button>
        <FieldMessage id={fieldId("business.services")} error={errorFor("business.services")} />
      </fieldset>
    </div>
  );
}
