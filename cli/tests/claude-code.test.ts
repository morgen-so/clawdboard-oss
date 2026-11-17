import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ccusage (a dev dependency, kept as the reference these tests compare
// against) reads its log level when first imported; keep it quiet.
vi.hoisted(() => {
  process.env.LOG_LEVEL = "0";
});

import {
  createUniqueHash,
  loadDailyUsageData,
  usageDataSchema,
} from "ccusage/data-loader";
import {
  aggregateTranscripts,
  extractClaudeCodeData,
  getClaudeConfigDirs,
  scanLine,
  toUsageEntry,
} from "../src/claude-code.js";
import {
  _setLiveTableForTests,
  _setTieredTableForTests,
} from "../src/litellm-pricing.js";
import { calculateCost } from "../src/pricing.js";
import { SyncPayloadSchema } from "../src/schemas.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function createTempDir(label: string): string {
  const dir = join(
    tmpdir(),
    `claude-code-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Deterministic PRNG, so a fuzz failure reproduces. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Write `<claudeDir>/projects/<relPath>` as JSONL. Returns the full path. */
function writeTranscript(
  claudeDir: string,
  relPath: string,
  lines: (Json | string)[],
  options: { eol?: string; trailingNewline?: boolean } = {}
): string {
  const path = join(claudeDir, "projects", relPath);
  mkdirSync(join(path, ".."), { recursive: true });
  const eol = options.eol ?? "\n";
  const body = lines
    .map((line) => (typeof line === "string" ? line : JSON.stringify(line)))
    .join(eol);
  writeFileSync(path, body + (options.trailingNewline === false ? "" : eol), "utf-8");
  return path;
}

let messageCounter = 0;

/** An assistant line as Claude Code writes it, private fields included. */
function assistant(
  timestamp: string,
  usage: {
    input?: number;
    output?: number;
    cacheCreation?: number;
    cacheRead?: number;
  } = {},
  overrides: {
    model?: string | null;
    messageId?: string | null;
    requestId?: string | null;
    text?: string;
  } = {}
): Json {
  messageCounter++;
  const message: Json = {
    type: "message",
    role: "assistant",
    content: [
      { type: "thinking", thinking: "private reasoning", signature: "sig" },
      { type: "text", text: overrides.text ?? "private answer" },
      { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } },
    ],
    usage: {
      input_tokens: usage.input ?? 10,
      output_tokens: usage.output ?? 20,
      ...(usage.cacheCreation !== undefined
        ? { cache_creation_input_tokens: usage.cacheCreation }
        : {}),
      ...(usage.cacheRead !== undefined
        ? { cache_read_input_tokens: usage.cacheRead }
        : {}),
      service_tier: "standard",
    },
  };
  if (overrides.model !== null) message.model = overrides.model ?? "claude-sonnet-4-5-20250929";
  if (overrides.messageId !== null) message.id = overrides.messageId ?? `msg_${messageCounter}`;
  const line: Json = {
    parentUuid: "parent",
    isSidechain: false,
    cwd: "/Users/private/secret-project",
    sessionId: "session-1",
    version: "2.1.0",
    gitBranch: "feature/confidential",
    message,
    type: "assistant",
    uuid: `uuid-${messageCounter}`,
    timestamp,
  };
  if (overrides.requestId !== null) line.requestId = overrides.requestId ?? `req_${messageCounter}`;
  return line;
}

/** A user line: no usage, a large tool result, misleading nested fields. */
function user(timestamp: string, payload = "tool output"): Json {
  return {
    parentUuid: "parent",
    cwd: "/Users/private/secret-project",
    sessionId: "session-1",
    version: "2.1.0",
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: payload }],
    },
    toolUseResult: {
      stdout: payload,
      // A subagent's totals: shaped like usage, but not this line's usage.
      usage: { input_tokens: 999_999, output_tokens: 999_999 },
      timestamp: "1999-01-01T00:00:00.000Z",
    },
    uuid: "uuid-user",
    timestamp,
  };
}

const PRICING_FIXTURE: Record<string, unknown> = {
  sample_spec: {
    max_tokens: "LEGACY parameter. set to max_output_tokens if provider specifies it.",
    input_cost_per_token: 0,
    output_cost_per_token: 0,
  },
  // Unpriced, and listed first: a fuzzy match can land here and price at 0.
  "embed-claude-mystery-9-large": { mode: "embedding" },
  "claude-sonnet-4-5-20250929": {
    input_cost_per_token: 3e-6,
    output_cost_per_token: 1.5e-5,
    cache_creation_input_token_cost: 3.75e-6,
    cache_read_input_token_cost: 3e-7,
    input_cost_per_token_above_200k_tokens: 6e-6,
    output_cost_per_token_above_200k_tokens: 2.25e-5,
    cache_creation_input_token_cost_above_200k_tokens: 7.5e-6,
    cache_read_input_token_cost_above_200k_tokens: 6e-7,
  },
  "anthropic/claude-opus-4-1": {
    input_cost_per_token: 1.5e-5,
    output_cost_per_token: 7.5e-5,
    cache_creation_input_token_cost: 1.875e-5,
    cache_read_input_token_cost: 1.5e-6,
  },
  "claude-fable-5": {
    input_cost_per_token: 1e-5,
    output_cost_per_token: 5e-5,
    cache_creation_input_token_cost: 1.25e-5,
    cache_read_input_token_cost: 1e-6,
  },
  "claude-haiku-4-5": {
    input_cost_per_token: 1e-6,
    output_cost_per_token: 5e-6,
  },
};

/** ccusage's daily rows, reduced to the fields the two loaders share. */
async function loadWithCcusage(claudeDir: string): Promise<unknown[]> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(PRICING_FIXTURE), { status: 200 }))
  );
  try {
    const rows = await loadDailyUsageData({ mode: "calculate", claudePath: claudeDir });
    return rows.map((row) => ({
      date: row.date,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheCreationTokens: row.cacheCreationTokens,
      cacheReadTokens: row.cacheReadTokens,
      totalCost: row.totalCost,
      modelsUsed: row.modelsUsed,
      modelBreakdowns: row.modelBreakdowns,
    }));
  } finally {
    vi.unstubAllGlobals();
  }
}

async function loadWithClawdboard(since?: string): Promise<unknown[]> {
  const days = await extractClaudeCodeData(since);
  return days.map(({ source, ...rest }) => {
    expect(source).toBe("claude-code");
    return rest;
  });
}

let claudeDir: string;
let clawdboardHome: string;

// Restored key by key: replacing `process.env` wholesale would swap Node's
// live environment for a plain object, and a later `process.env.TZ = ...`
// would then no longer change the timezone.
const ENV_KEYS = ["CLAUDE_CONFIG_DIR", "CLAWDBOARD_HOME", "TZ"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/** Switch the process timezone, and prove the switch took. */
function useTimezone(timezone: string): void {
  process.env.TZ = timezone;
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(timezone);
}

beforeEach(() => {
  claudeDir = createTempDir("claude");
  clawdboardHome = createTempDir("home");
  mkdirSync(join(claudeDir, "projects"), { recursive: true });
  process.env.CLAUDE_CONFIG_DIR = claudeDir;
  process.env.CLAWDBOARD_HOME = clawdboardHome;
  _setTieredTableForTests(PRICING_FIXTURE);
});

afterEach(() => {
  rmSync(claudeDir, { recursive: true, force: true });
  rmSync(clawdboardHome, { recursive: true, force: true });
  restoreEnv();
  _setTieredTableForTests(null);
  _setLiveTableForTests(null);
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// scanLine
// ---------------------------------------------------------------------------

function scan(text: string) {
  const buffer = Buffer.from(text, "utf-8");
  return scanLine(buffer, 0, buffer.length);
}

/** What JSON.parse says a line's scan should be. */
function referenceScan(text: string) {
  const json = JSON.parse(text);
  const isPlainObject = (v: unknown): v is Json =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  return {
    timestamp: typeof json.timestamp === "string" ? json.timestamp : null,
    hasUsage: isPlainObject(json.message) && isPlainObject(json.message.usage),
  };
}

describe("scanLine", () => {
  it("reads the top-level timestamp", () => {
    expect(scan('{"type":"user","timestamp":"2026-03-01T10:00:00.000Z","uuid":"u"}')).toEqual({
      timestamp: "2026-03-01T10:00:00.000Z",
      hasUsage: false,
    });
  });

  it("ignores timestamps nested in other values", () => {
    const line = JSON.stringify({
      type: "file-history-snapshot",
      snapshot: { timestamp: "2026-03-01T10:00:00.000Z" },
      list: [{ timestamp: "2026-03-02T10:00:00.000Z" }],
    });
    expect(scan(line)).toEqual({ timestamp: null, hasUsage: false });
  });

  it("is not fooled by timestamps and braces inside strings", () => {
    const line = JSON.stringify({
      note: 'he said "timestamp":"2020-01-01T00:00:00Z"} and left \\',
      path: "C:\\dir\\",
      timestamp: "2026-03-01T10:00:00.000Z",
      tail: '{"timestamp":"x"',
    });
    expect(scan(line)).toEqual(referenceScan(line));
    expect(scan(line)?.timestamp).toBe("2026-03-01T10:00:00.000Z");
  });

  it("returns null for a timestamp that is not a string", () => {
    expect(scan('{"timestamp":1767261600000}')?.timestamp).toBeNull();
    expect(scan('{"timestamp":null}')?.timestamp).toBeNull();
    expect(scan('{"timestamp":{"at":"2026-03-01T10:00:00.000Z"}}')?.timestamp).toBeNull();
  });

  it("lets a repeated key override the earlier one, like JSON.parse", () => {
    const line =
      '{"timestamp":"2026-01-01T00:00:00.000Z","timestamp":"2026-02-02T00:00:00.000Z"}';
    expect(scan(line)).toEqual(referenceScan(line));
    const overridden = '{"timestamp":"2026-01-01T00:00:00.000Z","timestamp":5}';
    expect(scan(overridden)).toEqual(referenceScan(overridden));
    const message = '{"message":{"usage":{}},"message":{"role":"user"}}';
    expect(scan(message)).toEqual(referenceScan(message));
    const usage = '{"message":{"usage":{},"usage":null}}';
    expect(scan(usage)).toEqual(referenceScan(usage));
  });

  it("flags a line whose message holds a usage object", () => {
    const line = JSON.stringify(assistant("2026-03-01T10:00:00.000Z"));
    expect(scan(line)).toEqual({ timestamp: "2026-03-01T10:00:00.000Z", hasUsage: true });
  });

  it("does not flag usage that sits anywhere else", () => {
    expect(scan(JSON.stringify(user("2026-03-01T10:00:00.000Z")))?.hasUsage).toBe(false);
    const progress = JSON.stringify({
      type: "progress",
      data: { message: { message: { usage: { input_tokens: 1, output_tokens: 1 } } } },
      usage: { input_tokens: 1, output_tokens: 1 },
      timestamp: "2026-03-01T10:00:00.000Z",
    });
    expect(scan(progress)).toEqual({ timestamp: "2026-03-01T10:00:00.000Z", hasUsage: false });
    expect(scan('{"message":{"usage":[1,2]}}')?.hasUsage).toBe(false);
    expect(scan('{"message":{"usage":null}}')?.hasUsage).toBe(false);
    expect(scan('{"message":[{"usage":{}}]}')?.hasUsage).toBe(false);
    expect(scan('{"message":"usage"}')?.hasUsage).toBe(false);
  });

  it("accepts whitespace between tokens", () => {
    const line = ' { "a" : [ 1 , { "b" : "c" } ] , "timestamp" : "2026-03-01T10:00:00Z" } \r';
    expect(scan(line)).toEqual(referenceScan(line));
  });

  it("handles empty objects", () => {
    expect(scan("{}")).toEqual({ timestamp: null, hasUsage: false });
    expect(scan('{"message":{}}')).toEqual({ timestamp: null, hasUsage: false });
  });

  it("declines lines it cannot vouch for", () => {
    expect(scan("")).toBeUndefined();
    expect(scan("   ")).toBeUndefined();
    expect(scan("[1,2,3]")).toBeUndefined();
    expect(scan('"just a string"')).toBeUndefined();
    expect(scan("null")).toBeUndefined();
    // Cut short
    expect(scan('{"timestamp":"2026-03-01T10:00:00.000Z","message":{"a":"b')).toBeUndefined();
    expect(scan('{"timestamp":"2026-03-01T10:00:00.000Z"')).toBeUndefined();
    expect(scan('{"timestamp":')).toBeUndefined();
    // Trailing bytes after the object
    expect(scan('{"timestamp":"2026-03-01T10:00:00.000Z"}{"a":1}')).toBeUndefined();
    // Escapes where the byte compare would be wrong
    expect(scan('{"time\\u0073tamp":"2026-03-01T10:00:00.000Z"}')).toBeUndefined();
    expect(scan('{"timestamp":"2026-03-01T10:00:00\\u002e000Z"}')).toBeUndefined();
    expect(scan('{"message":{"us\\u0061ge":{}}}')).toBeUndefined();
  });

  it("only scans the given byte range", () => {
    const first = '{"timestamp":"2026-01-01T00:00:00.000Z"}';
    const second = '{"timestamp":"2026-02-02T00:00:00.000Z","message":{"usage":{}}}';
    const buffer = Buffer.from(`${first}\n${second}\n`, "utf-8");
    expect(scanLine(buffer, 0, first.length)).toEqual({
      timestamp: "2026-01-01T00:00:00.000Z",
      hasUsage: false,
    });
    expect(scanLine(buffer, first.length + 1, buffer.length - 1)).toEqual({
      timestamp: "2026-02-02T00:00:00.000Z",
      hasUsage: true,
    });
    // A line cut inside a string must not find its closing quote in the next line.
    expect(scanLine(buffer, 0, 20)).toBeUndefined();
  });

  it("agrees with JSON.parse on generated lines", () => {
    const random = mulberry32(20261117);
    const pick = <T,>(items: T[]): T => items[Math.floor(random() * items.length)];
    const awkward = ['"', "\\", '\\"', "{", "}", "[", "]", ":", ",", "\n", "\t", "é", "日本", "😀", " "];

    const randomString = (): string => {
      // Long strings exercise the native search; short ones the byte steps.
      const length = random() < 0.15 ? 150 + Math.floor(random() * 400) : Math.floor(random() * 12);
      let out = "";
      for (let i = 0; i < length; i++) {
        out += random() < 0.25 ? pick(awkward) : String.fromCharCode(97 + Math.floor(random() * 26));
      }
      return out;
    };
    const randomKey = (): string =>
      random() < 0.5
        ? pick(["timestamp", "message", "usage", "content", "type", "data"])
        : randomString().replace(/[\\"]/g, "") || "k";
    const randomValue = (depth: number): unknown => {
      const roll = random();
      if (depth > 3 || roll < 0.35) {
        return pick([
          randomString(),
          "2026-03-01T10:00:00.000Z",
          Math.floor(random() * 1e6),
          -1.5e-7,
          true,
          false,
          null,
        ]);
      }
      if (roll < 0.6) {
        return Array.from({ length: Math.floor(random() * 4) }, () => randomValue(depth + 1));
      }
      const object: Json = {};
      const keys = Math.floor(random() * 5);
      for (let i = 0; i < keys; i++) object[randomKey()] = randomValue(depth + 1);
      return object;
    };

    // The scanner may only decline a well-formed line for an escape in a key
    // it compares (top level, or inside `message`) or in the timestamp.
    const escaped = (text: string): boolean => JSON.stringify(text).includes("\\");
    const mayDecline = (object: Json): boolean => {
      const message = object.message;
      const messageKeys =
        typeof message === "object" && message !== null && !Array.isArray(message)
          ? Object.keys(message)
          : [];
      return (
        [...Object.keys(object), ...messageKeys].some(escaped) ||
        (typeof object.timestamp === "string" && escaped(object.timestamp))
      );
    };

    let answered = 0;
    const rounds = 3000;
    for (let i = 0; i < rounds; i++) {
      const value = randomValue(0);
      const object = (
        typeof value === "object" && value !== null && !Array.isArray(value) ? value : { v: value }
      ) as Json;
      // Compact, as Claude Code writes it, or spaced out on one line.
      const line =
        random() < 0.8
          ? JSON.stringify(object)
          : JSON.stringify(object, null, 2).replace(/\n/g, " ");

      const result = scan(line);
      if (result !== undefined) {
        answered++;
        expect(result, line).toEqual(referenceScan(line));
      } else {
        expect(mayDecline(object), line).toBe(true);
      }

      // No proper prefix of a JSON object is itself a complete object.
      const bytes = Buffer.from(line, "utf-8");
      const cut = Math.floor(random() * bytes.length);
      const trimmedLength = Buffer.from(line.trimEnd(), "utf-8").length;
      if (cut < trimmedLength) {
        expect(scanLine(bytes, 0, cut), `${line} cut at ${cut}`).toBeUndefined();
      }
    }
    // Declining is the exception, not the way the comparison above passes.
    expect(answered).toBeGreaterThan(rounds * 0.8);
  });
});

// ---------------------------------------------------------------------------
// toUsageEntry: same lines as ccusage's schema
// ---------------------------------------------------------------------------

/** Whether ccusage's own schema accepts a parsed line. */
function ccusageAccepts(json: unknown): boolean {
  const result = (
    usageDataSchema as unknown as {
      "~standard": { validate: (value: unknown) => { issues?: unknown } };
    }
  )["~standard"].validate(json);
  return result.issues === undefined;
}

describe("toUsageEntry", () => {
  it("picks out the counted fields", () => {
    const line = assistant(
      "2026-03-01T10:00:00.000Z",
      { input: 5, output: 7, cacheCreation: 11, cacheRead: 13 },
      { messageId: "msg_a", requestId: "req_a", model: "claude-fable-5" }
    );
    expect(toUsageEntry(line)).toEqual({
      hash: "msg_a:req_a",
      timestamp: "2026-03-01T10:00:00.000Z",
      model: "claude-fable-5",
      input: 5,
      output: 7,
      cacheCreation: 11,
      cacheRead: 13,
    });
  });

  it("defaults missing cache counts to 0 and missing ids to no hash", () => {
    const entry = toUsageEntry(
      assistant("2026-03-01T10:00:00Z", {}, { messageId: null, model: null })
    );
    expect(entry).toMatchObject({ hash: null, model: undefined, cacheCreation: 0, cacheRead: 0 });
    expect(
      toUsageEntry(assistant("2026-03-01T10:00:00Z", {}, { requestId: null }))?.hash
    ).toBeNull();
  });

  it("accepts and rejects exactly what ccusage's schema does", () => {
    const base = (): Json => assistant("2026-03-01T10:00:00.000Z", { cacheRead: 1 });
    const withMessage = (patch: Json): Json => {
      const line = base();
      line.message = { ...(line.message as Json), ...patch };
      return line;
    };
    const withUsage = (patch: Json): Json =>
      withMessage({ usage: { ...((base().message as Json).usage as Json), ...patch } });

    const cases: unknown[] = [
      base(),
      user("2026-03-01T10:00:00.000Z"),
      null,
      "text",
      42,
      [],
      [base()],
      {},
      // timestamp
      { ...base(), timestamp: "2026-03-01T10:00:00Z" },
      { ...base(), timestamp: "2026-03-01T10:00:00.12Z" },
      { ...base(), timestamp: "2026-03-01T10:00:00.000+01:00" },
      { ...base(), timestamp: "2026-03-01 10:00:00" },
      { ...base(), timestamp: "2026-13-45T99:99:99Z" },
      { ...base(), timestamp: 1767261600000 },
      { ...base(), timestamp: null },
      (() => {
        const line = base();
        delete line.timestamp;
        return line;
      })(),
      // optional top-level fields
      { ...base(), cwd: null },
      { ...base(), cwd: 5 },
      { ...base(), cwd: "" },
      { ...base(), sessionId: "" },
      { ...base(), sessionId: null },
      { ...base(), sessionId: 7 },
      { ...base(), version: "2.1" },
      { ...base(), version: "v2.1.0" },
      { ...base(), version: "2.1.0-beta.3" },
      { ...base(), version: 2 },
      { ...base(), version: null },
      { ...base(), costUSD: 0.25 },
      { ...base(), costUSD: "0.25" },
      { ...base(), costUSD: null },
      { ...base(), requestId: "" },
      { ...base(), requestId: null },
      { ...base(), requestId: 12 },
      { ...base(), isApiErrorMessage: true },
      { ...base(), isApiErrorMessage: "true" },
      { ...base(), isApiErrorMessage: null },
      // message
      { ...base(), message: null },
      { ...base(), message: "hello" },
      { ...base(), message: [] },
      withMessage({ model: "" }),
      withMessage({ model: null }),
      withMessage({ model: 4 }),
      withMessage({ model: "<synthetic>" }),
      withMessage({ id: "" }),
      withMessage({ id: null }),
      withMessage({ content: "a plain string" }),
      withMessage({ content: null }),
      withMessage({ content: [] }),
      withMessage({ content: [{ text: 5 }] }),
      withMessage({ content: [{ text: null }] }),
      withMessage({ content: [{ type: "text", text: "ok" }, "loose string"] }),
      withMessage({ content: [null] }),
      withMessage({ content: [[1, 2]] }),
      withMessage({ content: [{}] }),
      withMessage({ content: { text: "not an array" } }),
      // usage
      withMessage({ usage: null }),
      withMessage({ usage: [] }),
      withMessage({ usage: {} }),
      withUsage({ input_tokens: "10" }),
      withUsage({ input_tokens: null }),
      withUsage({ output_tokens: undefined }),
      withUsage({ output_tokens: 1.5 }),
      withUsage({ input_tokens: -3 }),
      withUsage({ cache_creation_input_tokens: null }),
      withUsage({ cache_creation_input_tokens: "1" }),
      withUsage({ cache_read_input_tokens: null }),
      withUsage({ cache_read_input_tokens: 0 }),
    ];

    for (const candidate of cases) {
      // Round-trip, so the case is what a transcript line would parse to.
      const json = candidate === undefined ? undefined : JSON.parse(JSON.stringify(candidate));
      const label = JSON.stringify(candidate)?.slice(0, 200);
      const entry = toUsageEntry(json);
      expect(entry !== null, label).toBe(ccusageAccepts(json));
      if (entry !== null) {
        expect(entry.hash, label).toBe(createUniqueHash(json as never));
      }
    }
  });

  it("agrees with ccusage's schema on randomly damaged lines", () => {
    const random = mulberry32(42);
    const pick = <T,>(items: T[]): T => items[Math.floor(random() * items.length)];
    const junk = [null, "", "x", 0, 1.5, -1, true, false, [], {}, [1], { text: 1 }, "2.1.0", "2026-03-01T10:00:00Z"];
    const paths: string[][] = [
      ["cwd"], ["sessionId"], ["timestamp"], ["version"], ["costUSD"], ["requestId"],
      ["isApiErrorMessage"], ["message"], ["message", "model"], ["message", "id"],
      ["message", "content"], ["message", "usage"], ["message", "usage", "input_tokens"],
      ["message", "usage", "output_tokens"], ["message", "usage", "cache_creation_input_tokens"],
      ["message", "usage", "cache_read_input_tokens"],
    ];

    let accepted = 0;
    for (let i = 0; i < 2000; i++) {
      const line = assistant("2026-03-01T10:00:00.000Z", { cacheCreation: 3, cacheRead: 4 });
      const damage = 1 + Math.floor(random() * 2);
      for (let d = 0; d < damage; d++) {
        const path = pick(paths);
        let target: Json = line;
        for (const key of path.slice(0, -1)) {
          const next = target[key];
          if (typeof next !== "object" || next === null || Array.isArray(next)) break;
          target = next as Json;
        }
        const leaf = path[path.length - 1];
        if (random() < 0.2) delete target[leaf];
        else target[leaf] = pick(junk);
      }
      const json = JSON.parse(JSON.stringify(line));
      const entry = toUsageEntry(json);
      expect(entry !== null, JSON.stringify(json)).toBe(ccusageAccepts(json));
      if (entry !== null) accepted++;
    }
    // The damage should land on both sides of the line.
    expect(accepted).toBeGreaterThan(100);
    expect(accepted).toBeLessThan(1900);
  });
});

// ---------------------------------------------------------------------------
// Parity with ccusage on whole transcript trees
// ---------------------------------------------------------------------------

describe("parity with ccusage's loadDailyUsageData", () => {
  /** A transcript tree with the shapes real ones have, from a seed. */
  function buildTree(seed: number): void {
    const random = mulberry32(seed);
    const pick = <T,>(items: T[]): T => items[Math.floor(random() * items.length)];
    const models = [
      "claude-sonnet-4-5-20250929", // exact entry, with above-200k rates
      "claude-opus-4-1", // found behind the "anthropic/" prefix
      "claude-fable-5-2", // fuzzy: contains "claude-fable-5"
      "claude-haiku-4-5", // no cache rates
      "claude-mystery-9", // fuzzy onto an unpriced entry
      "totally-unknown-model", // no entry at all
      "<synthetic>",
      null, // line without a model
    ];
    const start = Date.parse("2026-02-27T20:00:00.000Z");
    const iso = (ms: number): string =>
      // Claude Code writes milliseconds; older lines have none.
      random() < 0.9 ? new Date(ms).toISOString() : new Date(ms).toISOString().replace(".000Z", "Z");

    const sessions: (Json | string)[][] = [];
    for (let s = 0; s < 14; s++) {
      const lines: (Json | string)[] = [];
      let clock = start + Math.floor(random() * 6 * 24 * 3600 * 1000);
      // Whole seconds, so the no-millisecond form above stays a valid timestamp.
      clock -= clock % 1000;

      if (random() < 0.3) lines.push({ type: "summary", summary: "private title", leafUuid: "x" });
      if (random() < 0.5) {
        lines.push({
          type: "file-history-snapshot",
          snapshot: { timestamp: new Date(clock - 3600_000).toISOString() },
        });
      }

      const turns = 3 + Math.floor(random() * 25);
      for (let t = 0; t < turns; t++) {
        clock += 1000 * (1 + Math.floor(random() * 5000));
        lines.push(user(iso(clock), "x".repeat(Math.floor(random() * 4000))));
        clock += 1000 * (1 + Math.floor(random() * 60));

        const big = random() < 0.15;
        const usage = {
          input: Math.floor(random() * (big ? 400_000 : 3000)),
          output: Math.floor(random() * (big ? 250_000 : 8000)),
          ...(random() < 0.8 ? { cacheCreation: Math.floor(random() * (big ? 500_000 : 50_000)) } : {}),
          ...(random() < 0.8 ? { cacheRead: Math.floor(random() * (big ? 900_000 : 150_000)) } : {}),
        };
        const overrides = {
          model: pick(models),
          messageId: random() < 0.05 ? null : `msg_${s}_${t}`,
          requestId: random() < 0.05 ? null : `req_${s}_${t}`,
        };
        const first = assistant(iso(clock), usage, overrides);
        lines.push(first);
        // One line per content block, same ids, usage restated or grown.
        const repeats = Math.floor(random() * 3);
        for (let r = 0; r < repeats; r++) {
          clock += 1000;
          lines.push(
            assistant(iso(clock), { ...usage, output: usage.output + (r + 1) * 17 }, overrides)
          );
        }

        if (random() < 0.05) lines.push('{"type":"assistant","message":{"usage":{"input_tok');
        if (random() < 0.05) lines.push("");
        if (random() < 0.05) {
          lines.push({
            type: "progress",
            data: { message: assistant(iso(clock), { input: 77_777, output: 77_777 }) },
            timestamp: iso(clock),
          });
        }
      }
      sessions.push(lines);
    }

    sessions.forEach((lines, s) => {
      const project = `-Users-private-project-${s % 4}`;
      const relPath =
        s % 5 === 4
          ? join(project, `session-${s - 1}`, "subagents", `agent-${s}.jsonl`)
          : join(project, `session-${s}.jsonl`);
      writeTranscript(claudeDir, relPath, lines, {
        eol: s % 6 === 5 ? "\r\n" : "\n",
        trailingNewline: s % 7 !== 6,
      });
    });

    // A resumed session: the first transcript's history, copied, then new turns.
    const original = sessions[0];
    const resumed = [
      ...original.slice(0, Math.max(2, Math.floor(original.length * 0.7))),
      user("2026-03-09T09:00:00.000Z"),
      assistant("2026-03-09T09:00:05.000Z", { input: 123, output: 456, cacheRead: 789 }),
    ];
    writeTranscript(claudeDir, join("-Users-private-project-0", "session-resumed.jsonl"), resumed);

    // No timestamps at all: ordered last.
    writeTranscript(claudeDir, join("-Users-private-project-1", "session-untimed.jsonl"), [
      { type: "summary", summary: "nothing dated here" },
    ]);
    // Not transcripts.
    writeFileSync(join(claudeDir, "projects", "-Users-private-project-1", "notes.txt"), "x");
    writeFileSync(join(claudeDir, "projects", "-Users-private-project-1", "data.json"), "{}");
  }

  for (const seed of [1, 2, 3, 4, 5]) {
    it(`matches on generated transcripts (seed ${seed})`, async () => {
      buildTree(seed);
      const expected = await loadWithCcusage(claudeDir);
      const actual = await loadWithClawdboard();
      expect(expected.length).toBeGreaterThan(3);
      // Exact equality, costs included: same entries, summed in the same order.
      expect(actual).toEqual(expected);
      // And again from the cache.
      expect(await loadWithClawdboard()).toEqual(expected);
    });
  }

  for (const timezone of ["Pacific/Auckland", "America/Los_Angeles", "UTC"]) {
    it(`buckets days in the local timezone (${timezone})`, async () => {
      useTimezone(timezone);
      buildTree(7);
      const expected = await loadWithCcusage(claudeDir);
      expect(await loadWithClawdboard()).toEqual(expected);
    });
  }

  it("matches when one response is copied into several files", async () => {
    // The copy with different numbers sits in the file that starts later, so
    // the earlier file's numbers must win in both loaders.
    const shared = { messageId: "msg_shared", requestId: "req_shared" };
    writeTranscript(claudeDir, join("p", "b-later.jsonl"), [
      user("2026-03-02T08:00:00.000Z"),
      assistant("2026-03-02T08:00:01.000Z", { input: 9000, output: 9000 }, shared),
      assistant("2026-03-02T08:00:02.000Z", { input: 1, output: 1 }),
    ]);
    writeTranscript(claudeDir, join("p", "z-earlier.jsonl"), [
      user("2026-03-01T08:00:00.000Z"),
      assistant("2026-03-01T08:00:01.000Z", { input: 100, output: 200 }, shared),
    ]);
    const expected = await loadWithCcusage(claudeDir);
    const actual = await loadWithClawdboard();
    expect(actual).toEqual(expected);
    expect(actual).toMatchObject([
      { date: "2026-03-02", inputTokens: 1, outputTokens: 1 },
      { date: "2026-03-01", inputTokens: 100, outputTokens: 200 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// extractClaudeCodeData
// ---------------------------------------------------------------------------

describe("extractClaudeCodeData", () => {
  it("returns nothing when there is no Claude Code directory", async () => {
    process.env.CLAUDE_CONFIG_DIR = join(claudeDir, "does-not-exist");
    expect(getClaudeConfigDirs()).toEqual([]);
    expect(await extractClaudeCodeData()).toEqual([]);
  });

  it("returns nothing for an empty projects directory", async () => {
    expect(await extractClaudeCodeData()).toEqual([]);
  });

  it("aggregates tokens and cost per day and model", async () => {
    writeTranscript(claudeDir, join("p", "s.jsonl"), [
      user("2026-03-01T12:00:00.000Z"),
      assistant(
        "2026-03-01T12:00:01.000Z",
        { input: 1000, output: 2000, cacheCreation: 3000, cacheRead: 4000 },
        { model: "claude-sonnet-4-5-20250929" }
      ),
      assistant("2026-03-01T12:00:02.000Z", { input: 10, output: 20 }, { model: "claude-haiku-4-5" }),
      assistant("2026-03-01T12:00:03.000Z", { input: 1, output: 2 }, { model: "claude-haiku-4-5" }),
    ]);

    const days = await extractClaudeCodeData();
    const sonnetCost = 1000 * 3e-6 + 2000 * 1.5e-5 + 3000 * 3.75e-6 + 4000 * 3e-7;
    const haikuCost = 10 * 1e-6 + 20 * 5e-6 + (1 * 1e-6 + 2 * 5e-6);
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({
      date: "2026-03-01",
      source: "claude-code",
      inputTokens: 1011,
      outputTokens: 2022,
      cacheCreationTokens: 3000,
      cacheReadTokens: 4000,
      modelsUsed: ["claude-sonnet-4-5-20250929", "claude-haiku-4-5"],
    });
    expect(days[0].totalCost).toBeCloseTo(sonnetCost + haikuCost, 12);
    // Most expensive model first
    expect(days[0].modelBreakdowns.map((m) => m.modelName)).toEqual([
      "claude-sonnet-4-5-20250929",
      "claude-haiku-4-5",
    ]);
    expect(days[0].modelBreakdowns[1]).toMatchObject({ inputTokens: 11, outputTokens: 22 });
  });

  it("emits only allowlisted fields, with no paths, ids or content", async () => {
    writeTranscript(claudeDir, join("-Users-private-secret-project", "s.jsonl"), [
      user("2026-03-01T12:00:00.000Z", "secret tool output"),
      assistant("2026-03-01T12:00:01.000Z", {}, { text: "secret answer" }),
    ]);
    const days = await extractClaudeCodeData();
    expect(() => SyncPayloadSchema.strict().parse({ days })).not.toThrow();
    expect(Object.keys(days[0]).sort()).toEqual([
      "cacheCreationTokens",
      "cacheReadTokens",
      "date",
      "inputTokens",
      "modelBreakdowns",
      "modelsUsed",
      "outputTokens",
      "source",
      "totalCost",
    ]);
    const json = JSON.stringify(days);
    for (const secret of ["secret", "private", "/Users/", "session-1", "msg_", "req_", "feature/"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("counts a response once when Claude Code writes it on several lines", async () => {
    const ids = { messageId: "msg_stream", requestId: "req_stream" };
    writeTranscript(claudeDir, join("p", "s.jsonl"), [
      assistant("2026-03-01T12:00:01.000Z", { input: 100, output: 5 }, ids),
      assistant("2026-03-01T12:00:02.000Z", { input: 100, output: 50 }, ids),
      assistant("2026-03-01T12:00:03.000Z", { input: 100, output: 500 }, ids),
    ]);
    const days = await extractClaudeCodeData();
    // The first line's numbers, as ccusage counts it.
    expect(days[0]).toMatchObject({ inputTokens: 100, outputTokens: 5 });
    // And the cache keeps one entry for it, not three.
    const cache = JSON.parse(
      readFileSync(join(clawdboardHome, "claude-code-cache.json"), "utf-8")
    );
    expect(Object.values<{ entries: unknown[] }>(cache.files)[0].entries).toHaveLength(1);
  });

  it("counts lines without ids every time", async () => {
    writeTranscript(claudeDir, join("p", "s.jsonl"), [
      assistant("2026-03-01T12:00:01.000Z", { input: 100, output: 5 }, { messageId: null }),
      assistant("2026-03-01T12:00:02.000Z", { input: 100, output: 5 }, { messageId: null }),
    ]);
    expect((await extractClaudeCodeData())[0]).toMatchObject({ inputTokens: 200, outputTokens: 10 });
  });

  it("keeps synthetic and model-less lines out of the model list", async () => {
    writeTranscript(claudeDir, join("p", "s.jsonl"), [
      assistant("2026-03-01T12:00:01.000Z", { input: 0, output: 0 }, { model: "<synthetic>" }),
      assistant("2026-03-01T12:00:02.000Z", { input: 7, output: 9 }, { model: null }),
      assistant("2026-03-01T12:00:03.000Z", { input: 1, output: 1 }, { model: "claude-haiku-4-5" }),
    ]);
    const [day] = await extractClaudeCodeData();
    expect(day.modelsUsed).toEqual(["claude-haiku-4-5"]);
    expect(day.modelBreakdowns.map((m) => m.modelName).sort()).toEqual(["claude-haiku-4-5", "unknown"]);
    expect(day.inputTokens).toBe(8);
  });

  it("skips lines that are not usage: broken JSON, blanks, other shapes", async () => {
    writeTranscript(claudeDir, join("p", "s.jsonl"), [
      "",
      "not json at all",
      '{"type":"assistant","timestamp":"2026-03-01T12:00:00.000Z","message":{"usage":{"input_tokens":5',
      "[1,2,3]",
      "null",
      { type: "summary", summary: "s" },
      { ...assistant("2026-03-01T12:00:01.000Z"), timestamp: "yesterday" },
      { ...assistant("2026-03-01T12:00:01.000Z"), cwd: null },
      assistant("2026-03-01T12:00:02.000Z", { input: 3, output: 4 }),
    ]);
    const days = await extractClaudeCodeData();
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ inputTokens: 3, outputTokens: 4 });
  });

  it("counts a last line that has no newline", async () => {
    writeTranscript(
      claudeDir,
      join("p", "s.jsonl"),
      [
        assistant("2026-03-01T12:00:01.000Z", { input: 1, output: 1 }),
        assistant("2026-03-01T12:00:02.000Z", { input: 2, output: 2 }),
      ],
      { trailingNewline: false }
    );
    expect((await extractClaudeCodeData())[0]).toMatchObject({ inputTokens: 3, outputTokens: 3 });
  });

  it("reads lines larger than a read chunk, wherever the chunk boundary falls", async () => {
    // 1 MiB chunks: a 2.5 MB tool result, then a 1.5 MB assistant line, then
    // small lines, so boundaries land inside both kinds of line.
    const huge = "tool output with \"quotes\" and \\ slashes\n".repeat(60_000);
    const longAnswer = "word ".repeat(300_000);
    writeTranscript(claudeDir, join("p", "s.jsonl"), [
      assistant("2026-03-01T12:00:01.000Z", { input: 1, output: 10 }),
      user("2026-03-01T12:00:02.000Z", huge),
      assistant("2026-03-01T12:00:03.000Z", { input: 2, output: 20 }, { text: longAnswer }),
      user("2026-03-01T12:00:04.000Z", huge),
      assistant("2026-03-01T12:00:05.000Z", { input: 4, output: 40 }),
    ]);
    expect((await extractClaudeCodeData())[0]).toMatchObject({ inputTokens: 7, outputTokens: 70 });
    expect(await loadWithClawdboard()).toEqual(await loadWithCcusage(claudeDir));
  });

  it("handles CRLF line endings", async () => {
    writeTranscript(
      claudeDir,
      join("p", "s.jsonl"),
      [
        user("2026-03-01T12:00:00.000Z"),
        assistant("2026-03-01T12:00:01.000Z", { input: 5, output: 6 }),
      ],
      { eol: "\r\n" }
    );
    expect((await extractClaudeCodeData())[0]).toMatchObject({ inputTokens: 5, outputTokens: 6 });
  });

  it("finds transcripts in nested folders, follows symlinks, skips dot-entries", async () => {
    writeTranscript(claudeDir, join("p", "session", "subagents", "agent-1.jsonl"), [
      assistant("2026-03-01T12:00:01.000Z", { input: 1, output: 0 }),
    ]);
    writeTranscript(claudeDir, join("p", ".hidden", "s.jsonl"), [
      assistant("2026-03-01T12:00:02.000Z", { input: 10, output: 0 }),
    ]);
    writeTranscript(claudeDir, join("p", ".hidden.jsonl"), [
      assistant("2026-03-01T12:00:03.000Z", { input: 100, output: 0 }),
    ]);
    writeTranscript(claudeDir, join("p", "transcript.jsonl.bak"), [
      assistant("2026-03-01T12:00:04.000Z", { input: 1000, output: 0 }),
    ]);

    const elsewhere = createTempDir("elsewhere");
    try {
      const linked = join(elsewhere, "linked.jsonl");
      writeFileSync(
        linked,
        JSON.stringify(assistant("2026-03-01T12:00:05.000Z", { input: 10_000, output: 0 })) + "\n"
      );
      symlinkSync(linked, join(claudeDir, "projects", "p", "linked.jsonl"));
      mkdirSync(join(elsewhere, "dir"));
      writeFileSync(
        join(elsewhere, "dir", "inner.jsonl"),
        JSON.stringify(assistant("2026-03-01T12:00:06.000Z", { input: 100_000, output: 0 })) + "\n"
      );
      symlinkSync(join(elsewhere, "dir"), join(claudeDir, "projects", "linked-dir"));
      symlinkSync(join(elsewhere, "gone"), join(claudeDir, "projects", "dangling.jsonl"));

      expect((await extractClaudeCodeData())[0].inputTokens).toBe(110_001);
      expect(await loadWithClawdboard()).toEqual(await loadWithCcusage(claudeDir));
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  // chmod means nothing on Windows, or to root.
  const canRevokeRead = process.platform !== "win32" && process.getuid?.() !== 0;
  it.skipIf(!canRevokeRead)("skips a transcript it cannot read and counts the rest", async () => {
    writeTranscript(claudeDir, join("p", "readable.jsonl"), [
      assistant("2026-03-01T12:00:01.000Z", { input: 5, output: 6 }),
    ]);
    const locked = writeTranscript(claudeDir, join("p", "locked.jsonl"), [
      assistant("2026-03-01T12:00:02.000Z", { input: 100, output: 100 }),
    ]);
    chmodSync(locked, 0o000);
    try {
      // ccusage fails the whole load here, which used to drop every Claude
      // Code day from the sync.
      await expect(loadDailyUsageData({ mode: "display", claudePath: claudeDir })).rejects.toThrow();
      expect((await extractClaudeCodeData())[0]).toMatchObject({ inputTokens: 5, outputTokens: 6 });
    } finally {
      chmodSync(locked, 0o644);
    }
    // Readable again: picked up on the next run.
    expect((await extractClaudeCodeData())[0]).toMatchObject({ inputTokens: 105, outputTokens: 106 });
  });

  it("reads every directory in CLAUDE_CONFIG_DIR", async () => {
    const second = createTempDir("claude-second");
    try {
      writeTranscript(claudeDir, join("p", "s.jsonl"), [
        assistant("2026-03-01T12:00:01.000Z", { input: 1, output: 1 }),
      ]);
      writeTranscript(second, join("p", "s.jsonl"), [
        assistant("2026-03-01T12:00:02.000Z", { input: 2, output: 2 }),
      ]);
      process.env.CLAUDE_CONFIG_DIR = ` ${claudeDir} , ${second},${join(second, "missing")},${claudeDir}`;
      expect(getClaudeConfigDirs()).toEqual([claudeDir, second]);
      expect((await extractClaudeCodeData())[0]).toMatchObject({ inputTokens: 3, outputTokens: 3 });
    } finally {
      rmSync(second, { recursive: true, force: true });
    }
  });

  it("puts a response on the day it happened where the machine is", async () => {
    writeTranscript(claudeDir, join("p", "s.jsonl"), [
      assistant("2026-02-28T23:30:00.000Z", { input: 1, output: 1 }),
      assistant("2026-03-01T03:00:00.000Z", { input: 2, output: 2 }),
    ]);
    const dates = async () => (await extractClaudeCodeData()).map((d) => d.date);

    useTimezone("UTC");
    expect(await dates()).toEqual(["2026-03-01", "2026-02-28"]);
    // UTC+13: both fall on 1 March.
    useTimezone("Pacific/Auckland");
    expect(await dates()).toEqual(["2026-03-01"]);
    // UTC-8: both fall on 28 February.
    useTimezone("America/Los_Angeles");
    expect(await dates()).toEqual(["2026-02-28"]);
  });

  it("filters by --since, in either date format", async () => {
    writeTranscript(claudeDir, join("p", "s.jsonl"), [
      assistant("2026-02-27T12:00:00.000Z", { input: 1, output: 1 }),
      assistant("2026-02-28T12:00:00.000Z", { input: 2, output: 2 }),
      assistant("2026-03-01T12:00:00.000Z", { input: 4, output: 4 }),
    ]);
    const dates = async (since?: string) =>
      (await extractClaudeCodeData(since)).map((d) => d.date);
    expect(await dates()).toEqual(["2026-03-01", "2026-02-28", "2026-02-27"]);
    expect(await dates("2026-02-28")).toEqual(["2026-03-01", "2026-02-28"]);
    expect(await dates("20260301")).toEqual(["2026-03-01"]);
    expect(await dates("2026-03-02")).toEqual([]);
  });

  it("prices from the static table when live pricing never loaded", async () => {
    _setTieredTableForTests(null);
    writeTranscript(claudeDir, join("p", "s.jsonl"), [
      assistant(
        "2026-03-01T12:00:01.000Z",
        { input: 1000, output: 2000, cacheCreation: 3000, cacheRead: 4000 },
        { model: "claude-sonnet-4-5-20250929" }
      ),
    ]);
    const [day] = await extractClaudeCodeData();
    expect(day.totalCost).toBe(
      calculateCost("claude-sonnet-4-5-20250929", {
        input: 1000,
        output: 2000,
        cacheCreation: 3000,
        cacheRead: 4000,
      })
    );
    expect(day.totalCost).toBeGreaterThan(0);
  });

  it("applies the above-200k rate to the part of a response over 200k", async () => {
    writeTranscript(claudeDir, join("p", "s.jsonl"), [
      assistant(
        "2026-03-01T12:00:01.000Z",
        { input: 250_000, output: 100, cacheRead: 900_000 },
        { model: "claude-sonnet-4-5-20250929" }
      ),
    ]);
    const [day] = await extractClaudeCodeData();
    const expected =
      50_000 * 6e-6 + 200_000 * 3e-6 + 100 * 1.5e-5 + (700_000 * 6e-7 + 200_000 * 3e-7);
    expect(day.totalCost).toBeCloseTo(expected, 12);
  });
});

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

describe("transcript cache", () => {
  const cachePath = () => join(clawdboardHome, "claude-code-cache.json");
  const readCacheFile = () => JSON.parse(readFileSync(cachePath(), "utf-8"));

  /** A whole-second mtime: utimes can't restore the sub-millisecond part. */
  const FIXED_MTIME = new Date("2026-03-01T13:00:00.000Z");

  /** Overwrite a file in place, keeping its size and (fixed) mtime. */
  function rewriteKeepingStat(path: string, content: string): void {
    const before = statSync(path);
    expect(Buffer.byteLength(content)).toBe(before.size);
    writeFileSync(path, content);
    utimesSync(path, FIXED_MTIME, FIXED_MTIME);
    expect(statSync(path).mtimeMs).toBe(before.mtimeMs);
  }

  it("writes one record per transcript, holding no content", async () => {
    const path = writeTranscript(claudeDir, join("p", "s.jsonl"), [
      user("2026-03-01T12:00:00.000Z", "secret tool output"),
      assistant("2026-03-01T12:00:01.000Z", { input: 5, output: 6 }, { text: "secret answer" }),
    ]);
    await extractClaudeCodeData();

    const cache = readCacheFile();
    expect(Object.keys(cache.files)).toEqual([path]);
    expect(cache.files[path]).toMatchObject({
      size: statSync(path).size,
      earliest: Date.parse("2026-03-01T12:00:00.000Z"),
      models: ["claude-sonnet-4-5-20250929"],
    });
    expect(cache.files[path].entries).toHaveLength(1);
    expect(JSON.stringify(cache)).not.toContain("secret");
  });

  it("reuses a record while the file's size and mtime are unchanged", async () => {
    const lines = [assistant("2026-03-01T12:00:01.000Z", { input: 111, output: 222 })];
    const path = writeTranscript(claudeDir, join("p", "s.jsonl"), lines);
    utimesSync(path, FIXED_MTIME, FIXED_MTIME);
    const first = await extractClaudeCodeData();

    // Same size, same mtime, different numbers: only the cache can still say 111.
    const original = readFileSync(path, "utf-8");
    rewriteKeepingStat(path, original.replace('"input_tokens":111', '"input_tokens":999'));
    expect(await extractClaudeCodeData()).toEqual(first);

    // Touch it: the file is read again.
    const later = new Date(Date.now() + 5000);
    utimesSync(path, later, later);
    expect((await extractClaudeCodeData())[0].inputTokens).toBe(999);
  });

  it("reads a transcript again after it grows", async () => {
    const path = writeTranscript(claudeDir, join("p", "s.jsonl"), [
      assistant("2026-03-01T12:00:01.000Z", { input: 1, output: 1 }),
    ]);
    expect((await extractClaudeCodeData())[0].inputTokens).toBe(1);

    appendFileSync(
      path,
      JSON.stringify(assistant("2026-03-01T12:00:02.000Z", { input: 2, output: 2 })) + "\n"
    );
    expect((await extractClaudeCodeData())[0].inputTokens).toBe(3);
    expect(readCacheFile().files[path].entries).toHaveLength(2);
  });

  it("picks up new transcripts and forgets deleted ones", async () => {
    const first = writeTranscript(claudeDir, join("p", "a.jsonl"), [
      assistant("2026-03-01T12:00:01.000Z", { input: 1, output: 1 }),
    ]);
    await extractClaudeCodeData();

    const second = writeTranscript(claudeDir, join("p", "b.jsonl"), [
      assistant("2026-03-01T12:00:02.000Z", { input: 2, output: 2 }),
    ]);
    expect((await extractClaudeCodeData())[0].inputTokens).toBe(3);
    expect(Object.keys(readCacheFile().files).sort()).toEqual([first, second]);

    rmSync(first);
    expect((await extractClaudeCodeData())[0].inputTokens).toBe(2);
    expect(Object.keys(readCacheFile().files)).toEqual([second]);
  });

  it("leaves the cache file alone when nothing changed", async () => {
    writeTranscript(claudeDir, join("p", "s.jsonl"), [
      assistant("2026-03-01T12:00:01.000Z", { input: 1, output: 1 }),
    ]);
    await extractClaudeCodeData();
    const old = new Date(Date.now() - 60_000);
    utimesSync(cachePath(), old, old);
    const before = statSync(cachePath()).mtimeMs;

    await extractClaudeCodeData();
    expect(statSync(cachePath()).mtimeMs).toBe(before);
  });

  it("survives a cache that is garbage, outdated or damaged", async () => {
    const path = writeTranscript(claudeDir, join("p", "s.jsonl"), [
      assistant("2026-03-01T12:00:01.000Z", { input: 5, output: 6 }),
    ]);
    const expected = await extractClaudeCodeData();
    const good = readCacheFile();
    const info = statSync(path);

    const broken: unknown[] = [
      "this is not json",
      "null",
      JSON.stringify({ version: 0, files: good.files }),
      JSON.stringify({ version: good.version, files: null }),
      JSON.stringify({ version: good.version, files: { [path]: "nope" } }),
      // Right file, right size and mtime, damaged inside. Each of these would
      // skew or break the totals if it were trusted.
      ...[
        [null, 7],
        [["m:r", Date.parse("2026-03-01T12:00:01.000Z"), 0, "5", 6, 0, 0]],
        [["m:r", Date.parse("2026-03-01T12:00:01.000Z"), 3, 5, 6, 0, 0]],
        [["m:r", "2026-03-01T12:00:01.000Z", 0, 5, 6, 0, 0]],
        [["m:r", Date.parse("2026-03-01T12:00:01.000Z"), 0, 5, 6, 0]],
        [[7, Date.parse("2026-03-01T12:00:01.000Z"), 0, 5, 6, 0, 0]],
      ].map((entries) =>
        JSON.stringify({
          version: good.version,
          files: {
            [path]: {
              size: info.size,
              mtimeMs: info.mtimeMs,
              earliest: null,
              models: ["claude-sonnet-4-5-20250929"],
              entries,
            },
          },
        })
      ),
    ];
    for (const content of broken) {
      writeFileSync(cachePath(), content as string);
      expect(await extractClaudeCodeData(), content as string).toEqual(expected);
      // And the cache is good again afterwards.
      expect(readCacheFile().files[path].entries).toEqual(good.files[path].entries);
    }
  });

  it("works when the cache cannot be written", async () => {
    writeTranscript(claudeDir, join("p", "s.jsonl"), [
      assistant("2026-03-01T12:00:01.000Z", { input: 5, output: 6 }),
    ]);
    // A file where the cache directory should be.
    const blocked = join(clawdboardHome, "blocked");
    writeFileSync(blocked, "x");
    process.env.CLAWDBOARD_HOME = blocked;
    expect((await extractClaudeCodeData())[0]).toMatchObject({ inputTokens: 5, outputTokens: 6 });
  });
});

// ---------------------------------------------------------------------------
// aggregateTranscripts
// ---------------------------------------------------------------------------

describe("aggregateTranscripts", () => {
  const at = (iso: string) => Date.parse(iso);

  it("lets the transcript that starts first win a shared response", () => {
    const later = {
      earliest: at("2026-03-02T00:00:00Z"),
      models: ["claude-haiku-4-5"],
      entries: [["m:r", at("2026-03-02T12:00:00Z"), 0, 500, 500, 0, 0]] as never,
    };
    const earlier = {
      earliest: at("2026-03-01T00:00:00Z"),
      models: ["claude-haiku-4-5"],
      entries: [["m:r", at("2026-03-01T12:00:00Z"), 0, 1, 2, 0, 0]] as never,
    };
    for (const order of [
      [later, earlier],
      [earlier, later],
    ]) {
      const days = aggregateTranscripts(order);
      expect(days).toHaveLength(1);
      expect(days[0]).toMatchObject({ date: "2026-03-01", inputTokens: 1, outputTokens: 2 });
    }
  });

  it("orders transcripts without a timestamp last", () => {
    const untimed = {
      earliest: null,
      models: [],
      entries: [["m:r", at("2026-03-05T12:00:00Z"), -1, 500, 500, 0, 0]] as never,
    };
    const timed = {
      earliest: at("2026-03-01T00:00:00Z"),
      models: [],
      entries: [["m:r", at("2026-03-01T12:00:00Z"), -1, 1, 2, 0, 0]] as never,
    };
    expect(aggregateTranscripts([untimed, timed])[0]).toMatchObject({ inputTokens: 1 });
  });

  it("drops an entry whose timestamp is not a real date but still spends its id", () => {
    const transcript = {
      earliest: at("2026-03-01T00:00:00Z"),
      models: [],
      entries: [
        ["m:r", null, -1, 500, 500, 0, 0],
        ["m:r", at("2026-03-01T12:00:00Z"), -1, 1, 2, 0, 0],
        ["m:other", at("2026-03-01T12:00:00Z"), -1, 10, 20, 0, 0],
      ] as never,
    };
    expect(aggregateTranscripts([transcript])[0]).toMatchObject({
      inputTokens: 10,
      outputTokens: 20,
    });
  });
});
