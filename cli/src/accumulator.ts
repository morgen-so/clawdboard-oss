/**
 * Shared accumulator utilities for building daily usage aggregates.
 *
 * Used by all source extractors (opencode.ts, codex.ts, gemini-cli.ts,
 * copilot-cli.ts, antigravity.ts) to avoid duplicating the accumulation
 * and conversion logic.
 */

import type { SyncDay } from "./schemas.js";

/** Per-model token/cost breakdown within a day. */
interface ModelStats {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cost: number;
  /** Optional: GitHub Copilot CLI premium-request count. */
  premiumRequests: number;
}

/** Mutable accumulator for building daily aggregates. */
export interface DayAccumulator {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalCost: number;
  /** Optional: GitHub Copilot CLI premium-request count. */
  premiumRequests: number;
  models: Record<string, ModelStats>;
}

/** Result of installing a hook or plugin. */
export interface InstallResult {
  installed: boolean;
  alreadyInstalled: boolean;
  updated: boolean;
}

/** Source slug union — kept in sync with cli/src/schemas.ts SOURCE_VALUES. */
export type Source =
  | "claude-code"
  | "opencode"
  | "opencode-go"
  | "opencode-zen"
  | "codex"
  | "gemini-cli"
  | "antigravity"
  | "copilot-cli";

/**
 * Add token/cost data for a single message to the daily accumulator.
 * Creates the date entry and model sub-entry if they don't exist.
 *
 * `tokens.premiumRequests` is optional and only relevant for the GitHub
 * Copilot CLI source — other sources should leave it unset (defaults to 0).
 */
export function accumulate(
  byDate: Record<string, DayAccumulator>,
  date: string,
  modelId: string,
  tokens: {
    input: number;
    output: number;
    cacheCreation: number;
    cacheRead: number;
    cost: number;
    premiumRequests?: number;
  }
): void {
  if (!byDate[date]) {
    byDate[date] = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalCost: 0,
      premiumRequests: 0,
      models: {},
    };
  }

  const day = byDate[date];
  day.inputTokens += tokens.input;
  day.outputTokens += tokens.output;
  day.cacheCreationTokens += tokens.cacheCreation;
  day.cacheReadTokens += tokens.cacheRead;
  day.totalCost += tokens.cost;
  day.premiumRequests += tokens.premiumRequests ?? 0;

  if (!day.models[modelId]) {
    day.models[modelId] = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      cost: 0,
      premiumRequests: 0,
    };
  }

  day.models[modelId].inputTokens += tokens.input;
  day.models[modelId].outputTokens += tokens.output;
  day.models[modelId].cacheCreationTokens += tokens.cacheCreation;
  day.models[modelId].cacheReadTokens += tokens.cacheRead;
  day.models[modelId].cost += tokens.cost;
  day.models[modelId].premiumRequests += tokens.premiumRequests ?? 0;
}

/**
 * Convert a date-keyed accumulator map to an array of SyncDay objects.
 *
 * Premium-request counts are only emitted on the output when non-zero,
 * keeping the payload tidy for the vast majority of providers that don't
 * use that metric.
 *
 * @param source - Tag each entry with the data source slug.
 */
export function accumulatorToSyncDays(
  byDate: Record<string, DayAccumulator>,
  source?: Source | null
): SyncDay[] {
  return Object.entries(byDate).map(([date, day]) => {
    const syncDay: SyncDay = {
      date,
      source: source ?? null,
      inputTokens: day.inputTokens,
      outputTokens: day.outputTokens,
      cacheCreationTokens: day.cacheCreationTokens,
      cacheReadTokens: day.cacheReadTokens,
      totalCost: day.totalCost,
      modelsUsed: Object.keys(day.models),
      modelBreakdowns: Object.entries(day.models).map(([modelName, mb]) => {
        const breakdown: SyncDay["modelBreakdowns"][number] = {
          modelName,
          inputTokens: mb.inputTokens,
          outputTokens: mb.outputTokens,
          cacheCreationTokens: mb.cacheCreationTokens,
          cacheReadTokens: mb.cacheReadTokens,
          cost: mb.cost,
        };
        if (mb.premiumRequests > 0) {
          breakdown.premiumRequests = mb.premiumRequests;
        }
        return breakdown;
      }),
    };
    if (day.premiumRequests > 0) {
      syncDay.premiumRequests = day.premiumRequests;
    }
    return syncDay;
  });
}

/**
 * Build the shell-level debounce command for hook-sync.
 * Used by Claude Code hook (settings.ts), OpenCode plugin (opencode-setup.ts),
 * and Codex hook (codex-setup.ts).
 */
export function buildDebounceCommand(debounceMinutes: number): string {
  return `bash -c 'f=$HOME/.clawdboard/last-sync; [ -f "$f" ] && [ -n "$(find "$f" -mmin -${debounceMinutes} 2>/dev/null)" ] && exit 0; if command -v clawdboard >/dev/null 2>&1; then clawdboard hook-sync; else npx -y clawdboard hook-sync; fi'`;
}
