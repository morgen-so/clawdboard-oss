import "server-only";

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import type { RecapData } from "@/lib/db/schema";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RawUserRecap {
  user_id: string;
  rank: number;
  total_users: number;
  total_cost: string;
  total_tokens: string;
  active_days: number;
  peak_day: string | null;
  peak_day_cost: string | null;
  current_streak: number;
}

interface RawModelRow {
  user_id: string;
  model_name: string;
  model_cost: string;
}

interface RawRivalRow {
  user_id: string;
  rival_user_id: string;
  rival_username: string | null;
  rival_image: string | null;
  rival_cost: string;
  rival_rank: number;
}

// ─── Friendly model names ───────────────────────────────────────────────────

const MODEL_NAME_RE = /^claude-([a-z]+)-(\d+)(?:-(\d))?(?:-\d{6,})?$/;
const MODEL_NAME_LEGACY_RE = /^claude-(\d+)(?:-(\d))?-([a-z]+)(?:-\d{6,})?$/;

function friendlyModelName(raw: string): string {
  const m = raw.match(MODEL_NAME_RE);
  if (m) {
    const family = m[1].charAt(0).toUpperCase() + m[1].slice(1);
    const version = m[3] ? `${m[2]}.${m[3]}` : m[2];
    return `${family} ${version}`;
  }
  const legacy = raw.match(MODEL_NAME_LEGACY_RE);
  if (legacy) {
    const version = legacy[2] ? `${legacy[1]}.${legacy[2]}` : legacy[1];
    const family = legacy[3].charAt(0).toUpperCase() + legacy[3].slice(1);
    return `${family} ${version}`;
  }
  return raw;
}

// ─── Day of week helper ─────────────────────────────────────────────────────

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function getDayLabel(dateStr: string, type: "weekly" | "monthly"): string {
  const d = new Date(dateStr + "T12:00:00Z");
  if (type === "weekly") {
    return DAY_NAMES[d.getUTCDay()];
  }
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// ─── State tier computation ─────────────────────────────────────────────────

function computeStateTier(
  activeDays: number,
  rank: number,
  totalUsers: number
): RecapData["stateTier"] {
  if (activeDays === 0) return "empty";
  if (rank <= 3) return "podium";
  if (rank <= 10) return "top10";
  const percentile = ((totalUsers - rank) / totalUsers) * 100;
  if (percentile >= 90) return "top10pct";
  if (percentile < 50) return "low";
  return "normal";
}

// ─── Main generation function ───────────────────────────────────────────────

/**
 * Generate recap data for all users with activity in the period.
 * Returns the number of recaps generated.
 */
export async function generateAllRecaps(
  type: "weekly" | "monthly",
  periodStart: string,
  periodEnd: string,
  prevPeriodStart: string,
  prevPeriodEnd: string
): Promise<number> {
  // 1. Compute current period stats + rank for all users in one query
  const currentStats = await db.execute(sql`
    WITH period_totals AS (
      SELECT
        u.id AS user_id,
        COALESCE(SUM(da.total_cost::numeric), 0) AS total_cost,
        COALESCE(SUM(da.input_tokens + da.output_tokens + da.cache_creation_tokens + da.cache_read_tokens), 0) AS total_tokens,
        COUNT(DISTINCT da.date)::int AS active_days
      FROM users u
      LEFT JOIN daily_aggregates da
        ON da.user_id = u.id
        AND da.date::date >= ${periodStart}::date
        AND da.date::date <= ${periodEnd}::date
      GROUP BY u.id
    ),
    ranked AS (
      SELECT
        user_id,
        total_cost,
        total_tokens,
        active_days,
        ROW_NUMBER() OVER (ORDER BY total_cost DESC) AS rank,
        COUNT(*) OVER() AS total_users
      FROM period_totals
    )
    SELECT user_id, rank::int, total_users::int, total_cost::text, total_tokens::text, active_days
    FROM ranked
  `);

  if (currentStats.rows.length === 0) return 0;

  const statsMap = new Map<string, RawUserRecap>();
  for (const row of currentStats.rows) {
    statsMap.set(row.user_id as string, {
      user_id: row.user_id as string,
      rank: Number(row.rank),
      total_users: Number(row.total_users),
      total_cost: row.total_cost as string,
      total_tokens: row.total_tokens as string,
      active_days: Number(row.active_days),
      peak_day: null,
      peak_day_cost: null,
      current_streak: 0,
    });
  }

  // 2. Get peak day per user
  const peakDays = await db.execute(sql`
    SELECT DISTINCT ON (user_id)
      user_id,
      date AS peak_day,
      total_cost::text AS peak_day_cost
    FROM daily_aggregates
    WHERE date::date >= ${periodStart}::date AND date::date <= ${periodEnd}::date
    ORDER BY user_id, total_cost::numeric DESC
  `);

  for (const row of peakDays.rows) {
    const stat = statsMap.get(row.user_id as string);
    if (stat) {
      stat.peak_day = row.peak_day as string;
      stat.peak_day_cost = row.peak_day_cost as string;
    }
  }

  // 3. Get current streaks (reuse the same window function pattern from leaderboard_mv)
  const streaks = await db.execute(sql`
    WITH streak_days AS (
      SELECT DISTINCT user_id, date::date AS d
      FROM daily_aggregates
    ),
    streak_groups AS (
      SELECT user_id, d,
        d - (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY d))::int AS grp
      FROM streak_days
    ),
    streak_lengths AS (
      SELECT user_id, grp, COUNT(*) AS streak_len, MAX(d) AS streak_end
      FROM streak_groups
      GROUP BY user_id, grp
    ),
    current_streaks AS (
      SELECT user_id, MAX(streak_len)::int AS current_streak
      FROM streak_lengths
      WHERE streak_end >= CURRENT_DATE - 1
      GROUP BY user_id
    )
    SELECT user_id, current_streak FROM current_streaks
  `);

  for (const row of streaks.rows) {
    const stat = statsMap.get(row.user_id as string);
    if (stat) {
      stat.current_streak = Number(row.current_streak);
    }
  }

  // 4. Get previous period stats for deltas
  const prevStats = await db.execute(sql`
    SELECT
      user_id,
      COALESCE(SUM(total_cost::numeric), 0)::text AS total_cost,
      COALESCE(SUM(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens), 0)::text AS total_tokens
    FROM daily_aggregates
    WHERE date::date >= ${prevPeriodStart}::date AND date::date <= ${prevPeriodEnd}::date
    GROUP BY user_id
  `);

  const prevMap = new Map<string, { cost: number; tokens: number }>();
  for (const row of prevStats.rows) {
    prevMap.set(row.user_id as string, {
      cost: parseFloat(row.total_cost as string),
      tokens: Number(row.total_tokens),
    });
  }

  // 5. Get previous period ranks
  const prevRanks = await db.execute(sql`
    WITH prev_totals AS (
      SELECT
        user_id,
        COALESCE(SUM(total_cost::numeric), 0) AS total_cost
      FROM daily_aggregates
      WHERE date::date >= ${prevPeriodStart}::date AND date::date <= ${prevPeriodEnd}::date
      GROUP BY user_id
    )
    SELECT user_id, ROW_NUMBER() OVER (ORDER BY total_cost DESC)::int AS rank
    FROM prev_totals
  `);

  const prevRankMap = new Map<string, number>();
  for (const row of prevRanks.rows) {
    prevRankMap.set(row.user_id as string, Number(row.rank));
  }

  // 6. Get model breakdowns per user
  const modelRows = await db.execute(sql`
    SELECT
      da.user_id,
      elem->>'modelName' AS model_name,
      SUM((elem->>'cost')::numeric)::text AS model_cost
    FROM daily_aggregates da,
      jsonb_array_elements(da.model_breakdowns) AS elem
    WHERE da.date::date >= ${periodStart}::date AND da.date::date <= ${periodEnd}::date
    GROUP BY da.user_id, elem->>'modelName'
    ORDER BY da.user_id, SUM((elem->>'cost')::numeric) DESC
  `);

  const modelMap = new Map<string, RawModelRow[]>();
  for (const row of modelRows.rows) {
    const uid = row.user_id as string;
    if (!modelMap.has(uid)) modelMap.set(uid, []);
    modelMap.get(uid)!.push({
      user_id: uid,
      model_name: row.model_name as string,
      model_cost: row.model_cost as string,
    });
  }

  // 7. Get rival (user ranked one above) for each user
  const rivals = await db.execute(sql`
    WITH period_totals AS (
      SELECT
        u.id AS user_id,
        u.github_username,
        u.image,
        COALESCE(SUM(da.total_cost::numeric), 0) AS total_cost
      FROM users u
      LEFT JOIN daily_aggregates da
        ON da.user_id = u.id
        AND da.date::date >= ${periodStart}::date
        AND da.date::date <= ${periodEnd}::date
      GROUP BY u.id, u.github_username, u.image
    ),
    ranked AS (
      SELECT
        user_id, github_username, image, total_cost,
        ROW_NUMBER() OVER (ORDER BY total_cost DESC) AS rank
      FROM period_totals
    )
    SELECT
      r.user_id,
      rival.user_id AS rival_user_id,
      rival.github_username AS rival_username,
      rival.image AS rival_image,
      rival.total_cost::text AS rival_cost,
      rival.rank::int AS rival_rank
    FROM ranked r
    JOIN ranked rival ON rival.rank = r.rank - 1
    WHERE r.rank > 1
  `);

  const rivalMap = new Map<string, RawRivalRow>();
  for (const row of rivals.rows) {
    rivalMap.set(row.user_id as string, {
      user_id: row.user_id as string,
      rival_user_id: row.rival_user_id as string,
      rival_username: row.rival_username as string | null,
      rival_image: row.rival_image as string | null,
      rival_cost: row.rival_cost as string,
      rival_rank: Number(row.rival_rank),
    });
  }

  // 8. Build RecapData for each user and upsert
  const periodStartDate = new Date(periodStart + "T00:00:00Z");
  const periodEndDate = new Date(periodEnd + "T00:00:00Z");
  const totalDays =
    Math.floor(
      (periodEndDate.getTime() - periodStartDate.getTime()) / (1000 * 60 * 60 * 24)
    ) + 1;
  let count = 0;

  for (const [userId, stat] of statsMap) {
    const totalCost = parseFloat(stat.total_cost);
    const totalTokens = Number(stat.total_tokens);
    const prev = prevMap.get(userId);
    const rival = rivalMap.get(userId);
    const models = modelMap.get(userId) ?? [];

    // Compute model breakdown with percentages
    const totalModelCost = models.reduce(
      (sum, m) => sum + parseFloat(m.model_cost),
      0
    );
    const modelBreakdown = models.map((m) => ({
      name: friendlyModelName(m.model_name),
      cost: parseFloat(m.model_cost),
      percentage:
        totalModelCost > 0
          ? Math.round((parseFloat(m.model_cost) / totalModelCost) * 1000) / 10
          : 0,
    }));

    const topModel =
      modelBreakdown.length > 0
        ? { name: modelBreakdown[0].name, percentage: modelBreakdown[0].percentage }
        : null;

    const percentile =
      stat.total_users <= 1
        ? 100
        : Math.round(
            ((stat.total_users - stat.rank) / stat.total_users) * 1000
          ) / 10;

    const rivalGap = rival
      ? parseFloat(rival.rival_cost) - totalCost
      : null;

    const data: RecapData = {
      rank: stat.rank,
      previousRank: prevRankMap.get(userId) ?? null,
      totalUsers: stat.total_users,
      percentile,
      totalCost,
      costDelta: prev ? totalCost - prev.cost : null,
      totalTokens,
      tokensDelta: prev ? totalTokens - prev.tokens : null,
      activeDays: stat.active_days,
      totalDays,
      currentStreak: stat.current_streak,
      peakDay: stat.peak_day,
      peakDayLabel: stat.peak_day
        ? getDayLabel(stat.peak_day, type)
        : "N/A",
      peakDayCost: stat.peak_day_cost ? parseFloat(stat.peak_day_cost) : 0,
      topModel,
      modelBreakdown,
      stateTier: computeStateTier(
        stat.active_days,
        stat.rank,
        stat.total_users
      ),
      rivalUsername: rival?.rival_username ?? null,
      rivalImage: rival?.rival_image ?? null,
      rivalGap,
      rivalRank: rival?.rival_rank ?? null,
    };

    // Upsert — idempotent by (user_id, type, period_start)
    await db.execute(sql`
      INSERT INTO recaps (id, user_id, type, period_start, period_end, data)
      VALUES (gen_random_uuid(), ${userId}, ${type}, ${periodStart}, ${periodEnd}, ${JSON.stringify(data)}::jsonb)
      ON CONFLICT (user_id, type, period_start)
      DO UPDATE SET data = EXCLUDED.data, period_end = EXCLUDED.period_end, created_at = NOW()
    `);
    count++;
  }

  return count;
}
