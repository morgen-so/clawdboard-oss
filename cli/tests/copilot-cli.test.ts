import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractCopilotCliData,
  hasCopilotCliData,
} from "../src/copilot-cli.js";

interface JsonObject {
  [key: string]: unknown;
}

function createTempCopilotDir(): string {
  const dir = join(
    tmpdir(),
    `copilot-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSession(
  baseDir: string,
  sessionId: string,
  events: JsonObject[]
): void {
  const sessionDir = join(baseDir, "session-state", sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const lines = events.map((e) => JSON.stringify(e)).join("\n");
  writeFileSync(join(sessionDir, "events.jsonl"), lines + "\n", "utf-8");
}

function makeStartEvent(
  sessionId: string,
  startTime = "2026-03-10T12:00:00.000Z"
): JsonObject {
  return {
    type: "session.start",
    timestamp: startTime,
    data: {
      sessionId,
      version: 1,
      producer: "copilot-agent",
      startTime,
    },
  };
}

function makeShutdownEvent(
  startMs: number,
  modelMetrics: Record<string, JsonObject>,
  totalPremium = 0,
  shutdownTime = "2026-03-10T12:30:00.000Z"
): JsonObject {
  return {
    type: "session.shutdown",
    timestamp: shutdownTime,
    data: {
      shutdownType: "routine",
      sessionStartTime: startMs,
      totalPremiumRequests: totalPremium,
      modelMetrics,
    },
  };
}

describe("extractCopilotCliData", () => {
  let tmpDir: string;
  const originalEnv = process.env.COPILOT_HOME;

  beforeEach(() => {
    tmpDir = createTempCopilotDir();
    process.env.COPILOT_HOME = tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (originalEnv === undefined) {
      delete process.env.COPILOT_HOME;
    } else {
      process.env.COPILOT_HOME = originalEnv;
    }
  });

  describe("hasCopilotCliData", () => {
    it("returns false when session-state dir is missing", () => {
      expect(hasCopilotCliData()).toBe(false);
    });

    it("returns true when session-state dir exists", () => {
      mkdirSync(join(tmpDir, "session-state"), { recursive: true });
      expect(hasCopilotCliData()).toBe(true);
    });
  });

  describe("extraction", () => {
    it("returns empty array when no sessions exist", async () => {
      const result = await extractCopilotCliData();
      expect(result).toEqual([]);
    });

    it("extracts a completed session with one model", async () => {
      const startMs = new Date("2026-03-10T12:00:00.000Z").getTime();
      writeSession(tmpDir, "sess-1", [
        makeStartEvent("sess-1"),
        makeShutdownEvent(
          startMs,
          {
            "claude-sonnet-4-5": {
              requests: { count: 3, cost: 2 },
              usage: {
                inputTokens: 1000,
                outputTokens: 500,
                cacheReadTokens: 200,
                cacheWriteTokens: 100,
                reasoningTokens: 0,
              },
            },
          },
          2
        ),
      ]);

      const result = await extractCopilotCliData();
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe("copilot-cli");
      expect(result[0].date).toBe("2026-03-10");
      expect(result[0].inputTokens).toBe(1000);
      expect(result[0].outputTokens).toBe(500);
      expect(result[0].cacheReadTokens).toBe(200);
      expect(result[0].cacheCreationTokens).toBe(100);
      // count is the request count; cost is the dollar value (not what we want)
      expect(result[0].premiumRequests).toBe(3);
      expect(result[0].modelsUsed).toEqual(["claude-sonnet-4-5"]);
    });

    it("treats reasoning tokens as output for cost calculation", async () => {
      const startMs = new Date("2026-03-10T12:00:00.000Z").getTime();
      writeSession(tmpDir, "sess-1", [
        makeShutdownEvent(startMs, {
          "claude-sonnet-4-5": {
            requests: { count: 1, cost: 1 },
            usage: {
              inputTokens: 1_000_000,
              outputTokens: 500_000,
              reasoningTokens: 500_000,
            },
          },
        }),
      ]);

      const result = await extractCopilotCliData();
      // claude-sonnet-4-5 = $3/1M input + $15/1M output → 1*3 + 1*15 = $18
      // (output 500k + reasoning 500k = 1M output total)
      expect(result[0].outputTokens).toBe(1_000_000);
      expect(result[0].totalCost).toBeCloseTo(18, 1);
    });

    it("aggregates multiple sessions on the same day", async () => {
      const startMs = new Date("2026-03-10T12:00:00.000Z").getTime();
      writeSession(tmpDir, "sess-1", [
        makeShutdownEvent(
          startMs,
          {
            "claude-sonnet-4-5": {
              requests: { count: 1, cost: 1 },
              usage: { inputTokens: 1000, outputTokens: 500 },
            },
          },
          1
        ),
      ]);
      writeSession(tmpDir, "sess-2", [
        makeShutdownEvent(
          startMs + 3600000, // an hour later, same day
          {
            "claude-sonnet-4-5": {
              requests: { count: 1, cost: 2 },
              usage: { inputTokens: 2000, outputTokens: 1000 },
            },
          },
          2
        ),
      ]);

      const result = await extractCopilotCliData();
      expect(result).toHaveLength(1);
      expect(result[0].inputTokens).toBe(3000);
      expect(result[0].outputTokens).toBe(1500);
      // sess-1 count=1 + sess-2 count=1 = 2 (cost values are 1 and 2; not used)
      expect(result[0].premiumRequests).toBe(2);
    });

    it("aggregates multiple models within a session", async () => {
      const startMs = new Date("2026-03-10T12:00:00.000Z").getTime();
      writeSession(tmpDir, "sess-1", [
        makeShutdownEvent(
          startMs,
          {
            "claude-sonnet-4-5": {
              requests: { count: 2, cost: 1 },
              usage: { inputTokens: 1000, outputTokens: 500 },
            },
            "gpt-5": {
              requests: { count: 1, cost: 1 },
              usage: { inputTokens: 2000, outputTokens: 800 },
            },
          },
          2
        ),
      ]);

      const result = await extractCopilotCliData();
      expect(result).toHaveLength(1);
      expect(result[0].modelsUsed.sort()).toEqual([
        "claude-sonnet-4-5",
        "gpt-5",
      ]);
      expect(result[0].inputTokens).toBe(3000);
      // sonnet count=2 + gpt-5 count=1 = 3 (cost values are 1+1=2; not used)
      expect(result[0].premiumRequests).toBe(3);

      const sonnet = result[0].modelBreakdowns.find(
        (m) => m.modelName === "claude-sonnet-4-5"
      );
      expect(sonnet?.premiumRequests).toBe(2);
    });

    it("filters by since date", async () => {
      const oldStartMs = new Date("2026-03-08T12:00:00.000Z").getTime();
      const newStartMs = new Date("2026-03-12T12:00:00.000Z").getTime();
      writeSession(tmpDir, "old", [
        makeShutdownEvent(oldStartMs, {
          m: { requests: { count: 1, cost: 1 }, usage: { inputTokens: 100, outputTokens: 50 } },
        }),
      ]);
      writeSession(tmpDir, "new", [
        makeShutdownEvent(newStartMs, {
          m: { requests: { count: 1, cost: 1 }, usage: { inputTokens: 200, outputTokens: 100 } },
        }),
      ]);

      const result = await extractCopilotCliData("2026-03-10");
      expect(result).toHaveLength(1);
      expect(result[0].date).toBe("2026-03-12");
      expect(result[0].inputTokens).toBe(200);
    });

    it("skips sessions without a shutdown event (still in progress)", async () => {
      writeSession(tmpDir, "in-progress", [makeStartEvent("in-progress")]);

      const result = await extractCopilotCliData();
      expect(result).toEqual([]);
    });

    it("does not emit premiumRequests on the SyncDay when total is zero", async () => {
      const startMs = new Date("2026-03-10T12:00:00.000Z").getTime();
      writeSession(tmpDir, "free", [
        makeShutdownEvent(
          startMs,
          {
            m: {
              // count: 0 — no premium requests for this session
              requests: { count: 0, cost: 0 },
              usage: { inputTokens: 100, outputTokens: 50 },
            },
          },
          0
        ),
      ]);

      const result = await extractCopilotCliData();
      expect(result).toHaveLength(1);
      expect(result[0].premiumRequests).toBeUndefined();
    });
  });

  describe("malformed input tolerance", () => {
    it("strips U+2028 / U+2029 codepoints before parsing (issue #2012)", async () => {
      const startMs = new Date("2026-03-10T12:00:00.000Z").getTime();
      const sessionDir = join(tmpDir, "session-state", "sess-1");
      mkdirSync(sessionDir, { recursive: true });

      // Build a shutdown event with rogue U+2028/U+2029 inside what would
      // otherwise be valid JSON. The line is broken until we strip them.
      const validShutdown = JSON.stringify({
        type: "session.shutdown",
        timestamp: "2026-03-10T12:30:00Z",
        data: {
          sessionStartTime: startMs,
          modelMetrics: {
            m: {
              requests: { count: 1, cost: 1 },
              usage: { inputTokens: 100, outputTokens: 50 },
            },
          },
        },
      });
      // Inject rogue codepoints
      const corrupted = validShutdown.replace("session.shutdown", "session.shutdown ");
      writeFileSync(
        join(sessionDir, "events.jsonl"),
        corrupted + "\n",
        "utf-8"
      );

      const result = await extractCopilotCliData();
      expect(result).toHaveLength(1);
      expect(result[0].inputTokens).toBe(100);
    });

    it("ignores blank lines", async () => {
      const startMs = new Date("2026-03-10T12:00:00.000Z").getTime();
      const sessionDir = join(tmpDir, "session-state", "sess-1");
      mkdirSync(sessionDir, { recursive: true });
      const shutdown = JSON.stringify({
        type: "session.shutdown",
        timestamp: "2026-03-10T12:30:00Z",
        data: {
          sessionStartTime: startMs,
          modelMetrics: {
            m: {
              requests: { count: 1, cost: 1 },
              usage: { inputTokens: 100, outputTokens: 50 },
            },
          },
        },
      });
      writeFileSync(
        join(sessionDir, "events.jsonl"),
        "\n\n" + shutdown + "\n\n",
        "utf-8"
      );

      const result = await extractCopilotCliData();
      expect(result).toHaveLength(1);
    });

    it("ignores garbled lines that fail JSON parsing", async () => {
      const startMs = new Date("2026-03-10T12:00:00.000Z").getTime();
      const sessionDir = join(tmpDir, "session-state", "sess-1");
      mkdirSync(sessionDir, { recursive: true });
      const shutdown = JSON.stringify({
        type: "session.shutdown",
        timestamp: "2026-03-10T12:30:00Z",
        data: {
          sessionStartTime: startMs,
          modelMetrics: {
            m: {
              requests: { count: 1, cost: 1 },
              usage: { inputTokens: 100, outputTokens: 50 },
            },
          },
        },
      });
      writeFileSync(
        join(sessionDir, "events.jsonl"),
        "{not json\n" + shutdown + "\n",
        "utf-8"
      );

      const result = await extractCopilotCliData();
      expect(result).toHaveLength(1);
    });
  });

  describe("privacy enforcement", () => {
    it("output contains no session IDs, prompts, or tool outputs", async () => {
      const startMs = new Date("2026-03-10T12:00:00.000Z").getTime();
      writeSession(tmpDir, "sess-secret-12345", [
        {
          type: "user.message",
          data: { content: "this is a secret prompt" },
        },
        {
          type: "assistant.message",
          data: { content: "this is a secret response" },
        },
        makeShutdownEvent(startMs, {
          m: {
            requests: { count: 1, cost: 1 },
            usage: { inputTokens: 100, outputTokens: 50 },
          },
        }),
      ]);

      const result = await extractCopilotCliData();
      const json = JSON.stringify(result);
      expect(json).not.toContain("sess-secret-12345");
      expect(json).not.toContain("secret prompt");
      expect(json).not.toContain("secret response");
    });

    it("SyncDay fields match the allowlisted schema (with optional premiumRequests)", async () => {
      const startMs = new Date("2026-03-10T12:00:00.000Z").getTime();
      writeSession(tmpDir, "s", [
        makeShutdownEvent(
          startMs,
          {
            m: {
              requests: { count: 1, cost: 1 },
              usage: { inputTokens: 100, outputTokens: 50 },
            },
          },
          1
        ),
      ]);

      const result = await extractCopilotCliData();
      const day = result[0];

      const allowedKeys = [
        "date",
        "source",
        "inputTokens",
        "outputTokens",
        "cacheCreationTokens",
        "cacheReadTokens",
        "totalCost",
        "modelsUsed",
        "modelBreakdowns",
        "premiumRequests",
      ];
      expect(Object.keys(day).sort()).toEqual(allowedKeys.sort());
    });
  });
});
