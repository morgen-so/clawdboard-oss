// ─── Per-day plausibility ceiling for synced usage ─────────────────────────
// The server stores whatever cost and token counts the client reports, so a
// hand-built payload can put any number on the leaderboard (on 2026-10-20 one
// account posted $1,000,000,000 across 293 days, $11M on its biggest day).
// A row above these ceilings is not something one machine can do with one
// tool in a day, so the sync route drops it instead of storing it.
//
// Set at ~6x the largest real rows on 2026-10-21: $16.5K and 33.8B tokens
// (both from a Codex overcount, since fixed). The largest correct rows are
// ~$13K and ~29B tokens. Raise them if real usage gets near.

export const MAX_DAY_COST_USD = 100_000;
export const MAX_DAY_TOKENS = 200_000_000_000;

interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface PlausibilityDay extends TokenCounts {
  totalCost: number;
  modelBreakdowns: (TokenCounts & { cost: number })[];
}

const tokens = (t: TokenCounts) =>
  t.inputTokens + t.outputTokens + t.cacheCreationTokens + t.cacheReadTokens;

/**
 * True when a synced day is beyond what any real usage produces. Checks the
 * model breakdowns too: they feed the model stats on their own, so a small
 * day total can't carry giant breakdowns past the ceiling.
 */
export function isImplausibleDay(day: PlausibilityDay): boolean {
  const breakdownCost = day.modelBreakdowns.reduce((s, m) => s + m.cost, 0);
  const breakdownTokens = day.modelBreakdowns.reduce((s, m) => s + tokens(m), 0);
  return (
    Math.max(day.totalCost, breakdownCost) > MAX_DAY_COST_USD ||
    Math.max(tokens(day), breakdownTokens) > MAX_DAY_TOKENS
  );
}

// ─── Mock models ───────────────────────────────────────────────────────────
// A model with "mock" in its name is a test harness or a fake provider, not
// paid usage. The CLI faithfully reads whatever a session file says, so on
// 2026-10-20 one account's fake pi sessions for "clawdboard-mock" put $867K
// on the board. No real model on the platform matches.

const MOCK_MODEL = /mock/i;

export interface MockStrippableDay extends PlausibilityDay {
  modelsUsed: string[];
  modelBreakdowns: (TokenCounts & { cost: number; modelName: string })[];
}

/**
 * The day without its mock models: their breakdowns are removed and their
 * tokens and cost taken off the day totals. Null when nothing real is left.
 * Returns the same object when the day has no mock model.
 */
export function stripMockModels<T extends MockStrippableDay>(day: T): T | null {
  const mock = day.modelBreakdowns.filter((m) => MOCK_MODEL.test(m.modelName));
  if (mock.length === 0) return day;
  const kept = day.modelBreakdowns.filter((m) => !MOCK_MODEL.test(m.modelName));
  if (kept.length === 0) return null;
  const minus = (k: keyof TokenCounts) =>
    Math.max(0, day[k] - mock.reduce((s, m) => s + m[k], 0));
  return {
    ...day,
    inputTokens: minus("inputTokens"),
    outputTokens: minus("outputTokens"),
    cacheCreationTokens: minus("cacheCreationTokens"),
    cacheReadTokens: minus("cacheReadTokens"),
    totalCost: Math.max(0, day.totalCost - mock.reduce((s, m) => s + m.cost, 0)),
    modelsUsed: day.modelsUsed.filter((name) => !MOCK_MODEL.test(name)),
    modelBreakdowns: kept,
  };
}
