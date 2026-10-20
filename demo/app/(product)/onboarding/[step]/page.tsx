import { notFound } from "next/navigation";
import OnboardingStep from "../../../../components/workspace/onboarding/OnboardingStep";
import { isStepId, STEP_IDS } from "../../../../lib/workspace/steps";

export const dynamicParams = false;

export function generateStaticParams() {
  return STEP_IDS.map((step) => ({ step }));
}

export default async function OnboardingStepPage({ params }: PageProps<"/onboarding/[step]">) {
  const { step } = await params;
  if (!isStepId(step)) notFound();
  return <OnboardingStep key={step} step={step} />;
}
