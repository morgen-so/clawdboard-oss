import { signIn } from "@/lib/auth";
import { CopyIconButton } from "./CopyIconButton";
import { getTranslations } from "next-intl/server";

interface HeroSectionProps {
  vibeCoderCount: number;
  totalCost: string;
  totalTokens: number;
  topWeeklyCost: number;
  longestStreak: number;
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toFixed(0);
}

export async function HeroSection({
  totalCost,
  totalTokens,
  topWeeklyCost,
  longestStreak,
}: HeroSectionProps) {
  const t = await getTranslations("leaderboard");

  return (
    <div className="mb-6 rounded-lg border border-accent/20 bg-accent/[0.03] p-6 sm:p-8">
      {/* Headline — data-driven, surfaces extremes */}
      <h1 className="font-display text-xl font-bold text-foreground text-balance tracking-tight sm:text-2xl md:text-3xl lg:text-4xl mb-2">
        {t("heroHeadline", { topCost: formatCurrency(topWeeklyCost) })}
      </h1>
      <p className="font-mono text-sm text-muted mb-5 max-w-2xl">
        {t("heroDescription")}
      </p>

      {/* Social proof stats — extremes, not averages */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="rounded-lg bg-background/60 border border-border/50 p-3 text-center">
          <p className="font-mono text-lg font-bold text-accent sm:text-xl">
            {formatCurrency(parseFloat(totalCost))}
          </p>
          <p className="font-mono text-[10px] text-muted uppercase tracking-wider mt-0.5">
            {t("heroTotalSpent")}
          </p>
        </div>
        <div className="rounded-lg bg-background/60 border border-border/50 p-3 text-center">
          <p className="font-mono text-lg font-bold text-foreground sm:text-xl">
            {formatTokens(totalTokens)}
          </p>
          <p className="font-mono text-[10px] text-muted uppercase tracking-wider mt-0.5">
            {t("heroTokens")}
          </p>
        </div>
        <div className="rounded-lg bg-background/60 border border-border/50 p-3 text-center">
          <p className="font-mono text-lg font-bold text-foreground sm:text-xl">
            {longestStreak}d
          </p>
          <p className="font-mono text-[10px] text-muted uppercase tracking-wider mt-0.5">
            {t("heroLongestStreak")}
          </p>
        </div>
      </div>

      {/* Privacy one-liner */}
      <p className="font-mono text-xs text-muted mb-5">
        <span className="text-success mr-1.5">&#10003;</span>
        {t("heroPrivacy")}
      </p>

      {/* CTA section */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* Primary: GitHub sign-in */}
        <form
          action={async () => {
            "use server";
            await signIn("github");
          }}
        >
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-2.5 rounded-md bg-accent px-5 py-2.5 font-mono text-sm font-semibold text-background transition-all hover:bg-accent-bright hover:shadow-[0_0_20px_rgba(249,166,21,0.2)]"
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
            {t("heroSignIn")}
          </button>
        </form>

        {/* Secondary: CLI command */}
        <div className="flex items-center gap-2 rounded border border-border bg-background px-3 py-2 text-xs">
          <span className="text-dim/60 select-none">$</span>
          <code className="font-mono text-foreground/70">npx clawdboard auth</code>
          <CopyIconButton text="npx clawdboard auth" />
        </div>
      </div>
    </div>
  );
}
