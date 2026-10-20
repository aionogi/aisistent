"use client";

import { useId, useState, type FormEvent } from "react";
import { ArrowRight, ArrowUpRight, BookOpen, CalendarDays, Check, ChevronRight, LayoutDashboard, MessageSquare, Phone, Plus, Waves, X } from "lucide-react";
import styles from "./DashboardPreview.module.css";

type PreviewTab = "overview" | "conversations" | "knowledge";
type KnowledgeEntry = { question: string; answer: string };

const conversations = [
  { id: "mila", name: "Mila Petrović", initials: "MP", channel: "Poziv", time: "10:42", duration: "2 min 14 s", outcome: "Zakazan termin", summary: "Mila je želela da zakaže konsultaciju. Asistent je odgovorio na pitanja i u ovom primeru rezervisao slobodan termin.", detail: "Sreda, 14:30 · Konsultacija", icon: CalendarDays },
  { id: "luka", name: "Luka Jovanović", initials: "LJ", channel: "Poruka", time: "10:28", duration: "4 poruke", outcome: "Odgovoreno", summary: "Luka je pitao za radno vreme i lokaciju. Asistent mu je odgovorio koristeći informacije iz baze znanja.", detail: "Radno vreme · Ponedeljak–petak, 09–17 h", icon: Check },
  { id: "sara", name: "Sara Nikolić", initials: "SN", channel: "Poziv", time: "10:15", duration: "1 min 38 s", outcome: "Za vaš tim", summary: "Sara je imala specifičan zahtev. Asistent je zabeležio sažetak kako bi vaš tim mogao da nastavi razgovor.", detail: "Sledeći korak · Tim pregleda zahtev", icon: ArrowUpRight },
];

const initialKnowledge: KnowledgeEntry[] = [
  { question: "Koje je vaše radno vreme?", answer: "Tu smo od ponedeljka do petka, od 09 do 17 časova." },
  { question: "Kako mogu da zakažem konsultaciju?", answer: "Recite nam koji dan vam odgovara. Konsultacija traje 30 minuta." },
];

function ConversationView() {
  const [selectedId, setSelectedId] = useState("mila");
  const selected = conversations.find((conversation) => conversation.id === selectedId)!;
  const OutcomeIcon = selected.icon;

  return (
    <>
      <div className={styles.sectionHeading}><h4>Poslednji razgovori</h4><span>Danas · primer</span></div>
      <div className={styles.conversationList} aria-label="Primeri razgovora">
        {conversations.map((conversation) => (
          <button type="button" key={conversation.id} className={`${styles.conversationRow} ${selectedId === conversation.id ? styles.selectedRow : ""}`} onClick={() => setSelectedId(conversation.id)} aria-pressed={selectedId === conversation.id}>
            <span className={styles.initials}>{conversation.initials}</span>
            <span className={styles.person}><strong>{conversation.name}</strong><span>{conversation.channel === "Poziv" ? <Phone size={12} aria-hidden="true" /> : <MessageSquare size={12} aria-hidden="true" />}{conversation.channel} · {conversation.duration}</span></span>
            <span className={`${styles.outcome} ${conversation.id === "sara" ? styles.pending : ""}`}>{conversation.outcome}</span>
            <span className={styles.time}>{conversation.time}</span>
            <ChevronRight className={styles.rowArrow} size={16} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className={styles.conversationDetail} aria-live="polite">
        <div className={styles.detailIcon}><OutcomeIcon size={18} aria-hidden="true" /></div>
        <div><div className={styles.detailLabel}>Sažetak razgovora · {selected.name.split(" ")[0]}</div><p>{selected.summary}</p><span className={styles.detailResult}>{selected.detail}</span></div>
      </div>
    </>
  );
}

function OverviewView({ onOpenConversations }: { onOpenConversations: () => void }) {
  return (
    <>
      <div className={styles.sectionHeading}><h4>Vaša nedelja, na jednom mestu.</h4><span>Primer aktivnosti</span></div>
      <div className={styles.overviewGrid}>
        <div className={styles.chartPanel}>
          <div className={styles.chartHeading}><span>Razgovori ove nedelje</span><strong>142 <small>ukupno</small></strong></div>
          <div className={styles.chart} role="img" aria-label="Ilustrativni primer: ponedeljak 15, utorak 21, sreda 18, četvrtak 29, petak 26, subota 19 i nedelja 14 razgovora.">
            {["Pon", "Uto", "Sre", "Čet", "Pet", "Sub", "Ned"].map((day) => <div key={day}><span className={styles.bar} /><span className={styles.day}>{day}</span></div>)}
          </div>
        </div>
        <div className={styles.overviewNote}><span className={styles.noteIcon}><CalendarDays size={20} aria-hidden="true" /></span><strong>Od razgovora<br />do sledećeg koraka.</strong><p>Vidite zakazane termine, dobijene upite i razgovore koji čekaju vaš tim.</p><button type="button" onClick={onOpenConversations}>Pogledajte primere <ArrowRight size={16} aria-hidden="true" /></button></div>
      </div>
    </>
  );
}

function KnowledgeView() {
  const [entries, setEntries] = useState(initialKnowledge);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const formId = useId();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!question.trim() || !answer.trim()) {
      setStatus("Unesite pitanje i odgovor pre dodavanja.");
      return;
    }
    setEntries((current) => [...current, { question: question.trim(), answer: answer.trim() }]);
    setQuestion("");
    setAnswer("");
    setIsFormOpen(false);
    setStatus("Vaš primer je dodat u bazu znanja za ovaj demo.");
  }

  return (
    <>
      <div className={styles.sectionHeading}><h4>Šta vaš asistent zna</h4><button type="button" className={styles.addButton} aria-expanded={isFormOpen} aria-controls={formId} onClick={() => { setIsFormOpen(!isFormOpen); setStatus(""); }}>{isFormOpen ? <X size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}{isFormOpen ? "Zatvori" : "Dodaj primer"}</button></div>
      <div className={styles.knowledgeEntries}>{entries.map((entry, index) => <div className={styles.knowledgeEntry} key={`${index}-${entry.question}`}><BookOpen size={17} aria-hidden="true" /><div><strong>{entry.question}</strong><p>{entry.answer}</p></div></div>)}</div>
      {isFormOpen && <form id={formId} className={styles.knowledgeForm} onSubmit={handleSubmit}><label htmlFor={`${formId}-question`}>Pitanje<input id={`${formId}-question`} value={question} onChange={(event) => setQuestion(event.target.value)} required maxLength={120} placeholder="Npr. Gde se nalazite?" autoFocus /></label><label htmlFor={`${formId}-answer`}>Odgovor<textarea id={`${formId}-answer`} value={answer} onChange={(event) => setAnswer(event.target.value)} required maxLength={400} rows={2} placeholder="Unesite odgovor koji bi asistent koristio." /></label><button type="submit">Sačuvaj primer <Check size={15} aria-hidden="true" /></button></form>}
      <p className={styles.localNote}>Primeri se čuvaju samo dok je ova stranica otvorena.</p>
      <p className={styles.formStatus} role="status">{status}</p>
    </>
  );
}

export default function DashboardPreview() {
  const [activeTab, setActiveTab] = useState<PreviewTab>("conversations");
  const tabs = [{ id: "overview" as const, label: "Pregled", icon: LayoutDashboard }, { id: "conversations" as const, label: "Razgovori", icon: MessageSquare }, { id: "knowledge" as const, label: "Baza znanja", icon: BookOpen }];

  return (
    <div className={styles.dashboard}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}><Waves size={24} aria-hidden="true" /><span>aisistent<span className={styles.brandDot}>.</span></span></div>
        <div className={styles.workspace}><span className={styles.workspaceIcon}>S</span><div><strong>Studio Ana</strong><span>Demo radni prostor</span></div></div>
        <nav className={styles.navigation} aria-label="Prikazi demo kontrolne table">{tabs.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={activeTab === id ? styles.activeTab : ""} aria-pressed={activeTab === id} onClick={() => setActiveTab(id)}><Icon size={17} aria-hidden="true" /><span>{label}</span></button>)}</nav>
        <div className={styles.sidebarBottom}><span className={styles.avatar}>AP</span><div><strong>Ana Petrović</strong><span>Primer naloga</span></div></div>
      </aside>
      <div className={styles.main}>
        <header className={styles.header}><div><h3>Dobro jutro, Ana.</h3></div><span className={styles.previewBadge}><span />Primer kontrolne table</span></header>
        <div className={styles.stats} aria-label="Ilustrativni podaci za današnji dan"><div><span>Razgovora danas</span><strong>26<small><ArrowUpRight size={13} aria-hidden="true" /> 8 više nego juče</small></strong></div><div><span>Zakazanih termina</span><strong>11<small>u ovom primeru</small></strong></div><div><span>Čekaju vaš tim</span><strong>3<small>zahteva za pregled</small></strong></div></div>
        <div className={styles.view} hidden={activeTab !== "overview"}><OverviewView onOpenConversations={() => setActiveTab("conversations")} /></div>
        <div className={styles.view} hidden={activeTab !== "conversations"}><ConversationView /></div>
        <div className={styles.view} hidden={activeTab !== "knowledge"}><KnowledgeView /></div>
        <div className={styles.footer}><span className={styles.footerDot} />Interaktivni demo · Svi prikazani podaci i osobe su izmišljeni.</div>
      </div>
    </div>
  );
}
