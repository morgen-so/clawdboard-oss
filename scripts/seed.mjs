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

import pg from "pg";

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
    `INSERT INTO users (id, name, email, github_username, image, api_token, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [u.id, u.name, u.email, u.github_username, u.image, u.api_token]
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

// ─── Create materialized view ────────────────────────────────────────────────

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
  currentStreak: 12,
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
