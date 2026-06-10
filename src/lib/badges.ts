// ─── Badge System ────────────────────────────────────────────────────────────
// 36 badges across 3 categories: all-time, daily (best single day), monthly
// (best calendar month). Badges are earned once, permanently. Earned badge IDs
// are persisted on the user record so badges can never be lost once earned.

import type { DailyDataRow } from "./db/profile";
import { getKitchenRank, getXpProgress, type XpProgress } from "./kitchen-rank";
import { computeCurrentStreak } from "./streak";

// ─── Types ───────────────────────────────────────────────────────────────────

export type BadgeCategory = "all-time" | "daily" | "monthly";

export type BadgeGroup =
  | "spend"
  | "streak"
  | "rank"
  | "days-active"
  | "daily-spend"
  | "daily-tokens"
  | "monthly-spend"
  | "monthly-days"
  | "perfect-month";

export type BadgeDefinition = {
  id: string;
  category: BadgeCategory;
  group: BadgeGroup;
  label: string;
  description: string;
  threshold: number;
  xp: number;
  celebrationTier: boolean;
};

export type EarnedBadge = {
  definition: BadgeDefinition;
  earned: boolean;
};

export const MAX_PINNED_BADGES = 5;

// ─── Badge Definitions ───────────────────────────────────────────────────────

export const BADGES: BadgeDefinition[] = [
  // ── All Time: Spend ──
  { id: "spend-100", category: "all-time", group: "spend", label: "$100 Lifetime", description: "Spent $100 total on AI coding", threshold: 100, xp: 5, celebrationTier: false },
  { id: "spend-500", category: "all-time", group: "spend", label: "$500 Lifetime", description: "Spent $500 total on AI coding", threshold: 500, xp: 8, celebrationTier: false },
  { id: "spend-1k", category: "all-time", group: "spend", label: "$1K Lifetime", description: "Spent $1,000 total on AI coding", threshold: 1000, xp: 12, celebrationTier: true },
  { id: "spend-5k", category: "all-time", group: "spend", label: "$5K Lifetime", description: "Spent $5,000 total on AI coding", threshold: 5000, xp: 18, celebrationTier: true },
  { id: "spend-10k", category: "all-time", group: "spend", label: "$10K Lifetime", description: "Spent $10,000 total on AI coding", threshold: 10000, xp: 25, celebrationTier: true },
  { id: "spend-25k", category: "all-time", group: "spend", label: "$25K Lifetime", description: "Spent $25,000 total on AI coding", threshold: 25000, xp: 35, celebrationTier: true },

  // ── All Time: Streak ──
  { id: "streak-7", category: "all-time", group: "streak", label: "7-Day Streak", description: "Coded 7 days in a row", threshold: 7, xp: 5, celebrationTier: false },
  { id: "streak-14", category: "all-time", group: "streak", label: "14-Day Streak", description: "Coded 14 days in a row", threshold: 14, xp: 8, celebrationTier: false },
  { id: "streak-30", category: "all-time", group: "streak", label: "30-Day Streak", description: "Coded 30 days in a row", threshold: 30, xp: 15, celebrationTier: true },
  { id: "streak-60", category: "all-time", group: "streak", label: "60-Day Streak", description: "Coded 60 days in a row", threshold: 60, xp: 22, celebrationTier: true },
  { id: "streak-100", category: "all-time", group: "streak", label: "100-Day Streak", description: "Coded 100 days in a row", threshold: 100, xp: 30, celebrationTier: true },

  // ── All Time: Rank ──
  { id: "rank-top50", category: "all-time", group: "rank", label: "Top 50%", description: "Ranked in the top half of all users", threshold: 50, xp: 5, celebrationTier: false },
  { id: "rank-top25", category: "all-time", group: "rank", label: "Top 25%", description: "Ranked in the top quarter of all users", threshold: 25, xp: 8, celebrationTier: false },
  { id: "rank-top10", category: "all-time", group: "rank", label: "Top 10%", description: "Ranked in the top 10% of all users", threshold: 10, xp: 15, celebrationTier: true },
  { id: "rank-top3", category: "all-time", group: "rank", label: "Top 3", description: "One of the top 3 users on the leaderboard", threshold: 3, xp: 25, celebrationTier: true },
  { id: "rank-1", category: "all-time", group: "rank", label: "#1", description: "The #1 user on the leaderboard", threshold: 1, xp: 40, celebrationTier: true },

  // ── All Time: Days Active ──
  { id: "days-10", category: "all-time", group: "days-active", label: "10 Days Active", description: "Used AI coding tools on 10 distinct days", threshold: 10, xp: 5, celebrationTier: false },
  { id: "days-30", category: "all-time", group: "days-active", label: "30 Days Active", description: "Used AI coding tools on 30 distinct days", threshold: 30, xp: 10, celebrationTier: false },
  { id: "days-100", category: "all-time", group: "days-active", label: "100 Days Active", description: "Used AI coding tools on 100 distinct days", threshold: 100, xp: 18, celebrationTier: true },
  { id: "days-365", category: "all-time", group: "days-active", label: "365 Days Active", description: "Used AI coding tools on 365 distinct days", threshold: 365, xp: 30, celebrationTier: true },

  // ── Daily: Spend ──
  { id: "daily-spend-25", category: "daily", group: "daily-spend", label: "$25 Day", description: "Spent $25 in a single day", threshold: 25, xp: 5, celebrationTier: false },
  { id: "daily-spend-50", category: "daily", group: "daily-spend", label: "$50 Day", description: "Spent $50 in a single day", threshold: 50, xp: 8, celebrationTier: false },
  { id: "daily-spend-100", category: "daily", group: "daily-spend", label: "$100 Day", description: "Spent $100 in a single day", threshold: 100, xp: 12, celebrationTier: true },
  { id: "daily-spend-250", category: "daily", group: "daily-spend", label: "$250 Day", description: "Spent $250 in a single day", threshold: 250, xp: 20, celebrationTier: true },
  { id: "daily-spend-500", category: "daily", group: "daily-spend", label: "$500 Day", description: "Spent $500 in a single day", threshold: 500, xp: 30, celebrationTier: true },

  // ── Daily: Tokens ──
  { id: "daily-tokens-1m", category: "daily", group: "daily-tokens", label: "1M Token Day", description: "Used 1 million tokens in a single day", threshold: 1_000_000, xp: 5, celebrationTier: false },
  { id: "daily-tokens-5m", category: "daily", group: "daily-tokens", label: "5M Token Day", description: "Used 5 million tokens in a single day", threshold: 5_000_000, xp: 10, celebrationTier: true },
  { id: "daily-tokens-10m", category: "daily", group: "daily-tokens", label: "10M Token Day", description: "Used 10 million tokens in a single day", threshold: 10_000_000, xp: 18, celebrationTier: true },

  // ── Monthly: Spend ──
  { id: "monthly-spend-500", category: "monthly", group: "monthly-spend", label: "$500 Month", description: "Spent $500 in a single month", threshold: 500, xp: 8, celebrationTier: false },
  { id: "monthly-spend-1k", category: "monthly", group: "monthly-spend", label: "$1K Month", description: "Spent $1,000 in a single month", threshold: 1000, xp: 12, celebrationTier: true },
  { id: "monthly-spend-2.5k", category: "monthly", group: "monthly-spend", label: "$2.5K Month", description: "Spent $2,500 in a single month", threshold: 2500, xp: 20, celebrationTier: true },
  { id: "monthly-spend-5k", category: "monthly", group: "monthly-spend", label: "$5K Month", description: "Spent $5,000 in a single month", threshold: 5000, xp: 28, celebrationTier: true },
  { id: "monthly-spend-10k", category: "monthly", group: "monthly-spend", label: "$10K Month", description: "Spent $10,000 in a single month", threshold: 10000, xp: 40, celebrationTier: true },

  // ── Monthly: Active Days ──
  { id: "monthly-days-20", category: "monthly", group: "monthly-days", label: "20-Day Month", description: "Active 20 days in a single month", threshold: 20, xp: 8, celebrationTier: false },
  { id: "monthly-days-25", category: "monthly", group: "monthly-days", label: "25-Day Month", description: "Active 25 days in a single month", threshold: 25, xp: 15, celebrationTier: true },

  // ── Monthly: Perfect Month ──
  { id: "perfect-month", category: "monthly", group: "perfect-month", label: "Perfect Month", description: "Active 28+ days in a single month", threshold: 28, xp: 35, celebrationTier: true },
];

// ─── Badge Inputs ────────────────────────────────────────────────────────────

type BadgeInputs = {
  streak: number;
  totalCost: number;
  rank: number;
  totalUsers: number;
  percentile: number;
  totalDaysActive: number;
  bestDayCost: number;
  bestDayTokens: number;
  bestMonthCost: number;
  bestMonthActiveDays: number;
};

/**
 * Derive daily/monthly aggregates from raw daily data rows.
 * Computes best single-day cost/tokens, best month cost/active days.
 */
function computeBadgeInputs(allDailyData: DailyDataRow[]): {
  totalDaysActive: number;
  totalCost: number;
  bestDayCost: number;
  bestDayTokens: number;
  bestMonthCost: number;
  bestMonthActiveDays: number;
} {
  let totalCost = 0;
  let bestDayCost = 0;
  let bestDayTokens = 0;
  const monthCosts = new Map<string, number>();
  const monthDays = new Map<string, number>();

  for (const row of allDailyData) {
    const cost = Number(row.totalCost ?? 0);
    totalCost += cost;
    const tokens =
      (row.inputTokens ?? 0) +
      (row.outputTokens ?? 0) +
      (row.cacheCreationTokens ?? 0) +
      (row.cacheReadTokens ?? 0);

    // Best single day
    if (cost > bestDayCost) bestDayCost = cost;
    if (tokens > bestDayTokens) bestDayTokens = tokens;

    // Monthly aggregation (key = "YYYY-MM")
    const monthKey = (row.date ?? "").slice(0, 7);
    if (monthKey) {
      monthCosts.set(monthKey, (monthCosts.get(monthKey) ?? 0) + cost);
      monthDays.set(monthKey, (monthDays.get(monthKey) ?? 0) + 1);
    }
  }

  let bestMonthCost = 0;
  let bestMonthActiveDays = 0;
  for (const cost of monthCosts.values()) {
    if (cost > bestMonthCost) bestMonthCost = cost;
  }
  for (const days of monthDays.values()) {
    if (days > bestMonthActiveDays) bestMonthActiveDays = days;
  }

  return {
    totalDaysActive: allDailyData.length,
    totalCost,
    bestDayCost,
    bestDayTokens,
    bestMonthCost,
    bestMonthActiveDays,
  };
}

// ─── Badge Computation ───────────────────────────────────────────────────────

/**
 * Pure function: compute which badges a user has earned.
 */
function computeBadges(params: BadgeInputs): EarnedBadge[] {
  return BADGES.map((definition) => {
    let earned = false;

    switch (definition.group) {
      case "spend":
        earned = params.totalCost >= definition.threshold;
        break;

      case "streak":
        earned = params.streak >= definition.threshold;
        break;

      case "rank":
        if (definition.id === "rank-top3" || definition.id === "rank-1") {
          earned = params.totalUsers > 0 && params.rank <= definition.threshold;
        } else {
          earned =
            params.totalUsers > 0 &&
            (100 - params.percentile) <= definition.threshold;
        }
        break;

      case "days-active":
        earned = params.totalDaysActive >= definition.threshold;
        break;

      case "daily-spend":
        earned = params.bestDayCost >= definition.threshold;
        break;

      case "daily-tokens":
        earned = params.bestDayTokens >= definition.threshold;
        break;

      case "monthly-spend":
        earned = params.bestMonthCost >= definition.threshold;
        break;

      case "monthly-days":
        earned = params.bestMonthActiveDays >= definition.threshold;
        break;

      case "perfect-month":
        earned = params.bestMonthActiveDays >= definition.threshold;
        break;
    }

    return { definition, earned };
  });
}

/**
 * Compute total XP from earned badges.
 */
function computeTotalXp(badges: EarnedBadge[]): number {
  return badges
    .filter((b) => b.earned)
    .reduce((sum, b) => sum + b.definition.xp, 0);
}

// ─── Full Badge State ─────────────────────────────────────────────────────────

export type BadgeState = {
  badges: EarnedBadge[];
  totalXp: number;
  kitchenRank: ReturnType<typeof getKitchenRank>;
  xpProgress: XpProgress;
  /** All earned badge IDs (previously earned + newly earned), ready for persistence. */
  allEarnedIds: string[];
  /** Badge IDs earned for the first time this computation (subset of allEarnedIds). */
  newlyEarnedIds: string[];
  /** True when no badges were previously persisted (first profile visit). */
  isFirstComputation: boolean;
};

/**
 * One-call helper: compute everything badge-related from daily data + rank info.
 * Used by both the profile page and settings page.
 *
 * Accepts optional previouslyEarnedBadgeIds so badges persist forever once
 * earned. Streak badges use current (active) streak only — historical streaks
 * don't count. Returns newlyEarnedIds for the caller to persist.
 */
export function computeFullBadgeState(
  allDailyData: DailyDataRow[],
  rankInfo: { rank: number; totalUsers: number; percentile: number },
  previouslyEarnedBadgeIds: string[] = [],
): BadgeState {
  const { totalCost, ...restInputs } = computeBadgeInputs(allDailyData);
  const currentStreak = computeCurrentStreak(allDailyData);
  const badges = computeBadges({
    streak: currentStreak,
    totalCost,
    rank: rankInfo.rank,
    totalUsers: rankInfo.totalUsers,
    percentile: rankInfo.percentile,
    ...restInputs,
  });

  // Merge previously earned badges so they can never be "lost"
  const previouslyEarnedSet = new Set(previouslyEarnedBadgeIds);
  const mergedBadges = badges.map((badge) =>
    !badge.earned && previouslyEarnedSet.has(badge.definition.id)
      ? { ...badge, earned: true }
      : badge
  );

  const totalXp = computeTotalXp(mergedBadges);

  // Compute all earned IDs and which are newly earned (for persistence)
  const allEarnedIds = mergedBadges
    .filter((b) => b.earned)
    .map((b) => b.definition.id);
  const newlyEarnedIds = allEarnedIds.filter(
    (id) => !previouslyEarnedSet.has(id)
  );

  return {
    badges: mergedBadges,
    totalXp,
    kitchenRank: getKitchenRank(totalXp),
    xpProgress: getXpProgress(totalXp),
    allEarnedIds,
    newlyEarnedIds,
    isFirstComputation: previouslyEarnedBadgeIds.length === 0,
  };
}
