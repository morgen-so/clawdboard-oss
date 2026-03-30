import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { Link } from "@/i18n/navigation";
import nextDynamic from "next/dynamic";

export const dynamic = "force-dynamic";
import { Header } from "@/components/layout/Header";
import {
  getUserByUsername,
  persistEarnedBadges,
  getUserSummary as getUncachedSummary,
  getUserDailyData as getUncachedDailyData,
  getUserModelBreakdown as getUncachedModelBreakdown,
} from "@/lib/db/profile";
import {
  getUserSummary,
  getUserDailyData,
  getUserModelBreakdown,
  getUserRank,
  VALID_PERIODS,
  parseDateRange,
  type Period,
} from "@/lib/db/cached";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import { ActivityGrid } from "@/components/profile/ActivityGrid";
import { ShareButtons } from "@/components/profile/ShareButtons";
import { BadgeSnippet } from "@/components/profile/BadgeSnippet";
import { TimeFilter } from "@/components/leaderboard/TimeFilter";
import { computeCurrentStreak } from "@/lib/streak";
import { computeFullBadgeState } from "@/lib/badges";
import { PinnedBadges } from "@/components/profile/PinnedBadges";
import { BadgeUnlockModal } from "@/components/profile/BadgeUnlockModal";
import { StreakCelebration } from "@/components/profile/StreakCelebration";
import { TeamNudge } from "@/components/profile/TeamNudge";
import { ProfileJoinCta } from "@/components/profile/ProfileJoinCta";
import { env } from "@/lib/env";
import { seoAlternates } from "@/lib/seo";
import { auth } from "@/lib/auth";
import { getUserTeams, getUserPublicTeams } from "@/lib/db/teams";
import { getAllRecaps } from "@/lib/db/recaps";
import { RecapStrip } from "@/components/recaps/RecapStrip";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { PERIOD_COOKIE, parsePeriodCookie } from "@/lib/period-cookie";

const BASE_URL = env.NEXT_PUBLIC_BASE_URL;

const UsageChart = nextDynamic(
  () =>
    import("@/components/profile/UsageChart").then((m) => ({
      default: m.UsageChart,
    })),
  {
    loading: () => (
      <div className="rounded-lg border border-border bg-surface p-6 h-[364px] animate-pulse" />
    ),
  }
);

const ModelBreakdown = nextDynamic(
  () =>
    import("@/components/profile/ModelBreakdown").then((m) => ({
      default: m.ModelBreakdown,
    })),
  {
    loading: () => (
      <div className="rounded-lg border border-border bg-surface p-6 h-[300px] animate-pulse" />
    ),
  }
);

interface PageProps {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}

function fmtCost(cost: string): string {
  const n = parseFloat(cost);
  return n >= 1000
    ? `$${(n / 1000).toFixed(1)}k`
    : `$${n.toFixed(0)}`;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { username: rawUsername } = await params;
  const username = decodeURIComponent(rawUsername);
  const user = await getUserByUsername(username);

  if (!user) {
    return {
      title: `${username} — User Not Found`,
      description: `No clawdboard profile found for ${username}.`,
    };
  }

  const [summary, rank] = await Promise.all([
    getUserSummary(user.id),
    getUserRank(user.id),
  ]);

  const title = `${username}'s AI Coding Stats — Ranked #${rank.rank}`;
  const description = `${username} has spent ${fmtCost(summary.totalCost)} on AI coding and ranks #${rank.rank} of ${rank.totalUsers} developers. View their activity heatmap, model breakdown, and streak on clawdboard.`;

  return {
    title,
    description,
    alternates: seoAlternates(`/user/${username}`),
    openGraph: {
      title: `${title} | clawdboard`,
      description,
    },
  };
}

export default async function UserProfilePage({
  params,
  searchParams,
}: PageProps) {
  const [{ username: rawUsername }, sp] = await Promise.all([
    params,
    searchParams,
  ]);
  const t = await getTranslations("profile");
  const username = decodeURIComponent(rawUsername);

  // Validate period (fall back to cookie, then "7d")
  const saved = parsePeriodCookie((await cookies()).get(PERIOD_COOKIE)?.value);
  const period: Period = VALID_PERIODS.includes(sp.period as Period)
    ? (sp.period as Period)
    : saved?.period ?? "7d";
  const range = parseDateRange(sp.from ?? saved?.from, sp.to ?? saved?.to);

  // Look up user by GitHub username (case-insensitive)
  const user = await getUserByUsername(username);
  if (!user) {
    notFound();
  }

  // Fetch all profile data in parallel
  // Filtered data: summary, chart, model breakdown use the selected period
  // Unfiltered data: daily data for activity grid + streak, rank is always all-time
  // "today" bypasses unstable_cache for real-time accuracy (cheap single-day query)
  const isToday = period === "today";
  const getSummary = isToday ? getUncachedSummary : getUserSummary;
  const getDaily = isToday ? getUncachedDailyData : getUserDailyData;
  const getModels = isToday ? getUncachedModelBreakdown : getUserModelBreakdown;

  const [summary, filteredDailyData, allDailyData, modelData, rank, session, publicTeams, userRecaps] =
    await Promise.all([
      getSummary(user.id, period, range),
      getDaily(user.id, period, range),
      getDaily(user.id),
      getModels(user.id, period, range),
      getUserRank(user.id),
      auth(),
      getUserPublicTeams(user.id),
      getAllRecaps(user.id),
    ]);

  const currentStreak = computeCurrentStreak(allDailyData);
  const isOwner =
    session?.user?.githubUsername?.toLowerCase() ===
    (user.githubUsername ?? "").toLowerCase();

  // Fetch team data for streak celebration invite CTA (owner only)
  const userTeams = isOwner && session?.user?.id
    ? await getUserTeams(session.user.id)
    : [];
  const celebrationTeam = userTeams.find((t) => !t.isLocked);

  const totalTokens =
    summary.totalInputTokens +
    summary.totalOutputTokens +
    summary.totalCacheCreation +
    summary.totalCacheRead;

  const { badges, totalXp, kitchenRank, xpProgress, allEarnedIds, newlyEarnedIds, isFirstComputation } =
    computeFullBadgeState(allDailyData, rank, (user.earnedBadges ?? []) as string[]);

  // Persist newly earned badges after response (serverless-safe)
  if (newlyEarnedIds.length > 0) {
    after(() => persistEarnedBadges(user.id, allEarnedIds));
  }

  // Get pinned badges
  const pinnedBadgeIds = (user.pinnedBadges as string[]) ?? [];
  const pinnedBadges = badges.filter(
    (b) => b.earned && pinnedBadgeIds.includes(b.definition.id)
  );

  const baseUrl = BASE_URL;
  const profileUrl = `${baseUrl}/user/${encodeURIComponent(user.githubUsername ?? username)}`;

  // Transform data for chart components (server-side)
  const usageChartData = filteredDailyData.map((row) => ({
    date: row.date ?? "",
    cost: Number(row.totalCost ?? 0),
    tokens:
      (row.inputTokens ?? 0) +
      (row.outputTokens ?? 0) +
      (row.cacheCreationTokens ?? 0) +
      (row.cacheReadTokens ?? 0),
  }));

  const modelBreakdownData = modelData.map((row) => ({
    modelName: row.model_name,
    totalCost: Number(row.total_cost),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
  }));

  const activityGridData = allDailyData.map((row) => ({
    date: row.date ?? "",
    cost: Number(row.totalCost ?? 0),
  }));

  const displayUsername = user.githubUsername ?? username;
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
      { "@type": "ListItem", position: 2, name: displayUsername },
    ],
  };

  const personLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: user.name ?? displayUsername,
    url: profileUrl,
    ...(user.image && { image: user.image }),
    ...(user.githubUsername && {
      sameAs: [`https://github.com/${user.githubUsername}`],
    }),
  };

  return (
    <div className="relative min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(personLd) }}
      />

      {/* Header */}
      <Header subtitle={user.githubUsername ?? "profile"} />

      {/* Streak tier-up celebration (owner only) */}
      <StreakCelebration
        username={user.githubUsername ?? username}
        currentStreak={currentStreak}
        isOwner={isOwner}
        team={celebrationTeam}
      />

      {/* Badge unlock modal (owner only) */}
      {isOwner && (
        <BadgeUnlockModal
          username={user.githubUsername ?? username}
          badges={badges}
          totalXp={totalXp}
          xpProgress={xpProgress}
          suppressModal={isFirstComputation}
        />
      )}

      {/* Main content */}
        <main className="relative z-10 mx-auto max-w-5xl px-4 py-8 sm:px-6 space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground transition-colors"
            >
              <span aria-hidden="true">&larr;</span> {t("backToLeaderboard")}
            </Link>
            <TimeFilter current={period} from={range?.from} to={range?.to} />
          </div>

          {/* Team nudge for teamless profile owners */}
          {isOwner && userTeams.length === 0 && <TeamNudge />}

          <ProfileHeader
            user={user}
            summary={summary}
            rank={rank}
            currentStreak={currentStreak}
            teams={publicTeams}
          >
            <div className="flex items-center gap-2">
              <ShareButtons
                username={user.githubUsername ?? user.name ?? "User"}
                image={user.image}
                rank={rank.rank}
                streak={currentStreak}
                totalCost={summary.totalCost}
                totalTokens={totalTokens}
                totalUsers={rank.totalUsers}
                percentile={rank.percentile}
                profileUrl={profileUrl}
              />
              {isOwner && (
                <BadgeSnippet
                  username={user.githubUsername ?? username}
                  baseUrl={baseUrl}
                />
              )}
            </div>
          </ProfileHeader>

          {/* Join CTA for unauthenticated visitors */}
          {!session?.user && <ProfileJoinCta />}

          {userRecaps.length > 0 && <RecapStrip recaps={userRecaps} />}

          <ActivityGrid data={activityGridData} />

          <PinnedBadges
            pinnedBadges={pinnedBadges}
            kitchenRank={kitchenRank}
            isOwner={isOwner}
          />

          <UsageChart data={usageChartData} period={period} range={range} />

          <ModelBreakdown data={modelBreakdownData} />
        </main>
    </div>
  );
}
