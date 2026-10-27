"use client";

import "@fontsource-variable/manrope";
import "./globals.css";
import ErrorPage from "./error";

/** Replaces the root layout when it fails, so it brings its own document and styles. */
export default function GlobalError(props: { error: unknown; retry: () => void }) {
  return (
    <html lang="sr-Latn">
      <body>
        <title>Greška — aisistent</title>
        <ErrorPage {...props} />
      </body>
    </html>
  );
}
