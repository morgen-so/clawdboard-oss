import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import type { Period, DateRange } from "./leaderboard";
import { VALID_PERIODS, parseDateRange } from "./leaderboard";

export { VALID_PERIODS, parseDateRange };
export type { Period, DateRange };

// ─── Date filter for stats queries (raw SQL, no parameterized ints) ─────────

function statsDateFilter(period?: Period, range?: DateRange) {
  if (!period) return { filter: sql`TRUE`, label: "all time" };
  switch (period) {
    case "today":
      return { filter: sql`date::date = CURRENT_DATE`, label: "today" };
    case "7d":
      return { filter: sql`date::date >= CURRENT_DATE - 6`, label: "last 7 days" };
    case "30d":
      return { filter: sql`date::date >= CURRENT_DATE - 29`, label: "last 30 days" };
    case "this-month":
      return { filter: sql`date::date >= date_trunc('month', CURRENT_DATE)::date`, label: "this month" };
    case "ytd":
      return { filter: sql`date::date >= date_trunc('year', CURRENT_DATE)::date`, label: "year to date" };
    case "custom":
      if (range) {
        return {
          filter: sql`date::date >= ${range.from}::date AND date::date <= ${range.to}::date`,
          label: `${range.from} to ${range.to}`,
        };
      }
      return { filter: sql`date::date >= CURRENT_DATE - 29`, label: "last 30 days" };
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CommunityStats {
  totalUsers: number;
  totalCost: string;
  totalTokens: number;
  totalActiveDays: number;
  longestStreak: number;
  biggestSingleDayCost: string;
  biggestSingleDayDate: string | null;
  avgCostPerUser: string;
  medianCostPerUser: string;
}

export interface DailyTrendPoint {
  date: string;
  cost: number;
  tokens: number;
  activeUsers: number;
}

export interface ModelStats {
  modelName: string;
  totalCost: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  userCount: number;
  costShare: number; // percentage
}

export interface GrowthPoint {
  week: string; // "YYYY-WW"
  newUsers: number;
  cumulativeUsers: number;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/** Aggregate community-wide stats (parallel simple queries — no transactions needed) */
export async function getCommunityStats(
  period?: Period,
  range?: DateRange
): Promise<CommunityStats & { periodLabel: string }> {
  const { filter, label } = statsDateFilter(period, range);

  const [totals, biggestDay, costDistribution, longestStreakResult] =
    await Promise.all([
      // 1. Basic totals (filtered)
      db.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM users) AS total_users,
          COALESCE(SUM(total_cost::numeric), 0)::text AS total_cost,
          COALESCE(SUM(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens), 0)::bigint AS total_tokens,
          COUNT(DISTINCT user_id || '-' || date)::int AS total_active_days
        FROM daily_aggregates
        WHERE ${filter}
      `),
      // 2. Biggest single community day (filtered)
      db.execute(sql`
        SELECT date, SUM(total_cost::numeric)::text AS day_cost
        FROM daily_aggregates
        WHERE ${filter}
        GROUP BY date
        ORDER BY SUM(total_cost::numeric) DESC
        LIMIT 1
      `),
      // 3. Avg + median cost per user (filtered)
      db.execute(sql`
        WITH user_costs AS (
          SELECT SUM(total_cost::numeric) AS c
          FROM daily_aggregates
          WHERE ${filter}
          GROUP BY user_id
        )
        SELECT
          COALESCE(AVG(c), 0)::text AS avg_cost,
          COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY c), 0)::text AS median_cost
        FROM user_costs
      `),
      // 4. Longest current streak (always all-time — streaks don't make sense filtered)
      db.execute(sql`
        WITH streak_days AS (
          SELECT DISTINCT user_id, date::date AS d FROM daily_aggregates
        ),
        streak_groups AS (
          SELECT user_id, d,
            d - (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY d))::int AS grp
          FROM streak_days
        ),
        streak_lengths AS (
          SELECT user_id, COUNT(*)::int AS streak_len, MAX(d) AS streak_end
          FROM streak_groups
          GROUP BY user_id, grp
        )
        SELECT COALESCE(MAX(streak_len), 0)::int AS longest
        FROM streak_lengths
        WHERE streak_end >= CURRENT_DATE - 1
      `),
    ]);

  const t = totals.rows[0];
  const bd = biggestDay.rows[0];
  const cd = costDistribution.rows[0];
  const ls = longestStreakResult.rows[0];

  return {
    totalUsers: Number(t?.total_users ?? 0),
    totalCost: String(t?.total_cost ?? "0"),
    totalTokens: Number(t?.total_tokens ?? 0),
    totalActiveDays: Number(t?.total_active_days ?? 0),
    longestStreak: Number(ls?.longest ?? 0),
    biggestSingleDayCost: String(bd?.day_cost ?? "0"),
    biggestSingleDayDate: (bd?.date as string) ?? null,
    avgCostPerUser: String(cd?.avg_cost ?? "0"),
    medianCostPerUser: String(cd?.median_cost ?? "0"),
    periodLabel: label,
  };
}

/** Daily cost/token/user trends for the last N days */
export async function getDailyTrends(days = 90): Promise<DailyTrendPoint[]> {
  // Compute the cutoff date in JS to avoid pg driver issues with
  // parameterized integer arithmetic in date expressions
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const result = await db.execute(sql`
    SELECT
      da.date,
      SUM(da.total_cost::numeric)::float AS cost,
      SUM(da.input_tokens + da.output_tokens + da.cache_creation_tokens + da.cache_read_tokens)::bigint AS tokens,
      COUNT(DISTINCT da.user_id)::int AS active_users
    FROM daily_aggregates da
    WHERE da.date >= ${cutoffStr}
    GROUP BY da.date
    ORDER BY da.date ASC
  `);

  return result.rows.map((row) => ({
    date: String(row.date),
    cost: Number(row.cost ?? 0),
    tokens: Number(row.tokens ?? 0),
    activeUsers: Number(row.active_users ?? 0),
  }));
}

/** Model usage breakdown across all users */
export async function getModelStats(
  period?: Period,
  range?: DateRange
): Promise<ModelStats[]> {
  const { filter } = statsDateFilter(period, range);

  const result = await db.execute(sql`
    WITH model_data AS (
      SELECT
        elem->>'modelName' AS model_name,
        SUM((elem->>'cost')::numeric) AS total_cost,
        SUM((elem->>'inputTokens')::bigint) AS input_tokens,
        SUM((elem->>'outputTokens')::bigint) AS output_tokens,
        SUM((elem->>'inputTokens')::bigint + (elem->>'outputTokens')::bigint) AS total_tokens,
        COUNT(DISTINCT da.user_id) AS user_count
      FROM daily_aggregates da,
        jsonb_array_elements(da.model_breakdowns) AS elem
      WHERE ${filter}
      GROUP BY elem->>'modelName'
    ),
    grand_total AS (
      SELECT SUM(total_cost) AS total FROM model_data
    )
    SELECT
      md.model_name,
      md.total_cost::text,
      md.total_tokens::bigint,
      md.input_tokens::bigint,
      md.output_tokens::bigint,
      md.user_count::int,
      CASE WHEN gt.total > 0
        THEN ROUND(md.total_cost / gt.total * 100, 1)::float
        ELSE 0
      END AS cost_share
    FROM model_data md, grand_total gt
    ORDER BY md.total_cost DESC
  `);

  return result.rows.map((row) => ({
    modelName: String(row.model_name),
    totalCost: String(row.total_cost ?? "0"),
    totalTokens: Number(row.total_tokens ?? 0),
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    userCount: Number(row.user_count ?? 0),
    costShare: Number(row.cost_share ?? 0),
  }));
}

/** Weekly new user growth */
export async function getWeeklyGrowth(): Promise<GrowthPoint[]> {
  const result = await db.execute(sql`
    WITH weekly_signups AS (
      SELECT
        TO_CHAR(DATE_TRUNC('week', created_at), 'YYYY-"W"IW') AS week,
        COUNT(*)::int AS new_users
      FROM users
      WHERE created_at IS NOT NULL
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY DATE_TRUNC('week', created_at) ASC
    )
    SELECT
      week,
      new_users,
      SUM(new_users) OVER (ORDER BY week)::int AS cumulative_users
    FROM weekly_signups
  `);

  return result.rows.map((row) => ({
    week: String(row.week),
    newUsers: Number(row.new_users ?? 0),
    cumulativeUsers: Number(row.cumulative_users ?? 0),
  }));
}
