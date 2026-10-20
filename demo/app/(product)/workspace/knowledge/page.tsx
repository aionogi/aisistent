import type { Metadata } from "next";
import KnowledgeView from "../../../../components/workspace/views/KnowledgeView";

export const metadata: Metadata = { title: "Baza znanja — aisistent demo" };

export default function KnowledgePage() {
  return <KnowledgeView />;
}
