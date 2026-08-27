/**
 * Pi coding agent usage data extraction.
 *
 * Pi (`@earendil-works/pi-coding-agent`, the `pi` binary) auto-saves every
 * session as a JSONL file:
 *
 *   ~/.pi/agent/sessions/--<cwd-with-slashes-as-hyphens>--/<timestamp>_<uuid>.jsonl
 *
 * `PI_CODING_AGENT_SESSION_DIR` relocates the sessions directory and
 * `PI_CODING_AGENT_DIR` relocates the whole agent directory (sessions live
 * under `<dir>/sessions`). The `--session-dir` CLI flag is per-invocation and
 * can't be discovered from disk, so sessions written there are not picked up.
 *
 * Session format (version 3) is a tree of entries, one per line:
 *   { type: "session", version, id, timestamp, cwd }            — header
 *   { type: "message", id, parentId, timestamp, message: {...} } — one turn
 *   plus model_change / thinking_level_change / compaction / branch_summary /
 *   label / session_info / custom entries that carry no token usage.
 *
 * Only assistant messages carry usage:
 *   message: { role: "assistant", provider, model, usage: {
 *     input, output, cacheRead, cacheWrite, totalTokens,
 *     cost: { input, output, cacheRead, cacheWrite, total } } }
 *
 * Pi's unified LLM layer (pi-ai) already normalizes provider accounting to
 * DISJOINT counts: for OpenAI/Gemini-style APIs it subtracts cached tokens
 * from `input`, so no subset correction is needed here.
 *
 * Cost is recomputed from token counts via our pricing table rather than
 * taken from pi's `usage.cost`, so estimates stay comparable with every other
 * source on the leaderboard.
 *
 * Same privacy guarantees as the other extractors: only aggregate metrics
 * (date, model, token counts, cost) leave the machine — no prompts, tool
 * calls, cwd, session ids, or labels.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { calculateCost } from "./pricing.js";
import {
  accumulate,
  accumulatorToSyncDays,
  type DayAccumulator,
} from "./accumulator.js";
import type { SyncDay } from "./schemas.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Get the Pi sessions directory. Respects PI_CODING_AGENT_SESSION_DIR / PI_CODING_AGENT_DIR. */
function getSessionsRoot(): string {
  if (process.env.PI_CODING_AGENT_SESSION_DIR) {
    return process.env.PI_CODING_AGENT_SESSION_DIR;
  }
  if (process.env.PI_CODING_AGENT_DIR) {
    return join(process.env.PI_CODING_AGENT_DIR, "sessions");
  }
  return join(homedir(), ".pi", "agent", "sessions");
}

// ---------------------------------------------------------------------------
// Internal types — only used during parsing, never sent to server
// ---------------------------------------------------------------------------

interface PiUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

interface PiMessage {
  role?: string;
  model?: string;
  usage?: PiUsage;
  /** Unix epoch ms — fallback when the entry-level ISO timestamp is missing. */
  timestamp?: number;
  // content, provider, api, stopReason are deliberately not declared —
  // we never read them.
}

interface PiEntry {
  type?: string;
  timestamp?: string;
  message?: PiMessage;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** Check whether Pi session data exists on this machine. */
export function hasPiData(): boolean {
  return existsSync(getSessionsRoot());
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Resolve an entry's date (YYYY-MM-DD, UTC) and epoch ms, or null if unusable. */
function entryDate(entry: PiEntry): { date: string; ms: number } | null {
  let ms = NaN;
  if (typeof entry.timestamp === "string") {
    ms = new Date(entry.timestamp).getTime();
  }
  if (Number.isNaN(ms) && typeof entry.message?.timestamp === "number") {
    ms = entry.message.timestamp;
  }
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const date = new Date(ms).toISOString().slice(0, 10);
  return { date, ms };
}

/**
 * Parse one session file and fold its assistant messages into the accumulator.
 *
 * Every message entry in the file is counted, including ones on abandoned
 * branches (`parentId` forks): each one was a real API call.
 */
async function parseSession(
  filePath: string,
  byDate: Record<string, DayAccumulator>,
  sinceMs: number
): Promise<void> {
  let text: string;
  try {
    text = await readFile(filePath, "utf-8");
  } catch {
    return;
  }

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let entry: PiEntry;
    try {
      entry = JSON.parse(line) as PiEntry;
    } catch {
      continue;
    }
    if (entry.type !== "message") continue;
    const msg = entry.message;
    if (!msg || msg.role !== "assistant") continue;
    if (!msg.usage || typeof msg.usage !== "object") continue;

    const when = entryDate(entry);
    if (!when) continue;
    if (sinceMs && when.ms < sinceMs) continue;

    const input = Math.max(0, Math.round(Number(msg.usage.input) || 0));
    const output = Math.max(0, Math.round(Number(msg.usage.output) || 0));
    const cacheRead = Math.max(0, Math.round(Number(msg.usage.cacheRead) || 0));
    const cacheWrite = Math.max(0, Math.round(Number(msg.usage.cacheWrite) || 0));
    if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) continue;

    const modelId =
      typeof msg.model === "string" && msg.model.trim()
        ? msg.model.trim()
        : "unknown";

    const cost = calculateCost(modelId, {
      input,
      output,
      cacheCreation: cacheWrite,
      cacheRead,
    });

    accumulate(byDate, when.date, modelId, {
      input,
      output,
      cacheCreation: cacheWrite,
      cacheRead,
      cost,
    });
  }
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Read all Pi session files and aggregate into daily usage data.
 *
 * @param since - Optional YYYY-MM-DD date; messages before this are skipped.
 */
export async function extractPiData(since?: string): Promise<SyncDay[]> {
  const root = getSessionsRoot();
  const sinceMs = since ? new Date(since).getTime() : 0;

  let projectDirs: string[];
  try {
    projectDirs = await readdir(root);
  } catch {
    return [];
  }

  const byDate: Record<string, DayAccumulator> = {};

  for (const projectDir of projectDirs) {
    const dir = join(root, projectDir);
    let dirStat;
    try {
      dirStat = await stat(dir);
    } catch {
      continue;
    }
    if (!dirStat.isDirectory()) continue;

    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const filePath = join(dir, file);

      // Quick skip: file mtime older than `since`
      let fileStat;
      try {
        fileStat = await stat(filePath);
      } catch {
        continue;
      }
      if (!fileStat.isFile()) continue;
      if (sinceMs && fileStat.mtimeMs < sinceMs) continue;

      await parseSession(filePath, byDate, sinceMs);
    }
  }

  return accumulatorToSyncDays(byDate, "pi");
}
