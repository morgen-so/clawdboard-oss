import "server-only";

import { db, executeRows } from "@/lib/db";
import { teams, teamMembers, users } from "./schema";
import { eq, and, isNull, sql, count } from "drizzle-orm";
import { getDateFilter, SQL_COL_MAP, getPreviousRanks, mapRawRows } from "./leaderboard";
import type { Period, SortCol, SortOrder, LeaderboardRow, DateRange, RawRow } from "./leaderboard";
import crypto from "crypto";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TeamLeaderboardRow {
  rank: number;
  teamId: string;
  teamName: string;
  teamSlug: string;
  activeMembers: number;
  totalCost: string;
  totalTokens: number;
  cookingUrl: string | null;
  cookingLabel: string | null;
}

// ─── Slug generation ────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

export async function generateUniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  if (!base) {
    // Fallback for names that produce empty slugs (e.g., all special characters)
    return `team-${crypto.randomBytes(3).toString("hex")}`;
  }

  const existing = await db
    .select({ slug: teams.slug })
    .from(teams)
    .where(sql`${teams.slug} = ${base} OR ${teams.slug} LIKE ${base + "-%"}`)
    .limit(1);

  if (existing.length === 0) return base;

  const suffix = crypto.randomBytes(3).toString("hex"); // 6 chars
  return `${base}-${suffix}`;
}

// ─── Team lookups ───────────────────────────────────────────────────────────

export async function getTeamBySlug(
  slug: string
): Promise<typeof teams.$inferSelect | null> {
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.slug, slug), isNull(teams.deletedAt)))
    .limit(1);
  return team ?? null;
}

export async function getTeamMembership(
  teamId: string,
  userId: string
): Promise<{ role: string } | null> {
  const [membership] = await db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.teamId, teamId),
        eq(teamMembers.userId, userId),
        eq(teamMembers.status, "active"),
        isNull(teamMembers.leftAt)
      )
    )
    .limit(1);
  return membership ?? null;
}

export async function getUserTeams(
  userId: string
): Promise<
  Array<{
    teamId: string;
    teamName: string;
    teamSlug: string;
    role: string;
    inviteToken: string;
    isLocked: boolean;
  }>
> {
  const rows = await db
    .select({
      teamId: teams.id,
      teamName: teams.name,
      teamSlug: teams.slug,
      role: teamMembers.role,
      inviteToken: teams.inviteToken,
      isLocked: teams.isLocked,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(
      and(
        eq(teamMembers.userId, userId),
        isNull(teamMembers.leftAt),
        isNull(teams.deletedAt)
      )
    );
  return rows.map((r) => ({ ...r, isLocked: r.isLocked ?? false }));
}

export async function getTeamMembers(
  teamId: string
): Promise<
  Array<{
    userId: string;
    githubUsername: string | null;
    image: string | null;
    role: string;
    status: string;
    joinedAt: Date | null;
    leftAt: Date | null;
  }>
> {
  return db
    .select({
      userId: teamMembers.userId,
      githubUsername: users.githubUsername,
      image: users.image,
      role: teamMembers.role,
      status: teamMembers.status,
      joinedAt: teamMembers.joinedAt,
      leftAt: teamMembers.leftAt,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teamMembers.teamId, teamId));
}

export async function getActiveOwnerCount(teamId: string): Promise<number> {
  const [result] = await db
    .select({ count: count() })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.teamId, teamId),
        eq(teamMembers.role, "owner"),
        isNull(teamMembers.leftAt)
      )
    );
  return result?.count ?? 0;
}

export async function getActiveMemberCount(teamId: string): Promise<number> {
  const [result] = await db
    .select({ count: count() })
    .from(teamMembers)
    .where(
      and(eq(teamMembers.teamId, teamId), isNull(teamMembers.leftAt))
    );
  return result?.count ?? 0;
}

// ─── Public team affiliations ────────────────────────────────────────────────

export async function getUserPublicTeams(
  userId: string
): Promise<Array<{ teamName: string; teamSlug: string }>> {
  const rows = await db
    .select({
      teamName: teams.name,
      teamSlug: teams.slug,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(
      and(
        eq(teamMembers.userId, userId),
        isNull(teamMembers.leftAt),
        isNull(teams.deletedAt),
        eq(teams.isPublic, true)
      )
    );
  return rows;
}

// ─── Team-scoped leaderboard ────────────────────────────────────────────────

export async function getTeamLeaderboardData(
  teamId: string,
  period: Period,
  sortBy: SortCol,
  order: SortOrder,
  range?: DateRange
): Promise<LeaderboardRow[]> {
  const colName = SQL_COL_MAP[sortBy];
  const direction = order === "desc" ? "DESC" : "ASC";

  const [rows, globalPrevRanks] = await Promise.all([
    executeRows<RawRow>(sql`
      WITH team_contributions AS (
        SELECT
          da.user_id,
          u.github_username,
          u.image,
          u.cooking_url,
          u.cooking_label,
          SUM(da.total_cost::numeric)::text AS total_cost,
          SUM(da.input_tokens + da.output_tokens + da.cache_creation_tokens + da.cache_read_tokens) AS total_tokens,
          COUNT(DISTINCT da.date) AS active_days
        FROM daily_aggregates da
        JOIN team_members tm ON tm.user_id = da.user_id
          AND tm.team_id = ${teamId}
          AND tm.left_at IS NULL
        JOIN users u ON u.id = da.user_id
        WHERE ${getDateFilter(period, range)}
        GROUP BY da.user_id, u.github_username, u.image, u.cooking_url, u.cooking_label
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
      )
      SELECT
        tc.user_id,
        tc.github_username,
        tc.image,
        tc.cooking_url,
        tc.cooking_label,
        tc.total_cost,
        tc.total_tokens,
        tc.active_days::int,
        COALESCE(cs.current_streak, 0)::int AS current_streak
      FROM team_contributions tc
      LEFT JOIN current_streaks cs ON cs.user_id = tc.user_id
      ORDER BY ${sql.raw(colName)} ${sql.raw(direction)}
    `),
    getPreviousRanks(),
  ]);

  // Derive previous team-internal ranking from global rank snapshots:
  // sort team members by their previous global rank to get previous positions.
  const membersByPrevRank = rows
    .filter((r) => globalPrevRanks.has(r.user_id))
    .sort(
      (a, b) =>
        (globalPrevRanks.get(a.user_id) ?? Infinity) -
        (globalPrevRanks.get(b.user_id) ?? Infinity)
    );
  const prevTeamRank = new Map<string, number>();
  membersByPrevRank.forEach((r, i) => prevTeamRank.set(r.user_id, i + 1));

  return mapRawRows(rows, prevTeamRank);
}

// ─── Public team leaderboard ────────────────────────────────────────────────

type PublicTeamRow = {
  team_id: string;
  team_name: string;
  team_slug: string;
  cooking_url: string | null;
  cooking_label: string | null;
  active_members: string | number;
  total_cost: string | null;
  total_tokens: string | number | null;
};

export async function getPublicTeamLeaderboard(
  period: Period,
  range?: DateRange
): Promise<TeamLeaderboardRow[]> {
  const dateFilter = sql`AND ${getDateFilter(period, range)}`;

  const rows = await executeRows<PublicTeamRow>(sql`
    WITH member_counts AS (
      SELECT team_id, COUNT(*) AS cnt
      FROM team_members
      WHERE left_at IS NULL
      GROUP BY team_id
    ),
    team_stats AS (
      SELECT
        t.id AS team_id,
        t.name AS team_name,
        t.slug AS team_slug,
        t.cooking_url,
        t.cooking_label,
        mc.cnt AS active_members,
        SUM(da.total_cost::numeric)::text AS total_cost,
        SUM(da.input_tokens + da.output_tokens + da.cache_creation_tokens + da.cache_read_tokens) AS total_tokens
      FROM teams t
      JOIN member_counts mc ON mc.team_id = t.id
      JOIN team_members tm ON tm.team_id = t.id
        AND tm.left_at IS NULL
      JOIN daily_aggregates da ON da.user_id = tm.user_id
      WHERE t.is_public = true
        AND t.deleted_at IS NULL
        ${dateFilter}
      GROUP BY t.id, t.name, t.slug, t.cooking_url, t.cooking_label, mc.cnt
    )
    SELECT * FROM team_stats
    ORDER BY total_cost::numeric DESC
  `);

  return rows.map((row, i) => ({
    rank: i + 1,
    teamId: row.team_id,
    teamName: row.team_name,
    teamSlug: row.team_slug,
    activeMembers: Number(row.active_members),
    totalCost: row.total_cost ?? "0",
    totalTokens: Number(row.total_tokens ?? 0),
    cookingUrl: row.cooking_url ?? null,
    cookingLabel: row.cooking_label ?? null,
  }));
}

// ─── Team stats ─────────────────────────────────────────────────────────────

export async function getTeamStats(
  teamId: string,
  period?: Period,
  range?: DateRange
): Promise<{
  totalCost: string;
  totalTokens: number;
  activeDays: number;
  memberCount: number;
}> {
  const dateFilter = period
    ? getDateFilter(period, range)
    : sql`TRUE`;

  const [statsResult, memberResult] = await Promise.all([
    db.execute(sql`
      SELECT
        COALESCE(SUM(da.total_cost::numeric), 0)::text AS total_cost,
        COALESCE(SUM(da.input_tokens + da.output_tokens + da.cache_creation_tokens + da.cache_read_tokens), 0) AS total_tokens,
        COUNT(DISTINCT da.date) AS active_days
      FROM daily_aggregates da
      JOIN team_members tm ON tm.user_id = da.user_id
        AND tm.team_id = ${teamId}
        AND tm.left_at IS NULL
      WHERE ${dateFilter}
    `),
    db
      .select({ count: count() })
      .from(teamMembers)
      .where(
        and(eq(teamMembers.teamId, teamId), isNull(teamMembers.leftAt))
      ),
  ]);

  const stats = statsResult.rows[0] as {
    total_cost: string;
    total_tokens: string | number;
    active_days: string | number;
  } | undefined;

  return {
    totalCost: stats?.total_cost ?? "0",
    totalTokens: Number(stats?.total_tokens ?? 0),
    activeDays: Number(stats?.active_days ?? 0),
    memberCount: memberResult[0]?.count ?? 0,
  };
}

