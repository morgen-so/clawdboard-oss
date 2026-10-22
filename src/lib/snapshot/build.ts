import "server-only";

import { after } from "next/server";
import { VALID_PERIODS, type Period } from "@/lib/constants";
import { getAllProfileUsers, getAllUserRanks } from "@/lib/db/profile";
import { getTeamMembers } from "@/lib/db/teams";
import { getActiveTools } from "@/lib/tools";
import { SNAP, SnapshotBuild, userFile } from "./index";
import {
  listSnapshotFiles,
  removeSnapshotFile,
  snapshotEnabled,
  writeSnapshotFile,
} from "./store";

// What each file holds. Only the calls public pages make by default are
// built (default sort, every period but custom); anything else reads live.
//
//   leaderboard.json  leaderboard and team leaderboard per period, community
//                     totals, vibe coder count, every profile-able user and
//                     their rank. Rebuilt after every sync and every hour.
//   users/<id>.json   one user's summary, daily rows and models per period,
//                     all-time summary and daily rows, public teams, recaps. Rebuilt after
//                     that user syncs and every hour.
//   stats.json        the /stats and /stats/tools pages and the sitemap.
//   models.json       every /stats/models/<slug> page. Both rebuilt hourly.

const PERIODS = VALID_PERIODS.filter(
  (p): p is Exclude<Period, "custom"> => p !== "custom"
);

/** Parallel queries per rebuild; Neon's HTTP driver opens one request each. */
const CONCURRENCY = 6;

async function inBatches(jobs: Array<() => Promise<unknown>>): Promise<void> {
  let next = 0;
  async function worker() {
    while (next < jobs.length) await jobs[next++]();
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
}

async function writeFiles(build: SnapshotBuild): Promise<number> {
  let written = 0;
  await inBatches(
    [...build.files].map(([name, entries]) => async () => {
      if (await writeSnapshotFile(name, entries, build.startedAt)) written++;
    })
  );
  return written;
}

/**
 * Build and write users' files one user at a time, so a run that gets cut
 * short keeps every file it finished.
 */
async function rebuildUsers(userIds: string[]): Promise<number> {
  let written = 0;
  await inBatches(
    userIds.map((id) => async () => {
      const build = new SnapshotBuild();
      for (const job of userJobs(build, id)) await job();
      const files = await writeFiles(build);
      written += files;
    })
  );
  return written;
}

/**
 * Users who went away while a run was building (account deleted, banned)
 * lose their files, and the leaderboard is rebuilt without them. Files left
 * from earlier departures go too.
 */
async function dropDepartedUsers(built: string[]): Promise<number> {
  const current = new Set([...(await getAllProfileUsers()).values()].map((u) => u.id));

  let written = 0;
  if (built.some((id) => !current.has(id))) {
    const build = new SnapshotBuild();
    await addLeaderboard(build);
    written = await writeFiles(build);
  }

  const departed = (await listSnapshotFiles("users")).filter(
    (name) => !current.has(name.slice("users/".length))
  );
  await inBatches(departed.map((name) => () => removeSnapshotFile(name)));
  return written;
}

/** Fill leaderboard.json and return the ids of every profile-able user. */
async function addLeaderboard(build: SnapshotBuild): Promise<string[]> {
  const [profiles, ranks] = await Promise.all([getAllProfileUsers(), getAllUserRanks()]);
  for (const [username, user] of profiles) {
    build.set(SNAP.profileUser, [username], user);
    const rank = ranks.get(user.id);
    if (rank) build.set(SNAP.userRank, [user.id], rank);
  }

  await inBatches([
    ...PERIODS.map((p) => () => build.add(SNAP.leaderboard, p, "cost", "desc")),
    ...PERIODS.map((p) => () => build.add(SNAP.teamLeaderboard, p)),
    () => build.add(SNAP.vibeCoderCount),
    () => build.add(SNAP.communityStats),
  ]);

  return [...profiles.values()].map((user) => user.id);
}

function userJobs(build: SnapshotBuild, userId: string): Array<() => Promise<unknown>> {
  return [
    ...PERIODS.flatMap((p) => [
      () => build.add(SNAP.userSummary, userId, p),
      () => build.add(SNAP.userDaily, userId, p),
      () => build.add(SNAP.userModels, userId, p),
    ]),
    // All-time reads: profile metadata, OG images, the README badge.
    () => build.add(SNAP.userSummary, userId),
    () => build.add(SNAP.userDaily, userId),
    () => build.add(SNAP.userPublicTeams, userId),
    () => build.add(SNAP.userRecaps, userId),
  ];
}

async function addStats(build: SnapshotBuild): Promise<void> {
  const [breakdown, modelSlugs] = await Promise.all([
    build.add(SNAP.sourceBreakdown),
    build.add(SNAP.modelSlugs),
  ]);

  await inBatches([
    () => build.add(SNAP.dailyTrends),
    () => build.add(SNAP.modelStats),
    () => build.add(SNAP.weeklyGrowth),
    () => build.add(SNAP.sourceComparison),
    () => build.add(SNAP.sitemapPaths),
    // The tools page asks for a tool's models only when it has details.
    ...getActiveTools(breakdown).map((tool) => async () => {
      if (await build.add(SNAP.sourceDetail, tool.slug)) {
        await build.add(SNAP.sourceModels, tool.slug);
      }
    }),
    ...modelSlugs.flatMap((slug) => [
      () => build.add(SNAP.modelDetail, slug),
      () => build.add(SNAP.modelDailyTrends, slug),
    ]),
  ]);
}

/** The leaderboard file, after a sync or a change to someone's public profile. */
export async function rebuildLeaderboardSnapshot(): Promise<void> {
  if (!snapshotEnabled()) return;
  const build = new SnapshotBuild();
  await addLeaderboard(build);
  await writeFiles(build);
}

/** One user's file, after they sync or change what their profile shows. */
export async function rebuildUserSnapshot(userId: string): Promise<void> {
  if (!snapshotEnabled()) return;
  await rebuildUsers([userId]);
}

/** Every user's file, after the recaps cron adds recaps. */
export async function rebuildAllUserSnapshots(): Promise<void> {
  if (!snapshotEnabled()) return;
  const profiles = await getAllProfileUsers();
  await rebuildUsers([...profiles.values()].map((user) => user.id));
}

/** After a sync: the leaderboard moved and so did this user's profile. */
export async function rebuildAfterSync(userId: string): Promise<void> {
  if (!snapshotEnabled()) return;
  const build = new SnapshotBuild();
  await addLeaderboard(build);
  await inBatches(userJobs(build, userId));
  await writeFiles(build);
}

/**
 * For team actions: team names, visibility and membership show on the team
 * board and on members' profiles. Once the response is sent, rebuild the
 * leaderboard file and the files of the team's current members plus anyone
 * who just left it. Pass no team for a change that only the board shows.
 */
export function scheduleTeamRebuild(teamId: string | null, alsoUserIds: string[] = []): void {
  after(() =>
    runSnapshotJob("team change", async () => {
      if (!snapshotEnabled()) return;
      const members = teamId ? await getTeamMembers(teamId) : [];
      const userIds = members.filter((m) => !m.leftAt).map((m) => m.userId);
      await rebuildLeaderboardSnapshot();
      await rebuildUsers([...new Set([...userIds, ...alsoUserIds])]);
    })
  );
}

export async function removeUserSnapshot(userId: string): Promise<void> {
  await removeSnapshotFile(userFile(userId));
}

/** Every file, from the hourly cron. */
export async function rebuildAllSnapshots(): Promise<{ files: number; ms: number } | null> {
  if (!snapshotEnabled()) return null;
  const started = Date.now();
  const build = new SnapshotBuild();

  const userIds = await addLeaderboard(build);
  await addStats(build);
  let files = await writeFiles(build);
  files += await rebuildUsers(userIds);
  files += await dropDepartedUsers(userIds);

  return { files, ms: Date.now() - started };
}

/**
 * Run a rebuild without letting it fail the request it rides on. A failed
 * rebuild leaves the previous file in place, and the next cron run replaces it.
 */
export async function runSnapshotJob(label: string, job: () => Promise<unknown>): Promise<void> {
  try {
    await job();
  } catch (err) {
    console.error(`[snapshot] ${label} failed:`, err);
  }
}
