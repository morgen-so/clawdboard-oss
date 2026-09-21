// Run with: npm test
//
// Node strips the types and runs this directly — no test framework, no build
// step. The streak fold is the one piece of this codebase where an off-by-one
// silently rewrites everyone's headline number, so it gets covered properly.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DAYS_PER_PASS,
  computeStreakSnapshot,
  computeStreakState,
  resolveStreak,
} from "./streak.ts";

// Well after PASSES_LIVE_FROM, so the default launch date never gets in the
// way. The launch-date tests below pass their own.
const EPOCH = Date.UTC(2027, 0, 1);

/** Day N of the fixture calendar, as "YYYY-MM-DD". */
const day = (n: number) =>
  new Date(EPOCH + n * 86_400_000).toISOString().slice(0, 10);

/** Daily rows for the given fixture day numbers. */
const rows = (...days: number[]) => days.map((n) => ({ date: day(n) }));

/** Fixture day numbers from `from` (inclusive) to `to` (exclusive). */
const span = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) => from + i);

test("no usage means no streak", () => {
  const s = computeStreakState([], day(0));
  assert.equal(s.current, 0);
  assert.equal(s.passesLeft, 0);
  assert.equal(s.daysToNextPass, null);
  assert.equal(s.lastActive, null);
});

test("consecutive days count, and today is never held against you", () => {
  assert.equal(computeStreakState(rows(0, 1, 2), day(2)).current, 3);
  assert.equal(computeStreakState(rows(0, 1, 2), day(3)).current, 3);
  // Two days on means yesterday was missed outright, with nothing to cover it.
  assert.equal(computeStreakState(rows(0, 1, 2), day(4)).current, 0);
});

test("a pass arrives on day 75, not before", () => {
  const short = computeStreakState(rows(...span(0, DAYS_PER_PASS - 1)), day(73));
  assert.equal(short.current, 74);
  assert.equal(short.passesLeft, 0);
  assert.equal(short.daysToNextPass, 1);
  // With nothing banked, one missed day ends it.
  assert.equal(
    computeStreakState(rows(...span(0, DAYS_PER_PASS - 1)), day(75)).current,
    0
  );

  const earned = computeStreakState(rows(...span(0, DAYS_PER_PASS)), day(74));
  assert.equal(earned.current, 75);
  assert.equal(earned.passesEarned, 1);
  assert.equal(earned.passesLeft, 1);
  assert.equal(earned.daysToNextPass, DAYS_PER_PASS);
});

test("a banked pass bridges a gap without padding the count", () => {
  const s = computeStreakState(rows(...span(0, 75), 76), day(76));
  assert.equal(s.current, 76, "76 active days, not 77 calendar days");
  assert.equal(s.passesLeft, 0);
  assert.equal(s.passesSpent, 1);
  assert.deepEqual(s.frozenDays, [day(75)]);
  assert.equal(s.frozen, false, "active today, so nothing is being held open");
});

test("a second gap with an empty balance restarts the run", () => {
  const s = computeStreakState(rows(...span(0, 75), 76, 78), day(78));
  assert.equal(s.current, 1);
  assert.equal(s.passesLeft, 0);
  assert.deepEqual(s.frozenDays, []);
  // The pass modal keys "already seen" on these two: a new run has to look new.
  assert.equal(s.passesEarned, 0, "earned count restarts with the run");
  assert.equal(s.runStart, day(78), "and the run has a new start date");
});

test("passes cumulate and cover a multi-day gap", () => {
  const banked = computeStreakState(rows(...span(0, 150)), day(149));
  assert.equal(banked.passesEarned, 2);
  assert.equal(banked.passesLeft, 2);

  const covered = computeStreakState(rows(...span(0, 150), 152), day(152));
  assert.equal(covered.current, 151);
  assert.equal(covered.passesSpent, 2);
  assert.deepEqual(covered.frozenDays, [day(150), day(151)]);

  // Three missed days is one more than the balance can pay for.
  assert.equal(computeStreakState(rows(...span(0, 150), 153), day(153)).current, 1);
});

test("a pass holds the streak open while the user is away", () => {
  const held = computeStreakState(rows(...span(0, 75)), day(76));
  assert.equal(held.current, 75);
  assert.equal(held.frozen, true);
  assert.equal(held.frozenFor, 1);
  assert.equal(held.passesLeft, 0);
  assert.deepEqual(held.frozenDays, [day(75)]);

  const spent = computeStreakState(rows(...span(0, 75)), day(77));
  assert.equal(spent.current, 0, "one pass only buys one day");
  assert.equal(spent.frozen, false);
});

test("the run keeps growing past a bridged day", () => {
  const s = computeStreakState(
    rows(...span(0, 75), 76, ...span(77, 152)),
    day(151)
  );
  assert.equal(s.current, 151);
  assert.equal(s.passesEarned, 2, "second pass at 150 active days");
  assert.equal(s.passesLeft, 1, "one of the two was spent on the gap");
});

test("input order, duplicates and junk dates don't matter", () => {
  const messy = [
    { date: day(2) },
    { date: day(0) },
    { date: day(1) },
    { date: day(2) },
    { date: null },
    { date: "not-a-date" },
  ];
  assert.equal(computeStreakState(messy, day(2)).current, 3);
});

test("a snapshot is clock-independent; resolving applies the clock", () => {
  const snap = computeStreakSnapshot(rows(...span(0, DAYS_PER_PASS)));
  assert.equal(snap.streakDays, 75);
  assert.equal(snap.passesLeft, 1);
  assert.equal(snap.lastActive, day(74));
  assert.equal(snap.runStart, day(0));

  assert.equal(resolveStreak(snap, day(74)).current, 75);
  assert.equal(resolveStreak(snap, day(75)).current, 75);
  assert.equal(resolveStreak(snap, day(76)).frozen, true);
  assert.equal(resolveStreak(snap, day(77)).current, 0);
});

// ─── Passes don't reach back before launch ──────────────────────────────────

const LAUNCH = day(100);

test("a gap from before launch stays broken, however long the old run was", () => {
  // 80 days, one missed day, 39 more. Under the old rules the streak is 39,
  // and shipping passes must not stitch the old 80 onto it.
  const s = computeStreakState(
    rows(...span(0, 80), ...span(81, 120)),
    day(120),
    LAUNCH
  );
  assert.equal(s.current, 39);
  assert.equal(s.passesEarned, 0);
  assert.equal(s.runStart, day(81));
  assert.deepEqual(s.frozenDays, []);
});

test("the current streak's pre-launch days still count towards passes", () => {
  const s = computeStreakState(rows(...span(0, 110)), day(110), LAUNCH);
  assert.equal(s.current, 110);
  assert.equal(s.passesLeft, 1);

  // ...and that pass covers a day missed after launch.
  const away = computeStreakState(rows(...span(0, 110)), day(111), LAUNCH);
  assert.equal(away.current, 110);
  assert.equal(away.frozenFor, 1);
});

test("a quiet spell that began before launch isn't covered", () => {
  // Last active two days before launch: the missed day predates the feature.
  const before = computeStreakState(rows(...span(0, 99)), day(100), LAUNCH);
  assert.equal(before.current, 0);

  // Last active the day before launch: the first missed day is launch day.
  const onLaunch = computeStreakState(rows(...span(0, 100)), day(101), LAUNCH);
  assert.equal(onLaunch.current, 100);
  assert.equal(onLaunch.frozenFor, 1);
});

test("a gap straddling launch breaks, even with passes to spare", () => {
  // 160 days banks two passes; days 99 and 100 are then missed. The second
  // is coverable, the first isn't, so the run ends.
  const s = computeStreakState(
    rows(...span(-61, 99), ...span(101, 105)),
    day(105),
    LAUNCH
  );
  assert.equal(s.current, 4);
  assert.equal(s.runStart, day(101));
});
