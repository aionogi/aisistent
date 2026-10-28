import type { Metadata } from "next";
import Brand from "../components/Brand";
import SupportChat from "../components/support/SupportChat";

export const metadata: Metadata = { title: "Stranica nije pronađena — aisistent" };

/**
 * The 404 page, replacing Next.js's default (which relies on inline styles the
 * Content-Security-Policy blocks). Organizations the visitor may not open get
 * the same page, so it never reveals which ones exist.
 */
export default function NotFound() {
  return (
    <main id="main" className="status-page">
      <section className="status-card" aria-labelledby="not-found-title">
        <a href="/" aria-label="aisistent početna"><Brand /></a>
        <h1 id="not-found-title">Stranica nije pronađena</h1>
        <p>Adresa ne postoji ili nemate pristup ovoj stranici. Ako ste dobili poziv u firmu, otvorite ceo link iz poziva.</p>
        <div className="status-actions">
          <a href="/" className="status-primary">Početna strana</a>
          <a href="/account/">Nalog i firme</a>
        </div>
      </section>
      <SupportChat />
    </main>
  );
}
