import type { Metadata } from "next";
import AssistantTestView from "../../../../../../../components/workspace/views/AssistantTestView";
import { assistantConfig } from "../../../../../../../lib/assistant/config.ts";
import { sendTestMessageAction } from "./actions.ts";

export const metadata: Metadata = { title: "Probni razgovor — aisistent" };

/** The organization layout has already confirmed membership; the action re-checks role, MFA and limits on every message. */
export default async function AssistantTestPage({ params }: PageProps<"/org/[organizationId]/assistant/test">) {
  const { organizationId } = await params;
  return <AssistantTestView enabled={assistantConfig() !== null} send={sendTestMessageAction.bind(null, organizationId)} />;
}
