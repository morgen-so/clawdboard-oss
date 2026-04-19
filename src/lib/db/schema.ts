import {
  pgTable,
  pgMaterializedView,
  text,
  timestamp,
  integer,
  bigint,
  decimal,
  jsonb,
  uniqueIndex,
  index,
  boolean,
  serial,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ─── NextAuth required tables ───────────────────────────────────────────────

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email"),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  // Custom clawdboard fields
  githubUsername: text("github_username"),
  apiToken: text("api_token").unique(),
  cookingUrl: text("cooking_url"),
  cookingLabel: text("cooking_label"),
  createdAt: timestamp("created_at").defaultNow(),
  lastSyncAt: timestamp("last_sync_at"),
  syncIntervalMs: integer("sync_interval_ms"),
  githubOrgsFetchedAt: timestamp("github_orgs_fetched_at"),
  pinnedBadges: jsonb("pinned_badges").$type<string[]>().default([]),
  earnedBadges: jsonb("earned_badges").$type<string[]>().default([]),
  badgePromptDismissedAt: timestamp("badge_prompt_dismissed_at"),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    uniqueIndex("provider_unique").on(
      account.provider,
      account.providerAccountId
    ),
  ]
);

// ─── clawdboard data tables ────────────────────────────────────────────────────

export const dailyAggregates = pgTable(
  "daily_aggregates",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // "YYYY-MM-DD"
    source: text("source"), // "claude-code" | "opencode" | "codex" | null (legacy)
    machineId: text("machine_id"), // stable per-machine identifier (random UUID)
    inputTokens: bigint("input_tokens", { mode: "number" }).default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).default(0),
    cacheCreationTokens: bigint("cache_creation_tokens", {
      mode: "number",
    }).default(0),
    cacheReadTokens: bigint("cache_read_tokens", { mode: "number" }).default(0),
    totalCost: decimal("total_cost", { precision: 12, scale: 4 }).default("0"),
    modelsUsed: jsonb("models_used").$type<string[]>().default([]),
    modelBreakdowns: jsonb("model_breakdowns")
      .$type<
        {
          modelName: string;
          inputTokens: number;
          outputTokens: number;
          cacheCreationTokens: number;
          cacheReadTokens: number;
          cost: number;
        }[]
      >()
      .default([]),
    syncedAt: timestamp("synced_at").defaultNow(),
  },
  (table) => [
    // NULLS NOT DISTINCT: treats NULL values as equal, preventing
    // duplicate rows. Created via raw SQL in the cron/refresh route
    // since Drizzle doesn't support NULLS NOT DISTINCT.
    uniqueIndex("daily_user_date_source_machine_idx").on(table.userId, table.date, table.source, table.machineId),
  ]
);

// ─── Device codes for CLI auth flow ─────────────────────────────────────────

export const deviceCodes = pgTable("device_codes", {
  code: text("code").primaryKey(), // Short user-facing code (e.g., "A1B2C3")
  deviceCode: text("device_code").notNull().unique(), // Long polling code for CLI
  userId: text("user_id").references(() => users.id),
  apiToken: text("api_token"),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  claimed: boolean("claimed").default(false),
});

// ─── Teams ──────────────────────────────────────────────────────────────────

export const teams = pgTable("teams", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  inviteToken: text("invite_token").notNull(),
  isPublic: boolean("is_public").default(true),
  isLocked: boolean("is_locked").default(false),
  cookingUrl: text("cooking_url"),
  cookingLabel: text("cooking_label"),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const teamMembers = pgTable("team_members", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"), // "owner" | "member"
  status: text("status").notNull().default("active"), // "active" | "pending"
  joinedAt: timestamp("joined_at").defaultNow(),
  leftAt: timestamp("left_at"),
});

// ─── Notifications ─────────────────────────────────────────────────────────

export const notifications = pgTable(
  "notifications",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // "team_invite" etc.
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    readAt: timestamp("read_at"),
    actedAt: timestamp("acted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("notifications_user_unacted_idx").on(table.userId, table.actedAt),
  ]
);

// ─── GitHub org memberships ──────────────────────────────────────────────────

export const userGithubOrgs = pgTable(
  "user_github_orgs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgLogin: text("org_login").notNull(),
    orgId: text("org_id").notNull(),
    orgAvatarUrl: text("org_avatar_url"),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("user_org_login_idx").on(table.userId, table.orgLogin),
    index("org_login_idx").on(table.orgLogin),
  ]
);

// ─── Recaps (weekly/monthly usage summaries) ────────────────────────────────

export interface RecapData {
  rank: number;
  previousRank: number | null;
  totalUsers: number;
  percentile: number;
  totalCost: number;
  costDelta: number | null;
  totalTokens: number;
  tokensDelta: number | null;
  activeDays: number;
  totalDays: number;
  currentStreak: number;
  peakDay: string | null; // "YYYY-MM-DD"
  peakDayLabel: string; // "Monday" or "Mar 15"
  peakDayCost: number;
  topModel: { name: string; percentage: number } | null;
  modelBreakdown: { name: string; cost: number; percentage: number }[];
  stateTier: "empty" | "low" | "normal" | "top10pct" | "top10" | "podium";
  rivalUsername: string | null;
  rivalImage: string | null;
  rivalGap: number | null;
  rivalRank: number | null;
}

export const recaps = pgTable(
  "recaps",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // "weekly" | "monthly"
    periodStart: text("period_start").notNull(), // "YYYY-MM-DD"
    periodEnd: text("period_end").notNull(), // "YYYY-MM-DD"
    data: jsonb("data").$type<RecapData>().notNull(),
    seenAt: timestamp("seen_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("recap_user_type_period_idx").on(
      table.userId,
      table.type,
      table.periodStart
    ),
    index("recap_user_unseen_idx").on(table.userId, table.seenAt),
  ]
);

// ─── Rank snapshots (daily rank tracking for movement indicators) ───────────

export const rankSnapshots = pgTable(
  "rank_snapshots",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    snapshotDate: text("snapshot_date").notNull(), // "YYYY-MM-DD"
    capturedAt: timestamp("captured_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("rank_snapshot_user_date_idx").on(
      table.userId,
      table.snapshotDate
    ),
  ]
);

// ─── Page visits (growth metrics) ────────────────────────────────────────────

export const pageVisits = pgTable(
  "page_visits",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pathname: text("pathname").notNull(),
    visitedAt: timestamp("visited_at").defaultNow().notNull(),
  },
  (table) => [index("page_visits_user_visited_idx").on(table.userId, table.visitedAt)]
);

// ─── Feedback ───────────────────────────────────────────────────────────────

export const feedback = pgTable("feedback", {
  id: serial("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  username: text("username"),
  email: text("email"),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
});

// ─── Leaderboard materialized view ──────────────────────────────────────────
// NOTE: Create via db.execute() — drizzle-kit does not generate mat view migrations.
// See src/app/api/cron/refresh/route.ts for initial creation.

export const leaderboardView = pgMaterializedView("leaderboard_mv", {
  userId: text("user_id").notNull(),
  githubUsername: text("github_username"),
  image: text("image"),
  totalCost: decimal("total_cost", { precision: 14, scale: 4 }),
  totalTokens: bigint("total_tokens", { mode: "number" }),
  activeDays: integer("active_days"),
  currentStreak: integer("current_streak"),
}).as(sql`
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
`);
