/**
 * OpenCode usage data extraction.
 *
 * Reads OpenCode's message JSON files from disk, aggregates by date and model,
 * calculates costs from token counts, and returns a SyncPayload.
 *
 * This mirrors the ccusage-based extraction in extract.ts but reads OpenCode's
 * native file format instead. The same privacy guarantees apply: only aggregate
 * metrics leave the machine — no prompts, code, file paths, or session IDs.
 *
 * OpenCode stores messages at:
 *   ~/.local/share/opencode/storage/message/{sessionID}/msg_{messageID}.json
 *
 * Each message JSON contains:
 *   - providerID: string (e.g., "opencode-go", "opencode-zen", "anthropic", "openai")
 *   - modelID: string (e.g., "claude-sonnet-4-20250514", "glm-5.1")
 *   - time.created: number (millisecond timestamp)
 *   - tokens.input, tokens.output, tokens.reasoning: number
 *   - tokens.cache.read, tokens.cache.write: number
 *   - cost: number (typically 0 — we calculate from tokens instead)
 *
 * Branded OpenCode tiers (`opencode-go`, `opencode-zen`) are emitted as
 * distinct sources on the leaderboard. All other providerIDs (direct API
 * keys for anthropic/openai/openrouter/etc.) are bucketed into the
 * generic `opencode` source so they show up as plain OpenCode usage.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { calculateCost } from "./pricing.js";
import {
  accumulate,
  accumulatorToSyncDays,
  type DayAccumulator,
  type Source,
} from "./accumulator.js";
import type { SyncDay } from "./schemas.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/**
 * Get the OpenCode data directory.
 * Respects OPENCODE_DATA_DIR env var, falls back to platform default.
 */
function getOpenCodeDataDir(): string {
  if (process.env.OPENCODE_DATA_DIR) {
    return process.env.OPENCODE_DATA_DIR;
  }

  const platform = process.platform;
  if (platform === "darwin") {
    return join(homedir(), ".local", "share", "opencode");
  }
  if (platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "opencode");
  }
  // Linux and others: XDG_DATA_HOME or ~/.local/share
  const xdgData = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(xdgData, "opencode");
}

function getMessageStorageDir(): string {
  return join(getOpenCodeDataDir(), "storage", "message");
}

function getOpenCodeDbPath(): string {
  return join(getOpenCodeDataDir(), "opencode.db");
}

// ---------------------------------------------------------------------------
// Types (internal — only used for parsing, never sent to server)
// ---------------------------------------------------------------------------

interface OpenCodeMessage {
  providerID?: string;
  modelID?: string;
  time?: { created?: number };
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
  cost?: number;
}

// ---------------------------------------------------------------------------
// Provider routing
// ---------------------------------------------------------------------------

/**
 * Branded OpenCode tiers that get their own source slug on the leaderboard.
 * Anything else (direct API keys for anthropic/openai/openrouter/groq, etc.)
 * is routed to the catch-all "opencode" source.
 */
const KNOWN_OPENCODE_TIERS: ReadonlySet<string> = new Set([
  "opencode-go",
  "opencode-zen",
]);

type OpenCodeSource = Extract<Source, "opencode" | "opencode-go" | "opencode-zen">;

/**
 * Map a message's providerID to a leaderboard source slug.
 *
 * Branded tiers (opencode-go, opencode-zen) get their own slug.
 * Missing or unknown providerIDs fall back to the catch-all "opencode".
 */
function sourceForProviderID(providerID?: string): OpenCodeSource {
  if (providerID && KNOWN_OPENCODE_TIERS.has(providerID)) {
    return providerID as OpenCodeSource;
  }
  return "opencode";
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Check whether OpenCode data exists on this machine.
 *
 * Detects both layouts so DB-only installations (Go binary ≥1.14, which only
 * writes `opencode.db` and no longer populates `storage/message/`) are not
 * missed by callers gating on this helper:
 *   - SQLite database: `opencode.db`
 *   - Legacy/intermediate JSON: `storage/message/`
 */
export function hasOpenCodeData(): boolean {
  return existsSync(getOpenCodeDbPath()) || existsSync(getMessageStorageDir());
}

/**
 * Process a single parsed message: validate, route to the right
 * per-source accumulator. Errors and missing fields are silently skipped.
 *
 * Mutates `byProviderByDate` in place.
 */
function processMessageData(
  msg: OpenCodeMessage,
  sinceMs: number,
  byProviderByDate: Record<OpenCodeSource, Record<string, DayAccumulator>>
): void {
  const created = msg.time?.created;
  if (!created || typeof created !== "number") return;
  if (sinceMs && created < sinceMs) return;

  const date = new Date(created).toISOString().slice(0, 10);
  const modelId = msg.modelID ?? "unknown";

  // NOTE: AI SDK v6 (Mar 2026) normalized inputTokens to include cache for
  // all providers, but OpenCode's message JSON still stores raw, non-
  // overlapping components. Verified empirically: input + output + reasoning
  // + cache.read + cache.write == total for 100% of messages with a total.
  const input = Number(msg.tokens?.input) || 0;
  const output = Number(msg.tokens?.output) || 0;
  const reasoning = Number(msg.tokens?.reasoning) || 0;
  const cacheWrite = Number(msg.tokens?.cache?.write) || 0;
  const cacheRead = Number(msg.tokens?.cache?.read) || 0;

  // Skip only when every activity metric is zero — cache-only or
  // reasoning-only messages still represent billable work.
  if (
    input === 0 &&
    output === 0 &&
    reasoning === 0 &&
    cacheWrite === 0 &&
    cacheRead === 0
  ) {
    return;
  }

  // Treat reasoning tokens as part of output for cost calculation
  // (most providers bill reasoning at the output rate).
  const outputForCost = output + reasoning;

  const cost =
    (Number(msg.cost) || 0) > 0
      ? Number(msg.cost)
      : calculateCost(modelId, {
          input,
          output: outputForCost,
          cacheCreation: cacheWrite,
          cacheRead,
        });

  const source = sourceForProviderID(msg.providerID);

  accumulate(byProviderByDate[source], date, modelId, {
    input,
    output: outputForCost,
    cacheCreation: cacheWrite,
    cacheRead,
    cost,
  });
}

/**
 * Process a single message file: read from disk, parse, then delegate to
 * processMessageData.
 */
async function processMessageFile(
  filePath: string,
  sinceMs: number,
  byProviderByDate: Record<OpenCodeSource, Record<string, DayAccumulator>>
): Promise<void> {
  let msg: OpenCodeMessage;
  try {
    const raw = await readFile(filePath, "utf-8");
    msg = JSON.parse(raw) as OpenCodeMessage;
  } catch {
    return;
  }
  processMessageData(msg, sinceMs, byProviderByDate);
}

/**
 * Read messages from the OpenCode SQLite database.
 *
 * Newer Go-based opencode binaries (≥1.14) persist messages to
 * `~/.local/share/opencode/opencode.db` instead of JSON files.
 * This function queries the `message` table and processes each row's
 * JSON `data` column through the same pipeline as on-disk JSON files.
 *
 * Uses the system's `sqlite3` CLI (already present on macOS and most
 * Linux distros). If the CLI is missing, this function is a no-op.
 *
 * @param sinceMs - Epoch ms; rows with `time.created` before this are skipped.
 * @param byProviderByDate - Mutable accumulator map.
 */
function extractFromDb(
  sinceMs: number,
  byProviderByDate: Record<OpenCodeSource, Record<string, DayAccumulator>>
): void {
  const dbPath = getOpenCodeDbPath();
  if (!existsSync(dbPath)) return;

  let output: string;
  try {
    output = execFileSync(
      "sqlite3",
      [
        dbPath,
        "SELECT data FROM message WHERE json_extract(data, '$.time.created') IS NOT NULL",
      ],
      { encoding: "utf-8", maxBuffer: 100 * 1024 * 1024, timeout: 10_000 }
    );
  } catch {
    return;
  }

  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    let msg: OpenCodeMessage;
    try {
      msg = JSON.parse(line) as OpenCodeMessage;
    } catch {
      continue;
    }
    processMessageData(msg, sinceMs, byProviderByDate);
  }
}

/**
 * Read all OpenCode message files and aggregate into daily usage data,
 * partitioned by source slug (one of "opencode" / "opencode-go" / "opencode-zen").
 *
 * PRIVACY: Only date, token counts, cost, and model names are extracted.
 * Session IDs, project paths, prompts, and tool outputs are never read.
 *
 * Three on-disk layouts are supported:
 *   - **SQLite database (Go binary ≥1.14):** `opencode.db` — preferred source
 *   - **Legacy TypeScript opencode:** `storage/message/<sessionID>/msg_*.json`
 *   - **Native Go opencode binary (intermediate):** `storage/message/msg_*.json` (flat)
 *
 * When the SQLite DB exists and `sqlite3` is available, it is used as the
 * sole source of truth (it contains a superset of the JSON-file data).
 * Otherwise we fall back to walking the JSON directories.
 *
 * @param since - Optional YYYY-MM-DD date; messages before this are skipped.
 * @returns Array of SyncDay objects ready for Zod validation, with each day
 *   tagged with the appropriate source. The same calendar date may appear
 *   multiple times in the array (once per source) if the user used both
 *   a branded tier and direct keys on the same day.
 */
export async function extractOpenCodeData(since?: string): Promise<SyncDay[]> {
  const sinceMs = since ? new Date(since).getTime() : 0;

  // Per-source accumulators. The first key is the source slug; the second
  // key is the date string.
  const byProviderByDate: Record<OpenCodeSource, Record<string, DayAccumulator>> = {
    opencode: {},
    "opencode-go": {},
    "opencode-zen": {},
  };

  // -------------------------------------------------------------------------
  // Primary source: SQLite DB (Go binary ≥1.14)
  // -------------------------------------------------------------------------
  extractFromDb(sinceMs, byProviderByDate);

  const dbYieldedData = Object.values(byProviderByDate).some(
    (acc) => Object.keys(acc).length > 0
  );

  if (dbYieldedData) {
    // DB is the authoritative source; skip JSON files to avoid double-counting.
    const allDays: SyncDay[] = [];
    for (const source of Object.keys(byProviderByDate) as OpenCodeSource[]) {
      const days = accumulatorToSyncDays(byProviderByDate[source], source);
      allDays.push(...days);
    }
    return allDays;
  }

  // -------------------------------------------------------------------------
  // Fallback: JSON files (legacy TypeScript or intermediate Go layouts)
  // -------------------------------------------------------------------------
  const messageDir = getMessageStorageDir();

  let entries: string[];
  try {
    entries = await readdir(messageDir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const entryPath = join(messageDir, entry);

    let entryStat;
    try {
      entryStat = await stat(entryPath);
    } catch {
      continue;
    }

    // Native Go opencode layout: flat msg_*.json file at the top level.
    if (entryStat.isFile() && entry.endsWith(".json") && entry.startsWith("msg_")) {
      // Quick skip on file mtime
      if (sinceMs && entryStat.mtimeMs < sinceMs) continue;
      await processMessageFile(entryPath, sinceMs, byProviderByDate);
      continue;
    }

    // Legacy TypeScript opencode layout: <sessionID>/msg_*.json
    if (!entryStat.isDirectory()) continue;

    // Quick skip on directory mtime
    if (sinceMs && entryStat.mtimeMs < sinceMs) continue;

    let messageFiles: string[];
    try {
      messageFiles = await readdir(entryPath);
    } catch {
      continue;
    }

    for (const file of messageFiles) {
      if (!file.endsWith(".json")) continue;
      await processMessageFile(join(entryPath, file), sinceMs, byProviderByDate);
    }
  }

  // Emit one SyncDay[] per source, then concatenate.
  const allDays: SyncDay[] = [];
  for (const source of Object.keys(byProviderByDate) as OpenCodeSource[]) {
    const days = accumulatorToSyncDays(byProviderByDate[source], source);
    allDays.push(...days);
  }
  return allDays;
}
