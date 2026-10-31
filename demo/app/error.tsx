"use client";

import { useEffect } from "react";
import Brand from "../components/Brand";
import { reportRenderError } from "../lib/observability/report-render-error";

/**
 * Shown when a page fails to render. It never displays the error itself:
 * production errors from the server carry only a generic message and digest.
 * Styled with global classes; a CSS module here would be preloaded on every page.
 */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => reportRenderError(error), [error]);

  return (
    <main id="main" className="status-page">
      <section className="status-card" aria-labelledby="error-title">
        <a href="/" aria-label="aisistent početna"><Brand /></a>
        <h1 id="error-title">Nešto nije u redu</h1>
        <p>Stranica trenutno ne može da se prikaže. Pokušajte ponovo za nekoliko trenutaka; ako se greška ponavlja, zapišite vreme kada se desila.</p>
        <div className="status-actions">
          <button type="button" className="status-primary" onClick={() => retry()}>Pokušaj ponovo</button>
          <a href="/">Početna strana</a>
        </div>
      </section>
    </main>
  );
}
