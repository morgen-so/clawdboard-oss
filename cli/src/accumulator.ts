/**
 * Shared accumulator utilities for building daily usage aggregates.
 *
 * Used by both opencode.ts and codex.ts extractors to avoid duplicating
 * the accumulation and conversion logic.
 */

import type { SyncDay } from "./schemas.js";

/** Per-model token/cost breakdown within a day. */
interface ModelStats {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cost: number;
}

/** Mutable accumulator for building daily aggregates. */
export interface DayAccumulator {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalCost: number;
  models: Record<string, ModelStats>;
}

/** Result of installing a hook or plugin. */
export interface InstallResult {
  installed: boolean;
  alreadyInstalled: boolean;
  updated: boolean;
}

/**
 * Add token/cost data for a single message to the daily accumulator.
 * Creates the date entry and model sub-entry if they don't exist.
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
  }
): void {
  if (!byDate[date]) {
    byDate[date] = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalCost: 0,
      models: {},
    };
  }

  const day = byDate[date];
  day.inputTokens += tokens.input;
  day.outputTokens += tokens.output;
  day.cacheCreationTokens += tokens.cacheCreation;
  day.cacheReadTokens += tokens.cacheRead;
  day.totalCost += tokens.cost;

  if (!day.models[modelId]) {
    day.models[modelId] = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      cost: 0,
    };
  }

  day.models[modelId].inputTokens += tokens.input;
  day.models[modelId].outputTokens += tokens.output;
  day.models[modelId].cacheCreationTokens += tokens.cacheCreation;
  day.models[modelId].cacheReadTokens += tokens.cacheRead;
  day.models[modelId].cost += tokens.cost;
}

/**
 * Convert a date-keyed accumulator map to an array of SyncDay objects.
 * @param source - Tag each entry with the data source (e.g., "opencode", "codex")
 */
export function accumulatorToSyncDays(
  byDate: Record<string, DayAccumulator>,
  source?: "claude-code" | "opencode" | "codex" | "claude-code-desktop" | null
): SyncDay[] {
  return Object.entries(byDate).map(([date, day]) => ({
    date,
    source: source ?? null,
    inputTokens: day.inputTokens,
    outputTokens: day.outputTokens,
    cacheCreationTokens: day.cacheCreationTokens,
    cacheReadTokens: day.cacheReadTokens,
    totalCost: day.totalCost,
    modelsUsed: Object.keys(day.models),
    modelBreakdowns: Object.entries(day.models).map(([modelName, mb]) => ({
      modelName,
      inputTokens: mb.inputTokens,
      outputTokens: mb.outputTokens,
      cacheCreationTokens: mb.cacheCreationTokens,
      cacheReadTokens: mb.cacheReadTokens,
      cost: mb.cost,
    })),
  }));
}

/**
 * Build the shell-level debounce command for hook-sync.
 * Used by Claude Code hook (settings.ts), OpenCode plugin (opencode-setup.ts),
 * and Codex hook (codex-setup.ts).
 */
export function buildDebounceCommand(debounceMinutes: number): string {
  return `bash -c 'f=$HOME/.clawdboard/last-sync; [ -f "$f" ] && [ -n "$(find "$f" -mmin -${debounceMinutes} 2>/dev/null)" ] && exit 0; npx clawdboard hook-sync'`;
}
