/**
 * DeepSeek Harness (dsh) usage data extraction.
 *
 * DeepSeek Harness (`@deepseek-ai/dsh`) persists every session as an
 * append-only event log via its `dsh-session-persistence-jsonl` plugin:
 *
 *   ~/.dsh/sessions/<project-key>/<session-id>/session.jsonl.zstd
 *   ~/.dsh/sessions/_no-cwd/<session-id>/session.jsonl.zstd
 *
 * `DSH_HOME` relocates the harness home (`~/.dsh`). The project key is the
 * cwd with separators turned into hyphens, wrapped in `--…--`.
 *
 * Physical encoding defaults to Zstandard: the file is a concatenation of
 * independent zstd frames (one per flushed batch), each with a content
 * checksum. Decoding the frames in order and joining the output yields the
 * plain JSONL. `compression: none` writes a plain `session.jsonl` instead.
 * Both are handled; a torn trailing frame (crash mid-write) is ignored.
 *
 * Logical format (SESSION_FORMAT_VERSION 0):
 *   line 0:  { type: "session", version, id, createdAt, cwd?, ... }  — header
 *   line n:  { type, seq, time, data }                              — SessionEvent
 *   plus packed chunk rows ({ type: "text-chunks" | "reasoning-chunks" |
 *   "tool-call-chunks", seq0, time0, data }) which carry no usage.
 *
 * Usage rides on `assistant/message` events:
 *   data: { turn, step, message, usage?: { inputTokens, outputTokens,
 *           cacheReadTokens?, cacheWriteTokens?, reasoningTokens? } }
 * The harness `TokenUsage` convention is DISJOINT counts — its adapters
 * subtract cache hits out of `inputTokens` (e.g. DeepSeek's
 * `prompt_cache_hit_tokens`, OpenAI's `cached_tokens`), so no subset
 * correction is needed here. `reasoningTokens` is a breakdown of
 * `outputTokens` for chat-completions-style APIs and is not added on top.
 *
 * The model isn't on the message; it comes from the most recent
 * `request/header` (data.header.config.model) or `request/context`
 * (data.model) event that precedes it in the log.
 *
 * Same privacy guarantees as the other extractors: only aggregate metrics
 * (date, model, token counts, cost) leave the machine — no prompts, tool
 * calls, cwd, session ids, or titles.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import * as zlib from "node:zlib";
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

/** Expand a leading `~` the way dsh's own home resolver does. */
function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

/** Get the dsh home directory. Respects DSH_HOME. */
function getDshHome(): string {
  const fromEnv = process.env.DSH_HOME;
  if (fromEnv && fromEnv.trim().length > 0) {
    return resolve(expandHome(fromEnv.trim()));
  }
  return join(homedir(), ".dsh");
}

function getSessionsRoot(): string {
  return join(getDshHome(), "sessions");
}

// ---------------------------------------------------------------------------
// Internal types — only used during parsing, never sent to server
// ---------------------------------------------------------------------------

interface DshUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

interface DshEvent {
  type?: string;
  seq?: number;
  time?: number;
  data?: {
    usage?: DshUsage;
    // request/context
    model?: string;
    // request/header
    header?: { config?: { model?: string } };
    // message, turn, step, chunk payloads are deliberately not declared —
    // we never read them.
  };
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** Check whether dsh session data exists on this machine. */
export function hasDeepSeekHarnessData(): boolean {
  return existsSync(getSessionsRoot());
}

// ---------------------------------------------------------------------------
// Zstandard container
// ---------------------------------------------------------------------------

const ZSTD_MAGIC = 0xfd2fb528;

/**
 * Locate complete frames in a concatenated zstd stream without decompressing
 * (RFC 8878 frame layout). Stops at the first structurally incomplete frame
 * (a torn trailing write) or on anything that isn't a plain zstd frame.
 */
export function scanZstdFrames(
  buffer: Buffer
): { start: number; end: number }[] {
  const frames: { start: number; end: number }[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 5) break;
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break;
    offset += 4;

    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 0x08) !== 0) break; // reserved bit set

    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 0x20) !== 0;
    const checksum = (descriptor & 0x04) !== 0;
    const dictionaryFlag = descriptor & 0x03;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes =
      contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes =
      (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) break;
    offset += remainingHeaderBytes;

    let complete = false;
    for (;;) {
      if (buffer.length - offset < 3) break;
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 0x03;
      const blockSize = blockHeader >>> 3;
      if (blockType === 0x03) return frames; // reserved block type
      const payloadBytes = blockType === 0x01 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) break;
      offset += payloadBytes;
      if (lastBlock) {
        complete = true;
        break;
      }
    }
    if (!complete) break;

    if (checksum) {
      if (buffer.length - offset < 4) break;
      offset += 4;
    }
    frames.push({ start, end: offset });
  }

  return frames;
}

type ZstdDecompressSync = (buf: Buffer) => Buffer;

/** Node ≥ 22.15 / 23.8 ships zstd in node:zlib; older runtimes can't read compressed logs. */
function getZstdDecoder(): ZstdDecompressSync | null {
  const fn = (zlib as unknown as { zstdDecompressSync?: unknown }).zstdDecompressSync;
  return typeof fn === "function" ? (fn as ZstdDecompressSync) : null;
}

/** Decode a concatenated-frame zstd session log to its JSONL text (complete frames only). */
function decodeZstdLog(buffer: Buffer, decode: ZstdDecompressSync): string {
  const parts: Buffer[] = [];
  for (const { start, end } of scanZstdFrames(buffer)) {
    try {
      parts.push(decode(buffer.subarray(start, end)));
    } catch {
      break; // corrupt frame — keep whatever decoded cleanly before it
    }
  }
  return Buffer.concat(parts).toString("utf-8");
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Fold one session log's assistant messages into the accumulator, tracking
 * the active model from request/header and request/context events.
 */
function parseLog(
  text: string,
  byDate: Record<string, DayAccumulator>,
  sinceMs: number
): void {
  let model = "unknown";

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let event: DshEvent;
    try {
      event = JSON.parse(line) as DshEvent;
    } catch {
      continue;
    }
    const data = event.data;
    if (!data || typeof data !== "object") continue;

    if (event.type === "request/header") {
      const m = data.header?.config?.model;
      if (typeof m === "string" && m.trim()) model = m.trim();
      continue;
    }
    if (event.type === "request/context") {
      if (typeof data.model === "string" && data.model.trim()) {
        model = data.model.trim();
      }
      continue;
    }
    if (event.type !== "assistant/message") continue;

    const usage = data.usage;
    if (!usage || typeof usage !== "object") continue;
    if (typeof event.time !== "number" || !Number.isFinite(event.time) || event.time <= 0) {
      continue;
    }
    if (sinceMs && event.time < sinceMs) continue;
    const date = new Date(event.time).toISOString().slice(0, 10);

    const input = Math.max(0, Math.round(Number(usage.inputTokens) || 0));
    const output = Math.max(0, Math.round(Number(usage.outputTokens) || 0));
    const cacheRead = Math.max(0, Math.round(Number(usage.cacheReadTokens) || 0));
    const cacheWrite = Math.max(0, Math.round(Number(usage.cacheWriteTokens) || 0));
    if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) continue;

    const cost = calculateCost(model, {
      input,
      output,
      cacheCreation: cacheWrite,
      cacheRead,
    });

    accumulate(byDate, date, model, {
      input,
      output,
      cacheCreation: cacheWrite,
      cacheRead,
      cost,
    });
  }
}

/** Read a session log (plain or zstd) as JSONL text. Null when unreadable. */
async function readLog(
  filePath: string,
  zstd: ZstdDecompressSync | null
): Promise<string | null> {
  let buffer: Buffer;
  try {
    buffer = await readFile(filePath);
  } catch {
    return null;
  }
  if (filePath.endsWith(".zstd")) {
    if (!zstd) return null;
    return decodeZstdLog(buffer, zstd);
  }
  return buffer.toString("utf-8");
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Read all dsh session logs and aggregate into daily usage data.
 *
 * @param since - Optional YYYY-MM-DD date; events before this are skipped.
 */
export async function extractDeepSeekHarnessData(
  since?: string
): Promise<SyncDay[]> {
  const root = getSessionsRoot();
  const sinceMs = since ? new Date(since).getTime() : 0;
  const zstd = getZstdDecoder();

  let projectDirs: string[];
  try {
    projectDirs = await readdir(root);
  } catch {
    return [];
  }

  const byDate: Record<string, DayAccumulator> = {};

  for (const projectDir of projectDirs) {
    const projectPath = join(root, projectDir);
    let sessionDirs: string[];
    try {
      if (!(await stat(projectPath)).isDirectory()) continue;
      sessionDirs = await readdir(projectPath);
    } catch {
      continue;
    }

    for (const sessionDir of sessionDirs) {
      const dir = join(projectPath, sessionDir);
      // Prefer the compressed log; the backend writes exactly one of the two.
      for (const name of ["session.jsonl.zstd", "session.jsonl"]) {
        const filePath = join(dir, name);
        let fileStat;
        try {
          fileStat = await stat(filePath);
        } catch {
          continue;
        }
        if (!fileStat.isFile()) continue;
        // Quick skip: file mtime older than `since`
        if (sinceMs && fileStat.mtimeMs < sinceMs) break;

        const text = await readLog(filePath, zstd);
        if (text !== null) parseLog(text, byDate, sinceMs);
        break;
      }
    }
  }

  return accumulatorToSyncDays(byDate, "deepseek-harness");
}
