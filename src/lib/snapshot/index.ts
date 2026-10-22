import "server-only";

// ─── Public-data snapshot ────────────────────────────────────────────────────
// Neon bills for every minute the database is awake, and crawlers walking the
// long tail of profile and stats pages used to keep it awake around the
// clock. The public pages now read precomputed results from a few JSON files
// instead: the hourly cron rewrites them all, and a sync rewrites the
// leaderboard and that user's own file while the database is awake anyway.
//
// A read the snapshot can't answer (a custom date range, a non-default sort,
// a user who hasn't been built yet, a file that's missing or stale) falls
// through to the live query, so the snapshot only ever saves queries; it never
// changes what a page can show. See build.ts for what each file holds.

import {
  getLeaderboardData,
  getVibeCoderCount,
} from "@/lib/db/leaderboard";
import {
  getUserByUsername,
  getUserDailyData,
  getUserModelBreakdown,
  getUserRank,
  getUserSummary,
} from "@/lib/db/profile";
import { getPublicTeamLeaderboard, getUserPublicTeams } from "@/lib/db/teams";
import { getAllRecaps, type RecapRow } from "@/lib/db/recaps";
import {
  getCommunityStats,
  getDailyTrends,
  getWeeklyGrowth,
} from "@/lib/db/stats-community";
import {
  getDistinctModelSlugs,
  getModelDailyTrends,
  getModelDetailStats,
  getModelStats,
} from "@/lib/db/stats-models";
import {
  getSourceBreakdown,
  getSourceComparisonTrends,
  getSourceDetailStats,
  getSourceModelBreakdown,
} from "@/lib/db/stats-sources";
import { getSitemapPaths } from "@/lib/db/sitemap";
import { reviveDates, snapshotKey } from "./keys";
import { readSnapshotFile, snapshotEnabled } from "./store";

export interface SnapshotSpec<A extends unknown[], R> {
  /** Entry name; part of the key, so renaming one orphans its old entries. */
  name: string;
  /** Which file holds the entry, from the first (key) arg at most. */
  file: (first: A[0]) => string;
  /** The live query the entry stores the result of. */
  load: (...args: A) => Promise<R>;
  /** Canonical args for the key, when callers vary in ways that don't matter. */
  keyArgs?: (...args: A) => A;
  /** Undo what the JSON round trip did to the value (Dates). */
  revive?: (value: R) => R;
}

/** Takes its types from `load` alone, so `file` can ignore the args. */
function spec<A extends unknown[], R>(s: {
  name: string;
  file: (first: NoInfer<A>[0]) => string;
  load: (...args: A) => Promise<R>;
  keyArgs?: (...args: NoInfer<A>) => NoInfer<A>;
  revive?: (value: NoInfer<R>) => NoInfer<R>;
}): SnapshotSpec<A, R> {
  return s;
}

export const LEADERBOARD_FILE = "leaderboard";
export const STATS_FILE = "stats";
export const MODELS_FILE = "models";
export const userFile = (userId: string) => `users/${userId}`;

const leaderboardFile = () => LEADERBOARD_FILE;
const statsFile = () => STATS_FILE;
const modelsFile = () => MODELS_FILE;

const PROFILE_USER_DATES = ["createdAt", "lastSyncAt"] as const;
const RECAP_DATES = ["seenAt", "createdAt"] as const;

export const SNAP = {
  // leaderboard.json — rebuilt after every sync
  leaderboard: spec({ name: "leaderboard", file: leaderboardFile, load: getLeaderboardData }),
  vibeCoderCount: spec({ name: "vibeCoderCount", file: leaderboardFile, load: getVibeCoderCount }),
  communityStats: spec({ name: "communityStats", file: leaderboardFile, load: getCommunityStats }),
  teamLeaderboard: spec({ name: "teamLeaderboard", file: leaderboardFile, load: getPublicTeamLeaderboard }),
  profileUser: spec({
    name: "profileUser",
    file: leaderboardFile,
    load: getUserByUsername,
    keyArgs: (username: string): [string] => [username.toLowerCase()],
    revive: (user) => (user ? reviveDates(user, PROFILE_USER_DATES) : user),
  }),
  userRank: spec({ name: "userRank", file: leaderboardFile, load: getUserRank }),
  sitemapPaths: spec({ name: "sitemapPaths", file: leaderboardFile, load: getSitemapPaths }),

  // users/<id>.json — rebuilt after that user syncs
  userSummary: spec({ name: "userSummary", file: userFile, load: getUserSummary }),
  userDaily: spec({ name: "userDaily", file: userFile, load: getUserDailyData }),
  userModels: spec({ name: "userModels", file: userFile, load: getUserModelBreakdown }),
  userPublicTeams: spec({ name: "userPublicTeams", file: userFile, load: getUserPublicTeams }),
  userRecaps: spec({
    name: "userRecaps",
    file: userFile,
    load: getAllRecaps,
    revive: (rows: RecapRow[]) => rows.map((row) => reviveDates(row, RECAP_DATES)),
  }),

  // stats.json and models.json — rebuilt hourly
  dailyTrends: spec({ name: "dailyTrends", file: statsFile, load: getDailyTrends }),
  modelStats: spec({ name: "modelStats", file: statsFile, load: getModelStats }),
  weeklyGrowth: spec({ name: "weeklyGrowth", file: statsFile, load: getWeeklyGrowth }),
  modelSlugs: spec({ name: "modelSlugs", file: statsFile, load: getDistinctModelSlugs }),
  sourceBreakdown: spec({ name: "sourceBreakdown", file: statsFile, load: getSourceBreakdown }),
  sourceDetail: spec({ name: "sourceDetail", file: statsFile, load: getSourceDetailStats }),
  sourceModels: spec({ name: "sourceModels", file: statsFile, load: getSourceModelBreakdown }),
  sourceComparison: spec({ name: "sourceComparison", file: statsFile, load: getSourceComparisonTrends }),

  modelDetail: spec({ name: "modelDetail", file: modelsFile, load: getModelDetailStats }),
  modelDailyTrends: spec({ name: "modelDailyTrends", file: modelsFile, load: getModelDailyTrends }),
};

/**
 * Wrap a live reader so it answers from the snapshot when it can. `live` is
 * what runs on a miss: the unstable_cache wrapper, or the raw query where the
 * page wanted no cache.
 */
export function snapshotFirst<A extends unknown[], R>(
  s: SnapshotSpec<A, R>,
  live: (...args: A) => Promise<R>
): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    if (snapshotEnabled()) {
      const keyArgs = s.keyArgs ? s.keyArgs(...args) : args;
      const file = await readSnapshotFile(s.file(keyArgs[0]));
      const key = snapshotKey(s.name, keyArgs);
      if (file && Object.hasOwn(file.entries, key)) {
        const value = file.entries[key] as R;
        return s.revive ? s.revive(value) : value;
      }
    }
    return live(...args);
  };
}

/** Collects entries for a rebuild, grouped by the file each one belongs in. */
export class SnapshotBuild {
  readonly files = new Map<string, Record<string, unknown>>();
  /** When the reads began; a file only replaces one built from older data. */
  readonly startedAt = new Date().toISOString();

  /** Run the live query and keep its result. */
  async add<A extends unknown[], R>(s: SnapshotSpec<A, R>, ...args: A): Promise<R> {
    const value = await s.load(...args);
    this.set(s, args, value);
    return value;
  }

  /** Keep a result computed some other way (a bulk query standing in for many calls). */
  set<A extends unknown[], R>(s: SnapshotSpec<A, R>, args: A, value: R): void {
    const keyArgs = s.keyArgs ? s.keyArgs(...args) : args;
    const name = s.file(keyArgs[0]);
    let entries = this.files.get(name);
    if (!entries) {
      entries = {};
      this.files.set(name, entries);
    }
    entries[snapshotKey(s.name, keyArgs)] = value;
  }
}
