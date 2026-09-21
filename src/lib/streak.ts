// ─── Streaks and free passes ────────────────────────────────────────────────
// A streak is the number of days you used a supported tool, counted back from
// today (or yesterday, since today isn't over yet) without a break.
//
// Every DAYS_PER_PASS days of an unbroken streak grants one "free pass". A pass
// covers exactly one missed day, and passes bank up: three passes cover three
// missed days, whether they fall together or apart. A covered day keeps the
// streak alive but doesn't add to it — the number stays a count of days you
// actually showed up.
//
// Passes protect the current streak from PASSES_LIVE_FROM onwards. They never
// reach back: a gap from before that date broke the streak under the old rules
// and it stays broken, so no old run is stitched onto the current one. The
// current streak's full length still counts towards earning passes, including
// the days before launch.
//
// The fold below is the single source of truth. `computeStreakSnapshot` is a
// pure function of the dates, so its result is stable enough to store (see
// `user_streaks` in the DB); `resolveStreak` applies the passage of time to a
// stored snapshot and is mirrored in SQL by `streakSelect()` in
// src/lib/db/streak-state.ts. Change one, change the other.

/** Days of unbroken streak that grant one free pass. */
export const DAYS_PER_PASS = 75;

/**
 * The first day a pass can cover ("YYYY-MM-DD", UTC): the day the feature
 * shipped. Bump it if the deploy slips.
 */
export const PASSES_LIVE_FROM = "2026-09-21";

const MS_PER_DAY = 86_400_000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Streak state as of the last day the user was active. Depends only on the
 * dates, never on the clock, which is what makes it safe to persist.
 */
export interface StreakSnapshot {
  /** First active day of the live run ("YYYY-MM-DD"), or null with no usage. */
  runStart: string | null;
  /** Most recent active day ("YYYY-MM-DD"), or null with no usage. */
  lastActive: string | null;
  /** Active days in the run, as of `lastActive`. */
  streakDays: number;
  /**
   * Passes that can be spent on the days after `lastActive`. Zero when those
   * days fall before PASSES_LIVE_FROM, whatever the run has banked.
   */
  passesLeft: number;
  /** Passes granted over the life of the run. */
  passesEarned: number;
  /** Passes burnt on gaps inside the run. */
  passesSpent: number;
  /** Days inside the run a pass covered, ascending ("YYYY-MM-DD"). */
  frozenDays: string[];
}

/** Streak state as of a given day, derived from a snapshot. */
export interface StreakState {
  /** Active days in the current streak. 0 once it has broken. */
  current: number;
  /** Passes still banked, after any spent holding the streak up to today. */
  passesLeft: number;
  /** Passes granted over the life of the run. */
  passesEarned: number;
  /** Passes burnt inside the run, including any holding it open right now. */
  passesSpent: number;
  /** Active days to go before the next pass. Null once the streak has broken. */
  daysToNextPass: number | null;
  /** True when a pass is the only thing keeping the streak alive today. */
  frozen: boolean;
  /** How many days a pass is currently covering. 0 unless `frozen`. */
  frozenFor: number;
  /** Days a pass covered, ascending. Empty once the streak has broken. */
  frozenDays: string[];
  /** First active day of the live run, or null once it has broken. */
  runStart: string | null;
  /** Most recent active day, or null with no usage at all. */
  lastActive: string | null;
}

const EMPTY_SNAPSHOT: StreakSnapshot = {
  runStart: null,
  lastActive: null,
  streakDays: 0,
  passesLeft: 0,
  passesEarned: 0,
  passesSpent: 0,
  frozenDays: [],
};

/** Whole days since the Unix epoch for a "YYYY-MM-DD" date. */
function toDayNumber(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / MS_PER_DAY);
}

function toIsoDate(dayNumber: number): string {
  return new Date(dayNumber * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * PASSES_LIVE_FROM as a day number. STREAK_PASSES_LIVE_FROM overrides it for
 * local dev, where seeded demo gaps necessarily sit in the past. It's read
 * server-side only; the fold never runs in the browser.
 */
function defaultLiveFrom(): string {
  const override =
    typeof process !== "undefined"
      ? process.env.STREAK_PASSES_LIVE_FROM
      : undefined;
  return override && ISO_DATE_RE.test(override) ? override : PASSES_LIVE_FROM;
}

/** Today in UTC, the timezone every stored date is already in. */
export function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Walk every active day oldest-first, banking a pass every DAYS_PER_PASS days
 * and spending banked passes on gaps. The run restarts at the first day it
 * can't pay for, and a missed day before `liveFrom` can never be paid for.
 */
export function computeStreakSnapshot(
  dailyRows: { date: string | null }[],
  liveFrom: string = defaultLiveFrom()
): StreakSnapshot {
  const liveFromDay = toDayNumber(liveFrom);
  const days = [
    ...new Set(
      dailyRows
        .map((r) => r.date)
        .filter((d): d is string => !!d && ISO_DATE_RE.test(d))
    ),
  ]
    .map(toDayNumber)
    .filter((d) => Number.isFinite(d))
    .sort((a, b) => a - b);

  if (days.length === 0) return { ...EMPTY_SNAPSHOT };

  let runStart = days[0];
  let streakDays = 0;
  let passesLeft = 0;
  let passesEarned = 0;
  let passesSpent = 0;
  let frozenDays: number[] = [];
  let prev: number | null = null;

  for (const day of days) {
    if (prev !== null) {
      // Spend one pass per missed day. The loop can't run away: it stops the
      // moment the balance hits zero, and the balance is tiny by construction.
      let broke = false;
      for (let missed = prev + 1; missed < day; missed++) {
        if (passesLeft <= 0 || missed < liveFromDay) {
          broke = true;
          break;
        }
        passesLeft--;
        passesSpent++;
        frozenDays.push(missed);
      }
      if (broke) {
        runStart = day;
        streakDays = 0;
        passesLeft = 0;
        passesEarned = 0;
        passesSpent = 0;
        frozenDays = [];
      }
    }

    streakDays++;
    const due = Math.floor(streakDays / DAYS_PER_PASS) - passesEarned;
    if (due > 0) {
      passesEarned += due;
      passesLeft += due;
    }
    prev = day;
  }

  // Ageing a snapshot spends passes on the days right after `lastActive`. If
  // those days predate the feature there's nothing to spend, and saying so
  // here keeps resolveStreak() and its SQL mirror free of the launch date.
  if (prev! + 1 < liveFromDay) passesLeft = 0;

  return {
    runStart: toIsoDate(runStart),
    lastActive: toIsoDate(prev!),
    streakDays,
    passesLeft,
    passesEarned,
    passesSpent,
    frozenDays: frozenDays.map(toIsoDate),
  };
}

/**
 * Age a snapshot to `today`. Today never counts against anyone — it isn't over
 * — so only the days strictly between the last active day and today have to be
 * paid for out of the banked passes.
 */
export function resolveStreak(
  snapshot: StreakSnapshot,
  today: string = utcToday()
): StreakState {
  const { lastActive } = snapshot;

  if (!lastActive || snapshot.streakDays === 0) {
    return {
      current: 0,
      passesLeft: 0,
      passesEarned: 0,
      passesSpent: 0,
      daysToNextPass: null,
      frozen: false,
      frozenFor: 0,
      frozenDays: [],
      runStart: null,
      lastActive,
    };
  }

  const elapsed = Math.max(0, toDayNumber(today) - toDayNumber(lastActive) - 1);
  const dead = elapsed > snapshot.passesLeft;

  if (dead) {
    return {
      current: 0,
      passesLeft: 0,
      passesEarned: 0,
      passesSpent: 0,
      daysToNextPass: null,
      frozen: false,
      frozenFor: 0,
      frozenDays: [],
      runStart: null,
      lastActive,
    };
  }

  const heldOpen: string[] = [];
  const lastActiveDay = toDayNumber(lastActive);
  for (let i = 1; i <= elapsed; i++) {
    heldOpen.push(toIsoDate(lastActiveDay + i));
  }

  return {
    current: snapshot.streakDays,
    passesLeft: snapshot.passesLeft - elapsed,
    passesEarned: snapshot.passesEarned,
    passesSpent: snapshot.passesSpent + elapsed,
    daysToNextPass:
      DAYS_PER_PASS - (snapshot.streakDays % DAYS_PER_PASS),
    frozen: elapsed > 0,
    frozenFor: elapsed,
    frozenDays: [...snapshot.frozenDays, ...heldOpen],
    runStart: snapshot.runStart,
    lastActive,
  };
}

/** Full streak state straight from daily rows. */
export function computeStreakState(
  dailyRows: { date: string | null }[],
  today: string = utcToday(),
  liveFrom?: string
): StreakState {
  return resolveStreak(computeStreakSnapshot(dailyRows, liveFrom), today);
}

/**
 * Current streak in days. Kept as its own export because most callers only
 * ever want the number.
 */
export function computeCurrentStreak(
  dailyRows: { date: string | null }[]
): number {
  return computeStreakState(dailyRows).current;
}
