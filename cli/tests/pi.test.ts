import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractPiData, hasPiData } from "../src/pi.js";

interface JsonObject {
  [key: string]: unknown;
}

function createTempDir(): string {
  const dir = join(
    tmpdir(),
    `pi-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Write one session file under `<root>/<projectKey>/<name>.jsonl`. */
function writeSession(
  root: string,
  projectKey: string,
  name: string,
  entries: JsonObject[]
): string {
  const dir = join(root, projectKey);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.jsonl`);
  writeFileSync(
    path,
    entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
    "utf-8"
  );
  return path;
}

function header(id = "sess-1"): JsonObject {
  return {
    type: "session",
    version: 3,
    id,
    timestamp: "2026-08-20T09:00:00.000Z",
    cwd: "/Users/private/project",
  };
}

function userMessage(id: string, parentId: string | null, timestamp: string): JsonObject {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: {
      role: "user",
      content: [{ type: "text", text: "secret prompt" }],
      timestamp: new Date(timestamp).getTime(),
    },
  };
}

function assistantMessage(
  id: string,
  parentId: string | null,
  timestamp: string,
  overrides: Partial<JsonObject> = {}
): JsonObject {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "secret answer" }],
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      api: "anthropic-messages",
      usage: {
        input: 1000,
        output: 500,
        cacheRead: 200,
        cacheWrite: 100,
        totalTokens: 1800,
        cost: { input: 9, output: 9, cacheRead: 9, cacheWrite: 9, total: 99 },
      },
      stopReason: "stop",
      timestamp: new Date(timestamp).getTime(),
      ...overrides,
    },
  };
}

describe("pi extractor", () => {
  let root: string;
  const savedEnv = {
    sessionDir: process.env.PI_CODING_AGENT_SESSION_DIR,
    agentDir: process.env.PI_CODING_AGENT_DIR,
  };

  beforeEach(() => {
    root = createTempDir();
    process.env.PI_CODING_AGENT_SESSION_DIR = root;
    delete process.env.PI_CODING_AGENT_DIR;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    if (savedEnv.sessionDir === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR;
    else process.env.PI_CODING_AGENT_SESSION_DIR = savedEnv.sessionDir;
    if (savedEnv.agentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = savedEnv.agentDir;
  });

  it("detects data via PI_CODING_AGENT_SESSION_DIR", () => {
    expect(hasPiData()).toBe(true);
  });

  it("falls back to PI_CODING_AGENT_DIR/sessions", () => {
    delete process.env.PI_CODING_AGENT_SESSION_DIR;
    const agentDir = createTempDir();
    try {
      process.env.PI_CODING_AGENT_DIR = agentDir;
      expect(hasPiData()).toBe(false);
      mkdirSync(join(agentDir, "sessions"));
      expect(hasPiData()).toBe(true);
    } finally {
      rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("aggregates assistant messages by day and model, tagged as pi", async () => {
    writeSession(root, "--Users-private-project--", "2026-08-20T09-00-00_a", [
      header(),
      userMessage("u1", null, "2026-08-20T09:00:01.000Z"),
      assistantMessage("a1", "u1", "2026-08-20T09:00:05.000Z"),
      userMessage("u2", "a1", "2026-08-20T09:01:00.000Z"),
      assistantMessage("a2", "u2", "2026-08-20T09:01:05.000Z", {
        model: "gpt-5",
        provider: "openai",
        usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30, cost: { total: 0 } },
      }),
    ]);

    const days = await extractPiData();
    expect(days).toHaveLength(1);
    const day = days[0];
    expect(day.source).toBe("pi");
    expect(day.date).toBe("2026-08-20");
    expect(day.inputTokens).toBe(1010);
    expect(day.outputTokens).toBe(520);
    expect(day.cacheReadTokens).toBe(200);
    expect(day.cacheCreationTokens).toBe(100);
    expect(day.modelsUsed.sort()).toEqual(["claude-sonnet-4-5", "gpt-5"]);

    const sonnet = day.modelBreakdowns.find((m) => m.modelName === "claude-sonnet-4-5")!;
    // Cost comes from our pricing table, not pi's usage.cost.total (99):
    // 1000 in @ $3 + 500 out @ $15 + 200 cache-read @ $0.30 + 100 cache-write @ $3.75
    expect(sonnet.cost).toBeCloseTo(0.003 + 0.0075 + 0.00006 + 0.000375, 8);
    expect(day.totalCost).toBeLessThan(1);
  });

  it("counts every branch of a forked session", async () => {
    writeSession(root, "--proj--", "s", [
      header(),
      userMessage("u1", null, "2026-08-20T09:00:01.000Z"),
      assistantMessage("a1", "u1", "2026-08-20T09:00:05.000Z"),
      // Second assistant reply forked from the same user message
      assistantMessage("a1b", "u1", "2026-08-20T09:02:05.000Z"),
    ]);
    const days = await extractPiData();
    expect(days[0].inputTokens).toBe(2000);
  });

  it("splits by UTC date and ignores non-usage entries", async () => {
    writeSession(root, "--proj--", "s", [
      header(),
      { type: "model_change", id: "m1", parentId: null, timestamp: "2026-08-20T09:00:00.000Z", provider: "anthropic", modelId: "claude-sonnet-4-5" },
      { type: "thinking_level_change", id: "t1", parentId: "m1", timestamp: "2026-08-20T09:00:00.000Z", thinkingLevel: "high" },
      assistantMessage("a1", "t1", "2026-08-20T23:59:59.000Z"),
      { type: "compaction", id: "c1", parentId: "a1", timestamp: "2026-08-21T00:00:01.000Z", summary: "secret", tokensBefore: 5000 },
      assistantMessage("a2", "c1", "2026-08-21T00:00:02.000Z"),
      { type: "label", id: "l1", parentId: "a2", timestamp: "2026-08-21T00:00:03.000Z", targetId: "a2", label: "secret" },
    ]);
    const days = await extractPiData();
    expect(days.map((d) => d.date).sort()).toEqual(["2026-08-20", "2026-08-21"]);
    for (const d of days) expect(d.inputTokens).toBe(1000);
  });

  it("skips malformed lines, assistant messages without usage, and zero-usage messages", async () => {
    const path = writeSession(root, "--proj--", "s", [
      header(),
      assistantMessage("a0", null, "2026-08-20T09:00:00.000Z", { usage: undefined }),
      assistantMessage("a1", "a0", "2026-08-20T09:00:01.000Z", {
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      }),
      assistantMessage("a2", "a1", "2026-08-20T09:00:02.000Z"),
    ]);
    writeFileSync(path, "{not json\n" + require("node:fs").readFileSync(path, "utf-8") + "\n{\"type\":\"message\"}\n");

    const days = await extractPiData();
    expect(days).toHaveLength(1);
    expect(days[0].inputTokens).toBe(1000);
    expect(days[0].modelBreakdowns).toHaveLength(1);
  });

  it("falls back to message.timestamp (epoch ms) when the entry timestamp is missing", async () => {
    const entry = assistantMessage("a1", null, "2026-08-22T12:00:00.000Z");
    delete entry.timestamp;
    writeSession(root, "--proj--", "s", [header(), entry]);
    const days = await extractPiData();
    expect(days).toHaveLength(1);
    expect(days[0].date).toBe("2026-08-22");
  });

  it("uses 'unknown' when the model is missing", async () => {
    writeSession(root, "--proj--", "s", [
      header(),
      assistantMessage("a1", null, "2026-08-20T09:00:00.000Z", { model: "" }),
    ]);
    const days = await extractPiData();
    expect(days[0].modelsUsed).toEqual(["unknown"]);
  });

  it("honours --since at the entry level and skips stale files by mtime", async () => {
    writeSession(root, "--proj--", "recent", [
      header(),
      assistantMessage("a1", null, "2026-08-10T09:00:00.000Z"),
      assistantMessage("a2", "a1", "2026-08-20T09:00:00.000Z"),
    ]);
    const stale = writeSession(root, "--proj--", "stale", [
      header("old"),
      assistantMessage("b1", null, "2026-08-20T10:00:00.000Z"),
    ]);
    const old = new Date("2026-07-01T00:00:00Z");
    utimesSync(stale, old, old);

    const days = await extractPiData("2026-08-15");
    expect(days).toHaveLength(1);
    expect(days[0].date).toBe("2026-08-20");
    expect(days[0].inputTokens).toBe(1000);
  });

  it("never leaks content, cwd, or session ids into the output", async () => {
    writeSession(root, "--Users-private-project--", "2026-08-20T09-00-00_deadbeef", [
      header("deadbeef-session"),
      userMessage("u1", null, "2026-08-20T09:00:01.000Z"),
      assistantMessage("a1", "u1", "2026-08-20T09:00:05.000Z"),
    ]);
    const json = JSON.stringify(await extractPiData());
    expect(json).not.toContain("secret");
    expect(json).not.toContain("/Users/");
    expect(json).not.toContain("deadbeef");
    expect(json).not.toContain("anthropic-messages");
  });

  it("returns [] when the sessions directory is missing", async () => {
    process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "nope");
    expect(hasPiData()).toBe(false);
    expect(await extractPiData()).toEqual([]);
  });
});
