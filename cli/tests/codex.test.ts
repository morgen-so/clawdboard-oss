import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as zlib from "node:zlib";
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

/** Build a session_meta JSONL line (a fork's first line names its parent). */
function sessionMeta(id: string, forkedFromId?: string): Record<string, unknown> {
  return {
    timestamp: new Date().toISOString(),
    type: "session_meta",
    payload: { id, ...(forkedFromId ? { forked_from_id: forkedFromId } : {}) },
  };
}

/**
 * The token_count lines of a session that made one response per entry,
 * each with its own usage, as Codex writes them: a running total plus the
 * response's own usage as last_token_usage.
 */
function responses(
  usages: { input_tokens: number; cached_input_tokens?: number; output_tokens: number }[],
  start = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 }
): Record<string, unknown>[] {
  const total = { ...start };
  return usages.map((u) => {
    total.input_tokens += u.input_tokens;
    total.cached_input_tokens += u.cached_input_tokens ?? 0;
    total.output_tokens += u.output_tokens;
    const line = tokenCount(total);
    const info = (line.payload as { info: Record<string, unknown> }).info;
    info.last_token_usage = {
      input_tokens: u.input_tokens,
      cached_input_tokens: u.cached_input_tokens ?? 0,
      output_tokens: u.output_tokens,
      reasoning_output_tokens: 0,
      total_tokens: u.input_tokens + u.output_tokens,
    };
    return line;
  });
}

function sumTokens(days: { inputTokens: number; outputTokens: number; cacheReadTokens: number }[]) {
  return days.reduce(
    (acc, d) => ({
      input: acc.input + d.inputTokens,
      output: acc.output + d.outputTokens,
      cacheRead: acc.cacheRead + d.cacheReadTokens,
    }),
    { input: 0, output: 0, cacheRead: 0 }
  );
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

  describe("forks and sub-agents", () => {
    // A fork (or a sub-agent spawned with the parent's history) gets its own
    // rollout that starts with a verbatim copy of the parent's lines, and its
    // running total continues from the parent's. Taking each file's last
    // total counted the parent once per fork: one heavy multi-agent user
    // came out ~5x above Codex's own lifetime counter.
    const parentTurns = responses([
      { input_tokens: 1000, cached_input_tokens: 600, output_tokens: 100 },
      { input_tokens: 2000, cached_input_tokens: 1500, output_tokens: 200 },
    ]);
    const parentTotal = { input_tokens: 3000, cached_input_tokens: 2100, output_tokens: 300 };

    function forkOf(
      parentId: string,
      childId: string,
      own: { input_tokens: number; cached_input_tokens?: number; output_tokens: number }[],
      opts: { legacy?: boolean } = {}
    ): Record<string, unknown>[] {
      return [
        // Current Codex marks the fork on the child's own first line; older
        // versions only give it away by copying the parent's session_meta.
        opts.legacy ? sessionMeta(childId) : sessionMeta(childId, parentId),
        sessionMeta(parentId),
        turnContext("gpt-5.6-sol"),
        ...parentTurns,
        turnContext("gpt-5.6-sol"),
        ...responses(own, parentTotal),
      ];
    }

    it("counts a forked session's copied history once", async () => {
      writeRollout(tmpDir, "2026-07-14", "rollout-2026-07-14T10-00-00-parent.jsonl", [
        sessionMeta("parent"),
        turnContext("gpt-5.6-sol"),
        ...parentTurns,
      ]);
      writeRollout(
        tmpDir,
        "2026-07-14",
        "rollout-2026-07-14T11-00-00-child.jsonl",
        forkOf("parent", "child", [{ input_tokens: 500, cached_input_tokens: 400, output_tokens: 50 }])
      );

      const totals = sumTokens(await extractCodexData());
      // parent 3000 in (2100 cached) / 300 out, plus the child's own 500 (400) / 50
      expect(totals.cacheRead).toBe(2100 + 400);
      expect(totals.input).toBe(3000 - 2100 + (500 - 400));
      expect(totals.output).toBe(300 + 50);
    });

    it("recognises forks from older Codex by the copied session_meta", async () => {
      writeRollout(tmpDir, "2026-07-14", "rollout-2026-07-14T10-00-00-parent.jsonl", [
        sessionMeta("parent"),
        turnContext("gpt-5.6-sol"),
        ...parentTurns,
      ]);
      writeRollout(
        tmpDir,
        "2026-07-14",
        "rollout-2026-07-14T11-00-00-child.jsonl",
        forkOf("parent", "child", [{ input_tokens: 500, output_tokens: 50 }], { legacy: true })
      );

      const totals = sumTokens(await extractCodexData());
      expect(totals.output).toBe(300 + 50);
    });

    it("counts each of several sub-agents' own usage, and the parent once", async () => {
      writeRollout(tmpDir, "2026-07-14", "rollout-2026-07-14T10-00-00-parent.jsonl", [
        sessionMeta("parent"),
        turnContext("gpt-5.6-sol"),
        ...parentTurns,
      ]);
      for (const n of [1, 2, 3, 4]) {
        writeRollout(
          tmpDir,
          "2026-07-14",
          `rollout-2026-07-14T11-00-0${n}-agent${n}.jsonl`,
          forkOf("parent", `agent${n}`, [{ input_tokens: 100, output_tokens: 10 }])
        );
      }

      const totals = sumTokens(await extractCodexData());
      expect(totals.output).toBe(300 + 4 * 10);
      expect(totals.input + totals.cacheRead).toBe(3000 + 4 * 100);
    });

    it("counts a fork of a fork once per level", async () => {
      writeRollout(tmpDir, "2026-07-14", "rollout-2026-07-14T10-00-00-parent.jsonl", [
        sessionMeta("parent"),
        turnContext("gpt-5.6-sol"),
        ...parentTurns,
      ]);
      const child = forkOf("parent", "child", [{ input_tokens: 500, output_tokens: 50 }]);
      writeRollout(tmpDir, "2026-07-14", "rollout-2026-07-14T11-00-00-child.jsonl", child);
      writeRollout(tmpDir, "2026-07-14", "rollout-2026-07-14T12-00-00-grandchild.jsonl", [
        sessionMeta("grandchild", "child"),
        ...child,
        ...responses([{ input_tokens: 70, output_tokens: 7 }], {
          input_tokens: 3500,
          cached_input_tokens: 2100,
          output_tokens: 350,
        }),
      ]);

      const totals = sumTokens(await extractCodexData());
      expect(totals.output).toBe(300 + 50 + 7);
    });

    it("attributes a fork's own usage to the fork's date", async () => {
      writeRollout(tmpDir, "2026-07-13", "rollout-2026-07-13T23-00-00-parent.jsonl", [
        sessionMeta("parent"),
        turnContext("gpt-5.6-sol"),
        ...parentTurns,
      ]);
      writeRollout(
        tmpDir,
        "2026-07-14",
        "rollout-2026-07-14T09-00-00-child.jsonl",
        forkOf("parent", "child", [{ input_tokens: 500, output_tokens: 50 }])
      );

      const result = await extractCodexData();
      const byDate = Object.fromEntries(result.map((d) => [d.date, d]));
      expect(byDate["2026-07-13"].outputTokens).toBe(300);
      expect(byDate["2026-07-14"].outputTokens).toBe(50);
    });

    it("counts the copied history when the parent's rollout is gone", async () => {
      // Deleted parent: the fork's copy is the only record of that usage.
      writeRollout(
        tmpDir,
        "2026-07-14",
        "rollout-2026-07-14T11-00-00-child.jsonl",
        forkOf("parent", "child", [{ input_tokens: 500, output_tokens: 50 }])
      );

      const totals = sumTokens(await extractCodexData());
      expect(totals.output).toBe(300 + 50);
    });

    it("does not count a parent from before --since through its later fork", async () => {
      writeRollout(tmpDir, "2026-07-10", "rollout-2026-07-10T10-00-00-parent.jsonl", [
        sessionMeta("parent"),
        turnContext("gpt-5.6-sol"),
        ...parentTurns,
      ]);
      writeRollout(
        tmpDir,
        "2026-07-14",
        "rollout-2026-07-14T11-00-00-child.jsonl",
        forkOf("parent", "child", [{ input_tokens: 500, output_tokens: 50 }])
      );

      const result = await extractCodexData("2026-07-12");
      expect(result).toHaveLength(1);
      expect(result[0].date).toBe("2026-07-14");
      expect(result[0].outputTokens).toBe(50);
    });

    it("leaves a regular session that happens to repeat a total alone", async () => {
      // Only forks skip already-seen events; two unrelated sessions with an
      // identical first response both count.
      for (const name of ["a", "b"]) {
        writeRollout(tmpDir, "2026-07-14", `rollout-2026-07-14T10-00-00-${name}.jsonl`, [
          sessionMeta(name),
          turnContext("gpt-5.6-sol"),
          ...responses([{ input_tokens: 1000, output_tokens: 100 }]),
        ]);
      }

      const totals = sumTokens(await extractCodexData());
      expect(totals.output).toBe(200);
    });
  });

  describe("running-total edge cases", () => {
    it("ignores token_count events re-sent with no new usage", async () => {
      // Codex re-emits token_count on rate-limit updates with the same totals.
      const [first] = responses([{ input_tokens: 1000, output_tokens: 100 }]);
      writeRollout(tmpDir, "2026-07-14", "rollout-test.jsonl", [
        turnContext("gpt-5.6-sol"),
        first,
        first,
        first,
      ]);

      const result = await extractCodexData();
      expect(result[0].inputTokens).toBe(1000);
      expect(result[0].outputTokens).toBe(100);
    });

    it("keeps usage from before and after a counter reset", async () => {
      // On a context-window overflow Codex overwrites the running total with
      // zeroed fields, then keeps adding. The last total alone loses
      // everything before the reset.
      writeRollout(tmpDir, "2026-07-14", "rollout-test.jsonl", [
        turnContext("gpt-5.6-sol"),
        tokenCount({ input_tokens: 5000, output_tokens: 500 }),
        tokenCount({ input_tokens: 0, output_tokens: 0 }),
        tokenCount({ input_tokens: 800, output_tokens: 80 }),
      ]);

      const result = await extractCodexData();
      expect(result[0].inputTokens).toBe(5800);
      expect(result[0].outputTokens).toBe(580);
    });

    const zstd = (zlib as unknown as { zstdCompressSync?: (b: Buffer) => Buffer }).zstdCompressSync;
    it.skipIf(typeof zstd !== "function")("reads compressed .jsonl.zst rollouts", async () => {
      const [year, month, day] = ["2026", "07", "14"];
      const dayDir = join(tmpDir, "sessions", year, month, day);
      mkdirSync(dayDir, { recursive: true });
      const lines = [turnContext("gpt-5.6-sol"), tokenCount({ input_tokens: 4000, output_tokens: 400 })];
      const text = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
      writeFileSync(join(dayDir, "rollout-cold.jsonl.zst"), zstd!(Buffer.from(text)));

      const result = await extractCodexData();
      expect(result[0].inputTokens).toBe(4000);
      expect(result[0].outputTokens).toBe(400);
    });

    it.skipIf(typeof zstd !== "function")("reads a rollout once while both copies exist", async () => {
      // Codex writes the .zst before removing the plain file.
      const lines = [turnContext("gpt-5.6-sol"), tokenCount({ input_tokens: 4000, output_tokens: 400 })];
      writeRollout(tmpDir, "2026-07-14", "rollout-mid.jsonl", lines);
      const text = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
      writeFileSync(
        join(tmpDir, "sessions", "2026", "07", "14", "rollout-mid.jsonl.zst"),
        zstd!(Buffer.from(text))
      );

      const result = await extractCodexData();
      expect(result[0].inputTokens).toBe(4000);
      expect(result[0].outputTokens).toBe(400);
    });
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
