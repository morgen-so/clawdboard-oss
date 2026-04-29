/**
 * Cursor usage data extraction.
 *
 * Reads Cursor's SQLite state database (state.vscdb), extracts per-bubble
 * token counts and per-composer model/cost metadata, aggregates by date and
 * model, and returns daily usage as SyncDay[].
 *
 * Cursor stores its data at:
 *   - Windows: %APPDATA%\Cursor\User\globalStorage\state.vscdb
 *   - macOS:   ~/Library/Application Support/Cursor/User/globalStorage/state.vscdb
 *   - Linux:   ~/.config/Cursor/User/globalStorage/state.vscdb
 *
 * Override via CURSOR_DATA_DIR env var (full path to state.vscdb).
 *
 * Inside the SQLite database, table cursorDiskKV holds key/value pairs:
 *   - composerData:{composerId}        → conversation metadata + usageData/modelConfig
 *   - bubbleId:{composerId}:{bubbleId} → individual messages with tokenCount
 *
 * Model extraction prefers (in order):
 *   1. composerData.usageData keys (older format, has cost in cents)
 *   2. composerData.modelConfig.modelName (newer format; "default" is skipped
 *      since it's a UI placeholder, not a real model name)
 *   3. Fallback: "cursor-mixed"
 *
 * Note: Local data only goes up to ~Sep 17, 2025. After that, Cursor moved
 * conversation content (and per-bubble token counts) server-side. Recent
 * usage requires the Cursor account API and is out of scope for this module.
 *
 * PRIVACY: Only date, token counts, cost, and model names are extracted.
 * Prompts, code, file paths, and conversation content are never read.
 */

import Database from "better-sqlite3";
import { copyFileSync, existsSync, unlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { accumulate, accumulatorToSyncDays, type DayAccumulator } from "./accumulator.js";
import type { SyncDay } from "./schemas.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/**
 * Resolve the Cursor state.vscdb path on the current platform.
 * Respects CURSOR_DATA_DIR env var (if set, must be the full path to state.vscdb).
 */
function getCursorDbPath(): string {
  if (process.env.CURSOR_DATA_DIR) return process.env.CURSOR_DATA_DIR;

  const platform = process.platform;
  if (platform === "darwin") {
    return join(
      homedir(),
      "Library",
      "Application Support",
      "Cursor",
      "User",
      "globalStorage",
      "state.vscdb"
    );
  }
  if (platform === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "Cursor", "User", "globalStorage", "state.vscdb");
  }
  // Linux and others: XDG_CONFIG_HOME or ~/.config
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(xdgConfig, "Cursor", "User", "globalStorage", "state.vscdb");
}

// ---------------------------------------------------------------------------
// Internal types (never sent to server)
// ---------------------------------------------------------------------------

interface ComposerMeta {
  /** epoch milliseconds of composerData.createdAt, or null when missing/invalid */
  createdAt: number | null;
  /** Candidate model names ordered by preference; [0] is the primary */
  models: string[];
  /** Raw usageData map: model -> {costInCents, amount} (older composers only) */
  usageData: Record<string, { costInCents: number; amount: number }>;
}

interface BubbleRecord {
  composerId: string;
  date: string; // YYYY-MM-DD (UTC)
  inputTokens: number;
  outputTokens: number;
  /** Filled in later by distributeComposerCosts() */
  cost: number;
}

const FALLBACK_MODEL = "cursor-mixed";

// Sanity threshold: anything below this is too small to be a real epoch ms.
// Roughly Sep 9 2001 -- comfortably below our earliest realistic Cursor data.
const MIN_VALID_EPOCH_MS = 1_000_000_000_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether Cursor's state database exists on this machine.
 */
export function hasCursorData(): boolean {
  return existsSync(getCursorDbPath());
}

/**
 * Read Cursor's state.vscdb and aggregate token usage into daily entries.
 *
 * @param since - Optional YYYY-MM-DD date; days before this are dropped.
 * @returns Array of SyncDay objects ready for Zod validation.
 */
export async function extractCursorData(since?: string): Promise<SyncDay[]> {
  const dbPath = getCursorDbPath();
  if (!existsSync(dbPath)) return [];

  // Cursor holds an exclusive lock on the DB while running. Copy to a temp
  // file so we can open it as readonly without contending with that lock.
  const tmpPath = join(
    tmpdir(),
    `cursor-state-${process.pid}-${Date.now()}.vscdb`
  );
  try {
    copyFileSync(dbPath, tmpPath);
  } catch {
    // If copy fails (e.g. disk full, permissions), bail rather than crash.
    return [];
  }

  let db: Database.Database;
  try {
    db = new Database(tmpPath, { readonly: true, fileMustExist: true });
  } catch {
    cleanupTempFile(tmpPath);
    return [];
  }

  try {
    const composers = buildComposerMeta(db);
    const records = collectBubbleRecords(db, composers, since);
    distributeComposerCosts(records, composers);

    const byDate: Record<string, DayAccumulator> = {};
    for (const r of records) {
      const composer = composers.get(r.composerId);
      const model =
        (composer && composer.models[0]) ?? FALLBACK_MODEL;
      accumulate(byDate, r.date, model, {
        input: r.inputTokens,
        output: r.outputTokens,
        cacheCreation: 0,
        cacheRead: 0,
        cost: r.cost,
      });
    }

    return accumulatorToSyncDays(byDate, "cursor");
  } finally {
    try {
      db.close();
    } catch {
      /* best effort */
    }
    cleanupTempFile(tmpPath);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function cleanupTempFile(p: string): void {
  try {
    unlinkSync(p);
  } catch {
    /* best effort */
  }
}

/**
 * Scan all composerData rows and build a composerId -> ComposerMeta map.
 * Skips rows where the value is NULL or fails to parse as JSON.
 */
function buildComposerMeta(
  db: Database.Database
): Map<string, ComposerMeta> {
  const out = new Map<string, ComposerMeta>();

  // Cursor's schema: cursorDiskKV(key TEXT, value BLOB).
  // value is a UTF-8 JSON document.
  const rows = db
    .prepare(
      "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'"
    )
    .all() as Array<{ key: string; value: Buffer | string | null }>;

  for (const row of rows) {
    if (row.value == null) continue;
    const composerId = row.key.slice("composerData:".length);
    if (!composerId) continue;

    const data = parseJsonValue(row.value);
    if (!data) continue;

    // createdAt: epoch ms; reject anything implausibly small.
    let createdAt: number | null = null;
    const createdRaw = (data as { createdAt?: unknown }).createdAt;
    if (
      typeof createdRaw === "number" &&
      Number.isFinite(createdRaw) &&
      createdRaw >= MIN_VALID_EPOCH_MS
    ) {
      createdAt = Math.trunc(createdRaw);
    }

    // Model resolution: usageData keys first (most reliable, has cost),
    // then modelConfig.modelName (skipping the literal "default").
    const models: string[] = [];
    const usageData: Record<string, { costInCents: number; amount: number }> =
      {};

    const usageDataRaw = (data as { usageData?: unknown }).usageData;
    if (usageDataRaw && typeof usageDataRaw === "object") {
      for (const [modelName, info] of Object.entries(
        usageDataRaw as Record<string, unknown>
      )) {
        if (!modelName) continue;
        if (!models.includes(modelName)) models.push(modelName);
        if (info && typeof info === "object") {
          const obj = info as { costInCents?: unknown; amount?: unknown };
          const cost =
            typeof obj.costInCents === "number" ? obj.costInCents : 0;
          const amount = typeof obj.amount === "number" ? obj.amount : 0;
          usageData[modelName] = {
            costInCents: Math.max(0, Math.trunc(cost)),
            amount: Math.max(0, Math.trunc(amount)),
          };
        }
      }
    }

    const modelConfigRaw = (data as { modelConfig?: unknown }).modelConfig;
    if (modelConfigRaw && typeof modelConfigRaw === "object") {
      const mc = modelConfigRaw as { modelName?: unknown };
      if (
        typeof mc.modelName === "string" &&
        mc.modelName.length > 0 &&
        mc.modelName !== "default" &&
        !models.includes(mc.modelName)
      ) {
        models.push(mc.modelName);
      }
    }

    if (models.length === 0) models.push(FALLBACK_MODEL);

    out.set(composerId, { createdAt, models, usageData });
  }

  return out;
}

/**
 * Iterate every bubble row, retain only those with non-zero tokens and a
 * resolvable date. Returns one record per qualifying bubble.
 */
function collectBubbleRecords(
  db: Database.Database,
  composers: Map<string, ComposerMeta>,
  since?: string
): BubbleRecord[] {
  const records: BubbleRecord[] = [];

  const rows = db
    .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'")
    .all() as Array<{ key: string; value: Buffer | string | null }>;

  for (const row of rows) {
    if (row.value == null) continue;

    // Key format: bubbleId:{composerId}:{bubbleId}
    const parts = row.key.split(":");
    if (parts.length < 3) continue;
    const composerId = parts[1];

    const data = parseJsonValue(row.value);
    if (!data) continue;

    const tcRaw = (data as { tokenCount?: unknown }).tokenCount;
    if (!tcRaw || typeof tcRaw !== "object") continue;
    const tc = tcRaw as { inputTokens?: unknown; outputTokens?: unknown };
    const inputTokens =
      typeof tc.inputTokens === "number" ? Math.max(0, Math.trunc(tc.inputTokens)) : 0;
    const outputTokens =
      typeof tc.outputTokens === "number" ? Math.max(0, Math.trunc(tc.outputTokens)) : 0;
    if (inputTokens === 0 && outputTokens === 0) continue;

    // Date: prefer per-bubble timing, fall back to parent composer's createdAt.
    let dateStr: string | null = null;
    const timingRaw = (data as { timingInfo?: unknown }).timingInfo;
    if (timingRaw && typeof timingRaw === "object") {
      const csRaw = (timingRaw as { clientStartTime?: unknown }).clientStartTime;
      if (
        typeof csRaw === "number" &&
        Number.isFinite(csRaw) &&
        csRaw >= MIN_VALID_EPOCH_MS
      ) {
        dateStr = dateFromMs(Math.trunc(csRaw));
      }
    }
    if (!dateStr) {
      const meta = composers.get(composerId);
      if (meta && meta.createdAt != null) {
        dateStr = dateFromMs(meta.createdAt);
      }
    }
    if (!dateStr) continue;

    if (since && dateStr < since) continue;

    records.push({
      composerId,
      date: dateStr,
      inputTokens,
      outputTokens,
      cost: 0,
    });
  }

  return records;
}

/**
 * Distribute each composer's total cost (sum of usageData[*].costInCents)
 * across its bubbles, weighted by (inputTokens + outputTokens). Mutates
 * each record's `cost` field. Cost is converted from cents to dollars.
 *
 * For composers without usageData (or with zero total cost), bubbles get
 * cost = 0. The Python reference implementation does this same thing.
 */
function distributeComposerCosts(
  records: BubbleRecord[],
  composers: Map<string, ComposerMeta>
): void {
  // Group bubbles by composer
  const byComposer = new Map<string, BubbleRecord[]>();
  for (const r of records) {
    const list = byComposer.get(r.composerId);
    if (list) list.push(r);
    else byComposer.set(r.composerId, [r]);
  }

  for (const [composerId, list] of byComposer.entries()) {
    const meta = composers.get(composerId);
    if (!meta) continue;

    let totalCents = 0;
    for (const info of Object.values(meta.usageData)) {
      totalCents += info.costInCents;
    }
    if (totalCents <= 0) continue;

    const totalTokens = list.reduce(
      (sum, r) => sum + r.inputTokens + r.outputTokens,
      0
    );
    if (totalTokens <= 0) continue;

    // Distribute proportionally using largest remainder method to guarantee
    // the sum exactly equals totalCents with no rounding drift.
    const entries = list.map((r) => {
      const exactCents = (totalCents * (r.inputTokens + r.outputTokens)) / totalTokens;
      return {
        r,
        exactCents,
        floorCents: Math.floor(exactCents),
        fractional: exactCents - Math.floor(exactCents),
      };
    });

    let assignedCents = entries.reduce((sum, e) => sum + e.floorCents, 0);
    const remainder = totalCents - assignedCents;

    // Allocate remaining cents to entries with highest fractional parts
    entries.sort((a, b) => b.fractional - a.fractional);
    for (let i = 0; i < remainder; i++) {
      entries[i].floorCents += 1;
    }

    // Assign back to list items
    for (const e of entries) {
      e.r.cost = e.floorCents / 100;
    }
  }
}

/**
 * Parse a SQLite blob/text/string value as UTF-8 JSON. Returns the parsed
 * object or null if anything goes wrong (NULL value, invalid UTF-8, bad JSON,
 * non-object root).
 */
function parseJsonValue(value: Buffer | string | null): Record<string, unknown> | null {
  if (value == null) return null;
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = value.toString("utf-8");
    } catch {
      return null;
    }
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** Convert epoch milliseconds to a YYYY-MM-DD string (UTC). */
function dateFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
