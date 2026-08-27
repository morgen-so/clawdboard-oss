import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as zlib from "node:zlib";
import {
  extractDeepSeekHarnessData,
  hasDeepSeekHarnessData,
  scanZstdFrames,
} from "../src/deepseek-harness.js";

interface JsonObject {
  [key: string]: unknown;
}

const zstdCompressSync = (zlib as unknown as { zstdCompressSync?: (b: Buffer) => Buffer })
  .zstdCompressSync;
const hasZstd = typeof zstdCompressSync === "function";

const T0 = Date.UTC(2026, 7, 20, 9, 0, 0); // 2026-08-20T09:00:00Z

function header(id = "sess-1"): JsonObject {
  return {
    type: "session",
    version: 0,
    id,
    createdAt: T0,
    cwd: "/Users/private/project",
    delegationDepth: 0,
  };
}

function requestHeader(seq: number, model: string, time = T0): JsonObject {
  return {
    type: "request/header",
    seq,
    time,
    data: {
      header: {
        config: { provider: "deepseek", model },
        system: "secret system prompt",
        tools: [{ name: "bash" }],
      },
      reason: "initial",
    },
  };
}

function requestContext(seq: number, model: string, time = T0): JsonObject {
  return {
    type: "request/context",
    seq,
    time,
    data: { provider: "deepseek", model, contextWindow: 128000 },
  };
}

function assistantMessage(
  seq: number,
  time: number,
  usage: JsonObject | null = {
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 200,
    cacheWriteTokens: 100,
    reasoningTokens: 50,
  }
): JsonObject {
  return {
    type: "assistant/message",
    seq,
    time,
    data: {
      turn: 1,
      step: 1,
      message: {
        id: "m1",
        role: "assistant",
        content: [{ type: "text", text: "secret answer" }],
        source: { kind: "model" },
      },
      ...(usage ? { usage } : {}),
    },
  };
}

function lines(entries: JsonObject[]): string {
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

describe("deepseek-harness extractor", () => {
  let home: string;
  let root: string;
  const savedHome = process.env.DSH_HOME;

  beforeEach(() => {
    home = join(
      tmpdir(),
      `dsh-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    root = join(home, "sessions");
    mkdirSync(root, { recursive: true });
    process.env.DSH_HOME = home;
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    if (savedHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = savedHome;
  });

  function writePlain(project: string, session: string, entries: JsonObject[]): string {
    const dir = join(root, project, session);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "session.jsonl");
    writeFileSync(path, lines(entries), "utf-8");
    return path;
  }

  /** Write a zstd log made of one frame per batch, mimicking append-only flushes. */
  function writeZstd(project: string, session: string, batches: JsonObject[][], torn = false): string {
    const dir = join(root, project, session);
    mkdirSync(dir, { recursive: true });
    const frames = batches.map((b) => zstdCompressSync!(Buffer.from(lines(b), "utf-8")));
    if (torn) {
      const last = zstdCompressSync!(Buffer.from(lines([assistantMessage(99, T0)]), "utf-8"));
      frames.push(last.subarray(0, Math.max(6, last.length - 3)));
    }
    const path = join(dir, "session.jsonl.zstd");
    writeFileSync(path, Buffer.concat(frames));
    return path;
  }

  it("detects data via DSH_HOME", () => {
    expect(hasDeepSeekHarnessData()).toBe(true);
    process.env.DSH_HOME = join(home, "nope");
    expect(hasDeepSeekHarnessData()).toBe(false);
  });

  it("aggregates plain logs, taking the model from request/header", async () => {
    writePlain("--Users-private-project--", "s1", [
      header(),
      { type: "turn/start", seq: 0, time: T0, data: { turn: 1 } },
      requestHeader(1, "deepseek-v4-pro"),
      { type: "user/message", seq: 2, time: T0, data: { role: "user", content: [{ type: "text", text: "secret prompt" }] } },
      { type: "step/start", seq: 3, time: T0, data: { turn: 1, step: 1 } },
      { type: "text-chunks", seq0: 4, time0: T0, data: { index: 0, texts: ["sec", "ret"], seqs: [4, 5] } },
      assistantMessage(6, T0 + 5000),
      { type: "step/end", seq: 7, time: T0 + 5000, data: { turn: 1, step: 1 } },
      { type: "turn/end", seq: 8, time: T0 + 5000, data: { turn: 1, reason: { kind: "completed" } } },
    ]);

    const days = await extractDeepSeekHarnessData();
    expect(days).toHaveLength(1);
    const day = days[0];
    expect(day.source).toBe("deepseek-harness");
    expect(day.date).toBe("2026-08-20");
    expect(day.inputTokens).toBe(1000);
    expect(day.outputTokens).toBe(500); // reasoningTokens not added on top
    expect(day.cacheReadTokens).toBe(200);
    expect(day.cacheCreationTokens).toBe(100);
    expect(day.modelsUsed).toEqual(["deepseek-v4-pro"]);
    expect(day.totalCost).toBeGreaterThan(0);
  });

  it("follows model changes via request/context and request/header", async () => {
    writePlain("--proj--", "s1", [
      header(),
      requestHeader(0, "deepseek-v4-pro"),
      assistantMessage(1, T0),
      requestContext(2, "gpt-5"),
      assistantMessage(3, T0 + 1000),
      requestHeader(4, "claude-sonnet-4-5"),
      assistantMessage(5, T0 + 2000),
    ]);
    const days = await extractDeepSeekHarnessData();
    expect(days[0].modelsUsed.sort()).toEqual(["claude-sonnet-4-5", "deepseek-v4-pro", "gpt-5"]);
    for (const mb of days[0].modelBreakdowns) expect(mb.inputTokens).toBe(1000);
  });

  it("uses 'unknown' when no request header precedes the message", async () => {
    writePlain("--proj--", "s1", [header(), assistantMessage(0, T0)]);
    const days = await extractDeepSeekHarnessData();
    expect(days[0].modelsUsed).toEqual(["unknown"]);
  });

  it("skips messages without usage, zero usage, bad times, and malformed lines", async () => {
    const path = writePlain("--proj--", "s1", [
      header(),
      requestHeader(0, "deepseek-v4-pro"),
      assistantMessage(1, T0, null),
      assistantMessage(2, T0, { inputTokens: 0, outputTokens: 0 }),
      { ...assistantMessage(3, T0), time: "not-a-number" },
      assistantMessage(4, T0),
    ]);
    writeFileSync(path, require("node:fs").readFileSync(path, "utf-8") + "{broken\n");
    const days = await extractDeepSeekHarnessData();
    expect(days).toHaveLength(1);
    expect(days[0].inputTokens).toBe(1000);
  });

  it("reads sessions under _no-cwd and splits by UTC date", async () => {
    writePlain("_no-cwd", "s1", [
      header(),
      requestHeader(0, "deepseek-v4-pro"),
      assistantMessage(1, Date.UTC(2026, 7, 20, 23, 59, 59)),
      assistantMessage(2, Date.UTC(2026, 7, 21, 0, 0, 1)),
    ]);
    const days = await extractDeepSeekHarnessData();
    expect(days.map((d) => d.date).sort()).toEqual(["2026-08-20", "2026-08-21"]);
  });

  it("honours --since at the event level and skips stale files by mtime", async () => {
    writePlain("--proj--", "recent", [
      header(),
      requestHeader(0, "deepseek-v4-pro"),
      assistantMessage(1, Date.UTC(2026, 7, 10)),
      assistantMessage(2, Date.UTC(2026, 7, 20)),
    ]);
    const stale = writePlain("--proj--", "stale", [
      header("old"),
      requestHeader(0, "deepseek-v4-pro"),
      assistantMessage(1, Date.UTC(2026, 7, 20)),
    ]);
    const old = new Date("2026-07-01T00:00:00Z");
    utimesSync(stale, old, old);

    const days = await extractDeepSeekHarnessData("2026-08-15");
    expect(days).toHaveLength(1);
    expect(days[0].inputTokens).toBe(1000);
  });

  it("never leaks prompts, system prompts, cwd, or session ids", async () => {
    writePlain("--Users-private-project--", "deadbeef", [
      header("deadbeef"),
      requestHeader(0, "deepseek-v4-pro"),
      { type: "user/message", seq: 1, time: T0, data: { role: "user", content: [{ type: "text", text: "secret prompt" }] } },
      assistantMessage(2, T0),
    ]);
    const json = JSON.stringify(await extractDeepSeekHarnessData());
    expect(json).not.toContain("secret");
    expect(json).not.toContain("/Users/");
    expect(json).not.toContain("deadbeef");
  });

  it("returns [] when the sessions directory is missing", async () => {
    rmSync(root, { recursive: true, force: true });
    expect(await extractDeepSeekHarnessData()).toEqual([]);
  });

  describe("zstd logs", () => {
    it.skipIf(!hasZstd)("decodes concatenated frames written by separate flushes", async () => {
      writeZstd("--proj--", "s1", [
        [header()],
        [requestHeader(0, "deepseek-v4-pro"), assistantMessage(1, T0)],
        [assistantMessage(2, T0 + 1000)],
      ]);
      const days = await extractDeepSeekHarnessData();
      expect(days).toHaveLength(1);
      expect(days[0].inputTokens).toBe(2000);
      expect(days[0].modelsUsed).toEqual(["deepseek-v4-pro"]);
    });

    it.skipIf(!hasZstd)("ignores a torn trailing frame", async () => {
      writeZstd(
        "--proj--",
        "s1",
        [[header()], [requestHeader(0, "deepseek-v4-pro"), assistantMessage(1, T0)]],
        true
      );
      const days = await extractDeepSeekHarnessData();
      expect(days).toHaveLength(1);
      expect(days[0].inputTokens).toBe(1000);
    });

    it.skipIf(!hasZstd)("prefers the .zstd log when both encodings exist", async () => {
      writeZstd("--proj--", "s1", [[header()], [requestHeader(0, "deepseek-v4-pro"), assistantMessage(1, T0)]]);
      writePlain("--proj--", "s1", [header(), requestHeader(0, "deepseek-v4-pro"), assistantMessage(1, T0), assistantMessage(2, T0)]);
      const days = await extractDeepSeekHarnessData();
      expect(days[0].inputTokens).toBe(1000);
    });

    it.skipIf(!hasZstd)("scanZstdFrames finds every complete frame and stops at a torn one", () => {
      const a = zstdCompressSync!(Buffer.from("hello\n"));
      const b = zstdCompressSync!(Buffer.from("world\n"));
      const frames = scanZstdFrames(Buffer.concat([a, b]));
      expect(frames).toEqual([
        { start: 0, end: a.length },
        { start: a.length, end: a.length + b.length },
      ]);
      const torn = scanZstdFrames(Buffer.concat([a, b.subarray(0, b.length - 2)]));
      expect(torn).toEqual([{ start: 0, end: a.length }]);
      expect(scanZstdFrames(Buffer.from("not zstd at all"))).toEqual([]);
    });
  });
});
