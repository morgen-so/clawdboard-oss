import Image from "next/image";
import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import type { ProfileUser, UserSummary, UserRank } from "@/lib/db/profile";
import { safeHostname } from "@/lib/url";
import { StreakAura } from "@/components/ui/StreakAura";
import { getStreakTier } from "@/lib/streak-tiers";

interface ProfileHeaderProps {
  user: ProfileUser;
  summary: UserSummary;
  rank: UserRank;
  currentStreak: number;
  teams?: Array<{ teamName: string; teamSlug: string }>;
  children?: React.ReactNode;
}

function formatCost(cost: string): string {
  const num = parseFloat(cost);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

function formatTokens(count: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(count);
}

function formatDate(date: Date | null): string {
  if (!date) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
  }).format(date);
}

function getInitials(name: string | null, username: string | null): string {
  const source = name ?? username ?? "?";
  return source
    .split(/[\s-]+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export async function ProfileHeader({
  user,
  summary,
  rank,
  currentStreak,
  teams,
  children,
}: ProfileHeaderProps) {
  const t = await getTranslations("profile");
  const totalTokens =
    summary.totalInputTokens +
    summary.totalOutputTokens +
    summary.totalCacheCreation +
    summary.totalCacheRead;

  const streakTier = getStreakTier(currentStreak);

  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      {/* User info + share */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-5">
          <StreakAura streak={currentStreak} size="md">
            {user.image ? (
              <Image
                src={user.image}
                alt={user.githubUsername ?? "User avatar"}
                width={80}
                height={80}
                className="h-20 w-20 rounded-full"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-surface-hover text-2xl font-bold text-muted">
                {getInitials(user.name, user.githubUsername)}
              </div>
            )}
          </StreakAura>
          <div>
            <h1 className="font-display text-xl sm:text-2xl font-bold text-foreground break-words">
              {user.githubUsername ?? user.name ?? "Anonymous"}
            </h1>
            <p className="text-sm text-muted">
              {t("memberSince", { date: formatDate(user.createdAt) })}
            </p>
            {user.cookingUrl && (
              <p className="mt-1 text-sm">
                <span>&#129489;&#8205;&#127859;</span>{" "}
                <a
                  href={user.cookingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-accent transition-colors hover:text-accent/80"
                >
                  {user.cookingLabel || safeHostname(user.cookingUrl)}
                </a>
              </p>
            )}
            {teams && teams.length > 0 && (
              <p className="mt-1 text-sm">
                <span className="text-muted">{t("on")}</span>{" "}
                {teams.map((t, i) => (
                  <span key={t.teamSlug}>
                    {i > 0 && ", "}
                    <Link
                      href={`/team/${t.teamSlug}`}
                      className="font-medium text-accent transition-colors hover:text-accent/80"
                    >
                      {t.teamName}
                    </Link>
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>
        {children}
      </div>

      {/* Stat cards grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {/* Total Cost */}
        <div className="rounded-lg bg-background p-4">
          <p className="text-xs font-medium text-muted mb-1">{t("cost")}</p>
          <p className="font-mono text-lg font-semibold text-accent">
            {formatCost(summary.totalCost)}
          </p>
        </div>

        {/* Total Tokens */}
        <div className="rounded-lg bg-background p-4">
          <p className="text-xs font-medium text-muted mb-1">{t("tokens")}</p>
          <p className="font-mono text-lg font-semibold text-foreground">
            {formatTokens(totalTokens)}
          </p>
        </div>

        {/* Active Days */}
        <div className="rounded-lg bg-background p-4">
          <p className="text-xs font-medium text-muted mb-1">{t("daysActive")}</p>
          <p className="font-mono text-lg font-semibold text-foreground">
            {summary.activeDays}
          </p>
        </div>

        {/* Current Streak */}
        <div className="rounded-lg bg-background p-4">
          <p className="text-xs font-medium text-muted mb-1">{t("streak")}</p>
          <p className="font-mono text-lg font-semibold text-foreground">
            {currentStreak > 0 ? (
              <>
                <span className="text-accent">{streakTier.icon || "\uD83D\uDD25"}</span>{" "}
                {currentStreak}d
              </>
            ) : (
              <span className="text-muted">0d</span>
            )}
          </p>
          {streakTier.tier >= 2 && (
            <p className="text-[10px] font-medium text-muted mt-0.5">
              {streakTier.name}
            </p>
          )}
        </div>

        {/* Global Rank */}
        <div className="rounded-lg bg-background p-4 col-span-2 sm:col-span-1">
          <p className="text-xs font-medium text-muted mb-1">{t("rank")}</p>
          <p className="font-mono text-lg font-semibold text-accent">
            #{rank.rank}
          </p>
          <p className="text-xs text-muted">
            {t("top", { percent: String(rank.percentile) })}
          </p>
        </div>
      </div>
    </div>
  );
}
