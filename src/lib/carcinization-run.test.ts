// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { PASS_DAY, buildCarcinizationRun } from "./carcinization-run.ts";

const row = (date: string, tokens: number, cost = 1) => ({
  date,
  totalCost: String(cost),
  inputTokens: tokens,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
});

test("no run, no replay", () => {
  assert.equal(buildCarcinizationRun([row("2027-01-01", 5)], null, null), null);
});

test("one entry per calendar day, oldest first, with pass days marked", () => {
  const run = buildCarcinizationRun(
    [
      row("2027-01-01", 100),
      row("2027-01-02", 50),
      // 2027-01-03 covered by a pass
      row("2027-01-04", 100),
    ],
    "2027-01-01",
    "2027-01-04"
  );
  assert.ok(run);
  assert.equal(run.start, "2027-01-01");
  assert.deepEqual(run.days, [1, 0.5, PASS_DAY, 1]);
});

test("totals only count the run, not the history before it", () => {
  const run = buildCarcinizationRun(
    [row("2026-12-20", 9_999, 99), row("2027-01-01", 10, 2), row("2027-01-02", 30, 3)],
    "2027-01-01",
    "2027-01-02"
  );
  assert.ok(run);
  assert.equal(run.totalTokens, 40);
  assert.equal(run.totalCost, 5);
  assert.equal(run.days.length, 2);
});

test("days a pass holds open after the last active day are left off", () => {
  const run = buildCarcinizationRun(
    [row("2027-01-01", 10), row("2027-01-02", 10)],
    "2027-01-01",
    "2027-01-02"
  );
  assert.ok(run);
  assert.equal(run.days.length, 2);
  assert.notEqual(run.days.at(-1), PASS_DAY);
});

test("one monster day doesn't flatten the rest", () => {
  const rows = Array.from({ length: 20 }, (_, i) =>
    row(`2027-01-${String(i + 1).padStart(2, "0")}`, i === 7 ? 1_000_000 : (i + 1) * 10)
  );
  const run = buildCarcinizationRun(rows, "2027-01-01", "2027-01-20");
  assert.ok(run);
  assert.equal(run.days[7], 1);
  // Against the max, day 10 (100 tokens) would be 0.0001 and render black.
  assert.ok(run.days[9] > 0.4);
});
