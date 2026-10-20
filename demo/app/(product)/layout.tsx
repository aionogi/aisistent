import type { Metadata } from "next";
import { DraftProvider } from "../../components/workspace/DraftProvider";

export const metadata: Metadata = {
  title: "aisistent — Demo radni prostor",
  description: "Demo radni prostor i podešavanje asistenta sa primerima podataka. Bez prijave, poziva i naplate.",
};

/** Shares one browser-only draft between onboarding and the workspace, so it survives navigation between them. */
export default function ProductLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <DraftProvider>{children}</DraftProvider>;
}
