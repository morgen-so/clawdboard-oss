// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DAY_COST_USD,
  MAX_DAY_TOKENS,
  isImplausibleDay,
} from "./sync-plausibility.ts";

const model = (cost: number, inputTokens: number) => ({
  cost,
  inputTokens,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
});

const day = (
  totalCost: number,
  inputTokens: number,
  breakdowns = [model(totalCost, inputTokens)]
) => ({
  totalCost,
  inputTokens,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  modelBreakdowns: breakdowns,
});

test("the heaviest real days pass", () => {
  assert.equal(isImplausibleDay(day(16_487.73, 33_760_604_906)), false);
  assert.equal(isImplausibleDay(day(MAX_DAY_COST_USD, MAX_DAY_TOKENS)), false);
});

test("a fabricated day is dropped", () => {
  // Jan 1 from the $1B payload.
  assert.equal(
    isImplausibleDay({
      totalCost: 1_814_837.0267,
      inputTokens: 350_356_112_027,
      outputTokens: 52_729_404_436,
      cacheCreationTokens: 47_874_482_522,
      cacheReadTokens: 481_907_653_696,
      modelBreakdowns: [],
    }),
    true
  );
});

test("cost and tokens each trip the ceiling on their own", () => {
  assert.equal(isImplausibleDay(day(MAX_DAY_COST_USD + 1, 1_000)), true);
  assert.equal(isImplausibleDay(day(1, MAX_DAY_TOKENS + 1)), true);
});

test("cache tokens count towards the token ceiling", () => {
  assert.equal(
    isImplausibleDay({ ...day(1, 1_000, []), cacheReadTokens: MAX_DAY_TOKENS }),
    true
  );
});

test("breakdowns can't carry more than the ceiling under a small day total", () => {
  assert.equal(
    isImplausibleDay(day(10, 1_000, [model(60_000, 500), model(60_000, 500)])),
    true
  );
  assert.equal(
    isImplausibleDay(day(10, 1_000, [model(5, 100), model(5, MAX_DAY_TOKENS)])),
    true
  );
});
