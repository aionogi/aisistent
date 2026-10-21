import type { Metadata } from "next";
import KnowledgeView from "../../../../../../components/workspace/views/KnowledgeView";

export const metadata: Metadata = { title: "Baza znanja — aisistent" };

export default function OrganizationKnowledgeViewPage() {
  return <KnowledgeView />;
}
