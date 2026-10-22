import { cache } from "react";
import { revalidateTag, unstable_cache } from "next/cache";
import { SNAP, snapshotFirst } from "@/lib/snapshot";
import {
  getLeaderboardData as _getLeaderboardData,
  getUserLeaderboardRow as _getUserLeaderboardRow,
  getVibeCoderCount as _getVibeCoderCount,
} from "./leaderboard";
import {
  getUserByUsername as _getUserByUsername,
  getUserSummary as _getUserSummary,
  getUserDailyData as _getUserDailyData,
  getUserModelBreakdown as _getUserModelBreakdown,
  getUserRank as _getUserRank,
} from "./profile";
import {
  getPublicTeamLeaderboard as _getPublicTeamLeaderboard,
  getTeamLeaderboardData as _getTeamLeaderboardData,
  getTeamStats as _getTeamStats,
  getUserPublicTeams as _getUserPublicTeams,
} from "./teams";
import { getAllRecaps as _getAllRecaps } from "./recaps";
import { getSitemapPaths as _getSitemapPaths } from "./sitemap";
import {
  getCommunityStats as _getCommunityStats,
  getDailyTrends as _getDailyTrends,
  getModelStats as _getModelStats,
  getWeeklyGrowth as _getWeeklyGrowth,
  getModelDetailStats as _getModelDetailStats,
  getModelDailyTrends as _getModelDailyTrends,
  getDistinctModelSlugs as _getDistinctModelSlugs,
  getSourceBreakdown as _getSourceBreakdown,
  getSourceDetailStats as _getSourceDetailStats,
  getSourceDailyTrends as _getSourceDailyTrends,
  getSourceModelBreakdown as _getSourceModelBreakdown,
  getSourceComparisonTrends as _getSourceComparisonTrends,
  getDistinctSources as _getDistinctSources,
} from "./stats";

// ─── Cache tags (single source of truth) ────────────────────────────────────
// Every unstable_cache wrapper below references these constants for both its
// keyParts and options.tags, so adding a new cached function forces you to add
// a tag here — keeping revalidateAllCaches() automatically in sync.

const TAG = {
  leaderboard: "leaderboard",
  userLeaderboardRow: "user-leaderboard-row",
  teamLeaderboard: "team-leaderboard",
  userRank: "user-rank",
  vibeCoderCount: "vibe-coder-count",
  teamMembersLb: "team-members-lb",
  teamStats: "team-stats",
  userSummary: "user-summary",
  userDaily: "user-daily",
  userModels: "user-models",
  communityStats: "community-stats",
  dailyTrends: "daily-trends",
  modelStats: "model-stats",
  weeklyGrowth: "weekly-growth",
  modelDetail: "model-detail",
  modelDailyTrends: "model-daily-trends",
  modelSlugs: "model-slugs",
  sourceDetail: "source-detail",
  sourceDailyTrends: "source-daily-trends",
  sourceModels: "source-models",
  sourceComparison: "source-comparison",
  sourceSlugs: "source-slugs",
  sourceBreakdown: "source-breakdown",
} as const;

const ALL_TAGS = Object.values(TAG);

/** Invalidate every unstable_cache entry. Call after data mutations. */
export function revalidateAllCaches() {
  for (const tag of ALL_TAGS) {
    revalidateTag(tag);
  }
}

/** Invalidate team-scoped caches only (membership, stats). */
export function revalidateTeamCaches() {
  revalidateTag(TAG.teamStats);
  revalidateTag(TAG.teamMembersLb);
}

// Re-export types and constants so pages only need one import source
export type { Period, SortCol, SortOrder, LeaderboardRow, LeaderboardResult, DateRange } from "./leaderboard";
export { VALID_PERIODS, VALID_SORTS, VALID_ORDERS, parseDateRange, redactStreakPasses } from "./leaderboard";
export { MIN_DATE } from "@/lib/constants";

// ─── Snapshot first ──────────────────────────────────────────────────────────
// Most readers below answer from the public-data snapshot (src/lib/snapshot)
// when it holds the call, and fall back to the unstable_cache entry when it
// doesn't. With the snapshot off (local dev) they are the plain cached reads.

// ─── High priority (expensive, called on every navigation) ──────────────────

export const getLeaderboardData = snapshotFirst(
  SNAP.leaderboard,
  unstable_cache(
    _getLeaderboardData,
    [TAG.leaderboard],
    { revalidate: 120, tags: [TAG.leaderboard] }
  )
);

export const getUserLeaderboardRow = unstable_cache(
  _getUserLeaderboardRow,
  [TAG.userLeaderboardRow],
  { revalidate: 120, tags: [TAG.userLeaderboardRow] }
);

export const getPublicTeamLeaderboard = snapshotFirst(
  SNAP.teamLeaderboard,
  unstable_cache(
    _getPublicTeamLeaderboard,
    [TAG.teamLeaderboard],
    { revalidate: 120, tags: [TAG.teamLeaderboard] }
  )
);

export const getUserRank = snapshotFirst(
  SNAP.userRank,
  unstable_cache(
    _getUserRank,
    [TAG.userRank],
    { revalidate: 300, tags: [TAG.userRank] }
  )
);

export const getVibeCoderCount = snapshotFirst(
  SNAP.vibeCoderCount,
  unstable_cache(
    _getVibeCoderCount,
    [TAG.vibeCoderCount],
    { revalidate: 300, tags: [TAG.vibeCoderCount] }
  )
);

// ─── Medium priority (user/team-scoped aggregations) ────────────────────────

export const getTeamLeaderboardData = unstable_cache(
  _getTeamLeaderboardData,
  [TAG.teamMembersLb],
  { revalidate: 120, tags: [TAG.teamMembersLb] }
);

export const getTeamStats = unstable_cache(
  _getTeamStats,
  [TAG.teamStats],
  { revalidate: 300, tags: [TAG.teamStats] }
);

// NOTE: getTeamMembers is NOT cached — it returns Date objects (joinedAt, leftAt)
// that would be silently stringified by unstable_cache's JSON serialization,
// breaking Intl.DateTimeFormat.format() in MemberList. It's a simple indexed
// join so the caching benefit is marginal anyway.

export const getUserSummary = snapshotFirst(
  SNAP.userSummary,
  unstable_cache(
    _getUserSummary,
    [TAG.userSummary],
    { revalidate: 120, tags: [TAG.userSummary] }
  )
);

export const getUserDailyData = snapshotFirst(
  SNAP.userDaily,
  unstable_cache(
    _getUserDailyData,
    [TAG.userDaily],
    { revalidate: 120, tags: [TAG.userDaily] }
  )
);

export const getUserModelBreakdown = snapshotFirst(
  SNAP.userModels,
  unstable_cache(
    _getUserModelBreakdown,
    [TAG.userModels],
    { revalidate: 120, tags: [TAG.userModels] }
  )
);

// ─── Profile reads that skip unstable_cache ─────────────────────────────────
// The profile's "today" view, the user lookup (it returns Dates, which
// unstable_cache would turn into strings), teams and recaps never went through
// the data cache. They still read the snapshot first: it's rebuilt the moment
// the user syncs, so it's as current as a live query.

/** cache()-wrapped so the layout, generateMetadata and the page share one read. */
export const getUserByUsername = cache(
  snapshotFirst(SNAP.profileUser, _getUserByUsername)
);
export const getUserSummaryUncached = snapshotFirst(SNAP.userSummary, _getUserSummary);
export const getUserDailyDataUncached = snapshotFirst(SNAP.userDaily, _getUserDailyData);
export const getUserModelBreakdownUncached = snapshotFirst(
  SNAP.userModels,
  _getUserModelBreakdown
);
export const getUserPublicTeams = snapshotFirst(SNAP.userPublicTeams, _getUserPublicTeams);
export const getAllRecaps = snapshotFirst(SNAP.userRecaps, _getAllRecaps);
export const getSitemapPaths = snapshotFirst(SNAP.sitemapPaths, _getSitemapPaths);

// ─── Stats (aggregate, hourly refresh) ──────────────────────────────────────
// NOTE: These cache wrappers are for the stats PAGE only (no period filter).
// The /api/stats route calls the raw query functions directly since it
// supports period filtering and relies on HTTP Cache-Control instead.

export const getCommunityStatsCached = snapshotFirst(
  SNAP.communityStats,
  unstable_cache(
    _getCommunityStats,
    [TAG.communityStats],
    { revalidate: 3600, tags: [TAG.communityStats] }
  )
);

export const getDailyTrendsCached = snapshotFirst(
  SNAP.dailyTrends,
  unstable_cache(
    _getDailyTrends,
    [TAG.dailyTrends],
    { revalidate: 3600, tags: [TAG.dailyTrends] }
  )
);

export const getModelStatsCached = snapshotFirst(
  SNAP.modelStats,
  unstable_cache(
    _getModelStats,
    [TAG.modelStats],
    { revalidate: 3600, tags: [TAG.modelStats] }
  )
);

export const getWeeklyGrowthCached = snapshotFirst(
  SNAP.weeklyGrowth,
  unstable_cache(
    _getWeeklyGrowth,
    [TAG.weeklyGrowth],
    { revalidate: 3600, tags: [TAG.weeklyGrowth] }
  )
);

export const getSourceBreakdownCached = snapshotFirst(
  SNAP.sourceBreakdown,
  unstable_cache(
    _getSourceBreakdown,
    [TAG.sourceBreakdown],
    { revalidate: 3600, tags: [TAG.sourceBreakdown] }
  )
);

// ─── Per-model stats (for /stats/models/[model]) ────────────────────────────

export const getModelDetailStatsCached = snapshotFirst(
  SNAP.modelDetail,
  unstable_cache(
    _getModelDetailStats,
    [TAG.modelDetail],
    { revalidate: 3600, tags: [TAG.modelDetail] }
  )
);

export const getModelDailyTrendsCached = snapshotFirst(
  SNAP.modelDailyTrends,
  unstable_cache(
    _getModelDailyTrends,
    [TAG.modelDailyTrends],
    { revalidate: 3600, tags: [TAG.modelDailyTrends] }
  )
);

export const getDistinctModelSlugsCached = snapshotFirst(
  SNAP.modelSlugs,
  unstable_cache(
    _getDistinctModelSlugs,
    [TAG.modelSlugs],
    { revalidate: 3600, tags: [TAG.modelSlugs] }
  )
);

// ─── Per-source stats (for /stats/tools) ─────────────────────────────────

export const getSourceDetailStatsCached = snapshotFirst(
  SNAP.sourceDetail,
  unstable_cache(
    _getSourceDetailStats,
    [TAG.sourceDetail],
    { revalidate: 3600, tags: [TAG.sourceDetail] }
  )
);

export const getSourceDailyTrendsCached = unstable_cache(
  _getSourceDailyTrends,
  [TAG.sourceDailyTrends],
  { revalidate: 3600, tags: [TAG.sourceDailyTrends] }
);

export const getSourceModelBreakdownCached = snapshotFirst(
  SNAP.sourceModels,
  unstable_cache(
    _getSourceModelBreakdown,
    [TAG.sourceModels],
    { revalidate: 3600, tags: [TAG.sourceModels] }
  )
);

export const getSourceComparisonTrendsCached = snapshotFirst(
  SNAP.sourceComparison,
  unstable_cache(
    _getSourceComparisonTrends,
    [TAG.sourceComparison],
    { revalidate: 3600, tags: [TAG.sourceComparison] }
  )
);

export const getDistinctSourcesCached = unstable_cache(
  _getDistinctSources,
  [TAG.sourceSlugs],
  { revalidate: 3600, tags: [TAG.sourceSlugs] }
);
