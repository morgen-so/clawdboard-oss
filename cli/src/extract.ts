import { SyncPayloadSchema, type SyncPayload, type SyncDay } from "./schemas.js";
import { extractOpenCodeData, hasOpenCodeData } from "./opencode.js";
import { extractCodexData, hasCodexData } from "./codex.js";
import { extractCursorData, hasCursorData } from "./cursor.js";
import { extractCursorApiData, hasCursorApiAuth } from "./cursor-api.js";

/**
 * Privacy-preserving data extraction from raw ccusage DailyUsage data.
 *
 * This function is the core privacy boundary. It transforms raw ccusage output
 * (which may contain project paths, session IDs, git branches, and other
 * identifying information) into a clean SyncPayload containing ONLY aggregate
 * metrics.
 *
 * CRITICAL DESIGN DECISIONS:
 * 1. Uses explicit field picking (NOT object spread or Object.assign)
 * 2. Every field in the output is individually named in the code
 * 3. Result is validated through SyncPayloadSchema.parse() -- Zod catches any leakage
 * 4. Throws on validation failure (caller must handle)
 *
 * @param raw - Array of raw ccusage DailyUsage-like objects (typed as unknown[] for safety)
 * @param source - The data source tag for these entries
 * @returns A clean SyncPayload with only allowlisted fields
 * @throws ZodError if the sanitized data fails schema validation
 */
export function sanitizeDailyData(
  raw: unknown[],
  source?: "claude-code" | "opencode" | "codex" | "cursor" | null
): SyncPayload {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const days = (raw as any[]).map((day) => ({
    // ALLOWLISTED day-level fields only
    date: day.date,
    source: source ?? day.source ?? null,
    inputTokens: day.inputTokens,
    outputTokens: day.outputTokens,
    cacheCreationTokens: day.cacheCreationTokens,
    cacheReadTokens: day.cacheReadTokens,
    totalCost: day.totalCost,
    modelsUsed: [...day.modelsUsed],

    // ALLOWLISTED model breakdown fields only
    modelBreakdowns: (day.modelBreakdowns ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mb: any) => ({
        modelName: mb.modelName,
        inputTokens: mb.inputTokens,
        outputTokens: mb.outputTokens,
        cacheCreationTokens: mb.cacheCreationTokens,
        cacheReadTokens: mb.cacheReadTokens,
        cost: mb.cost,
      })
    ),
  }));

  // Validate through Zod -- catches any field leakage or malformed data
  return SyncPayloadSchema.parse({ days });
}

/**
 * Extract usage data from all available sources, sanitize, and combine.
 *
 * Sources:
 * 1. ccusage (Claude Code) — reads local JSONL files from ~/.claude/
 * 2. OpenCode — reads message JSON files from ~/.local/share/opencode/
 * 3. Codex CLI — reads rollout JSONL files from ~/.codex/sessions/
 * 4. Cursor (local) — reads SQLite state.vscdb from ~/Library/Application Support/Cursor (macOS),
 *    %APPDATA%/Cursor (Windows), or ~/.config/Cursor (Linux). Covers pre-Sep-2025 data.
 * 5. Cursor (API) — calls https://cursor.com/api/dashboard/get-aggregated-usage-events
 *    using the auth JWT cached locally by Cursor itself. Covers post-Sep-2025 data.
 *
 * All sources are optional and run concurrently. Each source's entries
 * are tagged with their source name and kept as separate daily entries
 * (not merged) so the server can store them as individual rows per source.
 *
 * The two Cursor extractors both emit `source: "cursor"`. They typically
 * cover non-overlapping date ranges (local DB stops storing tokens around
 * mid-Sep 2025; API only returns billable events from then on), so the
 * server-side upsert key (user_id, date, source, machine_id) keeps both
 * datasets distinct. On overlapping days the later write wins.
 *
 * @param since - Optional YYYY-MM-DD date to filter data from (inclusive)
 * @returns A clean SyncPayload with only allowlisted fields
 * @throws Error if no data sources are available at all
 */
export async function extractAndSanitize(
  since?: string
): Promise<SyncPayload> {
  // Run all extractions concurrently — they read from independent directories
  const [
    claudeResult,
    opencodeResult,
    codexResult,
    cursorResult,
    cursorApiResult,
  ] = await Promise.allSettled([
    // Source 1: Claude Code via ccusage
    (async (): Promise<SyncDay[]> => {
      const { loadDailyUsageData } = await import("ccusage/data-loader");
      const options: Record<string, unknown> = { mode: "calculate" };
      if (since) options.since = since;
      const raw = await loadDailyUsageData(
        options as Parameters<typeof loadDailyUsageData>[0]
      );
      return sanitizeDailyData(raw as unknown[], "claude-code").days;
    })(),
    // Source 2: OpenCode
    extractOpenCodeData(since),
    // Source 3: Codex CLI
    extractCodexData(since),
    // Source 4: Cursor (local SQLite — pre-Sep-2025 historical data)
    extractCursorData(since),
    // Source 5: Cursor (dashboard API — post-Sep-2025 server-side data)
    extractCursorApiData(since),
  ]);

  const claudeDays = claudeResult.status === "fulfilled" ? claudeResult.value : [];
  const opencodeDays = opencodeResult.status === "fulfilled" ? opencodeResult.value : [];
  const codexDays = codexResult.status === "fulfilled" ? codexResult.value : [];
  const cursorDays = cursorResult.status === "fulfilled" ? cursorResult.value : [];
  const cursorApiDays =
    cursorApiResult.status === "fulfilled" ? cursorApiResult.value : [];

  // Concatenate all sources — each entry already has its source tag,
  // so the server can upsert them as separate (user_id, date, source) rows
  const allDays = [
    ...claudeDays,
    ...opencodeDays,
    ...codexDays,
    ...cursorDays,
    ...cursorApiDays,
  ];

  if (
    allDays.length === 0 &&
    !hasOpenCodeData() &&
    !hasCodexData() &&
    !hasCursorData() &&
    !hasCursorApiAuth()
  ) {
    throw new Error(
      "No usage data found. Make sure you have used Claude Code, OpenCode, Codex, or Cursor on this machine."
    );
  }

  // Final Zod validation on the combined payload
  return SyncPayloadSchema.parse({ days: allDays });
}
