export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cachedAuth, signIn, isDevAuthMode } from "@/lib/auth";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = {
  title: "Sign In",
  robots: { index: false, follow: false },
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const session = await cachedAuth();
  const params = await searchParams;
  const callbackUrl = params.callbackUrl || "/";
  const hasAuthError = !!params.error;
  const t = await getTranslations("auth");

  if (session?.user) {
    redirect(callbackUrl);
  }

  if (isDevAuthMode) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="relative z-10 w-full max-w-sm rounded-lg border border-border bg-surface p-8">
          <div className="text-center">
            <h1 className="font-display text-xl font-bold text-foreground">
              $ clawdboard
              <span className="animate-blink ml-0.5 text-accent">_</span>
            </h1>
            <p className="mt-2 font-mono text-xs text-muted">
              {`// dev mode — no GitHub OAuth required`}
            </p>
          </div>

          <form
            action={async (formData: FormData) => {
              "use server";
              const username = formData.get("username") as string;
              await signIn("credentials", {
                username,
                redirectTo: callbackUrl,
              });
            }}
            className="mt-8 space-y-4"
          >
            <div>
              <label
                htmlFor="username"
                className="block font-mono text-xs text-muted mb-1"
              >
                Seeded username
              </label>
              <input
                id="username"
                name="username"
                type="text"
                defaultValue="dev-alice"
                className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground focus:border-accent focus:outline-none"
                placeholder="dev-alice"
              />
            </div>
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-3 rounded-md bg-accent px-4 py-3 font-mono text-sm font-semibold text-background transition-all hover:bg-accent-bright focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background focus:outline-none"
            >
              Sign in as dev user
            </button>
          </form>

          <p className="mt-6 text-center font-mono text-[10px] text-dim">
            Set AUTH_GITHUB_ID and AUTH_GITHUB_SECRET
            <br />
            in .env.local to use real GitHub OAuth
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="relative z-10 w-full max-w-sm rounded-lg border border-border bg-surface p-8">
        <div className="text-center">
          <h1 className="font-display text-xl font-bold text-foreground">
            $ clawdboard
            <span className="animate-blink ml-0.5 text-accent">_</span>
          </h1>
          <p className="mt-2 font-mono text-xs text-muted">
            {`// ${t("signInToContinue")}`}
          </p>
        </div>

        {hasAuthError && (
          <div
            role="alert"
            className="mt-6 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 font-mono text-xs text-amber-200"
          >
            {t("signInInterrupted")}
          </div>
        )}

        <form
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: callbackUrl });
          }}
          className="mt-8"
        >
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-3 rounded-md bg-accent px-4 py-3 font-mono text-sm font-semibold text-background transition-all hover:bg-accent-bright hover:shadow-[0_0_20px_rgba(249,166,21,0.2)] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background focus:outline-none"
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
            {t("signInWithGithub")}
          </button>
        </form>

        <p className="mt-6 text-center font-mono text-[10px] text-dim">
          {t("publicProfileOnly")}
          <br />
          {t("noRepoAccess")}
        </p>
      </div>
    </div>
  );
}
