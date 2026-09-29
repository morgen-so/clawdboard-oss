// ─── The run, flattened for the 200-day replay ─────────────────────────────
// The Carcinization Event replays the owner's live streak one day at a time.
// This boils the daily rows down to the least the client needs: one number
// per calendar day from the run's first day to its last active one.

/** Marks a day a free pass covered: the run survived it, the count didn't grow. */
export const PASS_DAY = -1;

export interface CarcinizationRun {
  /** First day of the run, "YYYY-MM-DD". */
  start: string;
  /**
   * One entry per calendar day, oldest first. Active days carry their token
   * volume as 0-1 (relative to the run's own busy days); PASS_DAY where a free
   * pass covered the gap.
   */
  days: number[];
  /** Tokens across the run. */
  totalTokens: number;
  /** Spend across the run, in USD. */
  totalCost: number;
}

interface DailyRow {
  date: string | null;
  totalCost: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationTokens: number | null;
  cacheReadTokens: number | null;
}

const MS_PER_DAY = 86_400_000;

function dayNumber(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / MS_PER_DAY);
}

/**
 * The run from `runStart` to `lastActive`, inclusive. Days a pass is holding
 * open after the last active day are left off, so the replay always lands on
 * the day the count actually reached its number.
 */
export function buildCarcinizationRun(
  rows: DailyRow[],
  runStart: string | null,
  lastActive: string | null
): CarcinizationRun | null {
  if (!runStart || !lastActive) return null;
  const first = dayNumber(runStart);
  const last = dayNumber(lastActive);
  if (!(last >= first)) return null;

  const tokensByDay = new Map<number, number>();
  let totalTokens = 0;
  let totalCost = 0;
  for (const row of rows) {
    if (!row.date) continue;
    const n = dayNumber(row.date);
    if (n < first || n > last) continue;
    const tokens =
      (row.inputTokens ?? 0) +
      (row.outputTokens ?? 0) +
      (row.cacheCreationTokens ?? 0) +
      (row.cacheReadTokens ?? 0);
    tokensByDay.set(n, (tokensByDay.get(n) ?? 0) + tokens);
    totalTokens += tokens;
    totalCost += Number(row.totalCost ?? 0);
  }

  // Scale against the 90th-percentile day rather than the max, so one monster
  // day doesn't leave the other 199 looking dark.
  const volumes = [...tokensByDay.values()].sort((a, b) => a - b);
  const ceiling =
    volumes.length > 0
      ? Math.max(1, volumes[Math.floor((volumes.length - 1) * 0.9)])
      : 1;

  const days: number[] = [];
  for (let n = first; n <= last; n++) {
    const tokens = tokensByDay.get(n);
    // Inside a live run, a day with no rows is one a pass paid for.
    days.push(
      tokens === undefined
        ? PASS_DAY
        : Math.round(Math.min(1, tokens / ceiling) * 100) / 100
    );
  }

  return { start: runStart, days, totalTokens, totalCost };
}
