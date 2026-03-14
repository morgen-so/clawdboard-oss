import { revalidateTag, unstable_cache } from "next/cache";
import {
  getLeaderboardData as _getLeaderboardData,
  getUserLeaderboardRow as _getUserLeaderboardRow,
  getVibeCoderCount as _getVibeCoderCount,
} from "./leaderboard";
import {
  getUserSummary as _getUserSummary,
  getUserDailyData as _getUserDailyData,
  getUserModelBreakdown as _getUserModelBreakdown,
  getUserRank as _getUserRank,
} from "./profile";
import {
  getPublicTeamLeaderboard as _getPublicTeamLeaderboard,
  getTeamLeaderboardData as _getTeamLeaderboardData,
  getTeamStats as _getTeamStats,
} from "./teams";
import {
  getCommunityStats as _getCommunityStats,
  getDailyTrends as _getDailyTrends,
  getModelStats as _getModelStats,
  getWeeklyGrowth as _getWeeklyGrowth,
} from "./stats";

// ─── Cache tags (single source of truth) ────────────────────────────────────
// Every unstable_cache wrapper below references these constants for both its
// keyParts and options.tags, so adding a new cached function forces you to add
// a tag here — keeping revalidateAllCaches() automatically in sync.

export const TAG = {
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
export { VALID_PERIODS, VALID_SORTS, VALID_ORDERS, parseDateRange } from "./leaderboard";
export { MIN_DATE } from "@/lib/constants";

// ─── High priority (expensive, called on every navigation) ──────────────────

export const getLeaderboardData = unstable_cache(
  _getLeaderboardData,
  [TAG.leaderboard],
  { revalidate: 120, tags: [TAG.leaderboard] }
);

export const getUserLeaderboardRow = unstable_cache(
  _getUserLeaderboardRow,
  [TAG.userLeaderboardRow],
  { revalidate: 120, tags: [TAG.userLeaderboardRow] }
);

export const getPublicTeamLeaderboard = unstable_cache(
  _getPublicTeamLeaderboard,
  [TAG.teamLeaderboard],
  { revalidate: 120, tags: [TAG.teamLeaderboard] }
);

export const getUserRank = unstable_cache(
  _getUserRank,
  [TAG.userRank],
  { revalidate: 300, tags: [TAG.userRank] }
);

export const getVibeCoderCount = unstable_cache(
  _getVibeCoderCount,
  [TAG.vibeCoderCount],
  { revalidate: 300, tags: [TAG.vibeCoderCount] }
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

export const getUserSummary = unstable_cache(
  _getUserSummary,
  [TAG.userSummary],
  { revalidate: 120, tags: [TAG.userSummary] }
);

export const getUserDailyData = unstable_cache(
  _getUserDailyData,
  [TAG.userDaily],
  { revalidate: 120, tags: [TAG.userDaily] }
);

export const getUserModelBreakdown = unstable_cache(
  _getUserModelBreakdown,
  [TAG.userModels],
  { revalidate: 120, tags: [TAG.userModels] }
);

// ─── Stats (aggregate, hourly refresh) ──────────────────────────────────────
// NOTE: These cache wrappers are for the stats PAGE only (no period filter).
// The /api/stats route calls the raw query functions directly since it
// supports period filtering and relies on HTTP Cache-Control instead.

export const getCommunityStatsCached = unstable_cache(
  _getCommunityStats,
  [TAG.communityStats],
  { revalidate: 3600, tags: [TAG.communityStats] }
);

export const getDailyTrendsCached = unstable_cache(
  _getDailyTrends,
  [TAG.dailyTrends],
  { revalidate: 3600, tags: [TAG.dailyTrends] }
);

export const getModelStatsCached = unstable_cache(
  _getModelStats,
  [TAG.modelStats],
  { revalidate: 3600, tags: [TAG.modelStats] }
);

export const getWeeklyGrowthCached = unstable_cache(
  _getWeeklyGrowth,
  [TAG.weeklyGrowth],
  { revalidate: 3600, tags: [TAG.weeklyGrowth] }
);
