import { createFileRoute } from "@tanstack/react-router";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  return (
    <main className="grid min-h-dvh place-items-center bg-ink p-6 text-bone">
      <section className="w-full max-w-sm border border-line bg-panel p-6">
        <p className="font-mono text-xs tracking-widest text-ember">REAPER / PRIVATE RUNTIME</p>
        <h1 className="mt-3 font-mono text-xl text-paper">Sign in to your workbench</h1>
        <p className="mt-2 text-sm leading-6 text-mute">Workflows, run records, and retrieved evidence are scoped to your account.</p>
        <div className="mt-6 space-y-2">
          {authEnabled ? GROK_PROVIDERS.map((provider) => (
            <button
              key={provider.providerId}
              type="button"
              onClick={() => signIn(provider.providerId, { callbackURL: "/" })}
              className="min-h-11 w-full border border-line bg-well px-4 font-mono text-sm text-paper hover:border-ember"
            >
              Continue with {provider.label}
            </button>
          )) : <p className="text-sm text-mute">Sign-in is disabled.</p>}
        </div>
      </section>
    </main>
  );
}
