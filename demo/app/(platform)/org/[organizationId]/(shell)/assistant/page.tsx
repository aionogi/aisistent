import type { Metadata } from "next";
import AssistantSettingsView from "../../../../../../components/workspace/views/AssistantSettingsView";

export const metadata: Metadata = { title: "Asistent — aisistent" };

export default function OrganizationAssistantSettingsViewPage() {
  return <AssistantSettingsView />;
}
