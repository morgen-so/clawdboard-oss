import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { MIN_DATE, VALID_PERIODS, type Period } from "@/lib/constants";
export type { Period };
export { VALID_PERIODS };

// ─── Types ───────────────────────────────────────────────────────────────────
export type SortCol = "cost" | "tokens" | "days" | "streak";
export type SortOrder = "asc" | "desc";

export const VALID_SORTS: SortCol[] = ["cost", "tokens", "days", "streak"];
export const VALID_ORDERS: SortOrder[] = ["asc", "desc"];

export interface DateRange {
  from: string; // ISO date "YYYY-MM-DD"
  to: string;   // ISO date "YYYY-MM-DD"
}

export interface LeaderboardRow {
  rank: number;
  userId: string;
  githubUsername: string | null;
  image: string | null;
  totalCost: string; // decimal as string from DB
  totalTokens: number;
  activeDays: number;
  currentStreak: number;
  rankDelta: number | null; // null = NEW, 0 = unchanged, positive = moved up, negative = moved down
  cookingUrl: string | null;
  cookingLabel: string | null;
}

export interface LeaderboardResult {
  rows: LeaderboardRow[];
  totalCount: number;
}

// ─── Date range validator ────────────────────────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDateRange(
  from: string | undefined | null,
  to: string | undefined | null
): DateRange | undefined {
  if (!from || !to) return undefined;
  if (!ISO_DATE_RE.test(from) || !ISO_DATE_RE.test(to)) return undefined;

  const today = new Date().toISOString().slice(0, 10);
  if (from < MIN_DATE || to < MIN_DATE) return undefined;
  if (from > today || to > today) return undefined;
  if (from > to) return undefined;

  return { from, to };
}

// ─── Sort column mapping ─────────────────────────────────────────────────────

export const SQL_COL_MAP: Record<SortCol, string> = {
  cost: "total_cost::numeric",
  tokens: "total_tokens",
  days: "active_days",
  streak: "current_streak",
};

// ─── Date filter helper ─────────────────────────────────────────────────────

/**
 * Returns a SQL fragment for filtering `da.date` by the given period.
 * For "custom" with a valid range, uses the from/to bounds.
 * Always returns a filter (no null — "all" is gone).
 */
export function getDateFilter(
  period: Period,
  range?: DateRange
): ReturnType<typeof sql> {
  switch (period) {
    case "today":
      return sql`da.date::date = CURRENT_DATE`;
    case "7d":
      return sql`da.date::date >= CURRENT_DATE - 6`;
    case "30d":
      return sql`da.date::date >= CURRENT_DATE - 29`;
    case "this-month":
      return sql`da.date::date >= date_trunc('month', CURRENT_DATE)::date`;
    case "ytd":
      return sql`da.date::date >= date_trunc('year', CURRENT_DATE)::date`;
    case "custom":
      if (range) {
        return sql`da.date::date >= ${range.from}::date AND da.date::date <= ${range.to}::date`;
      }
      // Fallback to 30d if no valid range
      return sql`da.date::date >= CURRENT_DATE - 29`;
  }
}

// ─── Shared SQL CTEs ────────────────────────────────────────────────────────

/**
 * Builds the common CTE chain used by both getLeaderboardData and
 * getUserLeaderboardRow: filtered aggregates + streak computation.
 */
function buildLeaderboardCTEs(dateFilter: ReturnType<typeof sql>) {
  return sql`
    WITH filtered AS (
      SELECT
        u.id AS user_id,
        u.github_username,
        u.image,
        u.cooking_url,
        u.cooking_label,
        COALESCE(SUM(da.total_cost::numeric), 0)::text AS total_cost,
        COALESCE(SUM(da.input_tokens + da.output_tokens + da.cache_creation_tokens + da.cache_read_tokens), 0) AS total_tokens,
        COUNT(DISTINCT da.date)::int AS active_days
      FROM users u
      LEFT JOIN daily_aggregates da ON da.user_id = u.id AND ${dateFilter}
      GROUP BY u.id, u.github_username, u.image, u.cooking_url, u.cooking_label
    ),
    streak_days AS (
      SELECT DISTINCT user_id, date::date AS d
      FROM daily_aggregates
    ),
    streak_groups AS (
      SELECT
        user_id,
        d,
        d - (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY d))::int AS grp
      FROM streak_days
    ),
    streak_lengths AS (
      SELECT
        user_id,
        grp,
        COUNT(*) AS streak_len,
        MAX(d) AS streak_end
      FROM streak_groups
      GROUP BY user_id, grp
    ),
    current_streaks AS (
      SELECT
        user_id,
        MAX(streak_len) AS current_streak
      FROM streak_lengths
      WHERE streak_end >= CURRENT_DATE - 1
      GROUP BY user_id
    )`;
}

// ─── Previous rank lookup (for movement indicators) ─────────────────────────

export async function getPreviousRanks(): Promise<Map<string, number>> {
  const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

  try {
    const result = await db.execute(sql`
      SELECT user_id, rank FROM rank_snapshots
      WHERE snapshot_date = (
        SELECT MAX(snapshot_date) FROM rank_snapshots WHERE snapshot_date < ${today}
      )
    `);
    const map = new Map<string, number>();
    for (const row of result.rows) {
      map.set(row.user_id as string, Number(row.rank));
    }
    return map;
  } catch {
    // Table may not exist yet on first run
    return new Map();
  }
}

// ─── Main query function ─────────────────────────────────────────────────────

/**
 * Fetch leaderboard data for the given time period, sort column, and order.
 * Supports pagination via limit/offset. Returns rows + totalCount.
 */
export async function getLeaderboardData(
  period: Period,
  sortBy: SortCol,
  order: SortOrder,
  range?: DateRange,
  limit = 100,
  offset = 0
): Promise<LeaderboardResult> {
  const colName = SQL_COL_MAP[sortBy];
  const direction = order === "desc" ? "DESC" : "ASC";

  const dateFilter = getDateFilter(period, range);
  const ctes = buildLeaderboardCTEs(dateFilter);

  const [result, previousRanks] = await Promise.all([
    db.execute(sql`
      ${ctes}
      SELECT
        f.user_id,
        f.github_username,
        f.image,
        f.cooking_url,
        f.cooking_label,
        f.total_cost,
        f.total_tokens,
        f.active_days::int,
        COALESCE(cs.current_streak, 0)::int AS current_streak,
        COUNT(*) OVER() AS total_count
      FROM filtered f
      LEFT JOIN current_streaks cs ON cs.user_id = f.user_id
      ORDER BY ${sql.raw(colName)} ${sql.raw(direction)}
      LIMIT ${limit} OFFSET ${offset}
    `),
    getPreviousRanks(),
  ]);

  const rawRows = result.rows as unknown as RawRowWithCount[];
  const totalCount = rawRows.length > 0 ? Number(rawRows[0].total_count) : 0;

  return {
    rows: mapRawRows(rawRows, previousRanks, offset),
    totalCount,
  };
}

// ─── Single user query ──────────────────────────────────────────────────────

/**
 * Find a specific user's row with rank computed over the full leaderboard.
 * Used when the user falls outside the initial page of results.
 */
export async function getUserLeaderboardRow(
  userId: string,
  period: Period,
  sortBy: SortCol,
  order: SortOrder,
  range?: DateRange
): Promise<LeaderboardRow | null> {
  const colName = SQL_COL_MAP[sortBy];
  const direction = order === "desc" ? "DESC" : "ASC";

  const dateFilter = getDateFilter(period, range);
  const ctes = buildLeaderboardCTEs(dateFilter);

  const [result, previousRanks] = await Promise.all([
    db.execute(sql`
      ${ctes},
      ranked AS (
        SELECT
          f.user_id,
          f.github_username,
          f.image,
          f.cooking_url,
          f.cooking_label,
          f.total_cost,
          f.total_tokens,
          f.active_days::int,
          COALESCE(cs.current_streak, 0)::int AS current_streak,
          ROW_NUMBER() OVER (ORDER BY ${sql.raw(colName)} ${sql.raw(direction)}) AS rank
        FROM filtered f
        LEFT JOIN current_streaks cs ON cs.user_id = f.user_id
      )
      SELECT * FROM ranked WHERE user_id = ${userId}
    `),
    getPreviousRanks(),
  ]);

  if (result.rows.length === 0) return null;

  const raw = result.rows[0] as unknown as RawRowWithRank;
  const rank = Number(raw.rank);

  return mapSingleRow(raw, rank, previousRanks);
}

export interface RawRow {
  user_id: string;
  github_username: string | null;
  image: string | null;
  cooking_url: string | null;
  cooking_label: string | null;
  total_cost: string | null;
  total_tokens: string | number | null;
  active_days: string | number | null;
  current_streak: string | number | null;
}

interface RawRowWithCount extends RawRow {
  total_count: string | number;
}

interface RawRowWithRank extends RawRow {
  rank: string | number;
}

export function mapSingleRow(
  row: RawRow,
  rank: number,
  previousRanks?: Map<string, number>
): LeaderboardRow {
  const prevRank = previousRanks?.get(row.user_id);
  return {
    rank,
    userId: row.user_id,
    githubUsername: row.github_username ?? null,
    image: row.image ?? null,
    totalCost: row.total_cost ?? "0",
    totalTokens: Number(row.total_tokens ?? 0),
    activeDays: Number(row.active_days ?? 0),
    currentStreak: Number(row.current_streak ?? 0),
    rankDelta:
      previousRanks !== undefined && prevRank !== undefined
        ? prevRank - rank
        : null,
    cookingUrl: row.cooking_url ?? null,
    cookingLabel: row.cooking_label ?? null,
  };
}

// ─── Vibe coder count ─────────────────────────────────────────────────────

export async function getVibeCoderCount(): Promise<number> {
  const result = await db.execute(
    sql`SELECT COUNT(*)::int AS count FROM users`
  );
  return Number(result.rows[0]?.count ?? 0);
}

// ─── Row mapping ─────────────────────────────────────────────────────────────

export function mapRawRows(
  rows: RawRow[],
  previousRanks?: Map<string, number>,
  offset = 0
): LeaderboardRow[] {
  return rows.map((row, i) => mapSingleRow(row, offset + i + 1, previousRanks));
}
