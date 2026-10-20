"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowUpRight,
  Check,
  CircleCheck,
  MessageCircle,
  Pause,
  Phone,
  Play,
  RotateCcw,
  Scissors,
  Stethoscope,
  UtensilsCrossed,
  Wrench,
} from "lucide-react";
import styles from "./ConversationDemo.module.css";

const scenarios = [
  {
    id: "salon",
    label: "Salon",
    icon: Scissors,
    name: "Studio Mila",
    description: "Dok vi brinete o frizuri, aisistent brine o sledećem terminu.",
    request: "Šišanje i feniranje",
    appointment: "Sreda, 16:30",
    messages: [
      "Dobar dan! Dobili ste Studio Mila. Ja sam AI asistent salona. Kako mogu da vam pomognem?",
      "Zdravo! Imate li slobodan termin za šišanje i feniranje u sredu?",
      "Naravno. Mogu da vam ponudim sredu u 16:30 ili 18:00. Šta vam više odgovara?",
      "U 16:30 bi bilo odlično. Ja sam Ana.",
      "Hvala, Ana. Beležim šišanje i feniranje za sredu u 16:30. Vidimo se u Studiju Mila!",
    ],
  },
  {
    id: "clinic",
    label: "Ordinacija",
    icon: Stethoscope,
    name: "Dental Studio",
    description: "Vi ste posvećeni pacijentu. Sledeći poziv već ima kome da se javi.",
    request: "Kontrolni pregled",
    appointment: "Četvrtak, 10:00",
    messages: [
      "Dobar dan, Dental Studio. Ja sam AI asistent ordinacije. Želite li da zakažete pregled?",
      "Dobar dan. Želeo bih da zakažem redovnu kontrolu ove nedelje.",
      "Slobodan termin za kontrolni pregled je u četvrtak u 10:00. Da li vam odgovara?",
      "Da, odgovara mi. Marko je moje ime.",
      "Hvala, Marko. Beležim kontrolni pregled za četvrtak u 10:00. Prijatan dan!",
    ],
  },
  {
    id: "garage",
    label: "Auto-servis",
    icon: Wrench,
    name: "Servis Jovanović",
    description: "Manje prekidanja posla. Više uredno dogovorenih dolazaka.",
    request: "Zamena zimskih guma",
    appointment: "Petak, 09:00",
    messages: [
      "Dobar dan! Dobili ste Servis Jovanović. Ja sam AI asistent servisa. Kako mogu da pomognem?",
      "Treba mi zamena zimskih guma. Ima li nešto slobodno u petak?",
      "Imamo slobodan termin u petak u 09:00. Da li donosite svoj komplet guma?",
      "Da, donosim. Nikola je moje ime i odgovara mi termin.",
      "Odlično, Nikola. Beležim zamenu guma u petak u 09:00, sa vašim kompletom. Vidimo se!",
    ],
  },
  {
    id: "restaurant",
    label: "Restoran",
    icon: UtensilsCrossed,
    name: "Bistro Bašta",
    description: "Gosti za stolom imaju vašu pažnju. Gosti na telefonu imaju aisistenta.",
    request: "Sto za četiri osobe",
    appointment: "Subota, 19:00",
    messages: [
      "Dobro došli u Bistro Bašta! Ja sam AI asistent restorana. Kako mogu da pomognem?",
      "Htela bih da rezervišem sto za četvoro u subotu oko sedam.",
      "Imamo slobodan sto u 19:00. Da li biste želeli da sedite unutra ili u bašti?",
      "U bašti, molim vas. Rezervacija je na ime Jelena.",
      "Hvala, Jelena. Beležim sto u bašti za četiri osobe, u subotu u 19:00. Radujemo se dolasku!",
    ],
  },
] as const;

const duration = 15000;
const messageInterval = 2800;
const waveformHeights = [8, 14, 21, 12, 30, 40, 23, 48, 32, 20, 35, 50, 29, 17, 39, 26, 12, 30, 44, 22, 35, 18, 27, 12, 8];

export default function ConversationDemo() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const scenario = scenarios[selectedIndex];
  const isComplete = elapsed >= duration;
  const hasStarted = elapsed > 0 || isRunning;
  const visibleCount = hasStarted ? Math.min(Math.floor(elapsed / messageInterval) + 1, scenario.messages.length) : 0;
  const seconds = Math.floor(elapsed / 1000).toString().padStart(2, "0");

  useEffect(() => {
    if (!isRunning || isComplete) return;
    const timer = window.setInterval(() => setElapsed((current) => Math.min(current + 100, duration)), 100);
    return () => window.clearInterval(timer);
  }, [isRunning, isComplete]);

  useEffect(() => {
    if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [visibleCount, isComplete]);

  function selectScenario(index: number) {
    setSelectedIndex(index);
    setIsRunning(false);
    setElapsed(0);
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const nextIndex = event.key === "ArrowRight" ? (index + 1) % scenarios.length
      : event.key === "ArrowLeft" ? (index - 1 + scenarios.length) % scenarios.length
        : event.key === "Home" ? 0 : event.key === "End" ? scenarios.length - 1 : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    selectScenario(nextIndex);
    tabRefs.current[nextIndex]?.focus();
  }

  function togglePlayback() {
    if (isComplete) {
      setElapsed(1);
      setIsRunning(true);
    } else {
      if (!hasStarted) setElapsed(1);
      setIsRunning((current) => !current);
    }
  }

  const PlaybackIcon = isComplete ? RotateCcw : isRunning ? Pause : Play;
  const playbackLabel = isComplete ? "Ponovi razgovor" : isRunning ? "Pauziraj razgovor" : hasStarted ? "Nastavi razgovor" : "Pokreni razgovor";

  return (
    <section id="demo" className={styles.section} aria-labelledby="demo-title">
      <div className={styles.sectionHeader}>
        <div>
          <h2 id="demo-title">Jedan poziv.<br />Mnogo manje posla.</h2>
          <p>Izaberite delatnost i pokrenite simulaciju razgovora.</p>
        </div>
        <span className={styles.demoBadge}><span /> Interaktivni demo</span>
      </div>

      <div className={styles.tabs} role="tablist" aria-label="Izaberite delatnost">
        {scenarios.map((item, index) => {
          const Icon = item.icon;
          return (
            <button key={item.id} ref={(node) => { tabRefs.current[index] = node; }} type="button"
              role="tab" id={`demo-tab-${item.id}`} aria-controls="demo-panel"
              aria-selected={selectedIndex === index} tabIndex={selectedIndex === index ? 0 : -1}
              onClick={() => selectScenario(index)} onKeyDown={(event) => handleTabKey(event, index)}>
              <Icon size={17} strokeWidth={1.8} aria-hidden="true" />{item.label}
            </button>
          );
        })}
      </div>

      <div id="demo-panel" role="tabpanel" tabIndex={0} aria-labelledby={`demo-tab-${scenario.id}`} className={styles.demoPanel}>
        <div className={styles.callPanel}>
          <div className={styles.businessHeader}>
            <span className={styles.businessIcon}><scenario.icon size={24} strokeWidth={1.6} aria-hidden="true" /></span>
            <span>Primer za vašu delatnost</span>
          </div>
          <h3>{scenario.name}</h3>
          <p className={styles.businessDescription}>{scenario.description}</p>

          <div className={styles.callVisualization} aria-hidden="true">
            <div className={`${styles.phoneCircle} ${isRunning && !isComplete ? styles.activePhone : ""}`}>
              {isComplete ? <Check size={27} strokeWidth={1.8} /> : <Phone size={25} strokeWidth={1.6} />}
            </div>
            <div className={`${styles.waveform} ${isRunning && !isComplete ? styles.playing : ""}`}>
              {waveformHeights.map((height, index) => <span key={index} style={{ height, animationDelay: `${index * -0.13}s` }} />)}
            </div>
            <span className={styles.elapsed}>00:{seconds}</span>
          </div>

          <div className={styles.playback}>
            <div className={styles.progress} role="progressbar" aria-label="Napredak simulacije" aria-valuemin={0} aria-valuemax={15} aria-valuenow={Math.floor(elapsed / 1000)}>
              <span style={{ width: `${(elapsed / duration) * 100}%` }} />
            </div>
            <div className={styles.timeLabels}><span>{isComplete ? "Razgovor je završen" : isRunning ? "Razgovor je u toku" : hasStarted ? "Razgovor je pauziran" : "Spremni kad i vi"}</span><span>00:15</span></div>
            <button type="button" onClick={togglePlayback} className={styles.playButton}>
              <PlaybackIcon size={17} fill={!isRunning && !isComplete ? "currentColor" : "none"} aria-hidden="true" />{playbackLabel}
            </button>
            <p className={styles.simulationNote}>Tekstualna simulacija · bez stvarnog poziva</p>
          </div>
        </div>

        <div className={styles.transcriptPanel}>
          <div className={styles.transcriptHeader}>
            <span><MessageCircle size={16} strokeWidth={1.8} aria-hidden="true" /> Tok razgovora</span>
            <span className={styles.transcriptStatus}>{isComplete ? "Završeno" : isRunning ? "U toku" : hasStarted ? "Pauzirano" : "Pregled"}</span>
          </div>
          <div ref={transcriptRef} className={styles.transcript} role="log" aria-label={`Simulacija razgovora za ${scenario.name}`} aria-live="polite" aria-relevant="additions">
            {!hasStarted ? (
              <div className={styles.emptyState}>
                <div className={styles.previewBubble}>Dobar dan! Kako mogu<br />da vam pomognem?<span>aisistent <Check size={12} aria-hidden="true" /></span></div>
                <div className={styles.previewResponse}><span /><span /><span /></div>
                <p>Od prvog „dobar dan“<br />do dogovorenog termina.</p>
                <span>Pokrenite demo i pratite razgovor.</span>
              </div>
            ) : (
              scenario.messages.slice(0, visibleCount).map((message, index) => (
                <div key={`${scenario.id}-${index}`} className={`${styles.message} ${index % 2 === 0 ? styles.assistantMessage : styles.callerMessage}`}>
                  <span className={styles.speaker}>{index % 2 === 0 ? "aisistent" : "Klijent"}<span>00:{Math.floor(index * messageInterval / 1000).toString().padStart(2, "0")}</span></span>
                  <p>{message}</p>
                </div>
              ))
            )}
            {isComplete && <div className={styles.result}>
              <CircleCheck size={20} strokeWidth={1.8} aria-hidden="true" />
              <div><strong>Termin je zabeležen u simulaciji</strong><p>{scenario.request} · {scenario.appointment}</p></div>
            </div>}
          </div>
          <div className={styles.transcriptFooter}><span className={styles.footerMark}>a<span>i</span></span><span>Prirodan razgovor. Jasan dogovor.</span><ArrowUpRight size={16} aria-hidden="true" /></div>
        </div>
      </div>
      <p className={styles.disclaimer}>Svi nazivi i razgovori u ovom prikazu su izmišljeni. Simulacija ne zakazuje stvarne termine.</p>
    </section>
  );
}
