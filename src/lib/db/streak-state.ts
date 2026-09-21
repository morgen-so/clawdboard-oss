import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { db, executeRows } from "@/lib/db";
import { computeStreakSnapshot, type StreakSnapshot } from "@/lib/streak";

// ─── Persisted streak state ─────────────────────────────────────────────────
// Streak-with-passes can't be expressed as a window function: whether a gap is
// survivable depends on the pass balance, which depends on how the run got
// there. It's a fold, so it runs in TypeScript (src/lib/streak.ts) and the
// result lands in `user_streaks`, one row per user.
//
// The stored snapshot is clock-independent — it only changes when a user's
// daily rows change — so the leaderboard can apply "how many days since they
// last showed up" itself, in SQL, and stay exact between recomputes.
// `streakSelect()` below is the SQL mirror of `resolveStreak()`.
//
// Rows are written on every sync and rebuilt wholesale by the hourly cron.

const CREATE_TABLE = sql`
  CREATE TABLE IF NOT EXISTS user_streaks (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    run_start DATE,
    last_active DATE,
    streak_days INTEGER NOT NULL DEFAULT 0,
    passes_left INTEGER NOT NULL DEFAULT 0,
    passes_earned INTEGER NOT NULL DEFAULT 0,
    passes_spent INTEGER NOT NULL DEFAULT 0,
    frozen_days JSONB NOT NULL DEFAULT '[]'::jsonb,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

let tableReady: Promise<void> | null = null;

/**
 * Create `user_streaks` if it isn't there yet, once per process. Read paths
 * await this so a deploy that lands before the first cron tick can't 500 the
 * leaderboard; on an existing table the statement is a no-op.
 */
export function ensureStreakTable(): Promise<void> {
  tableReady ??= db
    .execute(CREATE_TABLE)
    .then(() => undefined)
    .catch((err) => {
      tableReady = null; // let the next caller retry
      throw err;
    });
  return tableReady;
}

/**
 * SQL mirror of `resolveStreak()`: ages a stored snapshot to CURRENT_DATE.
 *
 * Today is never counted against anyone (it isn't over), so only the days
 * strictly between `last_active` and today have to be paid for out of the
 * banked passes. Pass the alias the `user_streaks` row is joined under.
 */
export function streakSelect(alias = "us"): SQL {
  const a = sql.raw(alias);
  // Days fully elapsed since the last active day.
  const missed = sql`GREATEST(0, (CURRENT_DATE - ${a}.last_active) - 1)`;
  const alive = sql`${a}.last_active IS NOT NULL AND ${missed} <= ${a}.passes_left`;
  return sql`
    CASE WHEN ${alive} THEN ${a}.streak_days ELSE 0 END AS current_streak,
    CASE WHEN ${alive} THEN ${a}.passes_left - ${missed} ELSE 0 END AS streak_passes,
    CASE WHEN ${alive} THEN ${missed} ELSE 0 END AS streak_frozen_for
  `;
}

// ─── Writing ────────────────────────────────────────────────────────────────

function upsert(entries: [string, StreakSnapshot][]): SQL {
  const values = entries.map(
    ([userId, s]) => sql`(
      ${userId}, ${s.runStart}::date, ${s.lastActive}::date, ${s.streakDays},
      ${s.passesLeft}, ${s.passesEarned}, ${s.passesSpent},
      ${JSON.stringify(s.frozenDays)}::jsonb, NOW()
    )`
  );
  return sql`
    INSERT INTO user_streaks (
      user_id, run_start, last_active, streak_days,
      passes_left, passes_earned, passes_spent, frozen_days, computed_at
    ) VALUES ${sql.join(values, sql`, `)}
    ON CONFLICT (user_id) DO UPDATE SET
      run_start = EXCLUDED.run_start,
      last_active = EXCLUDED.last_active,
      streak_days = EXCLUDED.streak_days,
      passes_left = EXCLUDED.passes_left,
      passes_earned = EXCLUDED.passes_earned,
      passes_spent = EXCLUDED.passes_spent,
      frozen_days = EXCLUDED.frozen_days,
      computed_at = NOW()
  `;
}

/**
 * Recompute and store one user's streak. Called after every sync so the
 * leaderboard reflects a fresh sync immediately rather than at the next cron.
 */
export async function recomputeUserStreak(
  userId: string
): Promise<StreakSnapshot> {
  await ensureStreakTable();
  const rows = await executeRows<{ date: string }>(sql`
    SELECT DISTINCT date FROM daily_aggregates
    WHERE user_id = ${userId}
    ORDER BY date
  `);
  const snapshot = computeStreakSnapshot(rows);
  await db.execute(upsert([[userId, snapshot]]));
  return snapshot;
}

const BACKFILL_BATCH = 400;

/**
 * Rebuild every user's streak state. Runs hourly from the cron so the table
 * self-heals after row deletions (dedup, account removal) and backfills users
 * who haven't synced since the feature shipped.
 *
 * Users are pulled in batches so a large table never lands in memory at once.
 */
export async function recomputeAllStreaks(): Promise<number> {
  await ensureStreakTable();

  let processed = 0;
  let after = "";

  for (;;) {
    const batch = await executeRows<{ user_id: string; days: string[] }>(sql`
      SELECT user_id, ARRAY_AGG(DISTINCT date ORDER BY date) AS days
      FROM daily_aggregates
      WHERE user_id > ${after}
      GROUP BY user_id
      ORDER BY user_id
      LIMIT ${BACKFILL_BATCH}
    `);
    if (batch.length === 0) break;

    const snapshots = batch.map(
      (row): [string, StreakSnapshot] => [
        row.user_id,
        computeStreakSnapshot((row.days ?? []).map((date) => ({ date }))),
      ]
    );
    await db.execute(upsert(snapshots));
    processed += snapshots.length;

    after = batch[batch.length - 1].user_id;
    if (batch.length < BACKFILL_BATCH) break;
  }

  // Users whose rows all disappeared keep a stale streak otherwise.
  await db.execute(sql`
    UPDATE user_streaks SET
      run_start = NULL, last_active = NULL, streak_days = 0,
      passes_left = 0, passes_earned = 0, passes_spent = 0,
      frozen_days = '[]'::jsonb, computed_at = NOW()
    WHERE last_active IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM daily_aggregates da WHERE da.user_id = user_streaks.user_id
      )
  `);

  return processed;
}
