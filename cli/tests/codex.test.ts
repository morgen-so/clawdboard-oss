import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractCodexData } from "../src/codex.js";

function createTempCodexDir(): string {
  const dir = join(tmpdir(), `codex-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, "sessions"), { recursive: true });
  return dir;
}

/** Write a rollout JSONL file at the correct date-sharded path. */
function writeRollout(
  baseDir: string,
  date: string, // YYYY-MM-DD
  filename: string,
  lines: Record<string, unknown>[]
): void {
  const [year, month, day] = date.split("-");
  const dayDir = join(baseDir, "sessions", year, month, day);
  mkdirSync(dayDir, { recursive: true });
  const content = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  writeFileSync(join(dayDir, filename), content, "utf-8");
}

/** Build a turn_context JSONL line. */
function turnContext(model: string): Record<string, unknown> {
  return {
    timestamp: new Date().toISOString(),
    type: "turn_context",
    payload: { model },
  };
}

/** Build a token_count event_msg JSONL line with cumulative totals. */
function tokenCount(totals: {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
}): Record<string, unknown> {
  return {
    timestamp: new Date().toISOString(),
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: totals.input_tokens ?? 0,
          cached_input_tokens: totals.cached_input_tokens ?? 0,
          output_tokens: totals.output_tokens ?? 0,
          reasoning_output_tokens: totals.reasoning_output_tokens ?? 0,
          total_tokens:
            (totals.input_tokens ?? 0) +
            (totals.output_tokens ?? 0),
        },
      },
    },
  };
}

describe("extractCodexData", () => {
  let tmpDir: string;
  const originalEnv = process.env.CODEX_HOME;

  beforeEach(() => {
    tmpDir = createTempCodexDir();
    process.env.CODEX_HOME = tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (originalEnv === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalEnv;
    }
  });

  it("returns empty array when no sessions exist", async () => {
    const result = await extractCodexData();
    expect(result).toEqual([]);
  });

  it("extracts a single session into a daily aggregate", async () => {
    writeRollout(tmpDir, "2026-03-10", "rollout-test.jsonl", [
      turnContext("o4-mini"),
      tokenCount({ input_tokens: 5000, output_tokens: 1200 }),
    ]);

    const result = await extractCodexData();
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("2026-03-10");
    expect(result[0].inputTokens).toBe(5000);
    expect(result[0].outputTokens).toBe(1200);
    expect(result[0].modelsUsed).toEqual(["o4-mini"]);
    expect(result[0].modelBreakdowns).toHaveLength(1);
    expect(result[0].modelBreakdowns[0].modelName).toBe("o4-mini");
  });

  it("uses the LAST token_count as cumulative total", async () => {
    writeRollout(tmpDir, "2026-03-10", "rollout-test.jsonl", [
      turnContext("o4-mini"),
      tokenCount({ input_tokens: 1000, output_tokens: 500 }),
      tokenCount({ input_tokens: 3000, output_tokens: 1500 }), // cumulative, not additive
    ]);

    const result = await extractCodexData();
    expect(result).toHaveLength(1);
    expect(result[0].inputTokens).toBe(3000);
    expect(result[0].outputTokens).toBe(1500);
  });

  it("aggregates multiple sessions on the same day", async () => {
    writeRollout(tmpDir, "2026-03-10", "rollout-a.jsonl", [
      turnContext("o4-mini"),
      tokenCount({ input_tokens: 2000, output_tokens: 800 }),
    ]);
    writeRollout(tmpDir, "2026-03-10", "rollout-b.jsonl", [
      turnContext("o4-mini"),
      tokenCount({ input_tokens: 3000, output_tokens: 1000 }),
    ]);

    const result = await extractCodexData();
    expect(result).toHaveLength(1);
    expect(result[0].inputTokens).toBe(5000);
    expect(result[0].outputTokens).toBe(1800);
  });

  it("separates different days", async () => {
    writeRollout(tmpDir, "2026-03-10", "rollout-a.jsonl", [
      turnContext("o4-mini"),
      tokenCount({ input_tokens: 1000, output_tokens: 500 }),
    ]);
    writeRollout(tmpDir, "2026-03-11", "rollout-b.jsonl", [
      turnContext("gpt-4o"),
      tokenCount({ input_tokens: 2000, output_tokens: 800 }),
    ]);

    const result = await extractCodexData();
    expect(result).toHaveLength(2);
    const dates = result.map((d) => d.date).sort();
    expect(dates).toEqual(["2026-03-10", "2026-03-11"]);
  });

  it("tracks different models separately in breakdowns", async () => {
    writeRollout(tmpDir, "2026-03-10", "rollout-a.jsonl", [
      turnContext("o4-mini"),
      tokenCount({ input_tokens: 1000, output_tokens: 500 }),
    ]);
    writeRollout(tmpDir, "2026-03-10", "rollout-b.jsonl", [
      turnContext("gpt-4o"),
      tokenCount({ input_tokens: 2000, output_tokens: 800 }),
    ]);

    const result = await extractCodexData();
    expect(result[0].modelBreakdowns).toHaveLength(2);
    expect(result[0].modelsUsed).toContain("o4-mini");
    expect(result[0].modelsUsed).toContain("gpt-4o");
  });

  it("subtracts cached_input_tokens from input (OpenAI subset semantics)", async () => {
    // Codex reports cached_input_tokens as a SUBSET of input_tokens
    // (total_tokens = input + output). The extractor must not count the
    // cached portion twice — regression test for the double-count bug
    // that inflated every Codex user ~2x on tokens (fixed 2026-08-10).
    writeRollout(tmpDir, "2026-03-10", "rollout-test.jsonl", [
      turnContext("o4-mini"),
      tokenCount({ input_tokens: 5000, cached_input_tokens: 3000, output_tokens: 1000 }),
    ]);

    const result = await extractCodexData();
    expect(result[0].inputTokens).toBe(2000); // 5000 - 3000 uncached
    expect(result[0].cacheReadTokens).toBe(3000);
    expect(result[0].cacheCreationTokens).toBe(0);
    // Invariant: our components sum to Codex's own total (input + output).
    expect(
      result[0].inputTokens + result[0].outputTokens + result[0].cacheReadTokens
    ).toBe(5000 + 1000);
  });

  it("does not bill cached tokens at the full input rate", async () => {
    // 1M input of which 900k cached, 0 output, on o4-mini
    // ($1.1/M input, $0.275/M cache read):
    // correct = 0.1M * 1.1 + 0.9M * 0.275 = 0.11 + 0.2475 = 0.3575
    // buggy   = 1.0M * 1.1 + 0.9M * 0.275 = 1.1 + 0.2475 = 1.3475
    writeRollout(tmpDir, "2026-03-10", "rollout-test.jsonl", [
      turnContext("o4-mini"),
      tokenCount({ input_tokens: 1_000_000, cached_input_tokens: 900_000, output_tokens: 0 }),
    ]);

    const result = await extractCodexData();
    expect(result[0].totalCost).toBeCloseTo(0.3575, 3);
  });

  it("clamps input at zero if cached exceeds input (defensive)", async () => {
    writeRollout(tmpDir, "2026-03-10", "rollout-test.jsonl", [
      turnContext("o4-mini"),
      tokenCount({ input_tokens: 1000, cached_input_tokens: 1500, output_tokens: 100 }),
    ]);

    const result = await extractCodexData();
    expect(result[0].inputTokens).toBe(0);
    expect(result[0].cacheReadTokens).toBe(1500);
  });

  it("calculates cost from tokens", async () => {
    writeRollout(tmpDir, "2026-03-10", "rollout-test.jsonl", [
      turnContext("o4-mini"),
      tokenCount({ input_tokens: 1_000_000, output_tokens: 1_000_000 }),
    ]);

    const result = await extractCodexData();
    // o4-mini: $1.1/1M input + $4.4/1M output = $5.5
    expect(result[0].totalCost).toBeCloseTo(5.5, 1);
  });

  it("filters sessions by since date", async () => {
    writeRollout(tmpDir, "2026-03-08", "rollout-old.jsonl", [
      turnContext("o4-mini"),
      tokenCount({ input_tokens: 1000, output_tokens: 500 }),
    ]);
    writeRollout(tmpDir, "2026-03-12", "rollout-new.jsonl", [
      turnContext("o4-mini"),
      tokenCount({ input_tokens: 2000, output_tokens: 800 }),
    ]);

    const result = await extractCodexData("2026-03-10");
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("2026-03-12");
  });

  it("skips sessions with zero tokens", async () => {
    writeRollout(tmpDir, "2026-03-10", "rollout-empty.jsonl", [
      turnContext("o4-mini"),
      tokenCount({ input_tokens: 0, output_tokens: 0 }),
    ]);

    const result = await extractCodexData();
    expect(result).toEqual([]);
  });

  it("skips malformed JSONL files", async () => {
    const [year, month, day] = "2026-03-10".split("-");
    const dayDir = join(tmpDir, "sessions", year, month, day);
    mkdirSync(dayDir, { recursive: true });
    writeFileSync(join(dayDir, "rollout-bad.jsonl"), "not json\n", "utf-8");

    writeRollout(tmpDir, "2026-03-10", "rollout-good.jsonl", [
      turnContext("o4-mini"),
      tokenCount({ input_tokens: 1000, output_tokens: 500 }),
    ]);

    const result = await extractCodexData();
    expect(result).toHaveLength(1);
  });

  describe("privacy enforcement", () => {
    it("output contains no session metadata or paths", async () => {
      writeRollout(tmpDir, "2026-03-10", "rollout-test.jsonl", [
        {
          timestamp: new Date().toISOString(),
          type: "session_meta",
          payload: {
            id: "thread_secret123",
            cwd: "/Users/jim/secret-project",
            git: { branch: "feature/secret", origin_url: "https://github.com/user/repo" },
          },
        },
        turnContext("o4-mini"),
        tokenCount({ input_tokens: 1000, output_tokens: 500 }),
      ]);

      const result = await extractCodexData();
      const json = JSON.stringify(result);

      expect(json).not.toContain("thread_secret123");
      expect(json).not.toContain("/Users/jim");
      expect(json).not.toContain("secret-project");
      expect(json).not.toContain("feature/secret");
      expect(json).not.toContain("github.com");
    });

    it("SyncDay fields match the allowlisted schema exactly", async () => {
      writeRollout(tmpDir, "2026-03-10", "rollout-test.jsonl", [
        turnContext("o4-mini"),
        tokenCount({ input_tokens: 1000, output_tokens: 500 }),
      ]);

      const result = await extractCodexData();
      const allowedKeys = [
        "date", "source", "inputTokens", "outputTokens", "cacheCreationTokens",
        "cacheReadTokens", "totalCost", "modelsUsed", "modelBreakdowns",
      ];
      expect(Object.keys(result[0]).sort()).toEqual(allowedKeys.sort());

      const mbKeys = [
        "modelName", "inputTokens", "outputTokens",
        "cacheCreationTokens", "cacheReadTokens", "cost",
      ];
      expect(Object.keys(result[0].modelBreakdowns[0]).sort()).toEqual(mbKeys.sort());
    });
  });
});
