import { signIn } from "@/lib/auth";
import { CopyIconButton } from "@/components/leaderboard/CopyIconButton";
import { getTranslations } from "next-intl/server";

export async function ProfileJoinCta() {
  const t = await getTranslations("profile");

  return (
    <div className="rounded-lg border border-accent/20 bg-accent/[0.03] p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-display text-sm font-semibold text-foreground">
            {t("joinHeadline")}
          </p>
          <p className="font-mono text-xs text-muted mt-0.5">
            {t("joinDescription")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <form
            action={async () => {
              "use server";
              await signIn("github");
            }}
          >
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 font-mono text-xs font-semibold text-background transition-all hover:bg-accent-bright"
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
              </svg>
              {t("joinSignIn")}
            </button>
          </form>
          <div className="hidden sm:flex items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1.5 text-xs">
            <span className="text-dim/60 select-none">$</span>
            <code className="font-mono text-foreground/70 text-[11px]">npx clawdboard auth</code>
            <CopyIconButton text="npx clawdboard auth" />
          </div>
        </div>
      </div>
    </div>
  );
}
