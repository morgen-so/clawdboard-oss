import { Link } from "@/i18n/navigation";
import Image from "next/image";
import { type LeaderboardRow } from "@/lib/db/leaderboard";
import { formatCostNumber } from "@/lib/format";
import { StreakAura } from "@/components/ui/StreakAura";
import { getStreakTier } from "@/lib/streak-tiers";
import { buildProfileHref } from "@/lib/url";
import { getLocale, getTranslations } from "next-intl/server";

interface YourPositionProps {
  myRow?: LeaderboardRow;
  unsyncedUser?: { githubUsername: string; image: string | null };
  period?: string;
  rangeFrom?: string;
  rangeTo?: string;
}

function formatCompactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return tokens.toString();
}

interface TranslationLabels {
  spent: string;
  tokens: string;
  streak: string;
  new: string;
  syncYourData: string;
}

export async function YourPosition({ myRow, unsyncedUser, period, rangeFrom, rangeTo }: YourPositionProps) {
  if (!myRow && !unsyncedUser) return null;

  const t = await getTranslations("leaderboard");
  const locale = await getLocale();
  const labels: TranslationLabels = {
    spent: t("spent"),
    tokens: t("tokens"),
    streak: t("streak"),
    new: t("new"),
    syncYourData: t("syncYourData"),
  };

  return (
    <div className="mb-4 rounded-lg border border-accent/20 bg-accent/[0.03]">
      <div className="px-4 pt-3 pb-1">
        <span className="font-mono text-[10px] tracking-widest text-accent/60 font-medium">
          <span className="text-accent/40 select-none">$ </span>whoami
        </span>
      </div>

      {myRow ? (
        <SyncedStatBar row={myRow} period={period} rangeFrom={rangeFrom} rangeTo={rangeTo} labels={labels} locale={locale} />
      ) : unsyncedUser ? (
        <UnsyncedStatBar
          githubUsername={unsyncedUser.githubUsername}
          image={unsyncedUser.image}
          labels={labels}
        />
      ) : null}
    </div>
  );
}

function SyncedStatBar({ row, period, rangeFrom, rangeTo, labels, locale }: { row: LeaderboardRow; period?: string; rangeFrom?: string; rangeTo?: string; labels: TranslationLabels; locale: string }) {
  const username = row.githubUsername ?? row.userId;
  const href = buildProfileHref(row.githubUsername ?? row.userId, period, rangeFrom, rangeTo);
  const cost = `$${formatCostNumber(row.totalCost, locale)}`;
  const tokens = formatCompactTokens(row.totalTokens);
  const initials = username.slice(0, 2).toUpperCase();

  // Rank movement
  let movementEl: React.ReactNode = null;
  if (row.isNew) {
    movementEl = <span className="text-xs font-semibold text-accent">{labels.new}</span>;
  } else if (row.rankDelta !== null && row.rankDelta > 0) {
    movementEl = (
      <span className="text-xs font-semibold text-success">
        &#9650;+{row.rankDelta}
      </span>
    );
  } else if (row.rankDelta !== null && row.rankDelta < 0) {
    movementEl = (
      <span className="text-xs font-semibold text-danger">
        &#9660;{row.rankDelta}
      </span>
    );
  }

  // Streak tier
  const streakTier = getStreakTier(row.currentStreak);

  return (
    <Link
      href={href}
      className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/[0.04]"
    >
      {/* Avatar + username */}
      <StreakAura streak={row.currentStreak} size="sm">
        {row.image ? (
          <Image
            src={row.image}
            alt={username}
            width={28}
            height={28}
            className="h-7 w-7 rounded-full flex-shrink-0"
          />
        ) : (
          <div className="h-7 w-7 rounded-full bg-border flex items-center justify-center flex-shrink-0 text-[10px] font-medium text-muted">
            {initials}
          </div>
        )}
      </StreakAura>
      <span className="font-mono text-sm font-medium text-foreground/80 truncate max-w-[100px] sm:max-w-none">
        {username}
      </span>

      {/* Stat pills - visible on sm+ */}
      <span className="hidden sm:inline text-foreground/20 select-none">·</span>
      <span className="font-mono text-sm tabular-nums text-foreground/70">
        #{row.rank}
      </span>
      {movementEl}

      <span className="hidden sm:inline text-foreground/20 select-none">·</span>
      <span className="hidden sm:inline font-mono text-sm tabular-nums text-foreground/70">
        {cost} {labels.spent}
      </span>

      <span className="hidden md:inline text-foreground/20 select-none">·</span>
      <span className="hidden md:inline font-mono text-sm tabular-nums text-foreground/70">
        {tokens} {labels.tokens}
      </span>

      {row.currentStreak > 0 && (
        <>
          <span className="hidden sm:inline text-foreground/20 select-none">·</span>
          <span className={`hidden sm:inline font-mono text-sm tabular-nums font-semibold ${streakTier.textColor}`}>
            {streakTier.icon ? `${streakTier.icon} ` : ""}{row.currentStreak}d{streakTier.tier >= 2 ? ` ${streakTier.name}` : ` ${labels.streak}`}
          </span>
        </>
      )}

      {/* Clickable arrow */}
      <span className="ml-auto text-foreground/30 transition-colors group-hover:text-accent">
        &rarr;
      </span>
    </Link>
  );
}

function UnsyncedStatBar({
  githubUsername,
  image,
  labels,
}: {
  githubUsername: string;
  image: string | null;
  labels: TranslationLabels;
}) {
  const initials = githubUsername.slice(0, 2).toUpperCase();

  return (
    <Link
      href="/dashboard"
      className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/[0.04]"
    >
      {image ? (
        <Image
          src={image}
          alt={githubUsername}
          width={28}
          height={28}
          className="h-7 w-7 rounded-full ring-1 ring-border flex-shrink-0"
        />
      ) : (
        <div className="h-7 w-7 rounded-full bg-border flex items-center justify-center flex-shrink-0 text-[10px] font-medium text-muted">
          {initials}
        </div>
      )}
      <span className="font-mono text-sm font-medium text-foreground/80">
        {githubUsername}
      </span>

      <span className="ml-auto font-mono text-sm font-medium text-accent transition-colors group-hover:text-accent/80">
        {labels.syncYourData} &rarr;
      </span>
    </Link>
  );
}
