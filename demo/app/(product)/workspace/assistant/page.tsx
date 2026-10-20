import type { Metadata } from "next";
import AssistantSettingsView from "../../../../components/workspace/views/AssistantSettingsView";

export const metadata: Metadata = { title: "Podešavanje asistenta — aisistent demo" };

export default function AssistantPage() {
  return <AssistantSettingsView />;
}
