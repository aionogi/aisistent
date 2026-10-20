import { describeHours, handoffExamples, unknownAnswerReply } from "./format";
import { HANDOFF_LABELS } from "./templates";
import type { WorkspaceDraft } from "./types";

export type ConversationStatus = "resolved" | "team";

export type ExampleMessage = { from: "assistant" | "caller"; text: string };

export type ExampleConversation = {
  id: string;
  name: string;
  initials: string;
  channel: "call" | "message";
  time: string;
  length: string;
  status: ConversationStatus;
  outcome: string;
  summary: string;
  messages: ExampleMessage[];
};

/**
 * Builds the workspace's example conversations from the current draft, so the
 * records reflect the configured services, hours, knowledge, and handoff rules.
 * Caller names and times are fictional; no call or message took place.
 */
export function buildExampleConversations(draft: WorkspaceDraft): ExampleConversation[] {
  const { business, assistant, knowledge } = draft;
  const businessName = business.name.trim() || "vaš posao";
  const greeting = assistant.greeting.trim() || `Dobar dan, dobili ste ${businessName}.`;
  const service = business.services.find((item) => item.name.trim())?.name.trim() ?? "Konsultacija";
  const topic = assistant.handoffTopics[0];
  const entry = knowledge[0];

  const conversations: ExampleConversation[] = [
    {
      id: "booking",
      name: "Mila Petrović",
      initials: "MP",
      channel: "call",
      time: "10:42",
      length: "2 min 14 s",
      status: assistant.bookingEnabled ? "resolved" : "team",
      outcome: assistant.bookingEnabled ? "Zakazan termin" : "Zahtev za termin",
      summary: assistant.bookingEnabled
        ? `Mila je tražila termin za uslugu „${service}“. Asistent je predložio slobodan termin i zabeležio ga u ovom primeru.`
        : `Mila je tražila termin za uslugu „${service}“. Zakazivanje je isključeno, pa je asistent zahtev prosledio timu.`,
      messages: [
        { from: "assistant", text: greeting },
        { from: "caller", text: `Dobar dan, želela bih termin za uslugu „${service}“ u sredu.` },
        assistant.bookingEnabled
          ? { from: "assistant", text: "Slobodan je termin u sredu u 14:30. Da li vam odgovara?" }
          : { from: "assistant", text: "Zabeležiću vaš zahtev, a naš tim će vam se javiti da potvrdi termin." },
        { from: "caller", text: assistant.bookingEnabled ? "Odgovara, hvala. Mila Petrović." : "U redu, hvala. Mila Petrović." },
        { from: "assistant", text: assistant.bookingEnabled ? "Hvala, Mila. Beležim termin za sredu u 14:30. Vidimo se!" : "Hvala, Mila. Vaš zahtev je zabeležen za tim." },
      ],
    },
    {
      id: "hours",
      name: "Luka Jovanović",
      initials: "LJ",
      channel: "message",
      time: "10:28",
      length: "4 poruke",
      status: "resolved",
      outcome: "Odgovoreno",
      summary: "Luka je pitao za radno vreme. Asistent je odgovorio na osnovu radnog vremena iz podešavanja.",
      messages: [
        { from: "caller", text: "Zdravo, do kada radite?" },
        { from: "assistant", text: describeHours(draft.hours) },
        { from: "caller", text: "Super, hvala!" },
        { from: "assistant", text: "Nema na čemu. Prijatan dan!" },
      ],
    },
    topic
      ? {
        id: "handoff",
        name: "Sara Nikolić",
        initials: "SN",
        channel: "call",
        time: "10:15",
        length: "1 min 38 s",
        status: "team",
        outcome: "Za vaš tim",
        summary: `Razgovor spada u temu „${HANDOFF_LABELS[topic]}“. Asistent je zabeležio sažetak kako bi tim nastavio razgovor.`,
        messages: [
          { from: "assistant", text: greeting },
          { from: "caller", text: handoffExamples[topic].question },
          { from: "assistant", text: handoffExamples[topic].answer },
        ],
      }
      : {
        id: "handoff",
        name: "Sara Nikolić",
        initials: "SN",
        channel: "call",
        time: "10:15",
        length: "1 min 38 s",
        status: "team",
        outcome: "Za vaš tim",
        summary: "Asistent nije imao odgovor na pitanje, pa je postupio prema podešavanju za nepoznata pitanja.",
        messages: [
          { from: "assistant", text: greeting },
          { from: "caller", text: "Da li radite i za praznike?" },
          { from: "assistant", text: unknownAnswerReply(draft) },
        ],
      },
    entry
      ? {
        id: "knowledge",
        name: "Marko Ilić",
        initials: "MI",
        channel: "message",
        time: "09:52",
        length: "3 poruke",
        status: "resolved",
        outcome: "Odgovoreno",
        summary: "Marko je postavio pitanje na koje postoji odgovor u bazi znanja.",
        messages: [
          { from: "caller", text: entry.question },
          { from: "assistant", text: entry.answer },
          { from: "caller", text: "Hvala na odgovoru." },
        ],
      }
      : {
        id: "knowledge",
        name: "Marko Ilić",
        initials: "MI",
        channel: "message",
        time: "09:52",
        length: "3 poruke",
        status: "team",
        outcome: "Bez odgovora",
        summary: "Baza znanja je prazna, pa asistent nije imao pripremljen odgovor. Dodajte česta pitanja u bazu znanja.",
        messages: [
          { from: "caller", text: "Da li je potrebno da ponesem nešto?" },
          { from: "assistant", text: unknownAnswerReply(draft) },
        ],
      },
    {
      id: "location",
      name: "Jelena Savić",
      initials: "JS",
      channel: "call",
      time: "09:31",
      length: "58 s",
      status: "resolved",
      outcome: "Odgovoreno",
      summary: "Jelena je pitala gde se nalazite. Asistent je odgovorio adresom iz podešavanja.",
      messages: [
        { from: "assistant", text: greeting },
        { from: "caller", text: "Gde se tačno nalazite?" },
        { from: "assistant", text: describeLocation(draft) },
      ],
    },
  ];

  return conversations;
}

function describeLocation(draft: WorkspaceDraft): string {
  const address = draft.business.address.trim();
  const city = draft.business.city.trim();
  if (address) return `Nalazimo se na adresi ${address}${city ? `, ${city}` : ""}.`;
  if (city) return `Nalazimo se u gradu ${city}. Tačnu adresu će vam poslati naš tim.`;
  return unknownAnswerReply(draft);
}
