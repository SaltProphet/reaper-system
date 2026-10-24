import { createFileRoute } from "@tanstack/react-router";
import { Workbench } from "@/components/workbench";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) return <main className="min-h-dvh bg-ink p-6 font-mono text-sm text-mute">Loading private workbench…</main>;
  if (!user) return <RedirectToSignIn />;
  return <Workbench />;
}

