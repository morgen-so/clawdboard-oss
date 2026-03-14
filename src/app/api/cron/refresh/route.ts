import { NextRequest, NextResponse } from "next/server";
import { revalidateAllCaches } from "@/lib/db/cached";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sql } from "drizzle-orm";

import { rateLimit } from "@/lib/rate-limit";
import { timingSafeEqual } from "crypto";

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { key: "cron-refresh", limit: 2 });
  if (limited) return limited;

  try {
    // Verify CRON_SECRET if set (skip in local dev where it's not configured)
    const cronSecret = env.CRON_SECRET;
    if (cronSecret) {
      const authorization = req.headers.get("authorization");
      const token = authorization?.startsWith("Bearer ")
        ? authorization.slice(7)
        : null;
      if (
        !token ||
        token.length !== cronSecret.length ||
        !timingSafeEqual(Buffer.from(token), Buffer.from(cronSecret))
      ) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    // Ensure source column exists on daily_aggregates (idempotent migration)
    await db.execute(sql`
      ALTER TABLE daily_aggregates ADD COLUMN IF NOT EXISTS source TEXT
    `);
    await db.execute(sql`
      DROP INDEX IF EXISTS daily_user_date_idx
    `);

    // Deduplicate NULL-source rows: PostgreSQL treats NULLs as distinct in
    // unique indexes, so the old index allowed multiple rows with the same
    // (user_id, date, NULL). Keep only the most recently synced row per
    // (user_id, date, source) combo, delete the rest.
    const deduped = await db.execute(sql`
      DELETE FROM daily_aggregates da
      WHERE da.id NOT IN (
        SELECT DISTINCT ON (user_id, date, COALESCE(source, ''))
               id
        FROM daily_aggregates
        ORDER BY user_id, date, COALESCE(source, ''), synced_at DESC NULLS LAST
      )
    `);

    // Recreate unique index with NULLS NOT DISTINCT (PostgreSQL 15+) so
    // NULL source values are treated as equal, preventing future duplicates.
    await db.execute(sql`
      DROP INDEX IF EXISTS daily_user_date_source_idx
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX daily_user_date_source_idx
      ON daily_aggregates (user_id, date, source) NULLS NOT DISTINCT
    `);

    // Recreate the materialized view (drop first to pick up schema changes)
    await db.execute(sql`DROP MATERIALIZED VIEW IF EXISTS leaderboard_mv`);
    await db.execute(sql`
      CREATE MATERIALIZED VIEW leaderboard_mv AS
      WITH user_totals AS (
        SELECT
          u.id AS user_id,
          u.github_username,
          u.image,
          COALESCE(SUM(da.total_cost::numeric), 0) AS total_cost,
          COALESCE(SUM(da.input_tokens + da.output_tokens + da.cache_creation_tokens + da.cache_read_tokens), 0) AS total_tokens,
          COUNT(DISTINCT da.date) AS active_days
        FROM users u
        LEFT JOIN daily_aggregates da ON da.user_id = u.id
        GROUP BY u.id, u.github_username, u.image
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
        ut.user_id,
        ut.github_username,
        ut.image,
        ut.total_cost,
        ut.total_tokens,
        ut.active_days::int,
        COALESCE(cs.current_streak, 0)::int AS current_streak
      FROM user_totals ut
      LEFT JOIN current_streaks cs ON cs.user_id = ut.user_id
      WITH DATA
    `);

    // Create unique index required for CONCURRENTLY refresh
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_mv_user_id_idx
      ON leaderboard_mv (user_id)
    `);

    // Ensure rank_snapshots table exists (idempotent — first run creates it)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS rank_snapshots (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rank INTEGER NOT NULL,
        snapshot_date TEXT NOT NULL,
        captured_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS rank_snapshot_user_date_idx
      ON rank_snapshots (user_id, snapshot_date)
    `);

    // Ensure teams tables exist (idempotent -- first run creates them)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        invite_token TEXT NOT NULL,
        is_public BOOLEAN DEFAULT TRUE,
        is_locked BOOLEAN DEFAULT FALSE,
        created_by TEXT NOT NULL REFERENCES users(id),
        deleted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS team_members (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'member',
        joined_at TIMESTAMPTZ DEFAULT NOW(),
        left_at TIMESTAMPTZ
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS active_team_member_idx
      ON team_members (team_id, user_id) WHERE left_at IS NULL
    `);

    // Ensure user_github_orgs table and column exist (idempotent)
    await db.execute(sql`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS github_orgs_fetched_at TIMESTAMPTZ
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_github_orgs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        org_login TEXT NOT NULL,
        org_id TEXT NOT NULL,
        org_avatar_url TEXT,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS user_org_login_idx
      ON user_github_orgs (user_id, org_login)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS org_login_idx
      ON user_github_orgs (org_login)
    `);

    // Ensure recaps table exists (idempotent — first run creates it)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS recaps (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        data JSONB NOT NULL,
        seen_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS recap_user_type_period_idx
      ON recaps (user_id, type, period_start)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS recap_user_unseen_idx
      ON recaps (user_id, seen_at)
    `);

    // No separate refresh needed — view is recreated with fresh data above

    // Capture rank snapshots from the refreshed materialized view (single batch)
    const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
    const result = await db.execute(sql`
      INSERT INTO rank_snapshots (id, user_id, rank, snapshot_date)
      SELECT gen_random_uuid(), user_id,
             ROW_NUMBER() OVER (ORDER BY total_cost DESC),
             ${today}
      FROM leaderboard_mv
      ON CONFLICT (user_id, snapshot_date)
      DO UPDATE SET rank = EXCLUDED.rank, captured_at = NOW()
    `);
    const snapshotsCaptured = result.rowCount ?? 0;

    // Invalidate all unstable_cache entries so the next page visit
    // picks up the freshly rebuilt materialized view. Done before cleanup
    // so caches are fresh even if the cleanup queries below fail.
    revalidateAllCaches();

    // Reset earned badges when duplicates were cleaned up so badges get
    // recomputed from corrected data on next profile visit. Badge computation
    // sets isFirstComputation=true when earnedBadges is empty, which
    // suppresses the unlock modal — so users won't get spammed.
    let badgesReset = 0;
    const dedupedCount = deduped.rowCount ?? 0;
    if (dedupedCount > 0) {
      const resetResult = await db.execute(sql`
        UPDATE users SET earned_badges = '[]'::jsonb
        WHERE earned_badges IS NOT NULL
          AND earned_badges != '[]'::jsonb
      `);
      badgesReset = resetResult.rowCount ?? 0;
    }

    // Data retention cleanup
    const expiredCodes = await db.execute(sql`
      DELETE FROM device_codes WHERE expires_at < NOW()
    `);
    const oldVisits = await db.execute(sql`
      DELETE FROM page_visits WHERE visited_at < NOW() - INTERVAL '90 days'
    `);

    return NextResponse.json({
      ok: true,
      refreshedAt: new Date().toISOString(),
      snapshotsCaptured,
      cleanup: {
        duplicateRowsRemoved: dedupedCount,
        badgesReset,
        expiredDeviceCodes: expiredCodes.rowCount ?? 0,
        oldPageVisits: oldVisits.rowCount ?? 0,
      },
    });
  } catch (error) {
    console.error("[cron/refresh] Error refreshing leaderboard_mv:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
