import { NextRequest, NextResponse } from "next/server";
import { revalidateAllCaches } from "@/lib/db/cached";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

import { rateLimit } from "@/lib/rate-limit";
import { verifyCronSecret } from "@/lib/api-auth";
import { recomputeAllStreaks } from "@/lib/db/streak-state";

// This route does schema work, rebuilds the materialized view and refolds
// every user's streak, so it needs more than the default function timeout.
// A timeout on the first run after a deploy would leave user_streaks empty,
// and every user reading as a 0 streak until a later tick got through.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { key: "cron-refresh", limit: 2 });
  if (limited) return limited;

  try {
    // Verify CRON_SECRET if set (skip in local dev where it's not configured)
    const unauthorized = verifyCronSecret(req);
    if (unauthorized) return unauthorized;

    // Ensure source and machine_id columns exist on daily_aggregates (idempotent migration)
    await db.execute(sql`
      ALTER TABLE daily_aggregates ADD COLUMN IF NOT EXISTS source TEXT
    `);
    await db.execute(sql`
      ALTER TABLE daily_aggregates ADD COLUMN IF NOT EXISTS machine_id TEXT
    `);
    await db.execute(sql`
      DROP INDEX IF EXISTS daily_user_date_idx
    `);

    // Deduplicate rows: keep only the most recently synced row per
    // (user_id, date, source, machine_id) combo, delete the rest.
    const deduped = await db.execute(sql`
      DELETE FROM daily_aggregates da
      WHERE da.id NOT IN (
        SELECT DISTINCT ON (user_id, date, COALESCE(source, ''), COALESCE(machine_id, ''))
               id
        FROM daily_aggregates
        ORDER BY user_id, date, COALESCE(source, ''), COALESCE(machine_id, ''), synced_at DESC NULLS LAST
      )
    `);

    // Drop legacy index name (one-time cleanup; no-op after first run).
    // CONCURRENTLY avoids the ACCESS EXCLUSIVE lock that would block writers
    // during the brief window the lookup is taking place.
    await db.execute(sql`
      DROP INDEX CONCURRENTLY IF EXISTS daily_user_date_source_idx
    `);

    // Ensure the unique index exists with NULLS NOT DISTINCT (PG 15+) so NULL
    // source/machine_id are treated as equal. Only migrate if the index is
    // missing or was created without NULLS NOT DISTINCT — previously this ran
    // DROP+CREATE every cron tick, which left concurrent /api/sync ON CONFLICT
    // queries without a conflict target for a moment and surfaced as 500s.
    // The pg_index lookup is scoped to daily_aggregates so a same-named index
    // on another table can't shadow the check.
    const indexStatus = await db.execute<{ indnullsnotdistinct: boolean | null }>(sql`
      SELECT i.indnullsnotdistinct
      FROM pg_class c
      JOIN pg_index i ON i.indexrelid = c.oid
      WHERE c.relname = 'daily_user_date_source_machine_idx'
        AND i.indrelid = 'daily_aggregates'::regclass
      LIMIT 1
    `);
    const existingIndex = indexStatus.rows?.[0];
    const needsIndexMigration =
      !existingIndex || existingIndex.indnullsnotdistinct !== true;
    if (needsIndexMigration) {
      // Check whether a valid _new index already exists from a previous
      // partial migration. If CREATE CONCURRENTLY succeeded but RENAME
      // failed, _new is valid and has NULLS NOT DISTINCT — dropping it
      // would briefly leave the table with no unique constraint. Reuse it.
      const newIdx = await db.execute<{
        indisvalid: boolean;
        indnullsnotdistinct: boolean;
      }>(sql`
        SELECT i.indisvalid, i.indnullsnotdistinct
        FROM pg_class c
        JOIN pg_index i ON i.indexrelid = c.oid
        WHERE c.relname = 'daily_user_date_source_machine_idx_new'
          AND i.indrelid = 'daily_aggregates'::regclass
        LIMIT 1
      `);
      const existingNew = newIdx.rows?.[0];
      const canReuseNew =
        existingNew?.indisvalid === true &&
        existingNew?.indnullsnotdistinct === true;

      if (!canReuseNew) {
        // Either no _new index or it's INVALID (from a prior failed build).
        // CONCURRENTLY avoids blocking writes during the (one-time) rebuild.
        await db.execute(sql`
          DROP INDEX CONCURRENTLY IF EXISTS daily_user_date_source_machine_idx_new
        `);
        await db.execute(sql`
          CREATE UNIQUE INDEX CONCURRENTLY daily_user_date_source_machine_idx_new
          ON daily_aggregates (user_id, date, source, machine_id) NULLS NOT DISTINCT
        `);
      }
      await db.execute(sql`
        DROP INDEX CONCURRENTLY IF EXISTS daily_user_date_source_machine_idx
      `);
      await db.execute(sql`
        ALTER INDEX daily_user_date_source_machine_idx_new
        RENAME TO daily_user_date_source_machine_idx
      `);
    }

    // Banned users' rows must not leak into community-wide aggregates (the
    // /stats pages). Rather than repeat the exclusion across ~19 stats
    // queries — several of which use LATERAL joins where an extra WHERE is
    // easy to get wrong — define it once here. A plain view, so there is
    // nothing to refresh: it always reflects the current banned_at flags.
    // CREATE OR REPLACE keeps this idempotent across cron ticks.
    await db.execute(sql`
      CREATE OR REPLACE VIEW visible_daily_aggregates AS
      SELECT da.*
      FROM daily_aggregates da
      JOIN users u ON u.id = da.user_id
      WHERE u.banned_at IS NULL
    `);

    // Rebuild every user's streak snapshot. Streaks with free passes are a
    // fold over each user's active days rather than a window function, so the
    // maths lives in TypeScript and the result is stored in user_streaks.
    // Syncs keep each user's row current; this pass backfills users who
    // haven't synced since the feature shipped and repairs rows whose
    // daily_aggregates were just deduplicated above.
    const streaksRecomputed = await recomputeAllStreaks();

    // The MV used to work streaks out itself with a window function; it now
    // reads them from user_streaks. Drop a view built from the old definition
    // so the CREATE below rebuilds it (one-time per environment). NULL means
    // there's no view yet, which the CREATE handles on its own.
    const mvShape = await db.execute<{ ok: boolean | null }>(sql`
      SELECT pg_get_viewdef(to_regclass('leaderboard_mv')) LIKE '%user_streaks%' AS ok
    `);
    if (mvShape.rows?.[0]?.ok === false) {
      await db.execute(sql`DROP MATERIALIZED VIEW IF EXISTS leaderboard_mv`);
    }

    // Create the materialized view on first run only. Subsequent ticks use
    // REFRESH MATERIALIZED VIEW CONCURRENTLY (below) to pick up fresh data
    // without blocking readers. If the MV definition below ever changes,
    // update the probe above so this branch rebuilds it.
    await db.execute(sql`
      CREATE MATERIALIZED VIEW IF NOT EXISTS leaderboard_mv AS
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
        WHERE u.banned_at IS NULL
        GROUP BY u.id, u.github_username, u.image
      ),
      -- Ages each stored snapshot to refresh time; mirrors streakSelect()
      -- in src/lib/db/streak-state.ts. Only the streak number: pass state is
      -- private and this view feeds public stats.
      current_streaks AS (
        SELECT
          user_id,
          last_active IS NOT NULL
            AND GREATEST(0, (CURRENT_DATE - last_active) - 1) <= passes_left AS alive,
          streak_days
        FROM user_streaks
      )
      SELECT
        ut.user_id,
        ut.github_username,
        ut.image,
        ut.total_cost,
        ut.total_tokens,
        ut.active_days::int,
        COALESCE(CASE WHEN cs.alive THEN cs.streak_days END, 0)::int AS current_streak
      FROM user_totals ut
      LEFT JOIN current_streaks cs ON cs.user_id = ut.user_id
      WITH DATA
    `);

    // Create unique index required for CONCURRENTLY refresh
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_mv_user_id_idx
      ON leaderboard_mv (user_id)
    `);

    // Refresh the materialized view without blocking reads. CONCURRENTLY
    // requires the unique index above to already exist.
    await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_mv`);

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
      streaksRecomputed,
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
