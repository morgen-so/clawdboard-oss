#!/usr/bin/env node
/**
 * Seed script for local development.
 * Creates fake users with realistic usage data so all pages render.
 *
 * Usage:
 *   docker compose up -d
 *   npx drizzle-kit push
 *   npm run seed
 *   npm run dev    # then visit http://localhost:3001
 *
 * All data is clearly fake (dev-alice, dev-bob, etc.) — no real user data.
 */

import { createHash } from "node:crypto";
import pg from "pg";
// Node strips the types on import — the streak fold has exactly one
// implementation and the seed uses it rather than a SQL copy.
import { computeStreakSnapshot } from "../src/lib/streak.ts";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://clawdboard:clawdboard@localhost:5432/clawdboard";

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();

// Helper
const uuid = () => crypto.randomUUID();
const today = new Date();
const dayMs = 24 * 60 * 60 * 1000;

function dateStr(daysAgo) {
  const d = new Date(today.getTime() - daysAgo * dayMs);
  return d.toISOString().slice(0, 10);
}

// ─── Seed users ──────────────────────────────────────────────────────────────

const seedUsers = [
  {
    id: uuid(),
    name: "Alice Developer",
    email: "alice@example.dev",
    github_username: "dev-alice",
    image: "https://api.dicebear.com/9.x/pixel-art/svg?seed=alice",
    api_token: "dev-token-alice",
  },
  {
    id: uuid(),
    name: "Bob Hacker",
    email: "bob@example.dev",
    github_username: "dev-bob",
    image: "https://api.dicebear.com/9.x/pixel-art/svg?seed=bob",
    api_token: "dev-token-bob",
  },
  {
    id: uuid(),
    name: "Carol Engineer",
    email: "carol@example.dev",
    github_username: "dev-carol",
    image: "https://api.dicebear.com/9.x/pixel-art/svg?seed=carol",
    api_token: "dev-token-carol",
  },
  {
    id: uuid(),
    name: "Dave Coder",
    email: "dave@example.dev",
    github_username: "dev-dave",
    image: "https://api.dicebear.com/9.x/pixel-art/svg?seed=dave",
    api_token: "dev-token-dave",
  },
  {
    id: uuid(),
    name: "Eve Builder",
    email: "eve@example.dev",
    github_username: "dev-eve",
    image: "https://api.dicebear.com/9.x/pixel-art/svg?seed=eve",
    api_token: "dev-token-eve",
  },
];

console.log("Seeding users...");
for (const u of seedUsers) {
  await client.query(
    `INSERT INTO users (id, name, email, github_username, image, api_token, api_token_hash, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [
      u.id,
      u.name,
      u.email,
      u.github_username,
      u.image,
      u.api_token,
      createHash("sha256").update(u.api_token).digest("hex"),
    ]
  );
}
console.log(`  Created ${seedUsers.length} users`);

// ─── Seed daily aggregates (30 days of usage, with source tracking) ──────────

const models = [
  "claude-sonnet-4-20250514",
  "claude-opus-4-20250514",
  "claude-haiku-4-20250506",
];

const sources = ["claude-code", "opencode", "codex"];

console.log("Seeding daily aggregates...");
let aggregateCount = 0;

for (const user of seedUsers) {
  // Each user gets a different activity pattern
  const activityRate = 0.5 + Math.random() * 0.5; // 50-100% of days active
  const spendMultiplier = 0.5 + Math.random() * 4; // varies per user

  // Each user uses 1-3 sources with varying probability
  const userSourceCount = 1 + Math.floor(Math.random() * sources.length);
  const userSources = sources.slice(0, userSourceCount);

  for (let daysAgo = 0; daysAgo < 30; daysAgo++) {
    if (Math.random() > activityRate) continue;

    const date = dateStr(daysAgo);

    for (const source of userSources) {
      // Not every source is used every active day
      if (source !== "claude-code" && Math.random() > 0.4) continue;

      // Scale down secondary sources
      const sourceScale = source === "claude-code" ? 1.0 : 0.3 + Math.random() * 0.4;

      const inputTokens = Math.floor((50000 + Math.random() * 200000) * sourceScale);
      const outputTokens = Math.floor((10000 + Math.random() * 80000) * sourceScale);
      const cacheCreationTokens = Math.floor(Math.random() * 30000 * sourceScale);
      const cacheReadTokens = Math.floor(Math.random() * 100000 * sourceScale);

      // Rough cost calculation (in dollars)
      const cost = (
        (inputTokens * 0.003 +
          outputTokens * 0.015 +
          cacheCreationTokens * 0.00375 +
          cacheReadTokens * 0.0003) /
          1000 *
          spendMultiplier
      ).toFixed(4);

      const usedModels = models.slice(
        0,
        1 + Math.floor(Math.random() * models.length)
      );

      const breakdowns = usedModels.map((modelName, i) => {
        const share = i === 0 ? 0.6 : 0.4 / (usedModels.length - 1 || 1);
        return {
          modelName,
          inputTokens: Math.floor(inputTokens * share),
          outputTokens: Math.floor(outputTokens * share),
          cacheCreationTokens: Math.floor(cacheCreationTokens * share),
          cacheReadTokens: Math.floor(cacheReadTokens * share),
          cost: parseFloat((parseFloat(cost) * share).toFixed(4)),
        };
      });

      // machine_id intentionally omitted — seed data simulates legacy rows without machine tracking
      await client.query(
        `INSERT INTO daily_aggregates
         (id, user_id, date, source, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, total_cost, models_used, model_breakdowns, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
         ON CONFLICT (user_id, date, source, machine_id) DO NOTHING`,
        [
          uuid(),
          user.id,
          date,
          source,
          inputTokens,
          outputTokens,
          cacheCreationTokens,
          cacheReadTokens,
          cost,
          JSON.stringify(usedModels),
          JSON.stringify(breakdowns),
        ]
      );
      aggregateCount++;
    }
  }
}
console.log(`  Created ${aggregateCount} daily aggregate rows`);

// ─── Seed a team ─────────────────────────────────────────────────────────────

console.log("Seeding team...");
const teamId = uuid();
await client.query(
  `INSERT INTO teams (id, name, slug, invite_token, is_public, created_by, created_at)
   VALUES ($1, $2, $3, $4, TRUE, $5, NOW())
   ON CONFLICT (slug) DO NOTHING`,
  [teamId, "Dev Team", "dev-team", "dev-invite-token", seedUsers[0].id]
);

for (let i = 0; i < 3; i++) {
  await client.query(
    `INSERT INTO team_members (id, team_id, user_id, role, status, joined_at)
     VALUES ($1, $2, $3, $4, 'active', NOW())
     ON CONFLICT DO NOTHING`,
    [uuid(), teamId, seedUsers[i].id, i === 0 ? "owner" : "member"]
  );
}
console.log("  Created team 'dev-team' with 3 members");

// ─── Recreate unique index with NULLS NOT DISTINCT ──────────────────────────
// drizzle-kit push creates a plain unique index that treats NULLs as distinct.
// Recreate it with NULLS NOT DISTINCT so (user_id, date, NULL, NULL) is unique.

console.log("Recreating unique index with NULLS NOT DISTINCT...");
await client.query(`DROP INDEX IF EXISTS daily_user_date_source_machine_idx`);
await client.query(`DROP INDEX IF EXISTS daily_user_date_source_idx`);
await client.query(`
  CREATE UNIQUE INDEX daily_user_date_source_machine_idx
  ON daily_aggregates (user_id, date, source, machine_id) NULLS NOT DISTINCT
`);
console.log("  Index recreated");

// ─── Seed a 205-day streak for dev-alice (Carcinization Event) ───────────────
// Fills any gaps left by the random loop above so alice has 205 consecutive
// active days ending today — past the 200-day "Transcendent" tier, so her
// profile triggers the full takeover when she views it logged-in.
// Runs after the NULLS NOT DISTINCT index so ON CONFLICT dedupes correctly.

console.log("Seeding 205-day streak for dev-alice...");
const alice = seedUsers[0];
let streakRows = 0;
for (let daysAgo = 0; daysAgo < 205; daysAgo++) {
  // Deterministic modest usage — varies slightly by day so charts look organic
  const inputTokens = 60000 + (daysAgo % 7) * 5000;
  const outputTokens = 15000 + (daysAgo % 5) * 3000;
  const cost = ((inputTokens * 0.003 + outputTokens * 0.015) / 1000).toFixed(4);
  const breakdowns = [
    {
      modelName: models[0],
      inputTokens,
      outputTokens,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      cost: parseFloat(cost),
    },
  ];

  const res = await client.query(
    `INSERT INTO daily_aggregates
     (id, user_id, date, source, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, total_cost, models_used, model_breakdowns, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
     ON CONFLICT (user_id, date, source, machine_id) DO NOTHING`,
    [
      uuid(),
      alice.id,
      dateStr(daysAgo),
      "claude-code",
      inputTokens,
      outputTokens,
      0,
      0,
      cost,
      JSON.stringify([models[0]]),
      JSON.stringify(breakdowns),
    ]
  );
  streakRows += res.rowCount;
}
console.log(
  `  Added ${streakRows} filler rows — dev-alice now has a 205-day streak`
);

// ─── Seed a free-pass streak for dev-bob ────────────────────────────────────
// 89 active days ending today, with one day missing three days ago. Bob banks
// his first pass at day 75 of the run, so by the time the gap arrives he can
// pay for it: a live streak with a bridged day on the activity grid, which is
// the case the feature exists for.

console.log("Seeding a free-pass streak for dev-bob...");
const bob = seedUsers[1];
const BOB_GAP_DAYS_AGO = 3; // missed three days ago, bridged by a banked pass
let bobRows = 0;
for (let daysAgo = 0; daysAgo < 90; daysAgo++) {
  if (daysAgo === BOB_GAP_DAYS_AGO) continue;
  const inputTokens = 40000 + (daysAgo % 6) * 4000;
  const outputTokens = 9000 + (daysAgo % 4) * 2500;
  const cost = ((inputTokens * 0.003 + outputTokens * 0.015) / 1000).toFixed(4);
  const res = await client.query(
    `INSERT INTO daily_aggregates
     (id, user_id, date, source, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, total_cost, models_used, model_breakdowns, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
     ON CONFLICT (user_id, date, source, machine_id) DO NOTHING`,
    [
      uuid(),
      bob.id,
      dateStr(daysAgo),
      "claude-code",
      inputTokens,
      outputTokens,
      0,
      0,
      cost,
      JSON.stringify([models[0]]),
      JSON.stringify([
        {
          modelName: models[0],
          inputTokens,
          outputTokens,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          cost: parseFloat(cost),
        },
      ]),
    ]
  );
  bobRows += res.rowCount;
}
// The generic 30-day loop above may already have filled the gap day, so clear
// it explicitly rather than just skipping the insert.
await client.query(
  `DELETE FROM daily_aggregates WHERE user_id = $1 AND date = $2`,
  [bob.id, dateStr(BOB_GAP_DAYS_AGO)]
);
console.log(
  `  Added ${bobRows} rows — dev-bob's streak survives a gap on ${dateStr(BOB_GAP_DAYS_AGO)}`
);

// ─── Seed a frozen streak for dev-carol ─────────────────────────────────────
// 76 active days that stopped two days ago. She banked a pass at day 75, so
// the pass is holding the streak open right now: the ❄️ state, live, without
// anyone having to edit rows by hand.

console.log("Seeding a frozen streak for dev-carol...");
const carol = seedUsers[2];
const CAROL_LAST_ACTIVE = 2; // days ago
let carolRows = 0;
for (let daysAgo = CAROL_LAST_ACTIVE; daysAgo < CAROL_LAST_ACTIVE + 76; daysAgo++) {
  const inputTokens = 30000 + (daysAgo % 5) * 3000;
  const outputTokens = 7000 + (daysAgo % 3) * 2000;
  const cost = ((inputTokens * 0.003 + outputTokens * 0.015) / 1000).toFixed(4);
  const res = await client.query(
    `INSERT INTO daily_aggregates
     (id, user_id, date, source, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, total_cost, models_used, model_breakdowns, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
     ON CONFLICT (user_id, date, source, machine_id) DO NOTHING`,
    [
      uuid(),
      carol.id,
      dateStr(daysAgo),
      "claude-code",
      inputTokens,
      outputTokens,
      0,
      0,
      cost,
      JSON.stringify([models[1]]),
      JSON.stringify([
        {
          modelName: models[1],
          inputTokens,
          outputTokens,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          cost: parseFloat(cost),
        },
      ]),
    ]
  );
  carolRows += res.rowCount;
}
// The generic 30-day loop may have given her today/yesterday; clear those or
// the streak isn't frozen at all.
await client.query(
  `DELETE FROM daily_aggregates WHERE user_id = $1 AND date > $2`,
  [carol.id, dateStr(CAROL_LAST_ACTIVE)]
);
console.log(
  `  Added ${carolRows} rows — dev-carol's streak is frozen on a pass since ${dateStr(CAROL_LAST_ACTIVE)}`
);

// ─── Streak snapshots ───────────────────────────────────────────────────────
// Streaks with free passes are a fold over each user's active days, not a
// window function, so the result is stored per user. Mirrors
// recomputeAllStreaks() in src/lib/db/streak-state.ts.

console.log("Computing streak snapshots...");
await client.query(`
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
`);
const streakDayRows = await client.query(
  `SELECT user_id, ARRAY_AGG(DISTINCT date ORDER BY date) AS days
   FROM daily_aggregates GROUP BY user_id`
);
for (const row of streakDayRows.rows) {
  const snap = computeStreakSnapshot(row.days.map((date) => ({ date })));
  await client.query(
    `INSERT INTO user_streaks
       (user_id, run_start, last_active, streak_days, passes_left,
        passes_earned, passes_spent, frozen_days, computed_at)
     VALUES ($1, $2::date, $3::date, $4, $5, $6, $7, $8::jsonb, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       run_start = EXCLUDED.run_start,
       last_active = EXCLUDED.last_active,
       streak_days = EXCLUDED.streak_days,
       passes_left = EXCLUDED.passes_left,
       passes_earned = EXCLUDED.passes_earned,
       passes_spent = EXCLUDED.passes_spent,
       frozen_days = EXCLUDED.frozen_days,
       computed_at = NOW()`,
    [
      row.user_id,
      snap.runStart,
      snap.lastActive,
      snap.streakDays,
      snap.passesLeft,
      snap.passesEarned,
      snap.passesSpent,
      JSON.stringify(snap.frozenDays),
    ]
  );
}
console.log(`  Stored ${streakDayRows.rows.length} streak snapshots`);
if (!process.env.STREAK_PASSES_LIVE_FROM) {
  console.log(
    "  Note: passes can't cover days before the launch date, so dev-bob's and\n" +
      "  dev-carol's seeded gaps read as breaks. To demo passes in use, run the\n" +
      "  seed and the dev server with STREAK_PASSES_LIVE_FROM=2000-01-01."
  );
}

// ─── Create views ────────────────────────────────────────────────────────────

// Community-wide stats read through this view so banned users never reach the
// /stats aggregates. Mirrors the definition in GET /api/cron/refresh.
console.log("Creating visible_daily_aggregates view...");
await client.query(`
  CREATE OR REPLACE VIEW visible_daily_aggregates AS
  SELECT da.*
  FROM daily_aggregates da
  JOIN users u ON u.id = da.user_id
  WHERE u.banned_at IS NULL
`);

console.log("Creating leaderboard materialized view...");
await client.query(`DROP MATERIALIZED VIEW IF EXISTS leaderboard_mv`);
await client.query(`
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
await client.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_mv_user_id_idx
  ON leaderboard_mv (user_id)
`);
console.log("  Materialized view created");

// ─── Seed recaps (so RecapBanner renders for dev-alice) ─────────────────────

console.log("Seeding recaps...");

// Ensure recaps table exists
await client.query(`
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
await client.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS recap_user_type_period_idx
  ON recaps (user_id, type, period_start)
`);
await client.query(`
  CREATE INDEX IF NOT EXISTS recap_user_unseen_idx
  ON recaps (user_id, seen_at)
`);

// Build a sample weekly recap for dev-alice (rank #1 / podium)
const aliceRecap = {
  rank: 1,
  previousRank: 3,
  totalUsers: 5,
  percentile: 100,
  totalCost: 127.42,
  costDelta: 34.18,
  totalTokens: 2450000,
  tokensDelta: 580000,
  activeDays: 6,
  totalDays: 7,
  currentStreak: 205,
  peakDay: dateStr(2),
  peakDayLabel: new Date(today.getTime() - 2 * dayMs).toLocaleDateString("en-US", { weekday: "long" }),
  peakDayCost: 28.45,
  topModel: { name: "Opus 4", percentage: 68.3 },
  modelBreakdown: [
    { name: "Opus 4", cost: 87.03, percentage: 68.3 },
    { name: "Sonnet 4", cost: 31.42, percentage: 24.7 },
    { name: "Haiku 4", cost: 8.97, percentage: 7.0 },
  ],
  stateTier: "podium",
  rivalUsername: null,
  rivalImage: null,
  rivalGap: null,
  rivalRank: null,
};

await client.query(
  `INSERT INTO recaps (id, user_id, type, period_start, period_end, data)
   VALUES ($1, $2, 'weekly', $3, $4, $5)
   ON CONFLICT (user_id, type, period_start) DO UPDATE SET data = EXCLUDED.data`,
  [uuid(), seedUsers[0].id, dateStr(7), dateStr(1), JSON.stringify(aliceRecap)]
);

// Build a sample weekly recap for dev-bob (normal tier)
const bobRecap = {
  rank: 3,
  previousRank: 2,
  totalUsers: 5,
  percentile: 60,
  totalCost: 45.80,
  costDelta: -12.30,
  totalTokens: 890000,
  tokensDelta: -210000,
  activeDays: 4,
  totalDays: 7,
  currentStreak: 2,
  peakDay: dateStr(3),
  peakDayLabel: new Date(today.getTime() - 3 * dayMs).toLocaleDateString("en-US", { weekday: "long" }),
  peakDayCost: 15.20,
  topModel: { name: "Sonnet 4", percentage: 82.1 },
  modelBreakdown: [
    { name: "Sonnet 4", cost: 37.60, percentage: 82.1 },
    { name: "Haiku 4", cost: 8.20, percentage: 17.9 },
  ],
  stateTier: "normal",
  rivalUsername: "dev-carol",
  rivalImage: "https://api.dicebear.com/9.x/pixel-art/svg?seed=carol",
  rivalGap: 8.42,
  rivalRank: 2,
};

await client.query(
  `INSERT INTO recaps (id, user_id, type, period_start, period_end, data)
   VALUES ($1, $2, 'weekly', $3, $4, $5)
   ON CONFLICT (user_id, type, period_start) DO UPDATE SET data = EXCLUDED.data`,
  [uuid(), seedUsers[1].id, dateStr(7), dateStr(1), JSON.stringify(bobRecap)]
);

console.log("  Created 2 sample recaps (dev-alice: podium, dev-bob: normal)");

// ─── Done ────────────────────────────────────────────────────────────────────

await client.end();
console.log("\nDone! Dev users: dev-alice, dev-bob, dev-carol, dev-dave, dev-eve");
console.log("Sign in at http://localhost:3001/signin with any username above.");
console.log(
  "dev-alice has a 205-day streak — visit her profile logged-in as her to witness the Carcinization Event."
);
console.log(
  "dev-bob's streak survives a missed day on a banked free pass — check his activity grid."
);
console.log(
  "dev-carol's streak is frozen right now, held open by a pass — check the snowflake."
);
console.log(
  "Add ?passes=1 to any profile URL to replay the free-pass modal."
);
