import { NextRequest, NextResponse, after } from "next/server";
import { revalidatePath } from "next/cache";
import { revalidateAllCaches } from "@/lib/db/cached";
import { db } from "@/lib/db";
import { dailyAggregates, users } from "@/lib/db/schema";
import { eq, and, or, isNull, inArray, sql } from "drizzle-orm";
import { SyncPayloadSchema } from "@/lib/sync/validate";
import { rateLimit } from "@/lib/rate-limit";
import { authenticateApiToken } from "@/lib/api-auth";
import { isOrgDataStale, syncUserGitHubOrgs } from "@/lib/db/github-orgs";
import { recomputeUserStreak } from "@/lib/db/streak-state";
import { resolveStreak } from "@/lib/streak";

// Sources whose extractors double-counted cached tokens before CLI 0.3.5:
// OpenAI, Gemini, and Copilot report cached tokens as a SUBSET of
// input_tokens, but older CLIs added them on top (and billed them at the
// full input rate). Historical rows were backfilled to corrected values.
// Because the non-force conflict strategy below keeps GREATEST per column,
// a single re-sync of inflated numbers from an old CLI would re-corrupt a
// corrected row — so days for these sources are dropped unless the client
// is on the fixed version. Force syncs from old CLIs are equally dangerous
// (unconditional overwrite), so the guard applies to both paths.
const SUBSET_SEMANTICS_SOURCES = new Set([
  "codex",
  "gemini-cli",
  "copilot-cli",
  "antigravity",
]);
const MIN_CLI_VERSION_FOR_SUBSET_SOURCES = [0, 3, 5] as const;

// Codex before CLI 0.3.7 counted a forked session's copied history again:
// a fork or sub-agent's rollout starts with a copy of the parent's
// token_count events, and the extractor took each file's last running total.
// Heavy multi-agent users came out several times above Codex's own counter.
// Days from older CLIs are dropped (a re-sync would re-inflate a corrected
// row through GREATEST), and Codex rows last written before
// CODEX_FORK_FIX_LIVE_AT are replaced outright by the first fixed sync rather
// than merged with GREATEST, which would keep the inflated value forever.
// Must be at or after the deploy; after it, every Codex row is from a fixed
// CLI. Bump it if the deploy slips.
const MIN_CLI_VERSION_FOR_CODEX = [0, 3, 7] as const;
const CODEX_FORK_FIX_LIVE_AT = "2026-09-25T12:00:00Z";

/** Parse "clawdboard/x.y.z" from the User-Agent; unknown clients count as old. */
function cliVersionAtLeast(
  userAgent: string | null,
  min: readonly [number, number, number]
): boolean {
  const m = /^clawdboard\/(\d+)\.(\d+)\.(\d+)/.exec(userAgent ?? "");
  if (!m) return false;
  const v = [Number(m[1]), Number(m[2]), Number(m[3])];
  for (let i = 0; i < 3; i++) {
    if (v[i] > min[i]) return true;
    if (v[i] < min[i]) return false;
  }
  return true;
}

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, { key: "sync", limit: 10 });
  if (limited) return limited;

  try {
    // 1. Authenticate via Bearer token
    const tokenAuth = await authenticateApiToken(req);
    if (tokenAuth.response) return tokenAuth.response;
    const { user } = tokenAuth;

    if (user.bannedAt) {
      return NextResponse.json({ error: "Account suspended" }, { status: 403 });
    }

    // 2. Size check
    const contentLength = parseInt(
      req.headers.get("content-length") ?? "0",
      10
    );
    if (contentLength > 100_000) {
      return NextResponse.json(
        { error: "Payload too large (max 100KB)" },
        { status: 413 }
      );
    }

    // 3. Parse and validate with Zod
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const result = SyncPayloadSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: result.error.issues },
        { status: 400 }
      );
    }

    // 4. Upsert each day (Pitfall 6: avoid Vercel timeout)
    const { syncIntervalMs, machineId, reassignFromOpencode, force } = result.data;
    let { days } = result.data;

    // Drop subset-semantics sources from pre-fix CLIs (see constants above).
    let droppedLegacyDays = 0;
    if (!cliVersionAtLeast(req.headers.get("user-agent"), MIN_CLI_VERSION_FOR_SUBSET_SOURCES)) {
      const before = days.length;
      days = days.filter((d) => !SUBSET_SEMANTICS_SOURCES.has(d.source ?? ""));
      droppedLegacyDays = before - days.length;
      if (droppedLegacyDays > 0) {
        console.log(
          `[sync] Dropped ${droppedLegacyDays} day(s) from outdated CLI ` +
            `(${req.headers.get("user-agent") ?? "no UA"}) for user=${user.id}: ` +
            `codex/gemini/copilot/antigravity data from CLIs < 0.3.5 double-counts cached tokens`
        );
      }
    }
    if (!cliVersionAtLeast(req.headers.get("user-agent"), MIN_CLI_VERSION_FOR_CODEX)) {
      const before = days.length;
      days = days.filter((d) => d.source !== "codex");
      const dropped = before - days.length;
      droppedLegacyDays += dropped;
      if (dropped > 0) {
        console.log(
          `[sync] Dropped ${dropped} codex day(s) from outdated CLI ` +
            `(${req.headers.get("user-agent") ?? "no UA"}) for user=${user.id}: ` +
            `codex data from CLIs < 0.3.7 counts forked sessions' history again`
        );
      }
    }

    // 4a. Clean up legacy null-source rows that would cause double-counting.
    // When a CLI upgrade starts sending source="claude-code" (or other), the
    // same usage data that was previously stored with source=NULL now arrives
    // with a proper source tag. Delete the old NULL rows for dates being synced
    // so the SUM queries don't count the same usage twice.
    const sourcedDates = new Map<string, string[]>();
    for (const day of days) {
      if (day.source) {
        const existing = sourcedDates.get(day.source) ?? [];
        existing.push(day.date);
        sourcedDates.set(day.source, existing);
      }
    }
    if (sourcedDates.size > 0) {
      // Collect all dates that have a non-null source in this sync
      const allSourcedDates = [...new Set(days.filter(d => d.source).map(d => d.date))];
      if (allSourcedDates.length > 0) {
        await db
          .delete(dailyAggregates)
          .where(
            and(
              eq(dailyAggregates.userId, user.id),
              isNull(dailyAggregates.source),
              inArray(dailyAggregates.date, allSourcedDates)
            )
          );
      }
    }

    // 4a-bis. Reassign legacy `source: "opencode"` rows to branded tiers.
    // Before the providerID split landed, every OpenCode message regardless of
    // provider was tagged source="opencode". When the CLI now emits opencode-go
    // (or opencode-zen) rows for those same dates, we'd double-count unless we
    // clear the matching legacy "opencode" rows.
    //
    // The CLI signals reassignment intent by setting `reassignFromOpencode` to
    // the list of branded tiers it's emitting in this payload. We only clear
    // legacy "opencode" rows for dates that have a corresponding branded-tier
    // row in this same payload — preserving any genuine direct-key OpenCode
    // usage (e.g. provider=anthropic via the user's own key, which still emits
    // source="opencode") on days where the user mixed sources.
    if (reassignFromOpencode && reassignFromOpencode.length > 0) {
      const brandedSet = new Set<string>(reassignFromOpencode);
      const datesWithBranded = [
        ...new Set(
          days
            .filter((d) => d.source && brandedSet.has(d.source))
            .map((d) => d.date)
        ),
      ];
      // Only clear "opencode" legacy rows for dates where the same machine
      // does NOT also have a fresh "opencode" row in this payload — that
      // protects mixed-provider days.
      const datesWithFreshOpencodeForThisMachine = new Set(
        days
          .filter((d) => d.source === "opencode")
          .map((d) => d.date)
      );
      const datesToClear = datesWithBranded.filter(
        (d) => !datesWithFreshOpencodeForThisMachine.has(d)
      );
      if (datesToClear.length > 0) {
        await db
          .delete(dailyAggregates)
          .where(
            and(
              eq(dailyAggregates.userId, user.id),
              eq(dailyAggregates.source, "opencode"),
              inArray(dailyAggregates.date, datesToClear),
              // Only this machine's legacy rows. Other machines may still
              // have legitimate "opencode" data; let them clean themselves
              // up on their own next sync.
              machineId
                ? eq(dailyAggregates.machineId, machineId)
                : isNull(dailyAggregates.machineId)
            )
          );
      }
    }

    // 4b. Migrate existing NULL-machineId rows to this machine on first sync.
    // When a CLI upgrades to a version that sends machineId, existing rows
    // (from before multi-machine support) have NULL machine_id. The first
    // machine to sync claims rows matching its sources so historical data
    // isn't orphaned. Scoped to the sources in the current payload to avoid
    // claiming rows from other sources that may belong to a different machine.
    if (machineId) {
      const syncedDates = [...new Set(days.map(d => d.date))];
      const syncedSources = [...new Set(days.map(d => d.source).filter(Boolean))] as string[];
      if (syncedDates.length > 0) {
        const conditions = [
          eq(dailyAggregates.userId, user.id),
          isNull(dailyAggregates.machineId),
          inArray(dailyAggregates.date, syncedDates),
          // Skip rows where this machine already owns the (date, source) pair.
          // Without this guard, an old CLI (no machineId) could create a new
          // NULL-machineId row, and the next machine-aware sync would try to
          // claim it — violating the unique constraint.
          sql`NOT EXISTS (
            SELECT 1 FROM daily_aggregates existing
            WHERE existing.user_id = ${dailyAggregates.userId}
              AND existing.date = ${dailyAggregates.date}
              AND existing.source IS NOT DISTINCT FROM ${dailyAggregates.source}
              AND existing.machine_id = ${machineId}
          )`,
        ];
        if (syncedSources.length > 0) {
          conditions.push(
            or(isNull(dailyAggregates.source), inArray(dailyAggregates.source, syncedSources))!
          );
        } else {
          // No explicit source in this payload: only claim legacy NULL-source rows.
          conditions.push(isNull(dailyAggregates.source));
        }
        const migrationResult = await db
          .update(dailyAggregates)
          .set({ machineId })
          .where(and(...conditions));
        const migratedRows = (migrationResult as unknown as { rowCount?: number }).rowCount ?? 0;
        if (migratedRows > 0) {
          console.log(`[sync] Migrated ${migratedRows} legacy rows to machineId=${machineId} for user=${user.id}`);
        }
      }
    }

    // 4b-bis. Clear this machine's Codex rows written by pre-0.3.7 CLIs for
    // the dates being synced, so the fixed numbers replace them instead of
    // losing to them under GREATEST (see CODEX_FORK_FIX_LIVE_AT). Runs after
    // 4b so migrated legacy NULL-machine rows are included.
    const codexDates = [...new Set(days.filter((d) => d.source === "codex").map((d) => d.date))];
    if (codexDates.length > 0) {
      await db
        .delete(dailyAggregates)
        .where(
          and(
            eq(dailyAggregates.userId, user.id),
            eq(dailyAggregates.source, "codex"),
            inArray(dailyAggregates.date, codexDates),
            machineId
              ? eq(dailyAggregates.machineId, machineId)
              : isNull(dailyAggregates.machineId),
            sql`${dailyAggregates.syncedAt} < ${CODEX_FORK_FIX_LIVE_AT}::timestamptz`
          )
        );
    }

    // 4c. Upsert the actual data — uses (user_id, date, source, machine_id)
    // so each machine's data is stored independently.
    //
    // Default conflict strategy keeps the higher value per column so that
    // deleting local session files cannot shrink stored history. When the CLI
    // sends `force: true` (explicit user reset), we overwrite unconditionally.
    const updateClause = force
      ? sql`
          input_tokens = EXCLUDED.input_tokens,
          output_tokens = EXCLUDED.output_tokens,
          cache_creation_tokens = EXCLUDED.cache_creation_tokens,
          cache_read_tokens = EXCLUDED.cache_read_tokens,
          total_cost = EXCLUDED.total_cost,
          premium_requests = EXCLUDED.premium_requests,
          models_used = EXCLUDED.models_used,
          model_breakdowns = EXCLUDED.model_breakdowns,
          synced_at = NOW()
        `
      : sql`
          input_tokens = GREATEST(daily_aggregates.input_tokens, EXCLUDED.input_tokens),
          output_tokens = GREATEST(daily_aggregates.output_tokens, EXCLUDED.output_tokens),
          cache_creation_tokens = GREATEST(daily_aggregates.cache_creation_tokens, EXCLUDED.cache_creation_tokens),
          cache_read_tokens = GREATEST(daily_aggregates.cache_read_tokens, EXCLUDED.cache_read_tokens),
          total_cost = GREATEST(daily_aggregates.total_cost, EXCLUDED.total_cost),
          premium_requests = GREATEST(daily_aggregates.premium_requests, EXCLUDED.premium_requests),
          models_used = CASE
            WHEN EXCLUDED.total_cost >= daily_aggregates.total_cost
            THEN EXCLUDED.models_used
            ELSE daily_aggregates.models_used
          END,
          model_breakdowns = CASE
            WHEN EXCLUDED.total_cost >= daily_aggregates.total_cost
            THEN EXCLUDED.model_breakdowns
            ELSE daily_aggregates.model_breakdowns
          END,
          synced_at = NOW()
        `;

    await Promise.all(
      days.map((day) =>
        db.execute(sql`
          INSERT INTO daily_aggregates (
            id, user_id, date, source, machine_id,
            input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
            total_cost, premium_requests, models_used, model_breakdowns, synced_at
          ) VALUES (
            gen_random_uuid(), ${user.id}, ${day.date}, ${day.source ?? null}, ${machineId ?? null},
            ${day.inputTokens}, ${day.outputTokens}, ${day.cacheCreationTokens}, ${day.cacheReadTokens},
            ${day.totalCost.toString()}, ${day.premiumRequests ?? 0},
            ${JSON.stringify(day.modelsUsed)}::jsonb, ${JSON.stringify(day.modelBreakdowns)}::jsonb, NOW()
          )
          ON CONFLICT (user_id, date, source, machine_id)
          DO UPDATE SET ${updateClause}
        `)
      )
    );

    // 5. Update user's last sync timestamp (must be synchronous so the
    //    homepage sees hasSynced=true when the browser redirects after device auth)
    await db
      .update(users)
      .set({ lastSyncAt: new Date(), ...(syncIntervalMs != null && { syncIntervalMs }) })
      .where(eq(users.id, user.id));

    // 5b. Refold this user's streak (and free-pass balance) from the days we
    //     just wrote. The leaderboard reads the stored snapshot, so this has
    //     to land before the caches below are dropped. A failure here must not
    //     fail the sync — the hourly cron rebuilds every row anyway.
    let streakInfo: {
      streak: number;
      streakPasses: number;
      streakFrozenFor: number;
    } | null = null;
    try {
      const state = resolveStreak(await recomputeUserStreak(user.id));
      streakInfo = {
        streak: state.current,
        streakPasses: state.passesLeft,
        streakFrozenFor: state.frozenFor,
      };
    } catch (err) {
      console.error(`[sync] streak recompute failed for user=${user.id}:`, err);
    }

    // 6. Invalidate all cached data so the next page visit shows fresh results.
    revalidateAllCaches();
    revalidatePath("/");

    // 7. Sync GitHub orgs in the background (slow, non-critical)
    after(async () => {
      if (isOrgDataStale(user.githubOrgsFetchedAt)) {
        syncUserGitHubOrgs(user.id).catch((err) =>
          console.error("[sync] org sync failed:", err)
        );
      }
    });

    return NextResponse.json({
      success: true,
      daysUpserted: days.length,
      // The caller's own streak and free-pass state. Only ever returned to
      // the token holder; nothing about passes is public.
      ...(streakInfo ?? {}),
      ...(droppedLegacyDays > 0 && {
        warning:
          `${droppedLegacyDays} day(s) were not stored: this CLI version ` +
          `overcounts tokens for codex/gemini/copilot/antigravity. ` +
          `Update with: npm i -g clawdboard@latest (npx users update automatically).`,
      }),
    });
  } catch (error) {
    console.error("Sync error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
