"use client";

import Link from "next/link";
import { MessageCircle, RotateCcw, Send, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import { GREETING, MAX_SUPPORT_MESSAGE, replyTo, SUGGESTED_TOPICS, topicById, type SupportLink, type SupportReply } from "../../lib/support/faq";
import styles from "./SupportChat.module.css";

type Message = { id: number; from: "visitor" | "help"; text: string; kind?: SupportReply["kind"]; links?: SupportLink[] };

const MAX_MESSAGES = 60;
const SUGGESTIONS = SUGGESTED_TOPICS.map((id) => topicById(id)!.question);

/**
 * The website's help chat (bottom right). Until M4 it answers only from the
 * prepared questions in lib/support/faq.ts: nothing leaves the browser, and
 * the conversation disappears when the page is closed or reloaded.
 */
export default function SupportChat() {
  const panelId = useId();
  const titleId = useId();
  const inputId = useId();
  const privacyId = useId();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [showPrivacy, setShowPrivacy] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);
  const wasOpen = useRef(false);
  const returnFocus = useRef(true);

  // Focus moves into the panel when it opens and back to the button when it
  // closes, unless a link inside the page was followed (see followPageLink).
  useEffect(() => {
    if (open) inputRef.current?.focus();
    else if (wasOpen.current && returnFocus.current) launcherRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages]);

  function close(focusButton = true) {
    returnFocus.current = focusButton;
    setOpen(false);
    setShowPrivacy(false);
  }

  /**
   * The panel's link disappears with the panel, so instead of relying on the
   * browser's fragment navigation the panel closes first and the page then
   * moves to the section and focuses it, as a normal in-page link would. The
   * address is left unchanged.
   */
  function followPageLink(event: MouseEvent<HTMLAnchorElement>, href: string) {
    const target = document.getElementById(href.slice(1));
    if (!target) return;
    event.preventDefault();
    close(false);
    requestAnimationFrame(() => {
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
      target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    });
  }

  function ask(text: string) {
    const question = text.trim().slice(0, MAX_SUPPORT_MESSAGE);
    if (!question) return;
    const reply = replyTo(question);
    const visitorId = nextId.current++;
    const replyId = nextId.current++;
    setMessages((current) => [
      ...current,
      { id: visitorId, from: "visitor" as const, text: question },
      { id: replyId, from: "help" as const, text: reply.text, kind: reply.kind, links: reply.links },
    ].slice(-MAX_MESSAGES));
    setDraft("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    ask(draft);
  }

  function restart() {
    setMessages([]);
    setDraft("");
    inputRef.current?.focus();
  }

  function handleKey(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  }

  const last = messages[messages.length - 1];
  const showSuggestions = !last || last.kind === "unknown";

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        className={styles.launcher}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {open ? <X size={20} aria-hidden="true" /> : <MessageCircle size={20} aria-hidden="true" />}
        <span>{open ? "Zatvori" : "Pomoć"}</span>
      </button>

      <section id={panelId} className={styles.panel} role="dialog" aria-modal="false" aria-labelledby={titleId} hidden={!open} onKeyDown={handleKey}>
        <header className={styles.header}>
          <span className={styles.avatar}><MessageCircle size={18} aria-hidden="true" /></span>
          <div className={styles.heading}>
            <h2 id={titleId}>Pomoć za aisistent</h2>
            <p>Unapred napisani odgovori · nije AI</p>
          </div>
          <button type="button" className={styles.iconButton} onClick={restart} disabled={!messages.length} aria-label="Novi razgovor" title="Novi razgovor">
            <RotateCcw size={17} aria-hidden="true" />
          </button>
          <button type="button" className={styles.iconButton} onClick={() => close()} aria-label="Zatvori pomoć" title="Zatvori">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div ref={logRef} className={styles.log} role="log" aria-label="Razgovor sa pomoći">
          <p className={styles.notice}>
            Ovo nije razgovor sa AI-jem ni sa timom: odgovori su unapred napisani. Poruke ostaju samo na ovoj stranici i ne šalju se nigde. Ne upisujte lične podatke, lozinke ni brojeve kartica.
          </p>
          <p className={styles.help}><span className="visually-hidden">Pomoć: </span>{GREETING}</p>
          {messages.map((message) => (
            <div key={message.id} className={message.from === "visitor" ? styles.visitorRow : styles.helpRow}>
              <p className={message.from === "visitor" ? styles.visitor : styles.help}>
                <span className="visually-hidden">{message.from === "visitor" ? "Vi: " : "Pomoć: "}</span>{message.text}
              </p>
              {message.links && (
                <ul className={styles.links} aria-label="Linkovi uz odgovor">
                  {message.links.map((link) => (
                    <li key={link.href}>
                      {link.href.startsWith("#")
                        ? <a href={link.href} onClick={(event) => followPageLink(event, link.href)}>{link.label}</a>
                        : <Link href={link.href}>{link.label}</Link>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {showSuggestions && (
            <ul className={styles.suggestions} aria-label="Predložena pitanja">
              {SUGGESTIONS.map((question) => (
                <li key={question}><button type="button" onClick={() => ask(question)}>{question}</button></li>
              ))}
            </ul>
          )}
        </div>

        <div id={privacyId} className={styles.privacy} hidden={!showPrivacy}>
          <h3>Privatnost</h3>
          <p>Ovaj chat radi samo u vašem pregledaču. Poruke se ne šalju na server, ne čuvaju se i ne koriste za treniranje AI modela; nestaju kada zatvorite ili ponovo učitate stranicu. Tim ih ne vidi, pa ovde ne možete ostaviti poruku ni kontakt.</p>
        </div>

        <form className={styles.composer} onSubmit={submit}>
          <label htmlFor={inputId} className="visually-hidden">Vaše pitanje</label>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            value={draft}
            maxLength={MAX_SUPPORT_MESSAGE}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Napišite pitanje…"
            autoComplete="off"
          />
          <button type="submit" className={styles.send} disabled={!draft.trim()} aria-label="Pošalji pitanje">
            <Send size={17} aria-hidden="true" />
          </button>
        </form>

        <footer className={styles.footer}>
          <span>Poruke se ne čuvaju.</span>
          <button type="button" aria-expanded={showPrivacy} aria-controls={privacyId} onClick={() => setShowPrivacy(!showPrivacy)}>Privatnost</button>
        </footer>
      </section>
    </>
  );
}
