import { DAY_IDS, DAY_LABELS, HANDOFF_LABELS, UNKNOWN_ANSWER_LABELS } from "./templates";
import type { DayHours, DayId, HandoffTopic, WorkspaceDraft } from "./types";

type HoursGroup = { days: DayId[]; hours: DayHours };

function sameHours(a: DayHours, b: DayHours): boolean {
  return a.open === b.open && (!a.open || (a.from === b.from && a.to === b.to));
}

function groupHours(hours: Record<DayId, DayHours>): HoursGroup[] {
  const groups: HoursGroup[] = [];
  DAY_IDS.forEach((day) => {
    const last = groups.at(-1);
    if (last && sameHours(last.hours, hours[day])) last.days.push(day);
    else groups.push({ days: [day], hours: hours[day] });
  });
  return groups;
}

function dayRange(days: DayId[]): string {
  const first = DAY_LABELS[days[0]].short;
  return days.length === 1 ? first : `${first}–${DAY_LABELS[days[days.length - 1]].short}`;
}

/** `09:00` → `9`, `09:30` → `9:30`. */
function spokenTime(time: string): string {
  const [hour, minute] = time.split(":");
  return `${Number(hour)}${minute === "00" ? "" : `:${minute}`}`;
}

/** Compact lines such as `Pon–Pet · 09:00–20:00`. */
export function summarizeHours(hours: Record<DayId, DayHours>): Array<{ days: string; hours: string; open: boolean }> {
  return groupHours(hours).map((group) => ({
    days: dayRange(group.days),
    hours: group.hours.open ? `${group.hours.from}–${group.hours.to}` : "Zatvoreno",
    open: group.hours.open,
  }));
}

/** A sentence the example assistant could say about working hours. */
export function describeHours(hours: Record<DayId, DayHours>): string {
  const open = groupHours(hours).filter((group) => group.hours.open);
  if (open.length === 0) return "Radno vreme još nije uneto.";
  const parts = open.map((group) => {
    const first = group.days[0];
    const last = group.days[group.days.length - 1];
    const when = group.days.length === 1 ? DAY_LABELS[first].every : `od ${DAY_LABELS[first].from} do ${DAY_LABELS[last].from}`;
    return `${when} od ${spokenTime(group.hours.from)} do ${spokenTime(group.hours.to)} h`;
  });
  const sentence = parts.length > 1 ? `${parts.slice(0, -1).join(", ")}, a ${parts[parts.length - 1]}` : parts[0];
  return `Radimo ${sentence}.`;
}

const jsDayToId: DayId[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function todayHours(hours: Record<DayId, DayHours>, now: Date): { label: string; open: boolean } {
  const day = jsDayToId[now.getDay()];
  const entry = hours[day];
  return entry.open
    ? { label: `${DAY_LABELS[day].long} · ${entry.from}–${entry.to}`, open: true }
    : { label: `${DAY_LABELS[day].long} · zatvoreno`, open: false };
}

export const handoffExamples: Record<HandoffTopic, { question: string; answer: string }> = {
  complaints: { question: "Imam primedbu na prethodnu uslugu.", answer: "Žao mi je zbog toga. Prosleđujem razgovor timu, kako bi se neko lično pozabavio time." },
  pricing: { question: "Možete li da mi napravite posebnu ponudu?", answer: "Ponude priprema naš tim. Zabeležiću šta vam treba i proslediti im vaš zahtev." },
  urgent: { question: "Imam hitan problem. Može li neko odmah da pomogne?", answer: "Razumem da je hitno. Odmah prosleđujem razgovor timu." },
  "special-requests": { question: "Imam poseban zahtev za svoj termin.", answer: "Rado ću ga zabeležiti. Posebne zahteve potvrđuje naš tim." },
};

export type PreviewExchange = { question: string; answer: string; note: string };

/**
 * Deterministic example replies assembled from the draft.
 * They show how settings would be used; no AI model generates them.
 */
export function buildPreviewExchanges(draft: WorkspaceDraft): PreviewExchange[] {
  const { business, assistant, knowledge } = draft;
  const services = business.services.filter((service) => service.name.trim());
  const exchanges: PreviewExchange[] = [
    { question: "Koje je vaše radno vreme?", answer: describeHours(draft.hours), note: "Iz radnog vremena" },
  ];

  if (services.length > 0) {
    // Names stay in the nominative ("Naše usluge su: …") so any service name reads correctly.
    const names = services.slice(0, 3).map((service) => service.name.trim().toLowerCase());
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} i ${names[names.length - 1]}` : names[0];
    exchanges.push({
      question: "Šta sve radite?",
      answer: assistant.bookingEnabled
        ? `Naše usluge su: ${list}. Mogu odmah da vam predložim slobodan termin.`
        : `Naše usluge su: ${list}. Za termin će vam se javiti naš tim.`,
      note: assistant.bookingEnabled ? "Iz usluga · zakazivanje uključeno" : "Iz usluga · zakazivanje isključeno",
    });
  }

  if (knowledge[0]) exchanges.push({ question: knowledge[0].question, answer: knowledge[0].answer, note: "Iz baze znanja" });

  const firstTopic = assistant.handoffTopics[0];
  exchanges.push(firstTopic
    ? { ...handoffExamples[firstTopic], note: `Prepušta timu · ${HANDOFF_LABELS[firstTopic]}` }
    : { question: "Da li radite i za praznike?", answer: unknownAnswerReply(draft), note: `Bez odgovora · ${UNKNOWN_ANSWER_LABELS[assistant.unknownAnswer].label}` });

  return exchanges;
}

export function unknownAnswerReply(draft: WorkspaceDraft): string {
  return draft.assistant.unknownAnswer === "offer-callback"
    ? "Nemam tu informaciju, ali mogu da dogovorim da vam se neko iz tima javi."
    : "Nemam tu informaciju. Zabeležiću vaše pitanje da ga tim pogleda.";
}

export function formatUpdatedAt(iso: string | null): string {
  if (!iso) return "Još nema izmena";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Nepoznato vreme";
  return `Poslednja izmena u ${date.toLocaleTimeString("sr-Latn-RS", { hour: "2-digit", minute: "2-digit" })}`;
}
