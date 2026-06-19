import { db } from "@/lib/db";
import { dailyAggregates } from "./schema";
import { sql } from "drizzle-orm";
import type { Period, DateRange } from "./leaderboard";
import { statsDateFilter } from "./date-filter";
import { getDailyTrends, type DailyTrendPoint } from "./stats-community";
import { getModelStats, type ModelStats } from "./stats-models";

// ─── Source Breakdown ───────────────────────────────────────────────────────

export interface SourceBreakdownEntry {
  source: string;
  totalCost: number;
  totalTokens: number;
  userCount: number;
}

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

/** Per-source daily trends for the comparison chart (last N days). */
export interface SourceComparisonPoint {
  date: string;
  claudeCode: number;
  claudeCodeDesktop: number;
  opencode: number;
  opencodeGo: number;
  opencodeZen: number;
  codex: number;
  cursor: number;
  geminiCli: number;
  antigravity: number;
  copilotCli: number;
}

/** All-source daily trends for comparison chart (last N days). */
export async function getSourceComparisonTrends(
  days = 90
): Promise<SourceComparisonPoint[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  try {
    const result = await db.execute(sql`
      SELECT
        date,
        COALESCE(SUM(CASE WHEN source = 'claude-code' OR source IS NULL THEN total_cost::numeric ELSE 0 END), 0)::float AS claude_code,
        COALESCE(SUM(CASE WHEN source = 'claude-code-desktop' THEN total_cost::numeric ELSE 0 END), 0)::float AS claude_code_desktop,
        COALESCE(SUM(CASE WHEN source = 'opencode' THEN total_cost::numeric ELSE 0 END), 0)::float AS opencode,
        COALESCE(SUM(CASE WHEN source = 'opencode-go' THEN total_cost::numeric ELSE 0 END), 0)::float AS opencode_go,
        COALESCE(SUM(CASE WHEN source = 'opencode-zen' THEN total_cost::numeric ELSE 0 END), 0)::float AS opencode_zen,
        COALESCE(SUM(CASE WHEN source = 'codex' THEN total_cost::numeric ELSE 0 END), 0)::float AS codex,
        COALESCE(SUM(CASE WHEN source = 'cursor' THEN total_cost::numeric ELSE 0 END), 0)::float AS cursor,
        COALESCE(SUM(CASE WHEN source = 'gemini-cli' THEN total_cost::numeric ELSE 0 END), 0)::float AS gemini_cli,
        COALESCE(SUM(CASE WHEN source = 'antigravity' THEN total_cost::numeric ELSE 0 END), 0)::float AS antigravity,
        COALESCE(SUM(CASE WHEN source = 'copilot-cli' THEN total_cost::numeric ELSE 0 END), 0)::float AS copilot_cli
      FROM daily_aggregates
      WHERE date >= ${cutoffStr}
      GROUP BY date
      ORDER BY date ASC
    `);

    return result.rows.map((row) => ({
      date: String(row.date),
      claudeCode: Number(row.claude_code ?? 0),
      claudeCodeDesktop: Number(row.claude_code_desktop ?? 0),
      opencode: Number(row.opencode ?? 0),
      opencodeGo: Number(row.opencode_go ?? 0),
      opencodeZen: Number(row.opencode_zen ?? 0),
      codex: Number(row.codex ?? 0),
      cursor: Number(row.cursor ?? 0),
      geminiCli: Number(row.gemini_cli ?? 0),
      antigravity: Number(row.antigravity ?? 0),
      copilotCli: Number(row.copilot_cli ?? 0),
    }));
  } catch {
    // source column missing — all data goes to claudeCode
    const trends = await getDailyTrends(days);
    return trends.map((t) => ({
      date: t.date,
      claudeCode: t.cost,
      claudeCodeDesktop: 0,
      opencode: 0,
      opencodeGo: 0,
      opencodeZen: 0,
      codex: 0,
      cursor: 0,
      geminiCli: 0,
      antigravity: 0,
      copilotCli: 0,
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
