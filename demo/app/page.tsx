"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  AudioLines,
  CalendarDays,
  Check,
  ChevronDown,
  Globe2,
  Headphones,
  Menu,
  MessageCircle,
  Phone,
  PhoneIncoming,
  Play,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import AssistantChannels from "../components/AssistantChannels";
import Brand from "../components/Brand";
import ConversationDemo from "../components/ConversationDemo";
import DashboardPreview from "../components/DashboardPreview";

const questions = [
  {
    question: "Šta mogu da isprobam u ovom demou?",
    answer:
      "Možete da izaberete delatnost, pokrenete tekstualnu simulaciju razgovora i istražite primer kontrolne table. U demo radnom prostoru možete korak po korak da podesite asistenta: podatke o poslu, radno vreme, ton razgovora i bazu znanja. Demo ne upućuje stvarne pozive i ne čuva podatke na serveru.",
  },
  {
    question: "Da li je ovo pravi AI razgovor?",
    answer:
      "Ovo je interaktivni prikaz sa unapred pripremljenim primerima. Pokazuje kako će iskustvo izgledati. Povezivanje AI modela, telefonskih brojeva i glasova dolazi u narednoj fazi.",
  },
  {
    question: "Mogu li da zadržim svoj broj telefona?",
    answer:
      "Planirani način rada je preusmeravanje poziva sa postojećeg poslovnog broja. Dostupnost ćemo proveriti sa izabranim telefonskim operaterom pri povezivanju stvarne usluge.",
  },
  {
    question: "Šta ako asistent nema odgovor?",
    answer:
      "Predviđeno je da zabeleži pitanje ili ponudi razgovor sa vašim timom. Vi ćete određivati informacije koje asistent koristi i situacije u kojima treba da prepusti razgovor čoveku.",
  },
];

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <>
      <a className="skip-link" href="#main">Pređi na sadržaj</a>
      <header className="site-header">
        <a className="brand-link" href="#" aria-label="aisistent početna" onClick={closeMenu}>
          <Brand />
        </a>
        <nav className={menuOpen ? "desktop-nav nav-open" : "desktop-nav"} id="main-navigation" aria-label="Glavna navigacija">
          <a href="#how-it-works" onClick={closeMenu}>Kako radi</a>
          <a href="#possibilities" onClick={closeMenu}>Mogućnosti</a>
          <a href="#demo" onClick={closeMenu}>Za vaš posao <ChevronDown size={13} aria-hidden="true" /></a>
        </nav>
        <div className="header-actions">
          <span className="demo-label">Demo verzija</span>
          <a className="button button-blue header-cta" href="#demo">Isprobaj demo <ArrowUpRight /></a>
          <button className="menu-button" type="button" aria-expanded={menuOpen} aria-controls="main-navigation" aria-label={menuOpen ? "Zatvori meni" : "Otvori meni"} onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X  aria-hidden="true" /> : <Menu  aria-hidden="true" />}
          </button>
        </div>
      </header>

      <main id="main">
        <section className="hero container" aria-labelledby="hero-heading">
          <div className="hero-copy">
            <h1 id="hero-heading">Vaš novi asistent.<br /><span>Uvek pri<br className="desktop-break" /> telefonu.</span></h1>
            <p>Dok ste vi posvećeni poslu, aisistent je tu za vaše klijente. Pozivi, pitanja i dogovori — sve počinje dobrim razgovorom.</p>
            <div className="hero-actions">
              <a className="button button-blue button-large" href="#demo">Upoznajte aisistent <ArrowRight size={19} aria-hidden="true" /></a>
              <a className="text-link" href="#how-it-works"><span className="play-circle"><Play size={12} fill="currentColor" aria-hidden="true" /></span> Kako radi?</a>
            </div>
            <div className="hero-note"><Check size={15} aria-hidden="true" /> Bez registracije <span /> Interaktivni demo</div>
          </div>

          <div className="hero-art" aria-label="Ilustracija AI asistenta i primera razgovora">
            <div className="orbit orbit-one" aria-hidden="true" />
            <div className="orbit orbit-two" aria-hidden="true" />
            <div className="orbit orbit-three" aria-hidden="true" />
            <div className="orb-shadow" aria-hidden="true" />
            <div className="voice-orb" aria-hidden="true">
              <div className="orb-inner" />
              <div className="orb-highlight" />
              <div className="orb-wave">
                {Array.from({ length: 7 }, (_, index) => <i key={index} />)}
              </div>
            </div>
            <div className="language-chip"><span className="status-dot" /> Priča vašim jezikom</div>
            <div className="floating-question"><MessageCircle size={16} aria-hidden="true" /><span>„Imate li slobodan termin?“</span></div>
            <div className="hero-call">
              <div className="hero-call-top">
                <span className="call-symbol"><PhoneIncoming size={19} aria-hidden="true" /></span>
                <div><strong>Vaš aisistent</strong><span>Primer dolaznog poziva</span></div>
                <span className="call-time">00:12</span>
              </div>
              <p>„Dobar dan! Rado ću vam pomoći.<br />Koji termin bi vam odgovarao?“</p>
              <div className="call-bottom"><div className="small-wave" aria-hidden="true">{Array.from({ length: 24 }, (_, index) => <i key={index} />)}</div><span>Tu je za vaše klijente</span></div>
            </div>
            <div className="appointment-chip"><span><Check size={15} aria-hidden="true" /></span><div><strong>Jedan dogovor više.</strong><small>Jedna obaveza manje.</small></div></div>
          </div>
        </section>

        <section className="channels container" aria-label="Planirane mogućnosti asistenta">
          <p>Jedan asistent.<br /><strong>Mnogo načina da pomogne.</strong></p>
          <div><Phone size={20} aria-hidden="true" /><span>Pozivi</span></div>
          <div><MessageCircle size={21} aria-hidden="true" /><span>Poruke</span></div>
          <div><CalendarDays size={21} aria-hidden="true" /><span>Termini</span></div>
          <div><Globe2 size={21} aria-hidden="true" /><span>Znanje o vašem poslu</span></div>
        </section>

        <section className="how-section container" id="how-it-works" aria-labelledby="how-title">
          <div className="section-heading split-heading">
            <h2 id="how-title">Vaš posao.<br /><span>Njegova sledeća tema.</span></h2>
            <p>Vi najbolje poznajete svoj posao.<br />Dajte to znanje asistentu koji zna da sasluša.</p>
          </div>
          <div className="steps">
            <article className="step">
              <div className="step-visual website-visual"><div className="tiny-browser"><div><i /><i /><i /></div><span><Globe2 size={16} aria-hidden="true" /> vasposao.rs</span><b /><b /><b /></div><span className="step-icon"><Plus size={18} aria-hidden="true" /></span></div>
              <div className="step-heading"><span>01</span><h3>Upoznajte ga sa poslom</h3></div>
              <p>Usluge, radno vreme i odgovori na česta pitanja. Sve što želite da vaši klijenti znaju.</p>
            </article>
            <article className="step">
              <div className="step-visual voice-visual"><div className="voice-lines" aria-hidden="true">{Array.from({ length: 11 }, (_, index) => <i key={index} />)}</div><span className="voice-caption"><AudioLines size={14} aria-hidden="true" /> Ton koji liči na vas</span></div>
              <div className="step-heading"><span>02</span><h3>Dajte mu svoj karakter</h3></div>
              <p>Smiren i profesionalan ili srdačan i opušten. Vi birate kako vas asistent predstavlja.</p>
            </article>
            <article className="step">
              <div className="step-visual ready-visual"><div className="ready-avatar"><Brand /></div><span className="ready-message"><Check size={14} aria-hidden="true" /> Spreman za razgovor</span></div>
              <div className="step-heading"><span>03</span><h3>Proverite prvi razgovor</h3></div>
              <p>Isprobajte odgovore i prilagodite detalje. Dobar početak pre prvog razgovora sa klijentom.</p>
            </article>
          </div>
          <div className="section-footnote"><Sparkles size={14} aria-hidden="true" /> Ovde možete istražiti primer tog iskustva. Povezivanje vašeg posla dolazi u sledećoj fazi.</div>
        </section>

        <AssistantChannels />

        <div className="demo-section-wrap"><ConversationDemo /></div>

        <section className="workspace-section container" id="possibilities" aria-labelledby="workspace-title">
          <div className="section-heading centered-heading">
            <h2 id="workspace-title">Svaki razgovor.<br /><span>Sve na svom mestu.</span></h2>
            <p>Bez traženja beležaka i preslušavanja svega.<br />Pogledajte kako bi vaš radni dan mogao da izgleda.</p>
          </div>
          <DashboardPreview />
          <div className="workspace-caption"><span><Check size={15} aria-hidden="true" /> Pregled razgovora</span><span><Check size={15} aria-hidden="true" /> Jasni sažeci</span><span><Check size={15} aria-hidden="true" /> Vaša baza znanja</span></div>
          <div className="workspace-cta">
            <Link className="button button-blue" href="/onboarding/">Podesite svog asistenta <ArrowRight size={17} aria-hidden="true" /></Link>
            <Link className="text-link" href="/workspace/">Otvorite demo radni prostor <ArrowRight size={16} aria-hidden="true" /></Link>
            <p>Primer podataka, bez prijave. Podešavanje se čuva samo u ovoj kartici pregledača.</p>
          </div>
        </section>

        <section className="human-section container">
          <div className="human-mark" aria-hidden="true"><Headphones size={46} strokeWidth={1.3} aria-hidden="true" /><span><Phone size={17} aria-hidden="true" /></span></div>
          <div><h2>Tehnologija koja zna<br />kada je potreban čovek.</h2><p>Za jednostavna pitanja tu je asistent. Za važne razgovore — vaš tim. Vi određujete granicu.</p></div>
          <a className="text-link" href="#demo">Pogledajte primer <ArrowRight size={18} aria-hidden="true" /></a>
        </section>

        <section className="faq-section container" id="questions" aria-labelledby="faq-title">
          <div className="faq-intro"><h2 id="faq-title">Dobra pitanja.<br /><span>Jasni odgovori.</span></h2><p>Još malo o demou i ideji<br />iza vašeg budućeg asistenta.</p></div>
          <div className="faq-list">
            {questions.map((item, index) => (
              <details key={item.question} open={index === 0}>
                <summary>{item.question}<Plus size={18} aria-hidden="true" /></summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="closing-section" aria-labelledby="closing-title">
          <div className="closing-orbit" aria-hidden="true" />
          <div className="container closing-content">
            <Brand light />
            <h2 id="closing-title">Manje „javiću se kasnije“.<br />Više vremena za vaš posao.</h2>
            <a className="button button-white button-large" href="#demo">Isprobajte aisistent <ArrowRight size={19} aria-hidden="true" /></a>
            <p>Vaš sledeći dobar razgovor počinje ovde.</p>
          </div>
        </section>
      </main>

      <footer className="site-footer container">
        <div><a href="#" aria-label="aisistent početna"><Brand /></a><p>Za posao koji ne staje kada telefon zazvoni.</p></div>
        <nav aria-label="Navigacija u podnožju"><a href="#how-it-works">Kako radi</a><a href="#demo">Isprobajte demo</a><Link href="/workspace/">Radni prostor</Link><a href="#questions">Pitanja</a><a href="/account/">Prijava</a></nav>
        <div className="footer-bottom"><span>© {new Date().getFullYear()} aisistent</span><span>Interaktivni prototip · Bez stvarnih poziva i naplate</span><a href="#main">Na vrh <ArrowDown size={13} aria-hidden="true" /></a></div>
      </footer>
    </>
  );
}

function ArrowUpRight() {
  return <ArrowRight size={16} className="arrow-diagonal" aria-hidden="true" />;
}
