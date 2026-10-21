import Link from "next/link";
import { ArrowRight, Bot, Mail, MessageCircle, Phone, type LucideIcon } from "lucide-react";
import styles from "./AssistantChannels.module.css";

type Channel = { id: string; label: string; icon: LucideIcon; tone: "phone" | "whatsapp" | "mail" | "chat"; href?: string };

// Only the phone assistant can be tried (as a text simulation). The other
// channels are planned and are marked as such instead of linking anywhere.
const channels: Channel[] = [
  { id: "phone", label: "Telefonski asistent", icon: Phone, tone: "phone", href: "#demo" },
  { id: "whatsapp", label: "WhatsApp asistent", icon: MessageCircle, tone: "whatsapp" },
  { id: "mail", label: "E-mail asistent", icon: Mail, tone: "mail" },
  { id: "chat", label: "Chatbot za sajt", icon: Bot, tone: "chat" },
];

/** Calls to action and the assistant's channels, between the workflow steps and the conversation demo. */
export default function AssistantChannels() {
  return (
    <section className={styles.section} aria-labelledby="channels-title">
      <h2 id="channels-title" className="visually-hidden">Načini na koje aisistent pomaže</h2>
      <div className={styles.actions}>
        <Link href="/onboarding/" className={styles.primary}>Započnite podešavanje <ArrowRight size={17} aria-hidden="true" /></Link>
        <a href="#demo" className={styles.secondary}>Pogledajte demo</a>
      </div>

      <ul className={styles.channels}>
        {channels.map(({ id, label, icon: Icon, tone, href }) => {
          const content = (
            <>
              <span className={`${styles.icon} ${styles[tone]}`}><Icon size={19} strokeWidth={1.9} aria-hidden="true" /></span>
              <span className={styles.text}>
                <span className={styles.label}>{label}</span>
                {href ? <span className={styles.meta}>Isprobajte simulaciju</span> : <span className={styles.soon}>Uskoro</span>}
              </span>
              {href && <ArrowRight size={17} className={styles.arrow} aria-hidden="true" />}
            </>
          );
          return (
            <li key={id}>
              {href
                ? <a href={href} className={styles.card} aria-label={`${label}: isprobajte simulaciju razgovora`}>{content}</a>
                : <div className={`${styles.card} ${styles.planned}`}>{content}</div>}
            </li>
          );
        })}
      </ul>

      <a href="#demo" className={styles.transcriptLink}>Pogledajte primer razgovora sa transkriptom</a>
    </section>
  );
}
