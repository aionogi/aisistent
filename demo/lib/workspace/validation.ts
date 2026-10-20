import { DAY_IDS, DAY_LABELS } from "./templates";
import type { StepId, WorkspaceDraft } from "./types";

/** Field errors keyed by a stable field path, e.g. `business.name` or `hours.mon`. */
export type FieldErrors = Record<string, string>;

export const LIMITS = {
  businessName: 60,
  city: 40,
  address: 80,
  description: 280,
  website: 80,
  serviceName: 60,
  serviceDuration: 30,
  maxServices: 8,
  assistantName: 30,
  greetingMin: 10,
  greeting: 300,
  question: 120,
  answer: 400,
} as const;

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const websitePattern = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i;

export function validateIndustry(draft: WorkspaceDraft): FieldErrors {
  return draft.industry ? {} : { industry: "Izaberite delatnost da biste nastavili." };
}

export function validateBusiness(draft: WorkspaceDraft): FieldErrors {
  const errors: FieldErrors = {};
  const { name, city, address, description, website, services } = draft.business;

  if (name.trim().length < 2) errors["business.name"] = "Unesite naziv posla (najmanje 2 znaka).";
  else if (name.length > LIMITS.businessName) errors["business.name"] = `Naziv može imati najviše ${LIMITS.businessName} znakova.`;
  if (!city.trim()) errors["business.city"] = "Unesite grad.";
  else if (city.length > LIMITS.city) errors["business.city"] = `Grad može imati najviše ${LIMITS.city} znakova.`;
  if (address.length > LIMITS.address) errors["business.address"] = `Adresa može imati najviše ${LIMITS.address} znakova.`;
  if (description.length > LIMITS.description) errors["business.description"] = `Opis može imati najviše ${LIMITS.description} znakova.`;
  if (website.trim() && (!websitePattern.test(website.trim()) || website.length > LIMITS.website)) {
    errors["business.website"] = "Unesite adresu sajta, npr. vasposao.rs, ili ostavite polje prazno.";
  }

  const namedServices = services.filter((service) => service.name.trim());
  if (namedServices.length === 0) errors["business.services"] = "Dodajte bar jednu uslugu koju asistent može da pomene.";
  services.forEach((service) => {
    if (!service.name.trim() && service.duration.trim()) errors[`services.${service.id}.name`] = "Unesite naziv usluge ili uklonite red.";
    if (service.name.length > LIMITS.serviceName) errors[`services.${service.id}.name`] = `Najviše ${LIMITS.serviceName} znakova.`;
    if (service.duration.length > LIMITS.serviceDuration) errors[`services.${service.id}.duration`] = `Najviše ${LIMITS.serviceDuration} znakova.`;
  });
  return errors;
}

export function validateHours(draft: WorkspaceDraft): FieldErrors {
  const errors: FieldErrors = {};
  const openDays = DAY_IDS.filter((day) => draft.hours[day].open);
  if (openDays.length === 0) errors.hours = "Označite bar jedan radni dan.";
  openDays.forEach((day) => {
    const { from, to } = draft.hours[day];
    if (!timePattern.test(from) || !timePattern.test(to)) errors[`hours.${day}`] = `${DAY_LABELS[day].long}: unesite vreme u obliku SS:MM.`;
    else if (from >= to) errors[`hours.${day}`] = `${DAY_LABELS[day].long}: kraj radnog vremena mora biti posle početka.`;
  });
  return errors;
}

export function validateAssistant(draft: WorkspaceDraft): FieldErrors {
  const errors: FieldErrors = {};
  const { name, greeting } = draft.assistant;
  if (!name.trim()) errors["assistant.name"] = "Dajte asistentu ime.";
  else if (name.length > LIMITS.assistantName) errors["assistant.name"] = `Ime može imati najviše ${LIMITS.assistantName} znakova.`;
  if (greeting.trim().length < LIMITS.greetingMin) errors["assistant.greeting"] = "Napišite pozdrav kojim asistent počinje razgovor.";
  else if (greeting.length > LIMITS.greeting) errors["assistant.greeting"] = `Pozdrav može imati najviše ${LIMITS.greeting} znakova.`;
  return errors;
}

export function validateKnowledgeEntry(question: string, answer: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!question.trim()) errors.question = "Unesite pitanje.";
  else if (question.length > LIMITS.question) errors.question = `Pitanje može imati najviše ${LIMITS.question} znakova.`;
  if (!answer.trim()) errors.answer = "Unesite odgovor.";
  else if (answer.length > LIMITS.answer) errors.answer = `Odgovor može imati najviše ${LIMITS.answer} znakova.`;
  return errors;
}

const stepValidators: Record<Exclude<StepId, "review">, (draft: WorkspaceDraft) => FieldErrors> = {
  industry: validateIndustry,
  business: validateBusiness,
  hours: validateHours,
  assistant: validateAssistant,
};

export function validateStep(step: StepId, draft: WorkspaceDraft): FieldErrors {
  if (step === "review") return validateDraft(draft);
  return stepValidators[step](draft);
}

export function validateDraft(draft: WorkspaceDraft): FieldErrors {
  return { ...validateIndustry(draft), ...validateBusiness(draft), ...validateHours(draft), ...validateAssistant(draft) };
}

export function isStepComplete(step: Exclude<StepId, "review">, draft: WorkspaceDraft): boolean {
  // Default hours are valid on their own; nothing counts as done until setup has started.
  if (step !== "industry" && !draft.industry) return false;
  return Object.keys(stepValidators[step](draft)).length === 0;
}
