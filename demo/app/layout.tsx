import type { Metadata } from "next";
import { connection } from "next/server";
import "@fontsource-variable/manrope";
import "./globals.css";

export const metadata: Metadata = {
  title: "aisistent — Vaš posao. Uvek na vezi.",
  description:
    "Upoznajte aisistent: AI asistent za poslovne pozive i poruke. Istražite interaktivni demo na srpskom.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Render per request so Next.js can attach the CSP nonce from proxy.ts to its scripts.
  await connection();
  return (
    <html lang="sr-Latn" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
