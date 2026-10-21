import { notFound } from "next/navigation";
import OnboardingStep from "../../../../../../components/workspace/onboarding/OnboardingStep";
import { isStepId } from "../../../../../../lib/workspace/steps";

export default async function OrganizationOnboardingStepPage({ params }: PageProps<"/org/[organizationId]/onboarding/[step]">) {
  const { step } = await params;
  if (!isStepId(step)) notFound();
  return <OnboardingStep key={step} step={step} />;
}
