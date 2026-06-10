import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import type { Period, DateRange } from "./leaderboard";
import { statsDateFilter } from "./date-filter";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ModelStats {
  modelName: string;
  totalCost: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  userCount: number;
  costShare: number; // percentage
}

// ─── Queries ─────────────────────────────────────────────────────────────────

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
