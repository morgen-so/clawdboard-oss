/**
 * Codex CLI usage data extraction.
 *
 * Reads Codex's rollout JSONL files from disk, extracts token counts per session,
 * calculates costs, and returns daily aggregates as SyncDay[].
 *
 * Codex stores session rollouts at:
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<id>.jsonl
 * and compresses cold ones in place to `rollout-…jsonl.zst`.
 *
 * Each JSONL file contains multiple line types. We read:
 *   - "session_meta" lines → whether the file is a fork of another session
 *   - "turn_context" lines → model name per turn
 *   - "event_msg" lines with payload.type "token_count" → cumulative token counts
 *
 * Forks and sub-agents: a forked thread (`/fork`, or a sub-agent spawned with
 * the parent's history) gets its own rollout file that starts with a verbatim
 * copy of the parent's lines, token_count events included, and its running
 * total continues from the parent's. Taking each file's last total therefore
 * counted the parent again for every fork. We sum per-event deltas instead
 * and, in a fork, skip the copied block: the leading events that also appear
 * in the parent's own rollout.
 *
 * PRIVACY: Only date, token counts, cost, and model names are extracted.
 * Session ids are compared in memory to recognise forks and never leave this
 * module. Project paths, git info, and prompts are never read.
 */

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as zlib from "node:zlib";
import { calculateCost } from "./pricing.js";
import { accumulate, accumulatorToSyncDays, type DayAccumulator } from "./accumulator.js";
import type { SyncDay } from "./schemas.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getCodexHome(): string {
  const envHome = process.env.CODEX_HOME;
  if (envHome && existsSync(envHome)) return envHome;
  return join(homedir(), ".codex");
}

function getSessionsDir(): string {
  return join(getCodexHome(), "sessions");
}

// ---------------------------------------------------------------------------
// Types (internal only — never sent to server)
// ---------------------------------------------------------------------------

interface TokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

interface TokenEvent {
  /** Identity of the event, identical on a fork's copy of it. */
  key: string;
  input: number;
  cached: number;
  output: number;
}

interface ParsedRollout {
  date: string;
  model: string | null;
  /** This session's id, from its first session_meta line. */
  sessionId: string | null;
  /** The session this one was forked from, if it is a fork. */
  parentId: string | null;
  events: TokenEvent[];
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Check whether Codex session data exists on this machine.
 */
export function hasCodexData(): boolean {
  return existsSync(getSessionsDir());
}

/**
 * Read all Codex rollout files and aggregate into daily usage data.
 *
 * Strategy:
 * 1. Parse every rollout (plain or zstd) into its model, its token_count
 *    events, and the session it was forked from, if any (parseRolloutFile).
 * 2. Per file, sum the deltas between consecutive running totals. In a fork,
 *    skip the copied block: the leading events that also appear in the
 *    parent's rollout. If the parent's rollout is gone, nothing is skipped,
 *    since the copy is then the only record of that usage.
 * 3. Attribute the file's usage to the date in its year/month/day path.
 *
 * @param since - Optional YYYY-MM-DD date; sessions before this are not
 *   reported, but are still read so a later fork of them isn't double-counted.
 * @returns Array of SyncDay objects ready for Zod validation.
 */
export async function extractCodexData(since?: string): Promise<SyncDay[]> {
  const sessionsDir = getSessionsDir();
  const sinceDate = since ? new Date(since) : null;

  const files = await listRolloutFiles(sessionsDir);
  const decodeZstd = getZstdDecoder();

  const parsed: ParsedRollout[] = [];
  for (const { path, date } of files) {
    try {
      const content = await readRollout(path, decodeZstd);
      if (content === null) continue;
      parsed.push({ date, ...parseRolloutFile(content) });
    } catch {
      continue;
    }
  }

  const eventsBySession = new Map<string, Set<string>>();
  for (const rollout of parsed) {
    if (!rollout.sessionId) continue;
    const keys = eventsBySession.get(rollout.sessionId) ?? new Set<string>();
    for (const event of rollout.events) keys.add(event.key);
    eventsBySession.set(rollout.sessionId, keys);
  }

  const byDate: Record<string, DayAccumulator> = {};

  for (const rollout of parsed) {
    if (sinceDate && new Date(rollout.date) < sinceDate) continue;
    const parentEvents = rollout.parentId ? eventsBySession.get(rollout.parentId) : undefined;
    const usage = sumOwnUsage(rollout.events, parentEvents);
    if (usage.input === 0 && usage.output === 0) continue;

    const modelId = rollout.model || "unknown";
    // OpenAI reports cached_input_tokens as a SUBSET of input_tokens
    // (Codex's own total_tokens = input + output). Subtract so the
    // cached portion is counted (and billed) once, at the cache-read
    // rate — unlike Anthropic, where the two fields are disjoint.
    const cacheRead = usage.cached;
    const input = Math.max(0, usage.input - cacheRead);
    const output = usage.output;

    const cost = calculateCost(modelId, {
      input,
      output,
      cacheCreation: 0,
      cacheRead,
    });

    accumulate(byDate, rollout.date, modelId, {
      input,
      output,
      cacheCreation: 0,
      cacheRead,
      cost,
    });
  }

  return accumulatorToSyncDays(byDate, "codex");
}

/**
 * Sum the usage a rollout added itself, as deltas between consecutive running
 * totals. In a fork, the leading events that also appear in the parent's
 * rollout are the copied history: they add nothing, though they still move
 * the baseline the child's own totals continue from. The copy is one block at
 * the top of the file, so the first event not in the parent ends it.
 *
 * A total that goes down means Codex reset its counter (it overwrites the
 * total when the context window overflows), so that event counts from zero.
 */
function sumOwnUsage(
  events: TokenEvent[],
  parentEvents: Set<string> | undefined
): { input: number; cached: number; output: number } {
  const own = { input: 0, cached: 0, output: 0 };
  let prev = { input: 0, cached: 0, output: 0 };
  let inCopiedBlock = parentEvents !== undefined;

  for (const event of events) {
    if (inCopiedBlock && !parentEvents!.has(event.key)) inCopiedBlock = false;
    const inherited = inCopiedBlock;

    const reset = event.input < prev.input || event.output < prev.output;
    const base = reset ? { input: 0, cached: 0, output: 0 } : prev;

    if (!inherited) {
      own.input += Math.max(0, event.input - base.input);
      own.cached += Math.max(0, event.cached - base.cached);
      own.output += Math.max(0, event.output - base.output);
    }
    prev = { input: event.input, cached: event.cached, output: event.output };
  }

  return own;
}

/** List every rollout file under sessions/YYYY/MM/DD, in path order. */
async function listRolloutFiles(
  sessionsDir: string
): Promise<{ path: string; date: string }[]> {
  const out: { path: string; date: string }[] = [];

  let years: string[];
  try {
    years = (await readdir(sessionsDir)).sort();
  } catch {
    return out;
  }

  for (const year of years) {
    if (!/^\d{4}$/.test(year)) continue;

    let months: string[];
    try {
      months = (await readdir(join(sessionsDir, year))).sort();
    } catch {
      continue;
    }

    for (const month of months) {
      if (!/^\d{2}$/.test(month)) continue;

      let days: string[];
      try {
        days = (await readdir(join(sessionsDir, year, month))).sort();
      } catch {
        continue;
      }

      for (const day of days) {
        if (!/^\d{2}$/.test(day)) continue;

        const dayDir = join(sessionsDir, year, month, day);
        let files: string[];
        try {
          files = (await readdir(dayDir)).sort();
        } catch {
          continue;
        }

        const plain = new Set(files.filter((f) => f.endsWith(".jsonl")));
        for (const file of files) {
          if (file.endsWith(".jsonl.zst")) {
            // Mid-compression both copies exist; read the plain one only.
            if (plain.has(file.slice(0, -".zst".length))) continue;
          } else if (!file.endsWith(".jsonl")) {
            continue;
          }
          out.push({ path: join(dayDir, file), date: `${year}-${month}-${day}` });
        }
      }
    }
  }

  return out;
}

type ZstdDecompressSync = (buf: Buffer) => Buffer;

/** Node ≥ 22.15 / 23.8 ships zstd in node:zlib; older runtimes skip compressed rollouts. */
function getZstdDecoder(): ZstdDecompressSync | null {
  const fn = (zlib as unknown as { zstdDecompressSync?: unknown }).zstdDecompressSync;
  return typeof fn === "function" ? (fn as ZstdDecompressSync) : null;
}

async function readRollout(
  path: string,
  decodeZstd: ZstdDecompressSync | null
): Promise<string | null> {
  if (!path.endsWith(".zst")) return readFile(path, "utf-8");
  if (!decodeZstd) return null;
  return decodeZstd(await readFile(path)).toString("utf-8");
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Parse a single rollout JSONL file into its model, its token_count events,
 * its session id, and the session it was forked from.
 *
 * The first session_meta line is the file's own. A fork names its parent in
 * that line's `forked_from_id`; older Codex didn't, but a fork still carries
 * a copy of the parent's session_meta, so the first other session id in the
 * file is the parent.
 *
 * PRIVACY: Only reads "session_meta" (ids, compared in memory), "turn_context"
 * (for model) and "event_msg" with type "token_count" (for tokens). All other
 * line types are skipped — prompts, tool outputs, file paths, and git info are
 * never parsed.
 */
function parseRolloutFile(content: string): Omit<ParsedRollout, "date"> {
  let model: string | null = null;
  let sessionId: string | null = null;
  let parentId: string | null = null;
  const events: TokenEvent[] = [];

  for (const line of content.split("\n")) {
    // Cheap prefilter: most lines are prompts and tool output we never read.
    if (
      !line.includes('"token_count"') &&
      !line.includes('"turn_context"') &&
      !line.includes('"session_meta"')
    ) {
      continue;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    const type = parsed.type as string | undefined;
    const payload = parsed.payload as Record<string, unknown> | undefined;
    if (!payload) continue;

    if (type === "session_meta") {
      const id = payload.id;
      if (typeof id !== "string") continue;
      if (sessionId === null) {
        sessionId = id;
        const forkedFrom = payload.forked_from_id;
        if (typeof forkedFrom === "string") parentId = forkedFrom;
      } else if (parentId === null && id !== sessionId) {
        parentId = id;
      }
    } else if (type === "turn_context") {
      // Extract model name from turn context
      const m = payload.model as string | undefined;
      if (m) model = m;
    } else if (type === "event_msg" && payload.type === "token_count") {
      const info = payload.info as Record<string, unknown> | undefined;
      const total = info?.total_token_usage as TokenUsage | undefined;
      if (!total) continue;
      const last = info?.last_token_usage as TokenUsage | undefined;
      events.push({
        key: JSON.stringify([usageTuple(total), last ? usageTuple(last) : null]),
        input: num(total.input_tokens),
        cached: num(total.cached_input_tokens),
        output: num(total.output_tokens),
      });
    }
  }

  return { model, sessionId, parentId, events };
}

function usageTuple(u: TokenUsage): number[] {
  return [
    num(u.input_tokens),
    num(u.cached_input_tokens),
    num(u.output_tokens),
    num(u.reasoning_output_tokens),
    num(u.total_tokens),
  ];
}
