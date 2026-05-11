import { db } from "@/lib/db";
import { users, dailyAggregates } from "@/lib/db/schema";
import { eq, sql, asc, and, type SQL } from "drizzle-orm";
import type { Period, DateRange } from "./leaderboard";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ProfileUser = {
  id: string;
  name: string | null;
  githubUsername: string | null;
  image: string | null;
  cookingUrl: string | null;
  cookingLabel: string | null;
  createdAt: Date | null;
  lastSyncAt: Date | null;
  pinnedBadges: string[] | null;
  earnedBadges: string[] | null;
};

export type UserSummary = {
  totalCost: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreation: number;
  totalCacheRead: number;
  activeDays: number;
  firstActiveDay: string | null;
  lastActiveDay: string | null;
};

export type DailyDataRow = {
  date: string | null;
  totalCost: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationTokens: number | null;
  cacheReadTokens: number | null;
};

export type ModelBreakdownRow = {
  model_name: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_cost: string;
};

export type UserRank = {
  rank: number;
  totalUsers: number;
  percentile: number;
};

// ─── Date filter helpers ─────────────────────────────────────────────────────

/**
 * Returns a Drizzle SQL fragment filtering dailyAggregates.date by the given period.
 * Uses the Drizzle column reference (for query-builder WHERE clauses).
 */
function getProfileDateFilter(
  period: Period,
  range?: DateRange
): SQL {
  switch (period) {
    case "today":
      return sql`${dailyAggregates.date}::date = CURRENT_DATE`;
    case "7d":
      return sql`${dailyAggregates.date}::date >= CURRENT_DATE - 6`;
    case "30d":
      return sql`${dailyAggregates.date}::date >= CURRENT_DATE - 29`;
    case "this-month":
      return sql`${dailyAggregates.date}::date >= date_trunc('month', CURRENT_DATE)::date`;
    case "ytd":
      return sql`${dailyAggregates.date}::date >= date_trunc('year', CURRENT_DATE)::date`;
    case "custom":
      if (range) {
        return sql`${dailyAggregates.date}::date >= ${range.from}::date AND ${dailyAggregates.date}::date <= ${range.to}::date`;
      }
      return sql`${dailyAggregates.date}::date >= CURRENT_DATE - 29`;
  }
}

/**
 * Returns a raw SQL fragment using `da.` alias for getUserModelBreakdown's raw query.
 */
function getProfileDateFilterRaw(
  period: Period,
  range?: DateRange
): SQL {
  switch (period) {
    case "today":
      return sql`AND da.date::date = CURRENT_DATE`;
    case "7d":
      return sql`AND da.date::date >= CURRENT_DATE - 6`;
    case "30d":
      return sql`AND da.date::date >= CURRENT_DATE - 29`;
    case "this-month":
      return sql`AND da.date::date >= date_trunc('month', CURRENT_DATE)::date`;
    case "ytd":
      return sql`AND da.date::date >= date_trunc('year', CURRENT_DATE)::date`;
    case "custom":
      if (range) {
        return sql`AND da.date::date >= ${range.from}::date AND da.date::date <= ${range.to}::date`;
      }
      return sql`AND da.date::date >= CURRENT_DATE - 29`;
  }
}

// ─── Query Functions ─────────────────────────────────────────────────────────

/**
 * Look up a user by GitHub username (case-insensitive).
 * Returns null if no user found.
 */
export async function getUserByUsername(
  username: string
): Promise<ProfileUser | null> {
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      githubUsername: users.githubUsername,
      image: users.image,
      cookingUrl: users.cookingUrl,
      cookingLabel: users.cookingLabel,
      createdAt: users.createdAt,
      lastSyncAt: users.lastSyncAt,
      pinnedBadges: users.pinnedBadges,
      earnedBadges: users.earnedBadges,
    })
    .from(users)
    .where(sql`LOWER(${users.githubUsername}) = LOWER(${username})`)
    .limit(1);
  return user ?? null;
}

/**
 * Persist earned badge IDs to the user record.
 * Called when new badges are earned to ensure they can never be lost.
 */
export async function persistEarnedBadges(
  userId: string,
  allEarnedIds: string[]
): Promise<void> {
  await db
    .update(users)
    .set({ earnedBadges: allEarnedIds })
    .where(eq(users.id, userId));
}

/**
 * Get aggregate summary stats for a user across all their daily data.
 * When period is provided, filters to the given date range.
 */
export async function getUserSummary(
  userId: string,
  period?: Period,
  range?: DateRange
): Promise<UserSummary> {
  const conditions = [eq(dailyAggregates.userId, userId)];
  if (period) conditions.push(getProfileDateFilter(period, range));

  const [row] = await db
    .select({
      totalCost: sql<string>`COALESCE(SUM(${dailyAggregates.totalCost}::numeric), 0)::text`,
      totalInputTokens: sql<number>`COALESCE(SUM(${dailyAggregates.inputTokens}), 0)`,
      totalOutputTokens: sql<number>`COALESCE(SUM(${dailyAggregates.outputTokens}), 0)`,
      totalCacheCreation: sql<number>`COALESCE(SUM(${dailyAggregates.cacheCreationTokens}), 0)`,
      totalCacheRead: sql<number>`COALESCE(SUM(${dailyAggregates.cacheReadTokens}), 0)`,
      activeDays: sql<number>`COUNT(DISTINCT ${dailyAggregates.date})`,
      firstActiveDay: sql<string | null>`MIN(${dailyAggregates.date})`,
      lastActiveDay: sql<string | null>`MAX(${dailyAggregates.date})`,
    })
    .from(dailyAggregates)
    .where(and(...conditions));

  return {
    totalCost: row?.totalCost ?? "0",
    totalInputTokens: Number(row?.totalInputTokens ?? 0),
    totalOutputTokens: Number(row?.totalOutputTokens ?? 0),
    totalCacheCreation: Number(row?.totalCacheCreation ?? 0),
    totalCacheRead: Number(row?.totalCacheRead ?? 0),
    activeDays: Number(row?.activeDays ?? 0),
    firstActiveDay: row?.firstActiveDay ?? null,
    lastActiveDay: row?.lastActiveDay ?? null,
  };
}

/**
 * Get daily usage rows for a user, ordered by date ascending.
 * Aggregates across sources (claude-code, opencode, codex, cursor, legacy null)
 * so each date has exactly one row, consistent with getUserSummary.
 * When period is provided, filters to the given date range.
 */
export async function getUserDailyData(
  userId: string,
  period?: Period,
  range?: DateRange
): Promise<DailyDataRow[]> {
  const conditions = [eq(dailyAggregates.userId, userId)];
  if (period) conditions.push(getProfileDateFilter(period, range));

  const rows = await db
    .select({
      date: dailyAggregates.date,
      totalCost: sql<string>`SUM(${dailyAggregates.totalCost}::numeric)::text`,
      inputTokens: sql<string>`COALESCE(SUM(${dailyAggregates.inputTokens}), 0)`,
      outputTokens: sql<string>`COALESCE(SUM(${dailyAggregates.outputTokens}), 0)`,
      cacheCreationTokens: sql<string>`COALESCE(SUM(${dailyAggregates.cacheCreationTokens}), 0)`,
      cacheReadTokens: sql<string>`COALESCE(SUM(${dailyAggregates.cacheReadTokens}), 0)`,
    })
    .from(dailyAggregates)
    .where(and(...conditions))
    .groupBy(dailyAggregates.date)
    .orderBy(asc(dailyAggregates.date));

  return rows.map((row) => ({
    date: row.date,
    totalCost: row.totalCost,
    inputTokens: Number(row.inputTokens),
    outputTokens: Number(row.outputTokens),
    cacheCreationTokens: Number(row.cacheCreationTokens),
    cacheReadTokens: Number(row.cacheReadTokens),
  }));
}

/**
 * Get per-model aggregated token and cost data by unnesting the JSONB
 * model_breakdowns column. WHERE filter on user_id is applied before
 * JSONB expansion for performance.
 * When period is provided, filters to the given date range.
 */
export async function getUserModelBreakdown(
  userId: string,
  period?: Period,
  range?: DateRange
): Promise<ModelBreakdownRow[]> {
  const dateFilter = period
    ? getProfileDateFilterRaw(period, range)
    : sql``;

  const result = await db.execute(sql`
    SELECT
      elem->>'modelName' AS model_name,
      SUM((elem->>'inputTokens')::bigint) AS input_tokens,
      SUM((elem->>'outputTokens')::bigint) AS output_tokens,
      SUM((elem->>'cacheCreationTokens')::bigint) AS cache_creation_tokens,
      SUM((elem->>'cacheReadTokens')::bigint) AS cache_read_tokens,
      SUM((elem->>'cost')::numeric)::text AS total_cost
    FROM daily_aggregates da,
      jsonb_array_elements(da.model_breakdowns) AS elem
    WHERE da.user_id = ${userId}
    ${dateFilter}
    GROUP BY elem->>'modelName'
    ORDER BY SUM((elem->>'cost')::numeric) DESC
  `);
  return result.rows as unknown as ModelBreakdownRow[];
}

/**
 * Compute a user's global rank and percentile based on total cost.
 * Reuses the same pattern as /api/rank/route.ts.
 */
export async function getUserRank(userId: string): Promise<UserRank> {
  // Get user's total cost
  const [userCostRow] = await db
    .select({
      totalCost: sql<string>`COALESCE(SUM(${dailyAggregates.totalCost}::numeric), 0)::text`,
    })
    .from(dailyAggregates)
    .where(eq(dailyAggregates.userId, userId));

  const userTotalCost = parseFloat(userCostRow?.totalCost ?? "0");

  // Count users with higher total cost
  const userTotals = db
    .select({
      uId: dailyAggregates.userId,
      total: sql<number>`SUM(${dailyAggregates.totalCost}::numeric)`.as("total"),
    })
    .from(dailyAggregates)
    .groupBy(dailyAggregates.userId)
    .as("user_totals");

  const [usersAboveRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userTotals)
    .where(sql`${userTotals.total} > ${userTotalCost}`);

  // Count total users with any data
  const [totalUsersRow] = await db
    .select({
      count: sql<number>`count(DISTINCT ${dailyAggregates.userId})::int`,
    })
    .from(dailyAggregates);

  const usersAbove = usersAboveRow?.count ?? 0;
  const totalUsers = totalUsersRow?.count ?? 0;
  const rank = totalUsers === 0 ? 1 : usersAbove + 1;
  const percentile =
    totalUsers <= 1
      ? 100
      : Math.round(((totalUsers - rank) / totalUsers) * 1000) / 10;

  return { rank, totalUsers, percentile };
}
