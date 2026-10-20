import type { Metadata } from "next";
import ConversationsView from "../../../../components/workspace/views/ConversationsView";

export const metadata: Metadata = { title: "Razgovori — aisistent demo" };

export default function ConversationsPage() {
  return <ConversationsView />;
}
