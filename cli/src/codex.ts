/**
 * Codex CLI usage data extraction.
 *
 * Reads Codex's rollout JSONL files from disk, extracts token counts per session,
 * calculates costs, and returns daily aggregates as SyncDay[].
 *
 * Codex stores session rollouts at:
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<id>.jsonl
 *
 * Each JSONL file contains multiple line types. We read:
 *   - "turn_context" lines → model name per turn
 *   - "event_msg" lines with payload.type "token_count" → cumulative token counts
 *
 * PRIVACY: Only date, token counts, cost, and model names are extracted.
 * Project paths, git info, prompts, and session IDs are never read.
 */

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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
 * Read all Codex rollout JSONL files and aggregate into daily usage data.
 *
 * Strategy per session file:
 * 1. Scan for "turn_context" lines to find the model used (last one wins)
 * 2. Find the last "event_msg" with type "token_count" — its total_token_usage
 *    is the session's cumulative total
 * 3. Use the date from the year/month/day directory path
 *
 * @param since - Optional YYYY-MM-DD date; sessions before this are skipped.
 * @returns Array of SyncDay objects ready for Zod validation.
 */
export async function extractCodexData(since?: string): Promise<SyncDay[]> {
  const sessionsDir = getSessionsDir();

  const sinceDate = since ? new Date(since) : null;
  const byDate: Record<string, DayAccumulator> = {};

  let years: string[];
  try {
    years = await readdir(sessionsDir);
  } catch {
    return [];
  }

  for (const year of years) {
    if (!/^\d{4}$/.test(year)) continue;

    let months: string[];
    try {
      months = await readdir(join(sessionsDir, year));
    } catch {
      continue;
    }

    for (const month of months) {
      if (!/^\d{2}$/.test(month)) continue;

      let days: string[];
      try {
        days = await readdir(join(sessionsDir, year, month));
      } catch {
        continue;
      }

      for (const day of days) {
        if (!/^\d{2}$/.test(day)) continue;

        const date = `${year}-${month}-${day}`;
        if (sinceDate && new Date(date) < sinceDate) continue;

        const dayDir = join(sessionsDir, year, month, day);
        let files: string[];
        try {
          files = await readdir(dayDir);
        } catch {
          continue;
        }

        for (const file of files) {
          if (!file.endsWith(".jsonl")) continue;

          try {
            const content = await readFile(join(dayDir, file), "utf-8");
            const { model, tokens } = parseRolloutFile(content);

            if (!tokens || (tokens.input_tokens === 0 && tokens.output_tokens === 0)) {
              continue;
            }

            const modelId = model || "unknown";
            const output = tokens.output_tokens ?? 0;
            // OpenAI reports cached_input_tokens as a SUBSET of input_tokens
            // (Codex's own total_tokens = input + output). Subtract so the
            // cached portion is counted (and billed) once, at the cache-read
            // rate — unlike Anthropic, where the two fields are disjoint.
            const cacheRead = tokens.cached_input_tokens ?? 0;
            const input = Math.max(0, (tokens.input_tokens ?? 0) - cacheRead);

            const cost = calculateCost(modelId, {
              input,
              output,
              cacheCreation: 0,
              cacheRead,
            });

            accumulate(byDate, date, modelId, {
              input,
              output,
              cacheCreation: 0,
              cacheRead,
              cost,
            });
          } catch {
            continue;
          }
        }
      }
    }
  }

  return accumulatorToSyncDays(byDate, "codex");
}

/**
 * Parse a single rollout JSONL file to extract the model and final token counts.
 *
 * PRIVACY: Only reads "turn_context" (for model) and "event_msg" with type
 * "token_count" (for tokens). All other line types are skipped — prompts,
 * tool outputs, file paths, and git info are never parsed.
 */
function parseRolloutFile(content: string): {
  model: string | null;
  tokens: TokenUsage | null;
} {
  let model: string | null = null;
  let lastTokenUsage: TokenUsage | null = null;

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    const type = parsed.type as string | undefined;
    const payload = parsed.payload as Record<string, unknown> | undefined;
    if (!payload) continue;

    if (type === "turn_context") {
      // Extract model name from turn context
      const m = payload.model as string | undefined;
      if (m) model = m;
    } else if (type === "event_msg") {
      // Look for token_count events
      const eventType = payload.type as string | undefined;
      if (eventType === "token_count") {
        const info = payload.info as Record<string, unknown> | undefined;
        const totalUsage = info?.total_token_usage as TokenUsage | undefined;
        if (totalUsage) {
          lastTokenUsage = totalUsage;
        }
      }
    }
  }

  return { model, tokens: lastTokenUsage };
}
