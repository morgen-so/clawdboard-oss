/**
 * GitHub Copilot CLI usage data extraction.
 *
 * Reads Copilot CLI's session-state event logs from disk, aggregates by date
 * and model, and returns SyncDay objects.
 *
 * Same privacy guarantees as the other extractors: only aggregate metrics
 * (date, model, token counts, cost, premium-request count) leave the
 * machine — no prompts, code, file paths, session ids, or tool outputs.
 *
 * Copilot CLI stores per-session events at:
 *   ~/.copilot/session-state/<sessionId>/events.jsonl
 *
 * Each line is a JSON event. Token usage is only persisted in the
 * `session.shutdown` event (written when the user exits the session). Mid-
 * session usage isn't yet syncable; users should close their CLI sessions
 * before running `clawdboard sync` for full accuracy.
 *
 * The shutdown event carries:
 *   - sessionStartTime (ms since epoch)
 *   - totalPremiumRequests
 *   - modelMetrics: {
 *       [modelId]: {
 *         requests: { count, cost },
 *         usage: { inputTokens, outputTokens, cacheReadTokens,
 *                  cacheWriteTokens, reasoningTokens }
 *       }
 *     }
 *
 * Per GitHub Copilot CLI issue #2012, raw U+2028/U+2029 codepoints can
 * appear in event content and break JSON.parse — we strip them before
 * parsing. We never read content fields anyway, so this only affects
 * resilience, not behavior.
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

/** Get the Copilot CLI data directory. Respects COPILOT_HOME env var. */
function getCopilotDataDir(): string {
  if (process.env.COPILOT_HOME) {
    return process.env.COPILOT_HOME;
  }
  return join(homedir(), ".copilot");
}

function getSessionStateRoot(): string {
  return join(getCopilotDataDir(), "session-state");
}

// ---------------------------------------------------------------------------
// Internal types — only used during parsing, never sent to server
// ---------------------------------------------------------------------------

interface CopilotShutdownData {
  sessionStartTime?: number;
  totalPremiumRequests?: number;
  currentModel?: string;
  modelMetrics?: Record<
    string,
    {
      requests?: { count?: number; cost?: number };
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
        reasoningTokens?: number;
      };
    }
  >;
}

interface CopilotEvent {
  type?: string;
  timestamp?: string;
  data?: CopilotShutdownData;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** Check whether Copilot CLI session data exists on this machine. */
export function hasCopilotCliData(): boolean {
  return existsSync(getSessionStateRoot());
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Strip U+2028 / U+2029 codepoints from a JSONL line before parsing.
 * Workaround for github/copilot-cli issue #2012.
 */
function sanitizeLine(line: string): string {
  return line.replace(/[\u2028\u2029]/g, "");
}

/**
 * Find the session.shutdown event in a session's events.jsonl.
 * Returns null if the session never shut down.
 */
async function findShutdownEvent(
  filePath: string
): Promise<{ shutdown: CopilotShutdownData; eventTimestamp: string } | null> {
  let text: string;
  try {
    text = await readFile(filePath, "utf-8");
  } catch {
    return null;
  }

  // Walk lines from the end for efficiency — shutdown is typically last.
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i].trim();
    if (!raw) continue;
    let event: CopilotEvent;
    try {
      event = JSON.parse(sanitizeLine(raw)) as CopilotEvent;
    } catch {
      continue;
    }
    if (event.type === "session.shutdown" && event.data) {
      return {
        shutdown: event.data,
        eventTimestamp: typeof event.timestamp === "string" ? event.timestamp : "",
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Read all Copilot CLI session shutdown events and aggregate into daily
 * usage data tagged with `source: "copilot-cli"`.
 *
 * @param since - Optional YYYY-MM-DD date; sessions before this are skipped.
 */
export async function extractCopilotCliData(
  since?: string
): Promise<SyncDay[]> {
  const root = getSessionStateRoot();
  const sinceMs = since ? new Date(since).getTime() : 0;

  let sessionDirs: string[];
  try {
    sessionDirs = await readdir(root);
  } catch {
    return [];
  }

  const byDate: Record<string, DayAccumulator> = {};

  for (const sessionDir of sessionDirs) {
    const sessionPath = join(root, sessionDir);

    let dirStat;
    try {
      dirStat = await stat(sessionPath);
    } catch {
      continue;
    }
    if (!dirStat.isDirectory()) continue;

    // Quick skip: session dir mtime older than `since`
    if (sinceMs && dirStat.mtimeMs < sinceMs) continue;

    const eventsPath = join(sessionPath, "events.jsonl");
    if (!existsSync(eventsPath)) continue;

    const result = await findShutdownEvent(eventsPath);
    if (!result) continue;

    const { shutdown, eventTimestamp } = result;

    // Determine the session date — prefer sessionStartTime, fall back to event timestamp.
    let sessionMs: number;
    if (typeof shutdown.sessionStartTime === "number") {
      sessionMs = shutdown.sessionStartTime;
    } else if (eventTimestamp) {
      sessionMs = new Date(eventTimestamp).getTime();
      if (Number.isNaN(sessionMs)) continue;
    } else {
      continue;
    }

    if (sinceMs && sessionMs < sinceMs) continue;

    const date = new Date(sessionMs).toISOString().slice(0, 10);

    if (!shutdown.modelMetrics) continue;

    for (const [modelId, metrics] of Object.entries(shutdown.modelMetrics)) {
      const usage = metrics?.usage ?? {};
      const input = Number(usage.inputTokens) || 0;
      const output = Number(usage.outputTokens) || 0;
      const reasoning = Number(usage.reasoningTokens) || 0;
      const cacheRead = Number(usage.cacheReadTokens) || 0;
      const cacheWrite = Number(usage.cacheWriteTokens) || 0;
      // Premium-request count contributed by this model in this session.
      const premiumRequests = Number(metrics?.requests?.count) || 0;

      // Skip only when this model contributed nothing to the session — any
      // non-zero metric (including cache-only or premium-only activity) is
      // worth recording.
      if (
        input === 0 &&
        output === 0 &&
        reasoning === 0 &&
        cacheRead === 0 &&
        cacheWrite === 0 &&
        premiumRequests === 0
      ) {
        continue;
      }

      // Treat reasoning tokens as part of output for cost calculation.
      const outputForCost = output + reasoning;

      const cost = calculateCost(modelId, {
        input,
        output: outputForCost,
        cacheCreation: cacheWrite,
        cacheRead,
      });

      accumulate(byDate, date, modelId, {
        input,
        output: outputForCost,
        cacheCreation: cacheWrite,
        cacheRead,
        cost,
        premiumRequests,
      });
    }
  }

  return accumulatorToSyncDays(byDate, "copilot-cli");
}
