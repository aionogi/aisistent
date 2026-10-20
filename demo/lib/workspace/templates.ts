import type {
  AssistantTone,
  DayHours,
  DayId,
  HandoffTopic,
  IndustryId,
  KnowledgeEntry,
  ServiceItem,
  UnknownAnswerAction,
  WorkspaceDraft,
} from "./types";

export const DAY_IDS: DayId[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** `from` is the genitive ("od ponedeljka"), `every` the habitual instrumental ("subotom"). */
export const DAY_LABELS: Record<DayId, { long: string; short: string; from: string; every: string }> = {
  mon: { long: "Ponedeljak", short: "Pon", from: "ponedeljka", every: "ponedeljkom" },
  tue: { long: "Utorak", short: "Uto", from: "utorka", every: "utorkom" },
  wed: { long: "Sreda", short: "Sre", from: "srede", every: "sredom" },
  thu: { long: "Četvrtak", short: "Čet", from: "četvrtka", every: "četvrtkom" },
  fri: { long: "Petak", short: "Pet", from: "petka", every: "petkom" },
  sat: { long: "Subota", short: "Sub", from: "subote", every: "subotom" },
  sun: { long: "Nedelja", short: "Ned", from: "nedelje", every: "nedeljom" },
};

export const INDUSTRY_LABELS: Record<IndustryId, { label: string; description: string }> = {
  salon: { label: "Salon lepote", description: "Frizerski, kozmetički i nail saloni" },
  clinic: { label: "Ordinacija", description: "Stomatološke i privatne ordinacije" },
  garage: { label: "Auto-servis", description: "Servisi, vulkanizeri i perionice" },
  restaurant: { label: "Restoran", description: "Restorani, kafići i keteringi" },
  other: { label: "Druga delatnost", description: "Počnite od praznog obrasca" },
};

export const TONE_LABELS: Record<AssistantTone, { label: string; description: string }> = {
  professional: { label: "Profesionalan", description: "Smiren, učtiv i jasan." },
  warm: { label: "Srdačan", description: "Topao i opušten, kao vaš tim." },
  concise: { label: "Kratak i jasan", description: "Bez suvišnih reči, brzo do cilja." },
};

export const HANDOFF_LABELS: Record<HandoffTopic, string> = {
  complaints: "Žalbe i nezadovoljni klijenti",
  pricing: "Pitanja o cenama i ponudama",
  urgent: "Hitni slučajevi",
  "special-requests": "Posebni zahtevi",
};

export const UNKNOWN_ANSWER_LABELS: Record<UnknownAnswerAction, { label: string; description: string }> = {
  "take-message": { label: "Zabeleži pitanje za tim", description: "Asistent beleži pitanje i kontakt klijenta." },
  "offer-callback": { label: "Ponudi da se tim javi", description: "Asistent dogovara da se neko iz tima javi klijentu." },
};

export const DEFAULT_ASSISTANT_NAME = "Lena";

let idCounter = 0;

/** Locally unique IDs for list items in the browser-only draft. */
export function createId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export function suggestGreeting(tone: AssistantTone, businessName: string, assistantName: string): string {
  const business = businessName.trim() || "naš posao";
  const assistant = assistantName.trim() || DEFAULT_ASSISTANT_NAME;
  switch (tone) {
    case "warm":
      return `Zdravo i dobro došli u ${business}! Ja sam ${assistant}, AI asistent. Rado ću vam pomoći.`;
    case "concise":
      return `${business}, dobar dan. Ovde ${assistant}, AI asistent. Izvolite?`;
    default:
      return `Dobar dan, dobili ste ${business}. Ja sam ${assistant}, AI asistent. Kako mogu da vam pomognem?`;
  }
}

function hours(weekday: [string, string] | null, saturday: [string, string] | null, sunday: [string, string] | null): Record<DayId, DayHours> {
  const toDay = (range: [string, string] | null): DayHours => range ? { open: true, from: range[0], to: range[1] } : { open: false, from: "09:00", to: "17:00" };
  return {
    mon: toDay(weekday),
    tue: toDay(weekday),
    wed: toDay(weekday),
    thu: toDay(weekday),
    fri: toDay(weekday),
    sat: toDay(saturday),
    sun: toDay(sunday),
  };
}

type IndustryTemplate = {
  business: { name: string; city: string; address: string; description: string; website: string };
  services: Array<Omit<ServiceItem, "id">>;
  hours: Record<DayId, DayHours>;
  tone: AssistantTone;
  handoffTopics: HandoffTopic[];
  knowledge: Array<Omit<KnowledgeEntry, "id">>;
};

const templates: Record<IndustryId, IndustryTemplate> = {
  salon: {
    business: { name: "Studio Mila", city: "Novi Sad", address: "Cvetna 12", description: "Frizerski salon za šišanje, farbanje i negu kose.", website: "studio-mila.example" },
    services: [
      { name: "Šišanje i feniranje", duration: "45 min" },
      { name: "Farbanje", duration: "90 min" },
      { name: "Manikir", duration: "40 min" },
    ],
    hours: hours(["09:00", "20:00"], ["09:00", "15:00"], null),
    tone: "warm",
    handoffTopics: ["complaints", "special-requests"],
    knowledge: [
      { question: "Da li je potrebno zakazivanje?", answer: "Preporučujemo zakazivanje. Bez najave primamo kada ima slobodnih termina." },
      { question: "Koliko traje farbanje?", answer: "Farbanje traje oko 90 minuta, u zavisnosti od dužine kose." },
      { question: "Da li postoji parking?", answer: "Parking je dostupan u ulici ispred salona." },
    ],
  },
  clinic: {
    business: { name: "Dental Studio", city: "Beograd", address: "Lipova 4", description: "Stomatološka ordinacija za redovne preglede i popravke zuba.", website: "dental-studio.example" },
    services: [
      { name: "Kontrolni pregled", duration: "30 min" },
      { name: "Popravka zuba", duration: "45 min" },
      { name: "Uklanjanje kamenca", duration: "40 min" },
    ],
    hours: hours(["08:00", "16:00"], ["09:00", "13:00"], null),
    tone: "professional",
    handoffTopics: ["urgent", "complaints", "pricing"],
    knowledge: [
      { question: "Šta da ponesem na prvi pregled?", answer: "Ponesite ličnu kartu i prethodne snimke, ako ih imate." },
      { question: "Koliko traje kontrolni pregled?", answer: "Kontrolni pregled traje oko 30 minuta." },
      { question: "Da li primate hitne slučajeve?", answer: "Hitne slučajeve asistent odmah prosleđuje timu ordinacije." },
    ],
  },
  garage: {
    business: { name: "Servis Jovanović", city: "Niš", address: "Industrijska 8", description: "Auto-servis za redovno održavanje, gume i dijagnostiku.", website: "servis-jovanovic.example" },
    services: [
      { name: "Zamena guma", duration: "40 min" },
      { name: "Mali servis", duration: "90 min" },
      { name: "Kompjuterska dijagnostika", duration: "30 min" },
    ],
    hours: hours(["08:00", "17:00"], ["08:00", "14:00"], null),
    tone: "concise",
    handoffTopics: ["pricing", "special-requests"],
    knowledge: [
      { question: "Da li čuvate gume?", answer: "Da, nudimo sezonsko čuvanje kompleta guma." },
      { question: "Koliko traje mali servis?", answer: "Oko 90 minuta. Vozilo možete ostaviti ujutru i preuzeti posle podne." },
      { question: "Da li mogu da sačekam vozilo?", answer: "Da, imamo čekaonicu za kraće intervencije." },
    ],
  },
  restaurant: {
    business: { name: "Bistro Bašta", city: "Kragujevac", address: "Parkovska 3", description: "Restoran domaće kuhinje sa baštom.", website: "bistro-basta.example" },
    services: [
      { name: "Rezervacija stola", duration: "do 8 osoba" },
      { name: "Proslave", duration: "do 30 osoba" },
      { name: "Hrana za poneti", duration: "porudžbina telefonom" },
    ],
    hours: hours(["12:00", "23:00"], ["12:00", "23:00"], ["12:00", "22:00"]),
    tone: "warm",
    handoffTopics: ["special-requests", "complaints"],
    knowledge: [
      { question: "Da li imate baštu?", answer: "Bašta radi od aprila do oktobra, u zavisnosti od vremena." },
      { question: "Da li primate kućne ljubimce?", answer: "Kućni ljubimci su dobrodošli u bašti." },
      { question: "Imate li vegetarijanska jela?", answer: "Da, jelovnik ima nekoliko vegetarijanskih jela." },
    ],
  },
  other: {
    business: { name: "", city: "", address: "", description: "", website: "" },
    services: [{ name: "", duration: "" }],
    hours: hours(["09:00", "17:00"], null, null),
    tone: "professional",
    handoffTopics: ["complaints"],
    knowledge: [],
  },
};

export function createEmptyDraft(): WorkspaceDraft {
  return {
    version: 1,
    industry: null,
    business: { name: "", city: "", address: "", description: "", website: "", services: [] },
    hours: hours(["09:00", "17:00"], null, null),
    assistant: {
      name: DEFAULT_ASSISTANT_NAME,
      tone: "professional",
      greeting: "",
      bookingEnabled: true,
      handoffTopics: ["complaints"],
      unknownAnswer: "take-message",
    },
    knowledge: [],
    onboardingCompleted: false,
    updatedAt: null,
  };
}

/** Fills business details, hours, behavior, and knowledge from an industry's example template. */
export function applyIndustryTemplate(draft: WorkspaceDraft, industry: IndustryId): WorkspaceDraft {
  const template = templates[industry];
  const assistantName = draft.assistant.name.trim() || DEFAULT_ASSISTANT_NAME;
  return {
    ...draft,
    industry,
    business: {
      ...template.business,
      services: template.services.map((service) => ({ ...service, id: createId("service") })),
    },
    hours: structuredClone(template.hours),
    assistant: {
      ...draft.assistant,
      name: assistantName,
      tone: template.tone,
      greeting: template.business.name ? suggestGreeting(template.tone, template.business.name, assistantName) : "",
      handoffTopics: [...template.handoffTopics],
    },
    knowledge: template.knowledge.map((entry) => ({ ...entry, id: createId("knowledge") })),
  };
}

/** A finished salon configuration for exploring the workspace without onboarding. */
export function createCompleteExample(): WorkspaceDraft {
  return { ...applyIndustryTemplate(createEmptyDraft(), "salon"), onboardingCompleted: true };
}

/** True while the draft's details are still exactly its industry's example, so switching industry loses nothing. */
export function matchesIndustryTemplate(draft: WorkspaceDraft): boolean {
  if (!draft.industry) return !draft.business.name.trim() && draft.knowledge.length === 0;
  const template = templates[draft.industry];
  const { business } = draft;
  const sameBusiness = (Object.keys(template.business) as Array<keyof IndustryTemplate["business"]>).every((key) => business[key] === template.business[key]);
  const sameServices = business.services.length === template.services.length
    && business.services.every((service, index) => service.name === template.services[index].name && service.duration === template.services[index].duration);
  const sameKnowledge = draft.knowledge.length === template.knowledge.length
    && draft.knowledge.every((entry, index) => entry.question === template.knowledge[index].question && entry.answer === template.knowledge[index].answer);
  const sameHours = DAY_IDS.every((day) => JSON.stringify(draft.hours[day]) === JSON.stringify(template.hours[day]));
  return sameBusiness && sameServices && sameKnowledge && sameHours;
}
