/**
 * Tests for the Hermes Agent SQLite extractor. Drives `extractHermesData`
 * end-to-end against hand-built `state.db` fixtures pointed at by
 * `HERMES_HOME`, covering the source filter, the per-model vs session-total
 * selection, provider-prefix stripping, date bucketing, and `--since`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractHermesData,
  hasHermesData,
  normalizeHermesModel,
  INTERACTIVE_SOURCES,
} from "../src/hermes.js";

const DAY = "2026-08-20";
/** Epoch seconds, the unit Hermes writes via time.time(). */
const DAY_SEC = Date.UTC(2026, 7, 20, 12) / 1000;

interface SessionFixture {
  id: string;
  source?: string | null;
  model?: string | null;
  startedAt?: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

interface ModelUsageFixture {
  sessionId: string;
  model: string;
  task?: string;
  firstSeen?: number | null;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

function buildDb(
  path: string,
  sessions: SessionFixture[],
  modelUsage: ModelUsageFixture[] | null
): void {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      model TEXT,
      title TEXT,
      cwd TEXT,
      started_at REAL NOT NULL,
      ended_at REAL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_write_tokens INTEGER DEFAULT 0,
      reasoning_tokens INTEGER DEFAULT 0,
      estimated_cost_usd REAL
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      timestamp REAL NOT NULL
    );
  `);
  const insertSession = db.prepare(
    `INSERT INTO sessions (id, source, model, title, cwd, started_at, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, estimated_cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const s of sessions) {
    insertSession.run(
      s.id,
      s.source === undefined ? "cli" : (s.source ?? ""),
      s.model === undefined ? "claude-sonnet-4-5" : s.model,
      "secret title",
      "/Users/private/project",
      s.startedAt ?? DAY_SEC,
      s.input ?? 0,
      s.output ?? 0,
      s.cacheRead ?? 0,
      s.cacheWrite ?? 0,
      7,
      123.45
    );
    db.prepare(
      "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, 'user', 'secret prompt', ?)"
    ).run(s.id, s.startedAt ?? DAY_SEC);
  }
  if (modelUsage) {
    db.exec(`
      CREATE TABLE session_model_usage (
        session_id TEXT NOT NULL,
        model TEXT NOT NULL,
        billing_provider TEXT NOT NULL DEFAULT '',
        billing_base_url TEXT NOT NULL DEFAULT '',
        billing_mode TEXT NOT NULL DEFAULT '',
        task TEXT NOT NULL DEFAULT '',
        api_call_count INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL NOT NULL DEFAULT 0,
        actual_cost_usd REAL NOT NULL DEFAULT 0,
        first_seen REAL,
        last_seen REAL,
        PRIMARY KEY (session_id, model, billing_provider, billing_base_url, billing_mode, task)
      );
    `);
    const insert = db.prepare(
      `INSERT INTO session_model_usage (session_id, model, task, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const m of modelUsage) {
      insert.run(
        m.sessionId,
        m.model,
        m.task ?? "",
        m.input ?? 0,
        m.output ?? 0,
        m.cacheRead ?? 0,
        m.cacheWrite ?? 0,
        m.firstSeen === undefined ? DAY_SEC : m.firstSeen,
        m.firstSeen === undefined ? DAY_SEC : m.firstSeen
      );
    }
  }
  db.close();
}

describe("hermes extractor", () => {
  let home: string;
  let dbPath: string;
  const savedHome = process.env.HERMES_HOME;

  beforeEach(() => {
    home = join(
      tmpdir(),
      `hermes-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(home, { recursive: true });
    dbPath = join(home, "state.db");
    process.env.HERMES_HOME = home;
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    if (savedHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = savedHome;
  });

  it("detects data only when state.db exists", async () => {
    expect(hasHermesData()).toBe(false);
    expect(await extractHermesData()).toEqual([]);
    buildDb(dbPath, [], null);
    expect(hasHermesData()).toBe(true);
  });

  it("aggregates CLI session totals when there is no per-model table", async () => {
    buildDb(
      dbPath,
      [
        { id: "s1", input: 1000, output: 500, cacheRead: 200, cacheWrite: 100 },
        { id: "s2", input: 10, output: 20, model: "gpt-5" },
      ],
      null
    );
    const days = await extractHermesData();
    expect(days).toHaveLength(1);
    const day = days[0];
    expect(day.source).toBe("hermes");
    expect(day.date).toBe(DAY);
    expect(day.inputTokens).toBe(1010);
    expect(day.outputTokens).toBe(520);
    expect(day.cacheReadTokens).toBe(200);
    expect(day.cacheCreationTokens).toBe(100);
    expect(day.modelsUsed.sort()).toEqual(["claude-sonnet-4-5", "gpt-5"]);

    const sonnet = day.modelBreakdowns.find((m) => m.modelName === "claude-sonnet-4-5")!;
    // Priced from our table, not estimated_cost_usd (123.45)
    expect(sonnet.cost).toBeCloseTo(0.003 + 0.0075 + 0.00006 + 0.000375, 8);
  });

  it("only counts interactive developer surfaces (cli, tui, desktop, acp, web) and untagged sessions", async () => {
    buildDb(
      dbPath,
      [
        { id: "cli", source: "cli", input: 100 },
        { id: "tui", source: "tui", input: 100 },
        { id: "desktop", source: "desktop", input: 100 },
        { id: "acp", source: "acp", input: 100 },
        { id: "webui", source: "webui", input: 100 },
        { id: "blank", source: "", input: 10 },
        { id: "cron", source: "cron", input: 1000 },
        { id: "kanban", source: "kanban", input: 1000 },
        { id: "tool", source: "tool", input: 1000 },
        { id: "webhook", source: "webhook", input: 1000 },
        { id: "tg", source: "telegram", input: 1000 },
        { id: "wa", source: "whatsapp", input: 1000 },
        { id: "discord", source: "discord", input: 1000 },
        { id: "custom", source: "my-custom-source", input: 1000 },
        { id: "unknown", source: "unknown", input: 1000 },
      ],
      null
    );
    const days = await extractHermesData();
    expect(days).toHaveLength(1);
    expect(days[0].inputTokens).toBe(510);
  });

  it("prefers per-model rows over session totals when present", async () => {
    buildDb(
      dbPath,
      [{ id: "s1", model: "claude-sonnet-4-5", input: 300, output: 30 }],
      [
        { sessionId: "s1", model: "claude-sonnet-4-5", input: 200, output: 20 },
        { sessionId: "s1", model: "claude-haiku-4-5", task: "vision", input: 100, output: 10 },
      ]
    );
    const days = await extractHermesData();
    expect(days).toHaveLength(1);
    // Not double-counted: 300 from the per-model rows, not 300 + 300
    expect(days[0].inputTokens).toBe(300);
    expect(days[0].modelsUsed.sort()).toEqual(["claude-haiku-4-5", "claude-sonnet-4-5"]);
  });

  it("falls back to session totals when a session has no per-model rows", async () => {
    buildDb(
      dbPath,
      [
        { id: "with", input: 100 },
        { id: "without", input: 50, model: "gpt-5" },
      ],
      [{ sessionId: "with", model: "claude-sonnet-4-5", input: 100 }]
    );
    const days = await extractHermesData();
    expect(days[0].inputTokens).toBe(150);
    expect(days[0].modelsUsed.sort()).toEqual(["claude-sonnet-4-5", "gpt-5"]);
  });

  it("buckets per-model rows by their own first_seen date", async () => {
    const nextDaySec = DAY_SEC + 86400;
    buildDb(
      dbPath,
      [{ id: "s1", input: 30 }],
      [
        { sessionId: "s1", model: "claude-sonnet-4-5", input: 10 },
        { sessionId: "s1", model: "gpt-5", input: 20, firstSeen: nextDaySec },
        // NULL first_seen falls back to the session start
        { sessionId: "s1", model: "claude-haiku-4-5", input: 5, firstSeen: null },
      ]
    );
    const days = await extractHermesData();
    const byDate = Object.fromEntries(days.map((d) => [d.date, d.inputTokens]));
    expect(byDate).toEqual({ [DAY]: 15, "2026-08-21": 20 });
  });

  it("strips router-style provider prefixes from model ids", async () => {
    buildDb(
      dbPath,
      [
        { id: "s1", model: "anthropic/claude-sonnet-4-5", input: 10 },
        { id: "s2", model: "openrouter/deepseek/deepseek-v4-pro", input: 10 },
        { id: "s3", model: null, input: 10 },
      ],
      null
    );
    const days = await extractHermesData();
    expect(days[0].modelsUsed.sort()).toEqual([
      "claude-sonnet-4-5",
      "deepseek-v4-pro",
      "unknown",
    ]);
    expect(normalizeHermesModel("  ")).toBe("unknown");
    expect(normalizeHermesModel("gpt-5")).toBe("gpt-5");
  });

  it("keeps the interactive-source allowlist explicit", () => {
    expect([...INTERACTIVE_SOURCES]).toEqual(["cli", "tui", "desktop", "acp", "webui", "web"]);
  });

  it("honours --since against the session start date", async () => {
    buildDb(
      dbPath,
      [
        { id: "old", startedAt: DAY_SEC - 30 * 86400, input: 1000 },
        { id: "new", input: 10 },
      ],
      null
    );
    const days = await extractHermesData("2026-08-15");
    expect(days).toHaveLength(1);
    expect(days[0].inputTokens).toBe(10);
  });

  it("skips sessions with zero usage and bad timestamps", async () => {
    buildDb(
      dbPath,
      [
        { id: "empty" },
        { id: "bad", startedAt: 0, input: 100 },
        { id: "ok", input: 1 },
      ],
      null
    );
    const days = await extractHermesData();
    expect(days).toHaveLength(1);
    expect(days[0].inputTokens).toBe(1);
  });

  it("returns [] when the sessions table is missing", async () => {
    const db = new Database(dbPath);
    db.exec("CREATE TABLE unrelated (x INTEGER)");
    db.close();
    expect(await extractHermesData()).toEqual([]);
  });

  it("never leaks titles, cwd, content, or session ids", async () => {
    buildDb(dbPath, [{ id: "deadbeef-session", input: 10 }], null);
    const json = JSON.stringify(await extractHermesData());
    expect(json).not.toContain("secret");
    expect(json).not.toContain("/Users/");
    expect(json).not.toContain("deadbeef");
  });

  it("leaves the original database untouched and cleans up its temp copy", async () => {
    buildDb(dbPath, [{ id: "s1", input: 10 }], null);
    const before = require("node:fs").statSync(dbPath).mtimeMs;
    await extractHermesData();
    expect(require("node:fs").statSync(dbPath).mtimeMs).toBe(before);
    const leftovers = require("node:fs")
      .readdirSync(tmpdir())
      .filter((n: string) => n.startsWith(`hermes-state-${process.pid}-`));
    expect(leftovers).toEqual([]);
  });
});
