import OnboardingFrame from "../../../../../components/workspace/onboarding/OnboardingFrame";
import ReadOnlyRedirect from "../../../../../components/workspace/onboarding/ReadOnlyRedirect";

export default function OrganizationOnboardingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ReadOnlyRedirect><OnboardingFrame>{children}</OnboardingFrame></ReadOnlyRedirect>;
}
