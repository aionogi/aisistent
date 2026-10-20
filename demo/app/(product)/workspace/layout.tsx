import AppShell from "../../../components/workspace/AppShell";

export default function WorkspaceLayout({ children }: LayoutProps<"/workspace">) {
  return <AppShell>{children}</AppShell>;
}
