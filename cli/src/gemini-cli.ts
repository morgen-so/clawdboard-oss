/**
 * Google Gemini CLI usage data extraction.
 *
 * Reads gemini-cli's session JSONL files from disk, aggregates by date and
 * model, calculates costs from token counts, and returns SyncDay objects.
 *
 * Same privacy guarantees as the other extractors: only aggregate metrics
 * (date, model, token counts, cost) leave the machine — no prompts, code,
 * file paths, project hashes, session ids, or thought summaries.
 *
 * Gemini CLI stores chat history at:
 *   ~/.gemini/tmp/<projectIdentifier>/chats/session-<sessionId>.jsonl
 *
 * Each line is one of four record kinds:
 *   1. PartialMetadataRecord (header) — first line of every session
 *      `{ sessionId, projectHash, startTime, lastUpdated, kind }`
 *   2. MessageRecord — one per user/assistant turn
 *      `{ id, timestamp, type: "user" | "gemini", content, [thoughts], [tokens], [model] }`
 *   3. MetadataUpdateRecord — `{ "$set": { lastUpdated: "..." } }` (ignore)
 *   4. RewindRecord — `{ "$rewindTo": "<id>" }` — drop all messages from
 *      the rewound id onwards in the session order.
 *
 * Only `type: "gemini"` MessageRecords carry token counts. Costs are
 * computed via the pricing table; gemini-cli does not persist cost.
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

/** Get the Gemini CLI data directory. Respects GEMINI_HOME env var. */
function getGeminiDataDir(): string {
  if (process.env.GEMINI_HOME) {
    return process.env.GEMINI_HOME;
  }
  return join(homedir(), ".gemini");
}

function getChatsRoot(): string {
  return join(getGeminiDataDir(), "tmp");
}

// ---------------------------------------------------------------------------
// Internal types — only used during parsing, never sent to server
// ---------------------------------------------------------------------------

interface GeminiTokenCounts {
  input?: number;
  output?: number;
  cached?: number;
  thoughts?: number;
  tool?: number;
  total?: number;
}

interface GeminiMessageRecord {
  id?: string;
  timestamp?: string;
  type?: "user" | "gemini" | string;
  tokens?: GeminiTokenCounts;
  model?: string;
  // Other fields (content, thoughts) are deliberately not declared —
  // we never read them.
}

/** Either a MessageRecord, MetadataUpdate ($set), Rewind ($rewindTo), or PartialMetadata. */
interface MaybeRewindRecord {
  $rewindTo?: string;
  $set?: unknown;
  // For MessageRecord and PartialMetadata, these are present:
  id?: string;
  timestamp?: string;
  type?: string;
  // ...
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** Check whether gemini-cli session data exists on this machine. */
export function hasGeminiCliData(): boolean {
  return existsSync(getChatsRoot());
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a single session JSONL file and return its gemini message records
 * (in file order), with rewinds applied: any message whose id was rewound
 * past is dropped.
 *
 * Returns only `type === "gemini"` records that have a `tokens` object —
 * other kinds carry no usage data.
 */
async function parseSession(filePath: string): Promise<GeminiMessageRecord[]> {
  let text: string;
  try {
    text = await readFile(filePath, "utf-8");
  } catch {
    return [];
  }

  // Order-preserving list of all gemini message records seen in this file.
  const messages: GeminiMessageRecord[] = [];
  // Track gemini message ids so we can implement $rewindTo correctly.
  const idToIndex = new Map<string, number>();

  // We track all message-bearing records (user + gemini) for rewind anchoring,
  // then filter to gemini-only at the end. The user-message anchor enables
  // rewinds that target a user message (drop the assistant response that
  // followed) — but in practice gemini-cli rewinds only point at user msgs.
  // Keeping the full id list lets us be tolerant.
  const allOrderedIds: string[] = [];
  const allRecords = new Map<string, MaybeRewindRecord>();

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let record: MaybeRewindRecord;
    try {
      record = JSON.parse(line) as MaybeRewindRecord;
    } catch {
      continue;
    }

    // RewindRecord: drop everything from the target id forward (inclusive).
    if (typeof record.$rewindTo === "string") {
      const targetId = record.$rewindTo;
      const idx = allOrderedIds.indexOf(targetId);
      if (idx >= 0) {
        // Remove all subsequent ids and any associated gemini messages.
        const removed = allOrderedIds.splice(idx);
        for (const id of removed) {
          allRecords.delete(id);
          // Also drop from messages array if present.
          const mIdx = messages.findIndex((m) => m.id === id);
          if (mIdx >= 0) messages.splice(mIdx, 1);
          idToIndex.delete(id);
        }
      }
      continue;
    }

    // MetadataUpdateRecord ($set): ignore
    if (record.$set !== undefined) continue;

    // PartialMetadataRecord: has sessionId/projectHash/startTime, no `type`
    if (!record.type) continue;

    // MessageRecord: must have id and type
    if (typeof record.id !== "string") continue;

    allOrderedIds.push(record.id);
    allRecords.set(record.id, record);

    if (record.type === "gemini") {
      const msg = record as GeminiMessageRecord;
      idToIndex.set(record.id, messages.length);
      messages.push(msg);
    }
  }

  return messages;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Read all gemini-cli session files and aggregate into daily usage data.
 *
 * @param since - Optional YYYY-MM-DD date; messages before this are skipped.
 */
export async function extractGeminiCliData(
  since?: string
): Promise<SyncDay[]> {
  const chatsRoot = getChatsRoot();
  const sinceMs = since ? new Date(since).getTime() : 0;

  let projectDirs: string[];
  try {
    projectDirs = await readdir(chatsRoot);
  } catch {
    return [];
  }

  const byDate: Record<string, DayAccumulator> = {};

  for (const projectDir of projectDirs) {
    const chatsDir = join(chatsRoot, projectDir, "chats");
    let chatsDirStat;
    try {
      chatsDirStat = await stat(chatsDir);
    } catch {
      continue;
    }
    if (!chatsDirStat.isDirectory()) continue;

    let sessionFiles: string[];
    try {
      sessionFiles = await readdir(chatsDir);
    } catch {
      continue;
    }

    for (const file of sessionFiles) {
      if (!file.startsWith("session-") || !file.endsWith(".jsonl")) continue;

      const filePath = join(chatsDir, file);

      // Quick skip: file mtime older than `since`
      let fileStat;
      try {
        fileStat = await stat(filePath);
      } catch {
        continue;
      }
      if (sinceMs && fileStat.mtimeMs < sinceMs) continue;

      const messages = await parseSession(filePath);

      for (const msg of messages) {
        if (!msg.tokens) continue;
        if (!msg.timestamp) continue;
        if (typeof msg.timestamp !== "string") continue;

        const ts = new Date(msg.timestamp).getTime();
        if (Number.isNaN(ts)) continue;
        if (sinceMs && ts < sinceMs) continue;

        const date = msg.timestamp.slice(0, 10); // ISO 8601 → YYYY-MM-DD
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

        const modelId = msg.model ?? "gemini-unknown";
        const input = Number(msg.tokens.input) || 0;
        const output = Number(msg.tokens.output) || 0;
        // Gemini's "thoughts" tokens are billed as output for reasoning;
        // we accumulate them with output to keep the cost calculation
        // consistent with gemini-api's billing model.
        const thoughts = Number(msg.tokens.thoughts) || 0;
        const cached = Number(msg.tokens.cached) || 0;

        if (input === 0 && output === 0 && thoughts === 0) continue;

        const cost = calculateCost(modelId, {
          input,
          output: output + thoughts,
          cacheCreation: 0,
          cacheRead: cached,
        });

        accumulate(byDate, date, modelId, {
          input,
          output: output + thoughts,
          cacheCreation: 0,
          cacheRead: cached,
          cost,
        });
      }
    }
  }

  return accumulatorToSyncDays(byDate, "gemini-cli");
}
