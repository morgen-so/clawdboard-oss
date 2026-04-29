import { db } from "@/lib/db";
import { dailyAggregates } from "./schema";
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
        SUM((elem->>'inputTokens')::bigint + (elem->>'outputTokens')::bigint + COALESCE((elem->>'cacheCreationTokens')::bigint, 0) + COALESCE((elem->>'cacheReadTokens')::bigint, 0)) AS total_tokens,
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

// ─── Per-model queries (for /stats/models/[model] pages) ────────────────────

export interface ModelDetailStats {
  totalCost: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  userCount: number;
  costShare: number;
  avgCostPerUser: string;
  medianCostPerUser: string;
  firstSeen: string | null;
  rawModelIds: string[];
}

/** Detailed stats for all raw model IDs matching a slug prefix. */
export async function getModelDetailStats(
  slug: string
): Promise<ModelDetailStats | null> {
  const result = await db.execute(sql`
    WITH matched AS (
      SELECT
        elem->>'modelName' AS raw_id,
        (elem->>'cost')::numeric AS cost,
        (elem->>'inputTokens')::bigint AS inp,
        (elem->>'outputTokens')::bigint AS outp,
        COALESCE((elem->>'cacheCreationTokens')::bigint, 0) AS cache_create,
        COALESCE((elem->>'cacheReadTokens')::bigint, 0) AS cache_read,
        da.user_id,
        da.date
      FROM daily_aggregates da,
        jsonb_array_elements(da.model_breakdowns) AS elem
      WHERE (
        elem->>'modelName' = ${slug}
        OR elem->>'modelName' ~ ('^' || ${slug} || '-[0-9]{6,8}$')
      )
    ),
    grand_total AS (
      SELECT COALESCE(SUM((elem->>'cost')::numeric), 0) AS total
      FROM daily_aggregates da,
        jsonb_array_elements(da.model_breakdowns) AS elem
    ),
    user_costs AS (
      SELECT SUM(cost) AS c FROM matched GROUP BY user_id
    )
    SELECT
      COALESCE(SUM(m.cost), 0)::text AS total_cost,
      COALESCE(SUM(m.inp + m.outp + m.cache_create + m.cache_read), 0)::bigint AS total_tokens,
      COALESCE(SUM(m.inp), 0)::bigint AS input_tokens,
      COALESCE(SUM(m.outp), 0)::bigint AS output_tokens,
      COALESCE(SUM(m.cache_create), 0)::bigint AS cache_creation_tokens,
      COALESCE(SUM(m.cache_read), 0)::bigint AS cache_read_tokens,
      COUNT(DISTINCT m.user_id)::int AS user_count,
      CASE WHEN gt.total > 0
        THEN ROUND(SUM(m.cost) / gt.total * 100, 1)::float
        ELSE 0
      END AS cost_share,
      COALESCE((SELECT AVG(c) FROM user_costs), 0)::text AS avg_cost,
      COALESCE((SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY c) FROM user_costs), 0)::text AS median_cost,
      MIN(m.date)::text AS first_seen,
      ARRAY_AGG(DISTINCT m.raw_id) AS raw_model_ids
    FROM matched m, grand_total gt
    GROUP BY gt.total
  `);

  const row = result.rows[0];
  if (!row || Number(row.user_count ?? 0) === 0) return null;

  return {
    totalCost: String(row.total_cost ?? "0"),
    totalTokens: Number(row.total_tokens ?? 0),
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    cacheCreationTokens: Number(row.cache_creation_tokens ?? 0),
    cacheReadTokens: Number(row.cache_read_tokens ?? 0),
    userCount: Number(row.user_count ?? 0),
    costShare: Number(row.cost_share ?? 0),
    avgCostPerUser: String(row.avg_cost ?? "0"),
    medianCostPerUser: String(row.median_cost ?? "0"),
    firstSeen: (row.first_seen as string) ?? null,
    rawModelIds: (row.raw_model_ids as string[]) ?? [],
  };
}

export interface ModelDailyTrend {
  date: string;
  cost: number;
  tokens: number;
  activeUsers: number;
}

/** Daily trends for a specific model slug (last N days). */
export async function getModelDailyTrends(
  slug: string,
  days = 90
): Promise<ModelDailyTrend[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const result = await db.execute(sql`
    SELECT
      da.date,
      SUM((elem->>'cost')::numeric)::float AS cost,
      SUM((elem->>'inputTokens')::bigint + (elem->>'outputTokens')::bigint + COALESCE((elem->>'cacheCreationTokens')::bigint, 0) + COALESCE((elem->>'cacheReadTokens')::bigint, 0))::bigint AS tokens,
      COUNT(DISTINCT da.user_id)::int AS active_users
    FROM daily_aggregates da,
      jsonb_array_elements(da.model_breakdowns) AS elem
    WHERE da.date >= ${cutoffStr}
      AND (
        elem->>'modelName' = ${slug}
        OR elem->>'modelName' ~ ('^' || ${slug} || '-[0-9]{6,8}$')
      )
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

/** Get all distinct model slugs with enough data for a page. */
export async function getDistinctModelSlugs(): Promise<string[]> {
  const result = await db.execute(sql`
    SELECT DISTINCT
      regexp_replace(elem->>'modelName', '-[0-9]{6,8}$', '') AS slug
    FROM daily_aggregates da,
      jsonb_array_elements(da.model_breakdowns) AS elem
    WHERE (elem->>'cost')::numeric > 0
  `);

  return result.rows.map((row) => String(row.slug));
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

// ─── Source Breakdown ───────────────────────────────────────────────────────

export interface SourceBreakdownEntry {
  source: string;
  totalCost: number;
  totalTokens: number;
  userCount: number;
}

/**
 * Get aggregate usage broken down by data source (claude-code, opencode, codex).
 * Rows with null source are grouped as "claude-code" (legacy data).
 */
// ─── Per-source queries (for /stats/tools page) ──────────────────────────

export interface SourceDetailStats {
  source: string;
  totalCost: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  userCount: number;
  costShare: number;
  avgCostPerUser: string;
  medianCostPerUser: string;
  firstSeen: string | null;
  activeDays: number;
}

/** Detailed stats for a single source/tool. */
export async function getSourceDetailStats(
  source: string
): Promise<SourceDetailStats | null> {
  try {
    const sourceFilter = source === "claude-code"
      ? sql`(${dailyAggregates.source} = 'claude-code' OR ${dailyAggregates.source} IS NULL)`
      : sql`${dailyAggregates.source} = ${source}`;

    const result = await db.execute(sql`
      WITH source_data AS (
        SELECT * FROM daily_aggregates WHERE ${sourceFilter}
      ),
      grand_total AS (
        SELECT COALESCE(SUM(total_cost::numeric), 0) AS total FROM daily_aggregates
      ),
      user_costs AS (
        SELECT SUM(total_cost::numeric) AS c FROM source_data GROUP BY user_id
      )
      SELECT
        COALESCE(SUM(sd.total_cost::numeric), 0)::text AS total_cost,
        COALESCE(SUM(sd.input_tokens + sd.output_tokens + sd.cache_creation_tokens + sd.cache_read_tokens), 0)::bigint AS total_tokens,
        COALESCE(SUM(sd.input_tokens), 0)::bigint AS input_tokens,
        COALESCE(SUM(sd.output_tokens), 0)::bigint AS output_tokens,
        COALESCE(SUM(sd.cache_creation_tokens), 0)::bigint AS cache_creation_tokens,
        COALESCE(SUM(sd.cache_read_tokens), 0)::bigint AS cache_read_tokens,
        COUNT(DISTINCT sd.user_id)::int AS user_count,
        CASE WHEN gt.total > 0
          THEN ROUND(SUM(sd.total_cost::numeric) / gt.total * 100, 1)::float
          ELSE 0
        END AS cost_share,
        COALESCE((SELECT AVG(c) FROM user_costs), 0)::text AS avg_cost,
        COALESCE((SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY c) FROM user_costs), 0)::text AS median_cost,
        MIN(sd.date)::text AS first_seen,
        COUNT(DISTINCT sd.user_id || '-' || sd.date)::int AS active_days
      FROM source_data sd, grand_total gt
      GROUP BY gt.total
    `);

    const row = result.rows[0];
    if (!row || Number(row.user_count ?? 0) === 0) return null;

    return {
      source,
      totalCost: String(row.total_cost ?? "0"),
      totalTokens: Number(row.total_tokens ?? 0),
      inputTokens: Number(row.input_tokens ?? 0),
      outputTokens: Number(row.output_tokens ?? 0),
      cacheCreationTokens: Number(row.cache_creation_tokens ?? 0),
      cacheReadTokens: Number(row.cache_read_tokens ?? 0),
      userCount: Number(row.user_count ?? 0),
      costShare: Number(row.cost_share ?? 0),
      avgCostPerUser: String(row.avg_cost ?? "0"),
      medianCostPerUser: String(row.median_cost ?? "0"),
      firstSeen: (row.first_seen as string) ?? null,
      activeDays: Number(row.active_days ?? 0),
    };
  } catch {
    // source column may not exist yet — fall back to all data as claude-code
    if (source !== "claude-code") return null;
    return _getSourceDetailStatsFallback();
  }
}

/** Fallback when source column doesn't exist — treats all data as claude-code */
async function _getSourceDetailStatsFallback(): Promise<SourceDetailStats | null> {
  const result = await db.execute(sql`
    WITH user_costs AS (
      SELECT SUM(total_cost::numeric) AS c FROM daily_aggregates GROUP BY user_id
    )
    SELECT
      COALESCE(SUM(total_cost::numeric), 0)::text AS total_cost,
      COALESCE(SUM(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens), 0)::bigint AS total_tokens,
      COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
      COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
      COALESCE(SUM(cache_creation_tokens), 0)::bigint AS cache_creation_tokens,
      COALESCE(SUM(cache_read_tokens), 0)::bigint AS cache_read_tokens,
      COUNT(DISTINCT user_id)::int AS user_count,
      100.0::float AS cost_share,
      COALESCE((SELECT AVG(c) FROM user_costs), 0)::text AS avg_cost,
      COALESCE((SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY c) FROM user_costs), 0)::text AS median_cost,
      MIN(date)::text AS first_seen,
      COUNT(DISTINCT user_id || '-' || date)::int AS active_days
    FROM daily_aggregates
  `);
  const row = result.rows[0];
  if (!row || Number(row.user_count ?? 0) === 0) return null;
  return {
    source: "claude-code",
    totalCost: String(row.total_cost ?? "0"),
    totalTokens: Number(row.total_tokens ?? 0),
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    cacheCreationTokens: Number(row.cache_creation_tokens ?? 0),
    cacheReadTokens: Number(row.cache_read_tokens ?? 0),
    userCount: Number(row.user_count ?? 0),
    costShare: Number(row.cost_share ?? 0),
    avgCostPerUser: String(row.avg_cost ?? "0"),
    medianCostPerUser: String(row.median_cost ?? "0"),
    firstSeen: (row.first_seen as string) ?? null,
    activeDays: Number(row.active_days ?? 0),
  };
}

/** Daily trends for a specific source/tool (last N days). */
export async function getSourceDailyTrends(
  source: string,
  days = 90
): Promise<DailyTrendPoint[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  try {
    const sourceFilter = source === "claude-code"
      ? sql`(source = 'claude-code' OR source IS NULL)`
      : sql`source = ${source}`;

    const result = await db.execute(sql`
      SELECT
        date,
        SUM(total_cost::numeric)::float AS cost,
        SUM(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens)::bigint AS tokens,
        COUNT(DISTINCT user_id)::int AS active_users
      FROM daily_aggregates
      WHERE date >= ${cutoffStr} AND ${sourceFilter}
      GROUP BY date
      ORDER BY date ASC
    `);

    return result.rows.map((row) => ({
      date: String(row.date),
      cost: Number(row.cost ?? 0),
      tokens: Number(row.tokens ?? 0),
      activeUsers: Number(row.active_users ?? 0),
    }));
  } catch {
    // source column missing — return all data for claude-code, empty for others
    if (source !== "claude-code") return [];
    return getDailyTrends(days);
  }
}

/** Model breakdown for a specific source/tool. */
export async function getSourceModelBreakdown(
  source: string
): Promise<ModelStats[]> {
  try {
    const sourceFilter = source === "claude-code"
      ? sql`(da.source = 'claude-code' OR da.source IS NULL)`
      : sql`da.source = ${source}`;

    const result = await db.execute(sql`
      WITH model_data AS (
        SELECT
          elem->>'modelName' AS model_name,
          SUM((elem->>'cost')::numeric) AS total_cost,
          SUM((elem->>'inputTokens')::bigint) AS input_tokens,
          SUM((elem->>'outputTokens')::bigint) AS output_tokens,
          SUM((elem->>'inputTokens')::bigint + (elem->>'outputTokens')::bigint + COALESCE((elem->>'cacheCreationTokens')::bigint, 0) + COALESCE((elem->>'cacheReadTokens')::bigint, 0)) AS total_tokens,
          COUNT(DISTINCT da.user_id) AS user_count
        FROM daily_aggregates da,
          jsonb_array_elements(da.model_breakdowns) AS elem
        WHERE ${sourceFilter}
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
  } catch {
    // source column missing — return all models for claude-code, empty for others
    if (source !== "claude-code") return [];
    return getModelStats();
  }
}

/** All-source daily trends for comparison chart (last N days). */
export async function getSourceComparisonTrends(
  days = 90
): Promise<
  {
    date: string;
    claudeCode: number;
    opencode: number;
    codex: number;
    cursor: number;
  }[]
> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  try {
    const result = await db.execute(sql`
      SELECT
        date,
        COALESCE(SUM(CASE WHEN source = 'claude-code' OR source IS NULL THEN total_cost::numeric ELSE 0 END), 0)::float AS claude_code,
        COALESCE(SUM(CASE WHEN source = 'opencode' THEN total_cost::numeric ELSE 0 END), 0)::float AS opencode,
        COALESCE(SUM(CASE WHEN source = 'codex' THEN total_cost::numeric ELSE 0 END), 0)::float AS codex,
        COALESCE(SUM(CASE WHEN source = 'cursor' THEN total_cost::numeric ELSE 0 END), 0)::float AS cursor
      FROM daily_aggregates
      WHERE date >= ${cutoffStr}
      GROUP BY date
      ORDER BY date ASC
    `);

    return result.rows.map((row) => ({
      date: String(row.date),
      claudeCode: Number(row.claude_code ?? 0),
      opencode: Number(row.opencode ?? 0),
      codex: Number(row.codex ?? 0),
      cursor: Number(row.cursor ?? 0),
    }));
  } catch {
    // source column missing — all data goes to claudeCode
    const trends = await getDailyTrends(days);
    return trends.map((t) => ({
      date: t.date,
      claudeCode: t.cost,
      opencode: 0,
      codex: 0,
      cursor: 0,
    }));
  }
}

/** Get the list of known sources that have data. */
export async function getDistinctSources(): Promise<string[]> {
  try {
    const result = await db.execute(sql`
      SELECT DISTINCT COALESCE(source, 'claude-code') AS source
      FROM daily_aggregates
      WHERE total_cost::numeric > 0
      ORDER BY source
    `);
    return result.rows.map((row) => String(row.source));
  } catch {
    return ["claude-code"];
  }
}

export async function getSourceBreakdown(
  period?: Period,
  range?: DateRange
): Promise<SourceBreakdownEntry[]> {
  const { filter } = statsDateFilter(period, range);

  try {
    const result = await db.execute(sql`
      SELECT
        COALESCE(source, 'claude-code') AS source,
        COALESCE(SUM(total_cost::numeric), 0)::float AS total_cost,
        COALESCE(SUM(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens), 0)::bigint AS total_tokens,
        COUNT(DISTINCT user_id)::int AS user_count
      FROM daily_aggregates
      WHERE ${filter}
      GROUP BY COALESCE(source, 'claude-code')
    `);

    return result.rows.map((r) => ({
      source: String(r.source),
      totalCost: Number(r.total_cost),
      totalTokens: Number(r.total_tokens),
      userCount: Number(r.user_count),
    }));
  } catch {
    // source column may not exist yet (pre-migration) — fall back to all as claude-code
    const result = await db.execute(sql`
      SELECT
        COALESCE(SUM(total_cost::numeric), 0)::float AS total_cost,
        COALESCE(SUM(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens), 0)::bigint AS total_tokens,
        COUNT(DISTINCT user_id)::int AS user_count
      FROM daily_aggregates
      WHERE ${filter}
    `);

    const row = result.rows[0];
    return [{
      source: "claude-code",
      totalCost: Number(row?.total_cost ?? 0),
      totalTokens: Number(row?.total_tokens ?? 0),
      userCount: Number(row?.user_count ?? 0),
    }];
  }
}
