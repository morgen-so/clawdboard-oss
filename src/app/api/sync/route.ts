import { NextRequest, NextResponse, after } from "next/server";
import { revalidatePath } from "next/cache";
import { revalidateAllCaches } from "@/lib/db/cached";
import { db } from "@/lib/db";
import { dailyAggregates, users } from "@/lib/db/schema";
import { eq, and, or, isNull, inArray, sql } from "drizzle-orm";
import { SyncPayloadSchema } from "@/lib/sync/validate";
import { rateLimit } from "@/lib/rate-limit";
import { isOrgDataStale, syncUserGitHubOrgs } from "@/lib/db/github-orgs";

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, { key: "sync", limit: 10 });
  if (limited) return limited;

  try {
    // 1. Authenticate via Bearer token
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return NextResponse.json(
        { error: "Missing authorization token" },
        { status: 401 }
      );
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.apiToken, token))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
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
    const { days, syncIntervalMs, machineId } = result.data;

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

    // 4c. Upsert the actual data — uses (user_id, date, source, machine_id)
    // so each machine's data is stored independently.
    await Promise.all(
      days.map((day) =>
        db.execute(sql`
          INSERT INTO daily_aggregates (
            id, user_id, date, source, machine_id,
            input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
            total_cost, models_used, model_breakdowns, synced_at
          ) VALUES (
            gen_random_uuid(), ${user.id}, ${day.date}, ${day.source ?? null}, ${machineId ?? null},
            ${day.inputTokens}, ${day.outputTokens}, ${day.cacheCreationTokens}, ${day.cacheReadTokens},
            ${day.totalCost.toString()}, ${JSON.stringify(day.modelsUsed)}::jsonb, ${JSON.stringify(day.modelBreakdowns)}::jsonb, NOW()
          )
          ON CONFLICT (user_id, date, source, machine_id)
          DO UPDATE SET
            input_tokens = EXCLUDED.input_tokens,
            output_tokens = EXCLUDED.output_tokens,
            cache_creation_tokens = EXCLUDED.cache_creation_tokens,
            cache_read_tokens = EXCLUDED.cache_read_tokens,
            total_cost = EXCLUDED.total_cost,
            models_used = EXCLUDED.models_used,
            model_breakdowns = EXCLUDED.model_breakdowns,
            synced_at = NOW()
        `)
      )
    );

    // 5. Update user's last sync timestamp (must be synchronous so the
    //    homepage sees hasSynced=true when the browser redirects after device auth)
    await db
      .update(users)
      .set({ lastSyncAt: new Date(), ...(syncIntervalMs != null && { syncIntervalMs }) })
      .where(eq(users.id, user.id));

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
    });
  } catch (error) {
    console.error("Sync error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
