import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractGeminiCliData,
  hasGeminiCliData,
} from "../src/gemini-cli.js";

interface JsonObject {
  [key: string]: unknown;
}

function createTempGeminiDir(): string {
  const dir = join(
    tmpdir(),
    `gemini-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSession(
  baseDir: string,
  projectId: string,
  sessionId: string,
  records: JsonObject[]
): void {
  const chatsDir = join(baseDir, "tmp", projectId, "chats");
  mkdirSync(chatsDir, { recursive: true });
  const lines = records.map((r) => JSON.stringify(r)).join("\n");
  writeFileSync(
    join(chatsDir, `session-${sessionId}.jsonl`),
    lines + "\n",
    "utf-8"
  );
}

function makeHeader(sessionId = "test-session"): JsonObject {
  return {
    sessionId,
    projectHash: "deadbeef",
    startTime: "2026-04-28T19:18:52.492Z",
    lastUpdated: "2026-04-28T19:18:52.492Z",
    kind: "main",
  };
}

function makeUserMessage(id: string, timestamp: string): JsonObject {
  return {
    id,
    timestamp,
    type: "user",
    content: [{ text: "user prompt" }],
  };
}

function makeGeminiMessage(
  id: string,
  timestamp: string,
  overrides: Partial<JsonObject> = {}
): JsonObject {
  return {
    id,
    timestamp,
    type: "gemini",
    content: "response text",
    thoughts: [{ subject: "x", description: "y", timestamp }],
    tokens: {
      input: 1000,
      output: 500,
      cached: 0,
      thoughts: 100,
      tool: 0,
      total: 1600,
    },
    model: "gemini-2.5-pro",
    ...overrides,
  };
}

describe("extractGeminiCliData", () => {
  let tmpDir: string;
  const originalEnv = process.env.GEMINI_HOME;

  beforeEach(() => {
    tmpDir = createTempGeminiDir();
    process.env.GEMINI_HOME = tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (originalEnv === undefined) {
      delete process.env.GEMINI_HOME;
    } else {
      process.env.GEMINI_HOME = originalEnv;
    }
  });

  describe("hasGeminiCliData", () => {
    it("returns false when chats directory is missing", () => {
      // Don't create tmp/ subdirectory
      expect(hasGeminiCliData()).toBe(false);
    });

    it("returns true when tmp directory exists", () => {
      mkdirSync(join(tmpDir, "tmp"), { recursive: true });
      expect(hasGeminiCliData()).toBe(true);
    });
  });

  describe("extraction", () => {
    it("returns empty array when no sessions exist", async () => {
      const result = await extractGeminiCliData();
      expect(result).toEqual([]);
    });

    it("extracts a single gemini message into a daily aggregate", async () => {
      writeSession(tmpDir, "myproject", "session1", [
        makeHeader("session1"),
        makeUserMessage("u1", "2026-03-10T12:00:00.000Z"),
        makeGeminiMessage("g1", "2026-03-10T12:00:05.000Z"),
      ]);

      const result = await extractGeminiCliData();
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe("gemini-cli");
      expect(result[0].date).toBe("2026-03-10");
      expect(result[0].inputTokens).toBe(1000);
      // output (500) + thoughts (100) = 600
      expect(result[0].outputTokens).toBe(600);
      expect(result[0].modelsUsed).toEqual(["gemini-2.5-pro"]);
    });

    it("ignores user messages (no tokens)", async () => {
      writeSession(tmpDir, "myproject", "session1", [
        makeHeader("session1"),
        makeUserMessage("u1", "2026-03-10T12:00:00.000Z"),
      ]);

      const result = await extractGeminiCliData();
      expect(result).toEqual([]);
    });

    it("aggregates messages across days", async () => {
      writeSession(tmpDir, "myproject", "session1", [
        makeHeader("session1"),
        makeUserMessage("u1", "2026-03-10T12:00:00.000Z"),
        makeGeminiMessage("g1", "2026-03-10T12:00:05.000Z"),
        makeUserMessage("u2", "2026-03-11T12:00:00.000Z"),
        makeGeminiMessage("g2", "2026-03-11T12:00:05.000Z", {
          tokens: {
            input: 2000,
            output: 1000,
            cached: 200,
            thoughts: 50,
            tool: 0,
            total: 3250,
          },
        }),
      ]);

      const result = await extractGeminiCliData();
      expect(result).toHaveLength(2);
      const byDate = Object.fromEntries(result.map((d) => [d.date, d]));
      expect(byDate["2026-03-10"]?.inputTokens).toBe(1000);
      expect(byDate["2026-03-11"]?.inputTokens).toBe(2000);
      expect(byDate["2026-03-11"]?.cacheReadTokens).toBe(200);
    });

    it("aggregates multiple sessions across multiple projects", async () => {
      writeSession(tmpDir, "projectA", "sessionA", [
        makeHeader("sessionA"),
        makeGeminiMessage("a1", "2026-03-10T12:00:05.000Z"),
      ]);
      writeSession(tmpDir, "projectB", "sessionB", [
        makeHeader("sessionB"),
        makeGeminiMessage("b1", "2026-03-10T13:00:05.000Z", {
          tokens: { input: 2000, output: 1000, cached: 0, thoughts: 0, tool: 0, total: 3000 },
        }),
      ]);

      const result = await extractGeminiCliData();
      expect(result).toHaveLength(1);
      expect(result[0].inputTokens).toBe(3000); // 1000 + 2000
      expect(result[0].outputTokens).toBe(1600); // 500+100 + 1000+0
    });

    it("filters by since date (file mtime quick-skip + per-message check)", async () => {
      writeSession(tmpDir, "myproject", "session1", [
        makeHeader("session1"),
        makeGeminiMessage("g1", "2026-03-08T12:00:05.000Z"),
        makeGeminiMessage("g2", "2026-03-12T12:00:05.000Z"),
      ]);

      // Pin mtime to a fixed date strictly after `since` so the per-message
      // filter is exercised deterministically. Otherwise this test silently
      // depends on the runner's wall clock being after 2026-03-10.
      const sessionPath = join(
        tmpDir,
        "tmp",
        "myproject",
        "chats",
        "session-session1.jsonl"
      );
      const pinned = new Date("2026-04-01T00:00:00Z");
      utimesSync(sessionPath, pinned, pinned);

      const result = await extractGeminiCliData("2026-03-10");
      expect(result).toHaveLength(1);
      expect(result[0].date).toBe("2026-03-12");
    });

    it("computes cost from gemini-2.5-pro pricing", async () => {
      writeSession(tmpDir, "myproject", "session1", [
        makeHeader("session1"),
        makeGeminiMessage("g1", "2026-03-10T12:00:05.000Z", {
          tokens: {
            input: 1_000_000,
            output: 1_000_000,
            cached: 0,
            thoughts: 0,
            tool: 0,
            total: 2_000_000,
          },
          model: "gemini-2.5-pro",
        }),
      ]);

      const result = await extractGeminiCliData();
      // gemini-2.5-pro: $1.25/1M input + $10/1M output = $11.25
      expect(result[0].totalCost).toBeCloseTo(11.25, 1);
    });
  });

  describe("rewind handling", () => {
    it("drops messages after a $rewindTo event", async () => {
      writeSession(tmpDir, "myproject", "session1", [
        makeHeader("session1"),
        makeUserMessage("u1", "2026-03-10T12:00:00.000Z"),
        makeGeminiMessage("g1", "2026-03-10T12:00:05.000Z", {
          tokens: { input: 100, output: 50, cached: 0, thoughts: 0, tool: 0, total: 150 },
        }),
        makeUserMessage("u2", "2026-03-10T12:01:00.000Z"),
        makeGeminiMessage("g2", "2026-03-10T12:01:05.000Z", {
          tokens: { input: 5000, output: 2000, cached: 0, thoughts: 0, tool: 0, total: 7000 },
        }),
        // User rewinds back to u2 (drops u2 + g2 from session)
        { $rewindTo: "u2" },
        // After rewind, user retries — these messages should be the only
        // ones counted in addition to g1.
        makeUserMessage("u2b", "2026-03-10T12:02:00.000Z"),
        makeGeminiMessage("g2b", "2026-03-10T12:02:05.000Z", {
          tokens: { input: 200, output: 100, cached: 0, thoughts: 0, tool: 0, total: 300 },
        }),
      ]);

      const result = await extractGeminiCliData();
      // Only g1 (input=100) and g2b (input=200) survive.
      expect(result).toHaveLength(1);
      expect(result[0].inputTokens).toBe(300); // 100 + 200
      expect(result[0].outputTokens).toBe(150); // 50 + 100
    });

    it("does nothing if $rewindTo target id is unknown", async () => {
      writeSession(tmpDir, "myproject", "session1", [
        makeHeader("session1"),
        makeGeminiMessage("g1", "2026-03-10T12:00:05.000Z", {
          tokens: { input: 100, output: 50, cached: 0, thoughts: 0, tool: 0, total: 150 },
        }),
        { $rewindTo: "does-not-exist" },
      ]);

      const result = await extractGeminiCliData();
      expect(result).toHaveLength(1);
      expect(result[0].inputTokens).toBe(100);
    });
  });

  describe("malformed input tolerance", () => {
    it("ignores blank lines", async () => {
      const chatsDir = join(tmpDir, "tmp", "p", "chats");
      mkdirSync(chatsDir, { recursive: true });
      writeFileSync(
        join(chatsDir, "session-x.jsonl"),
        "\n\n" + JSON.stringify(makeHeader()) + "\n\n" + JSON.stringify(makeGeminiMessage("g1", "2026-03-10T12:00:05.000Z")) + "\n",
        "utf-8"
      );

      const result = await extractGeminiCliData();
      expect(result).toHaveLength(1);
    });

    it("ignores lines that aren't JSON", async () => {
      const chatsDir = join(tmpDir, "tmp", "p", "chats");
      mkdirSync(chatsDir, { recursive: true });
      writeFileSync(
        join(chatsDir, "session-x.jsonl"),
        JSON.stringify(makeHeader()) + "\n" +
        "not-json-at-all\n" +
        JSON.stringify(makeGeminiMessage("g1", "2026-03-10T12:00:05.000Z")) + "\n",
        "utf-8"
      );

      const result = await extractGeminiCliData();
      expect(result).toHaveLength(1);
    });

    it("ignores $set metadata records", async () => {
      writeSession(tmpDir, "p", "s", [
        makeHeader(),
        { $set: { lastUpdated: "2026-03-10T12:00:00.000Z" } },
        makeGeminiMessage("g1", "2026-03-10T12:00:05.000Z"),
        { $set: { lastUpdated: "2026-03-10T12:00:05.000Z" } },
      ]);

      const result = await extractGeminiCliData();
      expect(result).toHaveLength(1);
      expect(result[0].inputTokens).toBe(1000);
    });
  });

  describe("privacy enforcement", () => {
    it("output contains no project hashes, session IDs, content, or thoughts", async () => {
      writeSession(tmpDir, "myproject", "secret-session-12345", [
        {
          ...makeHeader("secret-session-12345"),
          projectHash: "secret-project-hash-deadbeef",
        },
        makeUserMessage("u1", "2026-03-10T12:00:00.000Z"),
        {
          ...makeGeminiMessage("g1", "2026-03-10T12:00:05.000Z"),
          content: "the secret response with sensitive data",
          thoughts: [
            {
              subject: "secret-thought-subject",
              description: "secret-thought-description",
              timestamp: "2026-03-10T12:00:03.000Z",
            },
          ],
        },
      ]);

      const result = await extractGeminiCliData();
      const json = JSON.stringify(result);

      expect(json).not.toContain("secret-session-12345");
      expect(json).not.toContain("secret-project-hash");
      expect(json).not.toContain("secret response");
      expect(json).not.toContain("sensitive data");
      expect(json).not.toContain("secret-thought-subject");
      expect(json).not.toContain("secret-thought-description");
    });

    it("SyncDay fields match the allowlisted schema exactly", async () => {
      writeSession(tmpDir, "p", "s", [
        makeHeader(),
        makeGeminiMessage("g1", "2026-03-10T12:00:05.000Z"),
      ]);

      const result = await extractGeminiCliData();
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
      ];
      expect(Object.keys(day).sort()).toEqual(allowedKeys.sort());
    });
  });
});
