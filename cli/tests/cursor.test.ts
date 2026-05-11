/**
 * Tests for the local Cursor SQLite extractor — focused on the cost
 * distribution math, since that's the most subtle part of the module.
 *
 * `distributeComposerCosts` is not exported, so we drive it end-to-end via
 * `extractCursorData` against hand-built `state.vscdb` fixtures pointed at
 * by the `CURSOR_DATA_DIR` env var. That also covers the surrounding glue
 * (composer metadata parsing, bubble selection, model-name resolution,
 * accumulator → SyncDay conversion).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractCursorData } from "../src/cursor.js";

// Anchor everything in this test file to a single UTC day so we don't have to
// reason about timezone edges. 2025-03-15 is comfortably above the
// MIN_VALID_EPOCH_MS guard inside the extractor.
const DAY = "2025-03-15";
const DAY_MS = Date.UTC(2025, 2, 15);

// ---------------------------------------------------------------------------
// Fixture builder
// ---------------------------------------------------------------------------

interface ComposerFixture {
  id: string;
  /** Defaults to DAY_MS so all bubbles roll up to the same date. */
  createdAtMs?: number;
  /** Per-model cost map. Keys define the model name preference order. */
  usageData?: Record<string, { costInCents: number; amount: number }>;
  /** Used when usageData is absent — `modelConfig.modelName`. */
  modelName?: string;
}

interface BubbleFixture {
  composerId: string;
  bubbleId: string;
  inputTokens: number;
  outputTokens: number;
  /** Override the per-bubble timestamp; otherwise inherits composer date. */
  clientStartTimeMs?: number;
}

function buildDb(
  path: string,
  composers: ComposerFixture[],
  bubbles: BubbleFixture[]
): void {
  const db = new Database(path);
  db.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value BLOB)");
  const insert = db.prepare(
    "INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)"
  );
  for (const c of composers) {
    const value: Record<string, unknown> = {
      createdAt: c.createdAtMs ?? DAY_MS,
    };
    if (c.usageData) value.usageData = c.usageData;
    if (c.modelName) value.modelConfig = { modelName: c.modelName };
    insert.run(
      `composerData:${c.id}`,
      Buffer.from(JSON.stringify(value), "utf-8")
    );
  }
  for (const b of bubbles) {
    const value: Record<string, unknown> = {
      tokenCount: { inputTokens: b.inputTokens, outputTokens: b.outputTokens },
    };
    if (b.clientStartTimeMs !== undefined) {
      value.timingInfo = { clientStartTime: b.clientStartTimeMs };
    }
    insert.run(
      `bubbleId:${b.composerId}:${b.bubbleId}`,
      Buffer.from(JSON.stringify(value), "utf-8")
    );
  }
  db.close();
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let tmpDir: string;
let dbPath: string;
const originalEnv = process.env.CURSOR_DATA_DIR;

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `cursor-db-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(tmpDir, { recursive: true });
  dbPath = join(tmpDir, "state.vscdb");
  process.env.CURSOR_DATA_DIR = dbPath;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  if (originalEnv === undefined) delete process.env.CURSOR_DATA_DIR;
  else process.env.CURSOR_DATA_DIR = originalEnv;
});

/** Find the breakdown row for a model on a specific day. */
function modelOn(
  days: Awaited<ReturnType<typeof extractCursorData>>,
  date: string,
  modelName: string
) {
  const day = days.find((d) => d.date === date);
  if (!day) throw new Error(`no day ${date} in result`);
  const mb = day.modelBreakdowns.find((m) => m.modelName === modelName);
  if (!mb) throw new Error(`no model ${modelName} on ${date}`);
  return mb;
}

// ---------------------------------------------------------------------------
// Cost distribution: the math
// ---------------------------------------------------------------------------

describe("extractCursorData — cost distribution", () => {
  it("assigns the full composer cost to a single bubble", async () => {
    buildDb(
      dbPath,
      [
        {
          id: "c1",
          usageData: { "gpt-4": { costInCents: 100, amount: 5 } },
        },
      ],
      [{ composerId: "c1", bubbleId: "b1", inputTokens: 50, outputTokens: 50 }]
    );

    const days = await extractCursorData();
    expect(modelOn(days, DAY, "gpt-4").cost).toBe(1.0);
  });

  it("distributes cost weighted by (input + output) tokens", async () => {
    // 100 cents over two bubbles with token totals 75 and 25 → 75c / 25c.
    buildDb(
      dbPath,
      [
        {
          id: "c1",
          usageData: { "claude-3": { costInCents: 100, amount: 5 } },
        },
      ],
      [
        { composerId: "c1", bubbleId: "b1", inputTokens: 50, outputTokens: 25 },
        { composerId: "c1", bubbleId: "b2", inputTokens: 15, outputTokens: 10 },
      ]
    );

    const days = await extractCursorData();
    // Day-level total is sum of bubbles → 100 cents → $1.00.
    expect(days[0].totalCost).toBeCloseTo(1.0, 10);
    expect(modelOn(days, DAY, "claude-3").cost).toBeCloseTo(1.0, 10);
  });

  it("preserves total cents exactly via largest-remainder allocation", async () => {
    // 100 cents over three equal-token bubbles → 33.33 each. Floor sum is 99,
    // remainder 1 goes to whichever bubble has the highest fractional part
    // (all equal here, so the first wins). End-of-day total must be exactly
    // $1.00 with no fp drift, which is the whole point of the algorithm.
    buildDb(
      dbPath,
      [{ id: "c1", usageData: { m: { costInCents: 100, amount: 1 } } }],
      [
        { composerId: "c1", bubbleId: "b1", inputTokens: 1, outputTokens: 0 },
        { composerId: "c1", bubbleId: "b2", inputTokens: 1, outputTokens: 0 },
        { composerId: "c1", bubbleId: "b3", inputTokens: 1, outputTokens: 0 },
      ]
    );

    const days = await extractCursorData();
    // Exact equality matters: the largest-remainder method exists specifically
    // to guarantee no rounding drift between sum-of-bubbles and composer total.
    expect(modelOn(days, DAY, "m").cost).toBe(1.0);
    expect(days[0].totalCost).toBe(1.0);
  });

  it("preserves total cents on awkward divisors too", async () => {
    // 7 cents over 3 equal-token bubbles. Floor = 2 each (sum 6), remainder 1
    // to the largest fractional. Sum must come out to exactly $0.07.
    buildDb(
      dbPath,
      [{ id: "c1", usageData: { m: { costInCents: 7, amount: 1 } } }],
      [
        { composerId: "c1", bubbleId: "b1", inputTokens: 1, outputTokens: 0 },
        { composerId: "c1", bubbleId: "b2", inputTokens: 1, outputTokens: 0 },
        { composerId: "c1", bubbleId: "b3", inputTokens: 1, outputTokens: 0 },
      ]
    );

    const days = await extractCursorData();
    expect(modelOn(days, DAY, "m").cost).toBe(0.07);
    expect(days[0].totalCost).toBe(0.07);
  });

  it("handles many bubbles without losing or gaining cents", async () => {
    // 10 bubbles, 1000 cents, asymmetric token counts. The day-level sum
    // must equal the input exactly — fp arithmetic on the cent-converted
    // dollar values would drift, but the algorithm operates in cents.
    const bubbles: BubbleFixture[] = Array.from({ length: 10 }, (_, i) => ({
      composerId: "c1",
      bubbleId: `b${i}`,
      inputTokens: i + 1, // 1, 2, 3, ..., 10
      outputTokens: 0,
    }));
    buildDb(
      dbPath,
      [{ id: "c1", usageData: { m: { costInCents: 1000, amount: 1 } } }],
      bubbles
    );

    const days = await extractCursorData();
    // 1000 cents → exactly $10.00.
    expect(modelOn(days, DAY, "m").cost).toBe(10.0);
    expect(days[0].totalCost).toBe(10.0);
  });

  it("sums cost across composers belonging to the same model + day", async () => {
    // Two independent composers, both sole-using model "m". Day-level cost
    // for "m" should be both composers' totals, distributed independently
    // and then summed by the accumulator.
    buildDb(
      dbPath,
      [
        { id: "c1", usageData: { m: { costInCents: 50, amount: 1 } } },
        { id: "c2", usageData: { m: { costInCents: 30, amount: 1 } } },
      ],
      [
        { composerId: "c1", bubbleId: "b1", inputTokens: 10, outputTokens: 0 },
        { composerId: "c2", bubbleId: "b1", inputTokens: 5, outputTokens: 0 },
      ]
    );

    const days = await extractCursorData();
    expect(modelOn(days, DAY, "m").cost).toBe(0.8);
  });
});

// ---------------------------------------------------------------------------
// Cost distribution: edge cases that should NOT distribute
// ---------------------------------------------------------------------------

describe("extractCursorData — cost distribution edge cases", () => {
  it("leaves cost at 0 when the composer has no usageData", async () => {
    // No usageData means models[0] falls through to modelConfig.modelName.
    // distributeComposerCosts has nothing to allocate → bubbles stay at 0.
    buildDb(
      dbPath,
      [{ id: "c1", modelName: "claude-3.5-sonnet" }],
      [{ composerId: "c1", bubbleId: "b1", inputTokens: 10, outputTokens: 5 }]
    );

    const days = await extractCursorData();
    expect(modelOn(days, DAY, "claude-3.5-sonnet").cost).toBe(0);
    expect(modelOn(days, DAY, "claude-3.5-sonnet").inputTokens).toBe(10);
  });

  it("leaves cost at 0 when usageData totals are zero", async () => {
    // costInCents: 0 across the board → distribution skipped via the
    // `totalCents <= 0` guard. Tokens still get attributed.
    buildDb(
      dbPath,
      [{ id: "c1", usageData: { m: { costInCents: 0, amount: 0 } } }],
      [{ composerId: "c1", bubbleId: "b1", inputTokens: 100, outputTokens: 50 }]
    );

    const days = await extractCursorData();
    expect(modelOn(days, DAY, "m").cost).toBe(0);
    expect(modelOn(days, DAY, "m").inputTokens).toBe(100);
  });

  it("falls through to cost=0 when every bubble has zero tokens", async () => {
    // Bubbles with both inputTokens = 0 AND outputTokens = 0 are dropped at
    // the bubble-collection stage entirely. Net effect: no bubbles → no day
    // for this composer in the output.
    buildDb(
      dbPath,
      [{ id: "c1", usageData: { m: { costInCents: 50, amount: 1 } } }],
      [{ composerId: "c1", bubbleId: "b1", inputTokens: 0, outputTokens: 0 }]
    );

    const days = await extractCursorData();
    expect(days).toEqual([]);
  });

  it("ignores 'default' as a model name and falls back appropriately", async () => {
    // modelConfig.modelName = "default" is a UI placeholder, not a real model.
    // With no usageData, models[] should fall through to FALLBACK_MODEL.
    buildDb(
      dbPath,
      [{ id: "c1", modelName: "default" }],
      [{ composerId: "c1", bubbleId: "b1", inputTokens: 10, outputTokens: 5 }]
    );

    const days = await extractCursorData();
    expect(modelOn(days, DAY, "cursor-mixed").inputTokens).toBe(10);
  });

  it("prefers usageData keys over modelConfig.modelName for attribution", async () => {
    // When both signals exist, the usageData key wins (it's the more
    // reliable signal — it carries cost, modelConfig.modelName is often
    // 'default' or a UI label). All cost flows to the usageData model.
    buildDb(
      dbPath,
      [
        {
          id: "c1",
          usageData: { "gpt-5": { costInCents: 100, amount: 1 } },
          modelName: "claude-3.5-sonnet",
        },
      ],
      [{ composerId: "c1", bubbleId: "b1", inputTokens: 10, outputTokens: 0 }]
    );

    const days = await extractCursorData();
    expect(modelOn(days, DAY, "gpt-5").cost).toBe(1.0);
    expect(
      days[0].modelBreakdowns.find((m) => m.modelName === "claude-3.5-sonnet")
    ).toBeUndefined();
  });
});
