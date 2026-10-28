/**
 * Answers for the website support chat before M4. Every answer is written in
 * advance and picked by keywords; nothing is generated, sent to a server, or
 * stored. Answers describe the current prototype only: no prices, dates,
 * availability, or legal and security promises.
 */

export type SupportLink = { label: string; href: string };
/**
 * `keywords` count twice, `hints` (common words) once. Both are prefixes of
 * normalized words; a leading "=" means the whole word must match.
 */
export type SupportTopic = { id: string; question: string; answer: string; links?: SupportLink[]; keywords: string[]; hints?: string[] };
export type SupportReply = { kind: "topic" | "personal_data" | "unknown"; topicId?: string; text: string; links?: SupportLink[] };

export const MAX_SUPPORT_MESSAGE = 500;

export const GREETING = "Zdravo! Ovde su odgovori na česta pitanja o aisistentu i demou. Izaberite pitanje ili ga napišite.";

// Specific topics come first: on equal scores the earlier topic wins.
export const SUPPORT_TOPICS: SupportTopic[] = [
  {
    id: "pricing",
    question: "Koliko košta?",
    answer: "Cene još nisu objavljene. Demo je besplatan i ne traži ni registraciju ni karticu.",
    keywords: ["cen", "kost", "plac", "naplat", "pretplat", "paket", "besplat", "popust", "novac", "dinar", "=eur", "evr", "faktur"],
    hints: ["racun", "plat"],
  },
  {
    id: "real_ai",
    question: "Da li je ovo pravi AI?",
    answer: "Ovaj chat nije AI: odgovori su unapred napisani i biraju se prema rečima iz vašeg pitanja. I razgovori u demou su pripremljeni primeri. AI asistent sa stvarnim razgovorima dolazi u narednoj fazi.",
    keywords: ["=ai", "vestack", "robot", "=bot", "chatgpt", "=gpt"],
    hints: ["pravi", "model", "ziv"],
  },
  {
    id: "phone_number",
    question: "Mogu li da zadržim svoj broj telefona?",
    answer: "Planirano je preusmeravanje poziva sa vašeg postojećeg poslovnog broja. Dostupnost ćemo proveriti sa izabranim telefonskim operaterom pri povezivanju stvarne usluge.",
    keywords: ["broj", "preusmer", "operater", "zadrz"],
    hints: ["telefon", "linij", "mobil"],
  },
  {
    id: "channels",
    question: "Da li radi i preko WhatsAppa ili e-maila?",
    answer: "Pored telefona planirani su WhatsApp, e-mail i chatbot za sajt klijenta; na stranici su označeni kao „Uskoro“. Za sada možete da isprobate samo simulaciju telefonskog razgovora.",
    links: [{ label: "Isprobajte simulaciju", href: "/#demo" }],
    keywords: ["whatsapp", "viber", "mail", "email", "sms", "kanal", "chatbot", "instagram", "facebook"],
    hints: ["poruk"],
  },
  {
    id: "data",
    question: "Gde se čuvaju moji podaci?",
    answer: "Demo radni prostor čuva podešavanje samo u ovoj kartici pregledača i ništa ne šalje serveru; ovaj chat takođe radi samo u pregledaču. Pravila za podatke stvarne usluge biće objavljena pre njenog pokretanja.",
    keywords: ["podat", "privatn", "bezbed", "sigurn", "gdpr", "zastit", "lozink"],
    hints: ["cuva"],
  },
  {
    id: "account",
    question: "Kako da otvorim nalog?",
    answer: "Za isprobavanje demoa nalog nije potreban. Nalozi za firme su u pripremi i još nisu otvoreni za javnost.",
    keywords: ["nalog", "registr", "prijav", "=login"],
    hints: ["profil", "otvor"],
  },
  {
    id: "language",
    question: "Na kom jeziku razgovara?",
    answer: "Demo je na srpskom (latinica). Koji jezici će biti podržani u stvarnoj usluzi biće navedeno kada usluga bude dostupna.",
    keywords: ["jezik", "srpsk", "engles", "cirilic", "latinic", "prevod"],
  },
  {
    id: "handoff",
    question: "Šta ako asistent ne zna odgovor?",
    answer: "Predviđeno je da zabeleži pitanje ili ponudi razgovor sa vašim timom. Vi određujete informacije koje asistent koristi i situacije u kojima prepušta razgovor čoveku.",
    keywords: ["prepust", "prebac", "nezna"],
    hints: ["=zna", "odgovor", "=tim", "timu", "covek", "osoblj", "zaposlen"],
  },
  {
    id: "demo",
    question: "Želim demo",
    answer: "Demo možete odmah da isprobate, bez registracije: simulaciju razgovora na ovoj stranici i demo radni prostor sa primerom podataka. Demo ne upućuje stvarne pozive i ne čuva podatke na serveru. Zakazivanje prezentacije sa timom preko sajta još nije dostupno.",
    links: [{ label: "Isprobajte simulaciju", href: "/#demo" }, { label: "Demo radni prostor", href: "/workspace/" }],
    keywords: ["demo", "isprob", "probat", "prezent"],
    hints: ["proba", "prikaz", "pogleda", "videt"],
  },
  {
    id: "capabilities",
    question: "Šta asistent može da radi?",
    answer: "aisistent je zamišljen da se javlja na pozive i poruke vaših klijenata, odgovara na česta pitanja iz vaše baze znanja, dogovara termine i prepušta razgovor vašem timu kada je to potrebno. Za sada postoji interaktivni demo sa unapred pripremljenim primerima; povezivanje stvarnih poziva i AI modela dolazi u narednoj fazi.",
    links: [{ label: "Pogledajte primer razgovora", href: "/#demo" }],
    keywords: ["mogucn", "funkcij", "termin", "zakaz", "sposob"],
    hints: ["moze", "mogu", "radi", "=sta", "poziv", "uslug"],
  },
  {
    id: "setup",
    question: "Kako se podešava aisistent?",
    answer: "Podešavanje ima pet koraka: delatnost, podaci o poslu, radno vreme, ponašanje asistenta (ime, ton, pozdrav, kada prepušta razgovor timu) i pregled. Posle toga u radnom prostoru dopunjujete bazu znanja, ručno ili uvozom iz fajla. U demou ne treba prijava; podešavanje se čuva samo u ovoj kartici pregledača.",
    links: [{ label: "Započnite podešavanje", href: "/onboarding/" }],
    keywords: ["podes", "postav", "konfigur", "korak", "uput", "onboard"],
    hints: ["=kako", "pocet", "pocn", "zapoc"],
  },
];

export const SUGGESTED_TOPICS = ["setup", "capabilities", "demo"] as const;

const SMALL_TALK: Array<{ phrases: string[]; text: string }> = [
  { phrases: ["zdravo", "cao", "pozdrav", "dobar dan", "dobro jutro", "dobro vece", "hej", "hello", "hi"], text: "Zdravo! Pitajte me o podešavanju, mogućnostima ili demou aisistenta." },
  { phrases: ["hvala", "fala", "thanks", "thank you"], text: "Nema na čemu. Ako imate još pitanja, tu sam." },
];

const UNKNOWN = "Na to pitanje nemam pouzdan odgovor. Ovaj chat zna samo unapred napisane odgovore o aisistentu, a razgovor sa timom preko sajta još nije dostupan. Pogledajte česta pitanja na stranici ili izaberite jedno od predloženih.";
const PERSONAL_DATA = "Ovaj chat ne čuva poruke i ne prosleđuje ih timu, pa te podatke niko neće videti. Molimo vas da ovde ne upisujete kontakt podatke, lozinke ni brojeve kartica.";

const CYRILLIC: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", ђ: "dj", е: "e", ж: "z", з: "z", и: "i", ј: "j", к: "k", л: "l", љ: "lj", м: "m", н: "n", њ: "nj",
  о: "o", п: "p", р: "r", с: "s", т: "t", ћ: "c", у: "u", ф: "f", х: "h", ц: "c", ч: "c", џ: "dz", ш: "s",
};

/** Lowercase Latin without diacritics, so "Košta", "kosta" and "кошта" compare equal. */
export function normalizeSupportText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[Ѐ-ӿ]/g, (letter) => CYRILLIC[letter] ?? letter)
    .replace(/đ/g, "dj")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;

/** Email addresses and phone- or card-like numbers (8+ digits) get a privacy reminder instead of an answer. */
export function containsPersonalData(message: string): boolean {
  const digitRuns = message.replace(/[\s()/-]/g, "").match(/\d+/g) ?? [];
  return EMAIL.test(message) || digitRuns.some((run) => run.length >= 8);
}

function matches(term: string, words: string[]): boolean {
  return term.startsWith("=") ? words.includes(term.slice(1)) : words.some((word) => word.startsWith(term));
}

function topicScore(topic: SupportTopic, words: string[]): number {
  return 2 * topic.keywords.filter((term) => matches(term, words)).length + (topic.hints ?? []).filter((term) => matches(term, words)).length;
}

export function topicById(id: string): SupportTopic | undefined {
  return SUPPORT_TOPICS.find((topic) => topic.id === id);
}

/** The prepared reply for a visitor's message. */
export function replyTo(message: string): SupportReply {
  const limited = message.slice(0, MAX_SUPPORT_MESSAGE);
  if (containsPersonalData(limited)) return { kind: "personal_data", text: PERSONAL_DATA };
  const text = normalizeSupportText(limited);
  const words = text.split(" ").filter(Boolean);
  const reply = (topic: SupportTopic): SupportReply => ({ kind: "topic", topicId: topic.id, text: topic.answer, links: topic.links });

  const exact = SUPPORT_TOPICS.find((topic) => normalizeSupportText(topic.question) === text);
  if (exact) return reply(exact);
  let best: SupportTopic | undefined;
  let bestScore = 0;
  for (const topic of SUPPORT_TOPICS) {
    const score = topicScore(topic, words);
    if (score > bestScore) {
      best = topic;
      bestScore = score;
    }
  }
  if (best) return reply(best);
  const smallTalk = SMALL_TALK.find(({ phrases }) => phrases.some((phrase) => ` ${text} `.includes(` ${phrase} `)));
  if (smallTalk) return { kind: "topic", text: smallTalk.text };
  return { kind: "unknown", text: UNKNOWN, links: [{ label: "Česta pitanja na stranici", href: "/#questions" }] };
}
