import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { Link } from "@/i18n/navigation";
import nextDynamic from "next/dynamic";

export const dynamic = "force-dynamic";
import { Header } from "@/components/layout/Header";
import {
  persistEarnedBadges,
  getUserSummary as getLiveSummary,
  getUserDailyData as getLiveDailyData,
  getUserModelBreakdown as getLiveModelBreakdown,
} from "@/lib/db/profile";
import {
  getUserByUsername,
  getUserSummary,
  getUserDailyData,
  getUserModelBreakdown,
  getUserSummaryUncached as getUncachedSummary,
  getUserDailyDataUncached as getUncachedDailyData,
  getUserModelBreakdownUncached as getUncachedModelBreakdown,
  getUserRank,
  getUserPublicTeams,
  getAllRecaps,
  VALID_PERIODS,
  parseDateRange,
  type Period,
} from "@/lib/db/cached";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import { ActivityGrid } from "@/components/profile/ActivityGrid";
import { StreakPasses } from "@/components/profile/StreakPasses";
import { ShareButtons } from "@/components/profile/ShareButtons";
import { BadgeSnippet } from "@/components/profile/BadgeSnippet";
import { TimeFilter } from "@/components/leaderboard/TimeFilter";
import { computeStreakState } from "@/lib/streak";
import { TRANSCENDENT_MIN_DAYS } from "@/lib/streak-tiers";
import { buildCarcinizationRun } from "@/lib/carcinization-run";
import { computeFullBadgeState } from "@/lib/badges";
import { PinnedBadges } from "@/components/profile/PinnedBadges";
import { BadgeUnlockModal } from "@/components/profile/BadgeUnlockModal";
import { StreakCelebration } from "@/components/profile/StreakCelebration";
import { StreakPassCelebration } from "@/components/profile/StreakPassCelebration";
import { TeamNudge } from "@/components/profile/TeamNudge";
import { ProfileJoinCta } from "@/components/profile/ProfileJoinCta";
import { env } from "@/lib/env";
import { seoAlternates, breadcrumbLd } from "@/lib/seo";
import { auth } from "@/lib/auth";
import { getUserTeams } from "@/lib/db/teams";
import { rebuildLeaderboardSnapshot, runSnapshotJob } from "@/lib/snapshot/build";
import { RecapStrip } from "@/components/recaps/RecapStrip";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { PERIOD_COOKIE, parsePeriodCookie } from "@/lib/period-cookie";
import { formatUsdShort } from "@/lib/format";
import { JsonLd } from "@/components/ui/JsonLd";

const BASE_URL = env.NEXT_PUBLIC_BASE_URL;

const UsageChart = nextDynamic(
  () =>
    import("@/components/profile/UsageChart").then((m) => ({
      default: m.UsageChart,
    })),
  {
    loading: () => (
      <div className="rounded-lg border border-border bg-surface p-6 h-[364px]">
        <div className="h-5 w-40 animate-pulse rounded bg-border/50" />
        <div className="mt-6 flex h-[260px] items-end gap-2 border-b border-l border-border/60 pl-2 pb-1">
          {[38, 62, 48, 74, 55, 81, 46].map((h, i) => (
            <div
              key={i}
              className="flex-1 animate-pulse rounded-t bg-border/60"
              style={{ height: `${h}%`, animationDelay: `${i * 80}ms` }}
            />
          ))}
        </div>
      </div>
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
      <div className="rounded-lg border border-border bg-surface p-6 h-[300px]">
        <div className="h-5 w-44 animate-pulse rounded bg-border/50" />
        <div className="mt-6 space-y-3">
          {[72, 58, 44, 32, 22, 14].map((w, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-3 w-16 animate-pulse rounded bg-border/50" />
              <div
                className="h-3 animate-pulse rounded bg-border/60"
                style={{ width: `${w}%`, animationDelay: `${i * 70}ms` }}
              />
            </div>
          ))}
        </div>
      </div>
    ),
  }
);

// Loaded on demand — mounts for a vanishingly small share of page views
// (owners with a 200+ day streak), so keep it out of everyone else's payload.
const CarcinizationEvent = nextDynamic(() =>
  import("@/components/profile/CarcinizationEvent").then((m) => ({
    default: m.CarcinizationEvent,
  }))
);

const BADGE_SAVE_WINDOW_MS = 5 * 60 * 1000;
const badgeSavedAt = new Map<string, number>();

/** True when this instance hasn't saved this user's badges in the last window. */
function claimBadgeSave(userId: string): boolean {
  const now = Date.now();
  const last = badgeSavedAt.get(userId);
  if (last !== undefined && now - last < BADGE_SAVE_WINDOW_MS) return false;
  for (const [id, at] of badgeSavedAt) {
    if (now - at >= BADGE_SAVE_WINDOW_MS) badgeSavedAt.delete(id);
  }
  badgeSavedAt.set(userId, now);
  return true;
}

interface PageProps {
  params: Promise<{ username: string }>;
  searchParams: Promise<{
    period?: string;
    from?: string;
    to?: string;
    vs?: string;
    carcinize?: string;
    passes?: string;
    eternal?: string;
  }>;
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
  const description = `${username} has spent ${formatUsdShort(summary.totalCost)} on AI coding and ranks #${rank.rank} of ${rank.totalUsers} developers. View their activity heatmap, model breakdown, and streak on clawdboard.`;

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
  // A saved range only applies to "custom"; leaving it off other periods keeps
  // their reads on the same snapshot entries (the queries ignore it anyway).
  const range =
    period === "custom"
      ? parseDateRange(sp.from ?? saved?.from, sp.to ?? saved?.to)
      : undefined;

  // Optional comparison overlay: ?vs=<github-username>
  const vsParam =
    typeof sp.vs === "string" ? decodeURIComponent(sp.vs).trim() : "";

  // Look up user by GitHub username (case-insensitive)
  const user = await getUserByUsername(username);
  if (!user) {
    notFound();
  }

  const session = await auth();
  const isOwner =
    session?.user?.githubUsername?.toLowerCase() ===
    (user.githubUsername ?? "").toLowerCase();

  // Fetch all profile data in parallel
  // Filtered data: summary, chart, model breakdown use the selected period
  // Unfiltered data: daily data for activity grid + streak, rank is always all-time
  // Your own profile reads live, so a sync shows the moment it lands. Everyone
  // else reads the public snapshot, rebuilt right after each sync; "today"
  // skips unstable_cache when the snapshot can't answer.
  const isToday = period === "today";
  const [getSummary, getDaily, getModels] = isOwner
    ? [getLiveSummary, getLiveDailyData, getLiveModelBreakdown]
    : isToday
      ? [getUncachedSummary, getUncachedDailyData, getUncachedModelBreakdown]
      : [getUserSummary, getUserDailyData, getUserModelBreakdown];

  const [summary, filteredDailyData, allDailyData, modelData, rank, publicTeams, userRecaps, compareUser] =
    await Promise.all([
      getSummary(user.id, period, range),
      getDaily(user.id, period, range),
      getDaily(user.id),
      getModels(user.id, period, range),
      getUserRank(user.id),
      getUserPublicTeams(user.id),
      getAllRecaps(user.id),
      vsParam ? getUserByUsername(vsParam) : Promise.resolve(null),
    ]);

  // One fold over the full history gives the streak, the free-pass balance and
  // which days a pass covered. Read-only: the stored snapshot the leaderboard
  // joins is written by /api/sync and the cron, never by a page view.
  const streak = computeStreakState(allDailyData);
  const currentStreak = streak.current;

  // Free passes are the user's own business. Visitors see the streak number
  // and nothing about what's holding it up, so the pass state never reaches
  // their page payload at all.
  const visibleStreak = isOwner
    ? streak
    : {
        ...streak,
        passesLeft: 0,
        passesEarned: 0,
        passesSpent: 0,
        daysToNextPass: null,
        frozen: false,
        frozenFor: 0,
        frozenDays: [],
      };

  // The Carcinization Event — dev preview via ?carcinize=1, or ?carcinize=<beat>
  // (e.g. replay, summon, crown) to start partway through. Never in prod.
  const forceCarcinize =
    process.env.NODE_ENV === "development" && !!sp.carcinize;
  // Free-pass celebration — dev preview via ?passes=1 (never in prod)
  const forcePasses =
    process.env.NODE_ENV === "development" && sp.passes === "1";
  // 100-day celebration — dev preview via ?eternal=1 (never in prod)
  const forceEternal =
    process.env.NODE_ENV === "development" && sp.eternal === "1";
  const showCarcinization =
    isOwner && (currentStreak >= TRANSCENDENT_MIN_DAYS || forceCarcinize);
  // The takeover replays the live run a day at a time, and its stats cover the
  // run rather than whatever period the page is filtered to.
  const carcinizationRun = showCarcinization
    ? buildCarcinizationRun(allDailyData, streak.runStart, streak.lastActive)
    : null;

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

  // Persist newly earned badges after response (serverless-safe), then
  // refresh the snapshot, which holds earnedBadges too. Until the refresh
  // reaches every instance, other views would see the same badges as new and
  // save them again, so each instance saves a user's badges once per window.
  if (newlyEarnedIds.length > 0 && claimBadgeSave(user.id)) {
    after(async () => {
      await persistEarnedBadges(user.id, allEarnedIds);
      await runSnapshotJob("badge save", rebuildLeaderboardSnapshot);
    });
  }

  // Get pinned badges
  const pinnedBadgeIds = (user.pinnedBadges as string[]) ?? [];
  const pinnedBadges = badges.filter(
    (b) => b.earned && pinnedBadgeIds.includes(b.definition.id)
  );

  const baseUrl = BASE_URL;
  const profileUrl = `${baseUrl}/user/${encodeURIComponent(user.githubUsername ?? username)}`;

  // Transform data for chart components (server-side)
  const toUsagePoints = (rows: typeof filteredDailyData) =>
    rows.map((row) => ({
      date: row.date ?? "",
      cost: Number(row.totalCost ?? 0),
      tokens:
        (row.inputTokens ?? 0) +
        (row.outputTokens ?? 0) +
        (row.cacheCreationTokens ?? 0) +
        (row.cacheReadTokens ?? 0),
    }));
  const usageChartData = toUsagePoints(filteredDailyData);

  // Comparison overlay: only for a valid, distinct user (same period/range).
  const showCompare = !!compareUser && compareUser.id !== user.id;
  const compareChartData = showCompare
    ? toUsagePoints(await getDaily(compareUser!.id, period, range))
    : undefined;
  const compareLabel = showCompare
    ? compareUser!.githubUsername ?? compareUser!.name ?? vsParam
    : undefined;
  const compareVs = showCompare
    ? compareUser!.githubUsername ?? vsParam
    : null;

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
      <JsonLd data={breadcrumbLd([{ name: displayUsername }])} />
      <JsonLd data={personLd} />

      {/* Header */}
      <Header subtitle={user.githubUsername ?? "profile"} />

      {/* Free pass banked. Mounted for the owner only: it's a client
          component, so its props are in the page payload for whoever gets it. */}
      {(isOwner || forcePasses) && (
        <StreakPassCelebration
          username={user.githubUsername ?? username}
          runStart={streak.runStart}
          currentStreak={currentStreak}
          passesEarned={streak.passesEarned}
          passesLeft={streak.passesLeft}
          suppress={showCarcinization}
          force={forcePasses}
        />
      )}

      {/* Streak tier-up celebration (owner only) */}
      <StreakCelebration
        username={user.githubUsername ?? username}
        currentStreak={currentStreak}
        isOwner={isOwner}
        team={celebrationTeam}
        forceEternal={forceEternal}
      />

      {/* The Carcinization Event — 200-day streak takeover (owner only) */}
      {showCarcinization && (
        <CarcinizationEvent
          username={user.githubUsername ?? username}
          image={user.image}
          currentStreak={currentStreak}
          run={carcinizationRun}
          stats={{
            totalTokens: carcinizationRun?.totalTokens ?? totalTokens,
            totalCost:
              carcinizationRun?.totalCost ?? Number(summary.totalCost ?? 0),
            rank: rank.rank,
            totalUsers: rank.totalUsers,
          }}
          force={forceCarcinize}
          startAt={forceCarcinize ? sp.carcinize : undefined}
        />
      )}

      {/* Badge unlock modal (owner only) */}
      {isOwner && (
        <BadgeUnlockModal
          username={user.githubUsername ?? username}
          badges={badges}
          totalXp={totalXp}
          xpProgress={xpProgress}
          suppressModal={isFirstComputation}
          suppressBadgeIds={
            currentStreak >= TRANSCENDENT_MIN_DAYS ? ["streak-200"] : undefined
          }
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
            streak={visibleStreak}
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

          <ActivityGrid
            data={activityGridData}
            frozenDays={visibleStreak.frozenDays}
          />

          {isOwner && <StreakPasses streak={streak} />}

          <PinnedBadges
            pinnedBadges={pinnedBadges}
            kitchenRank={kitchenRank}
            isOwner={isOwner}
          />

          <UsageChart
            data={usageChartData}
            period={period}
            range={range}
            compareData={compareChartData}
            compareLabel={compareLabel}
            primaryLabel={displayUsername}
            primaryUsername={user.githubUsername ?? username}
            currentVs={compareVs}
            canSearch={!!session?.user}
          />

          <ModelBreakdown data={modelBreakdownData} />
        </main>
    </div>
  );
}
