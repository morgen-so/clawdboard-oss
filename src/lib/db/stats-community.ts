import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import type { Period, DateRange } from "./leaderboard";
import { statsDateFilter } from "./date-filter";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CommunityStats {
  totalUsers: number;
  activeUsers: number;
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
          COUNT(DISTINCT user_id)::int AS active_users,
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
      // 4. Longest current streak — read from the materialized view
      // (pre-computed hourly by the cron job, same algorithm)
      db.execute(sql`
        SELECT COALESCE(MAX(current_streak), 0)::int AS longest
        FROM leaderboard_mv
      `),
    ]);

  const t = totals.rows[0];
  const bd = biggestDay.rows[0];
  const cd = costDistribution.rows[0];
  const ls = longestStreakResult.rows[0];

  return {
    totalUsers: Number(t?.total_users ?? 0),
    activeUsers: Number(t?.active_users ?? 0),
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
