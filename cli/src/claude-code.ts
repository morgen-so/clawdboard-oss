/**
 * Claude Code usage extraction.
 *
 * Reads the JSONL transcripts Claude Code writes under
 * `<config dir>/projects/**` and adds up token usage per local day.
 *
 * This replaces ccusage's `loadDailyUsageData`, which the CLI used until
 * 0.3.9. ccusage parses every line of every transcript twice per run (once
 * to order the files, once to read them), and a heavy user's transcripts run
 * to gigabytes, so a sync took minutes. Three things make this one fast:
 *
 *   1. One pass per file, over raw bytes. Only lines that can hold usage
 *      (a `message` object with a `usage` object) are decoded and
 *      JSON-parsed. For the rest, which is where the megabytes of tool
 *      output live, a small scanner pulls out the one field needed: the
 *      top-level `timestamp`.
 *   2. Each file's result is cached in `~/.clawdboard/` and reused while the
 *      file's size and mtime are unchanged, so a later sync only reads the
 *      transcripts that grew since.
 *   3. Prices are looked up once per model, not once per response.
 *
 * The numbers are ccusage's, on purpose: the leaderboard ranks by them. The
 * same lines count (its schema, ported in `toUsageEntry`), duplicates are
 * dropped the same way (`messageId:requestId`, first file wins, files ordered
 * by their earliest timestamp), days are local-timezone days, and cost uses
 * its tiered LiteLLM arithmetic. `tests/claude-code.test.ts` runs both on the
 * same transcripts and compares.
 *
 * Privacy guarantees match the other extractors: only dates, token counts,
 * cost and model names leave this module. The cache stays on disk next to
 * the transcripts it describes and is never uploaded.
 */

import { createReadStream, statSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { calculateTieredCost } from "./litellm-pricing.js";
import { calculateCost } from "./pricing.js";
import type { SyncDay } from "./schemas.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const PROJECTS_DIR = "projects";
/** Directory depth limit for the transcript walk; guards symlink loops. */
const MAX_WALK_DEPTH = 32;

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Claude Code config directories that hold a `projects/` folder.
 *
 * `CLAUDE_CONFIG_DIR` (comma-separated) replaces the defaults when set;
 * otherwise both the XDG location and `~/.claude` are read.
 */
export function getClaudeConfigDirs(): string[] {
  const fromEnv = (process.env.CLAUDE_CONFIG_DIR ?? "").trim();
  const candidates =
    fromEnv !== ""
      ? fromEnv
          .split(",")
          .map((p) => p.trim())
          .filter((p) => p !== "")
      : [
          join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "claude"),
          join(homedir(), ".claude"),
        ];

  const dirs: string[] = [];
  for (const candidate of candidates) {
    const dir = resolve(candidate);
    if (dirs.includes(dir)) continue;
    if (isDirectory(join(dir, PROJECTS_DIR))) dirs.push(dir);
  }
  return dirs;
}

/**
 * Every `*.jsonl` under a projects directory, in a stable (sorted) order.
 * Like the glob it replaces, it follows symlinks and skips dot-entries.
 */
async function findTranscripts(projectsDir: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);

      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const target = await stat(path);
          isDir = target.isDirectory();
          isFile = target.isFile();
        } catch {
          continue;
        }
      }

      if (isDir) {
        if (depth < MAX_WALK_DEPTH) await walk(path, depth + 1);
      } else if (isFile && entry.name.endsWith(".jsonl")) {
        out.push(path);
      }
    }
  }

  await walk(projectsDir, 0);
  return out;
}

// ---------------------------------------------------------------------------
// Types (internal: only used for parsing and the local cache, never uploaded)
// ---------------------------------------------------------------------------

/**
 * One counted API response. A tuple, because the cache holds one per response
 * and field names would triple its size.
 *
 *   [0] dedup key (`messageId:requestId`), or null when either id is missing
 *   [1] timestamp in ms, or null when it has the right shape but isn't a date
 *   [2] index into the file's `models`, or -1 when the line has no model
 *   [3] input tokens   [4] output tokens
 *   [5] cache creation tokens   [6] cache read tokens
 */
type UsageEntry = [
  string | null,
  number | null,
  number,
  number,
  number,
  number,
  number,
];

/** What one transcript contributes; also the cache's per-file record. */
interface TranscriptUsage {
  /** Earliest top-level `timestamp` on any line, in ms. Orders the files. */
  earliest: number | null;
  /** Model names referenced by `entries`. */
  models: string[];
  /** Responses in file order, without the file's own repeats. */
  entries: UsageEntry[];
}

interface CachedTranscript extends TranscriptUsage {
  size: number;
  mtimeMs: number;
}

interface CacheFile {
  version: number;
  files: Record<string, CachedTranscript>;
}

// ---------------------------------------------------------------------------
// Line parsing
// ---------------------------------------------------------------------------

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const VERSION = /^\d+\.\d+\.\d+/;

function isNumber(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(value);
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || isNumber(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

/** Absent, or a non-empty string. */
function isOptionalName(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length > 0);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The fields of a usage line that the totals are built from. */
interface UsageLine {
  hash: string | null;
  timestamp: string;
  model: string | undefined;
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

/**
 * Decide whether a parsed transcript line counts as usage, and pick out its
 * numbers. A port of ccusage's `usageDataSchema`: a line it rejects (say, a
 * null where a string belongs) is rejected here too, so both count the same
 * set of lines.
 */
export function toUsageEntry(json: unknown): UsageLine | null {
  if (!isObject(json)) return null;
  if (!isOptionalString(json.cwd)) return null;
  if (!isOptionalName(json.sessionId)) return null;
  const timestamp = json.timestamp;
  if (typeof timestamp !== "string" || !ISO_TIMESTAMP.test(timestamp)) return null;
  const version = json.version;
  if (version !== undefined && (typeof version !== "string" || !VERSION.test(version))) {
    return null;
  }
  if (!isOptionalNumber(json.costUSD)) return null;
  if (!isOptionalName(json.requestId)) return null;
  if (json.isApiErrorMessage !== undefined && typeof json.isApiErrorMessage !== "boolean") {
    return null;
  }

  const message = json.message;
  if (!isObject(message)) return null;
  if (!isOptionalName(message.model)) return null;
  if (!isOptionalName(message.id)) return null;
  const content = message.content;
  if (content !== undefined) {
    if (!Array.isArray(content)) return null;
    for (const block of content) {
      if (!isObject(block) || !isOptionalString(block.text)) return null;
    }
  }

  const usage = message.usage;
  if (!isObject(usage)) return null;
  if (!isNumber(usage.input_tokens) || !isNumber(usage.output_tokens)) return null;
  if (!isOptionalNumber(usage.cache_creation_input_tokens)) return null;
  if (!isOptionalNumber(usage.cache_read_input_tokens)) return null;

  const messageId = message.id;
  const requestId = json.requestId;
  return {
    hash:
      messageId !== undefined && requestId !== undefined
        ? `${messageId}:${requestId}`
        : null,
    timestamp,
    model: message.model,
    input: usage.input_tokens,
    output: usage.output_tokens,
    cacheCreation: usage.cache_creation_input_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
  };
}

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const COMMA = 0x2c;
const COLON = 0x3a;

/** Bytes `findStringEnd` steps through before trying a native search. */
const STEP_BYTES = 128;

const KEY_TIMESTAMP = Buffer.from("timestamp");
const KEY_MESSAGE = Buffer.from("message");
const KEY_USAGE = Buffer.from("usage");

function isJsonWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

function skipWhitespace(b: Buffer, i: number, end: number): number {
  while (i < end && isJsonWhitespace(b[i])) i++;
  return i;
}

/**
 * Index of the quote that closes a JSON string whose content starts at
 * `from`, or -1 if the string runs past `end`.
 */
function findStringEnd(b: Buffer, from: number, end: number): number {
  // Two ways to look for the closing quote, alternated. Stepping byte by byte
  // is quick where quotes are dense (keys, short values, escaped JSON inside
  // tool output); a native search is far quicker across a long quote-free
  // run (prose, base64) but costs a call per quote it lands on.
  let i = from; // always at the start of a character, never mid-escape
  for (;;) {
    const stepUntil = Math.min(end, i + STEP_BYTES);
    while (i < stepUntil) {
      const byte = b[i];
      if (byte === QUOTE) return i;
      i += byte === BACKSLASH ? 2 : 1;
    }
    if (i >= end) return -1;

    const quote = b.indexOf(QUOTE, i);
    if (quote === -1 || quote >= end) return -1;
    // A quote is escaped when an odd number of backslashes sits before it.
    let backslashes = 0;
    for (let k = quote - 1; k >= i && b[k] === BACKSLASH; k--) backslashes++;
    if ((backslashes & 1) === 0) return quote;
    i = quote + 1;
  }
}

/** Index just past the object or array that opens at `i`, or -1. */
function skipContainer(b: Buffer, i: number, end: number): number {
  let depth = 0;
  while (i < end) {
    const byte = b[i];
    if (byte === QUOTE) {
      const close = findStringEnd(b, i + 1, end);
      if (close === -1) return -1;
      i = close + 1;
      continue;
    }
    if (byte === OPEN_BRACE || byte === OPEN_BRACKET) {
      depth++;
    } else if (byte === CLOSE_BRACE || byte === CLOSE_BRACKET) {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return -1;
}

function hasBackslash(b: Buffer, from: number, to: number): boolean {
  for (let k = from; k < to; k++) if (b[k] === BACKSLASH) return true;
  return false;
}

function keyIs(b: Buffer, from: number, to: number, key: Buffer): boolean {
  if (to - from !== key.length) return false;
  for (let k = 0; k < key.length; k++) if (b[from + k] !== key[k]) return false;
  return true;
}

/** What a scan of one line found. */
export interface LineScan {
  /** The top-level `timestamp`, when it is a string. */
  timestamp: string | null;
  /**
   * Whether the line has a `message` object holding a `usage` object. Only
   * such a line can count as usage, and it gets a real JSON.parse.
   */
  hasUsage: boolean;
}

/** Set by `walkObject` on a `message` object: did it hold a `usage` object? */
let sawUsageObject = false;

/**
 * Walk the keys of the object that opens at `i`, jumping over each value.
 * Returns the index just past its closing brace, or -1 when the bytes aren't
 * an object this walker is sure about.
 *
 * At the top level (`into` is the scan result) it records `timestamp` and
 * descends into `message`. Inside `message` (`into` is null) it looks for a
 * `usage` object and reports it through `sawUsageObject`.
 */
function walkObject(b: Buffer, i: number, end: number, into: LineScan | null): number {
  if (into === null) sawUsageObject = false;
  i = skipWhitespace(b, i + 1, end);
  if (i < end && b[i] === CLOSE_BRACE) return i + 1;

  for (;;) {
    // Key
    if (i >= end || b[i] !== QUOTE) return -1;
    const keyStart = i + 1;
    const keyEnd = findStringEnd(b, keyStart, end);
    if (keyEnd === -1) return -1;
    // An escaped key could spell a name the byte compares below would miss;
    // leave such lines to JSON.parse.
    if (hasBackslash(b, keyStart, keyEnd)) return -1;
    const isTimestamp = into !== null && keyIs(b, keyStart, keyEnd, KEY_TIMESTAMP);
    const isMessage = into !== null && keyIs(b, keyStart, keyEnd, KEY_MESSAGE);
    const isUsage = into === null && keyIs(b, keyStart, keyEnd, KEY_USAGE);

    i = skipWhitespace(b, keyEnd + 1, end);
    if (i >= end || b[i] !== COLON) return -1;
    i = skipWhitespace(b, i + 1, end);
    if (i >= end) return -1;

    // Value. A repeated key overrides the earlier one, as in JSON.parse.
    const first = b[i];
    if (isTimestamp) into.timestamp = null;
    if (isMessage) into.hasUsage = false;
    if (isUsage) sawUsageObject = first === OPEN_BRACE;

    if (first === QUOTE) {
      const valueEnd = findStringEnd(b, i + 1, end);
      if (valueEnd === -1) return -1;
      if (isTimestamp) {
        if (hasBackslash(b, i + 1, valueEnd)) return -1;
        into.timestamp = b.toString("utf8", i + 1, valueEnd);
      }
      i = valueEnd + 1;
    } else if (first === OPEN_BRACE && isMessage) {
      i = walkObject(b, i, end, null);
      if (i === -1) return -1;
      into.hasUsage = sawUsageObject;
    } else if (first === OPEN_BRACE || first === OPEN_BRACKET) {
      i = skipContainer(b, i, end);
      if (i === -1) return -1;
    } else {
      // Number, true, false or null
      while (
        i < end &&
        b[i] !== COMMA &&
        b[i] !== CLOSE_BRACE &&
        !isJsonWhitespace(b[i])
      ) {
        i++;
      }
    }

    i = skipWhitespace(b, i, end);
    if (i >= end) return -1;
    if (b[i] === COMMA) {
      i = skipWhitespace(b, i + 1, end);
      continue;
    }
    return b[i] === CLOSE_BRACE ? i + 1 : -1;
  }
}

/**
 * Learn what's needed from one JSON object line without parsing it: its
 * top-level `timestamp`, and whether it can hold usage at all.
 *
 * Nearly all of a transcript's bytes are tool output inside lines that hold
 * no usage; this walks such a line's structure and skips its strings with
 * native searches instead of building them.
 *
 * Returns undefined when the line isn't a plain object the scanner is sure
 * about (not an object, cut short, an escape in a key or in the timestamp).
 * The caller then falls back to JSON.parse, so the scanner only has to be
 * right when it answers.
 */
export function scanLine(b: Buffer, start: number, end: number): LineScan | undefined {
  const open = skipWhitespace(b, start, end);
  if (open >= end || b[open] !== OPEN_BRACE) return undefined;
  const scan: LineScan = { timestamp: null, hasUsage: false };
  const close = walkObject(b, open, end, scan);
  if (close === -1 || skipWhitespace(b, close, end) !== end) return undefined;
  return scan;
}

// ---------------------------------------------------------------------------
// File parsing
// ---------------------------------------------------------------------------

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const READ_CHUNK_BYTES = 1 << 20;

/** Collects one transcript's usage as its lines are fed in. */
class TranscriptReader implements TranscriptUsage {
  earliest: number | null = null;
  models: string[] = [];
  entries: UsageEntry[] = [];
  private modelIndex = new Map<string, number>();
  private seen = new Set<string>();

  line(b: Buffer, start: number, end: number): void {
    if (end > start && b[end - 1] === CARRIAGE_RETURN) end--;
    if (end === start) return;

    const scan = scanLine(b, start, end);
    if (scan && !scan.hasUsage) {
      if (scan.timestamp !== null) this.noteTimestamp(scan.timestamp);
      return;
    }

    // A line that can hold usage, or one the scanner wouldn't vouch for.
    let json: unknown;
    try {
      json = JSON.parse(b.toString("utf8", start, end));
    } catch {
      return; // not JSON (a half-written last line, say)
    }
    if (isObject(json) && typeof json.timestamp === "string") {
      this.noteTimestamp(json.timestamp);
    }

    const usage = toUsageEntry(json);
    if (!usage) return;
    if (usage.hash !== null) {
      // A response repeated within the file (Claude Code writes one line per
      // content block) counts once, at its first line; the cross-file pass
      // would drop the rest anyway.
      if (this.seen.has(usage.hash)) return;
      this.seen.add(usage.hash);
    }

    let model = -1;
    if (usage.model !== undefined) {
      const known = this.modelIndex.get(usage.model);
      if (known === undefined) {
        model = this.models.length;
        this.models.push(usage.model);
        this.modelIndex.set(usage.model, model);
      } else {
        model = known;
      }
    }

    const ms = Date.parse(usage.timestamp);
    this.entries.push([
      usage.hash,
      Number.isNaN(ms) ? null : ms,
      model,
      usage.input,
      usage.output,
      usage.cacheCreation,
      usage.cacheRead,
    ]);
  }

  private noteTimestamp(timestamp: string): void {
    const ms = Date.parse(timestamp);
    if (Number.isNaN(ms)) return;
    if (this.earliest === null || ms < this.earliest) this.earliest = ms;
  }
}

/** Read one transcript, streaming it so its size never has to fit in memory. */
async function readTranscript(path: string): Promise<TranscriptUsage> {
  const reader = new TranscriptReader();
  // Pieces of a line that spans chunks, joined once its newline arrives.
  let partial: Buffer[] = [];

  const stream = createReadStream(path, { highWaterMark: READ_CHUNK_BYTES });
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    let lineStart = 0;
    for (;;) {
      const newline = chunk.indexOf(NEWLINE, lineStart);
      if (newline === -1) break;
      if (partial.length > 0) {
        partial.push(chunk.subarray(lineStart, newline));
        const line = Buffer.concat(partial);
        partial = [];
        reader.line(line, 0, line.length);
      } else {
        reader.line(chunk, lineStart, newline);
      }
      lineStart = newline + 1;
    }
    if (lineStart < chunk.length) partial.push(chunk.subarray(lineStart));
  }

  if (partial.length > 0) {
    const line = Buffer.concat(partial);
    reader.line(line, 0, line.length);
  }

  return { earliest: reader.earliest, models: reader.models, entries: reader.entries };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/** Bump when parsing changes in a way that makes old records wrong. */
const CACHE_VERSION = 1;
const CACHE_FILE = "claude-code-cache.json";
/** Transcripts read at once. The parsing is on one thread; this overlaps I/O. */
const READ_CONCURRENCY = 8;

function getCachePath(): string {
  const dir = process.env.CLAWDBOARD_HOME ?? join(homedir(), ".clawdboard");
  return join(dir, CACHE_FILE);
}

function isNumberOrNull(value: unknown): boolean {
  return value === null || typeof value === "number";
}

/**
 * Check a cache record all the way down. Totals are built straight from
 * these values, so a record that is off in any way (a hand edit, a disk
 * error, a future format) is treated as missing and the transcript is read
 * again.
 */
function isCachedTranscript(value: unknown): value is CachedTranscript {
  if (!isObject(value)) return false;
  const { size, mtimeMs, earliest, models, entries } = value;
  if (typeof size !== "number" || typeof mtimeMs !== "number") return false;
  if (!isNumberOrNull(earliest)) return false;
  if (!Array.isArray(models) || !models.every((m) => typeof m === "string")) return false;
  if (!Array.isArray(entries)) return false;
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 7) return false;
    if (entry[0] !== null && typeof entry[0] !== "string") return false;
    if (!isNumberOrNull(entry[1])) return false;
    const model = entry[2];
    if (!Number.isInteger(model) || model < -1 || model >= models.length) return false;
    for (let i = 3; i < 7; i++) if (typeof entry[i] !== "number") return false;
  }
  return true;
}

async function readCache(): Promise<Record<string, CachedTranscript>> {
  try {
    const parsed = JSON.parse(await readFile(getCachePath(), "utf8")) as CacheFile;
    if (parsed?.version !== CACHE_VERSION || !isObject(parsed.files)) return {};
    return parsed.files;
  } catch {
    return {};
  }
}

async function writeCache(files: Record<string, CachedTranscript>): Promise<void> {
  const cachePath = getCachePath();
  // Write-then-rename, so a sync running at the same time (the background
  // hook) never reads a half-written file.
  const tmpPath = `${cachePath}.${process.pid}.tmp`;
  try {
    await mkdir(join(cachePath, ".."), { recursive: true });
    const file: CacheFile = { version: CACHE_VERSION, files };
    await writeFile(tmpPath, JSON.stringify(file), "utf8");
    await rename(tmpPath, cachePath);
  } catch {
    // Cache write failure is non-fatal: the next run just reads more.
    await unlink(tmpPath).catch(() => {});
  }
}

/** Run `fn` over `items`, at most `limit` at a time. */
async function forEachLimited<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Usage for each transcript, in the order given: from the cache when the
 * file's size and mtime are unchanged, read from disk otherwise. Unreadable
 * files are left out. Rewrites the cache when anything changed.
 */
async function loadTranscripts(
  paths: string[],
  cached: Record<string, CachedTranscript>
): Promise<TranscriptUsage[]> {
  const loaded: (CachedTranscript | null)[] = new Array(paths.length).fill(null);
  let reused = 0;
  let read = 0;

  await forEachLimited(paths, READ_CONCURRENCY, async (path, index) => {
    try {
      // Stat first: if the file grows while it's being read, the record is
      // filed under the older size and the next sync reads it again.
      const info = await stat(path);
      const hit = cached[path];
      if (
        isCachedTranscript(hit) &&
        hit.size === info.size &&
        hit.mtimeMs === info.mtimeMs
      ) {
        loaded[index] = hit;
        reused++;
        return;
      }
      const usage = await readTranscript(path);
      loaded[index] = { size: info.size, mtimeMs: info.mtimeMs, ...usage };
      read++;
    } catch {
      // Unreadable (deleted mid-run, permissions): skip this file only.
    }
  });

  if (read > 0 || reused !== Object.keys(cached).length) {
    const files: Record<string, CachedTranscript> = {};
    paths.forEach((path, index) => {
      const transcript = loaded[index];
      if (transcript) files[path] = transcript;
    });
    await writeCache(files);
  }

  return loaded.filter((t): t is CachedTranscript => t !== null);
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

interface ModelTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cost: number;
}

interface DayTotals extends ModelTotals {
  models: Map<string, ModelTotals>;
  modelsUsed: Set<string>;
}

function emptyTotals(): ModelTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    cost: 0,
  };
}

/** YYYY-MM-DD in the machine's timezone. */
function localDate(ms: number): string {
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${String(d.getFullYear()).padStart(4, "0")}-${month}-${day}`;
}

function responseCost(
  model: string,
  input: number,
  output: number,
  cacheCreation: number,
  cacheRead: number
): number {
  const tokens = { input, output, cacheCreation, cacheRead };
  // Offline with no pricing cache: the static table is the best there is.
  return calculateTieredCost(model, tokens) ?? calculateCost(model, tokens);
}

/**
 * Fold per-transcript usage into per-day totals.
 *
 * Order matters twice. A response copied into several transcripts (a resumed
 * or forked session carries its history along) counts once, from the file
 * with the earliest first timestamp. And costs are summed in that same
 * order, so the floating-point totals come out as ccusage's did.
 */
export function aggregateTranscripts(
  transcripts: TranscriptUsage[],
  since?: string
): SyncDay[] {
  // Stable sort: files that start at the same instant keep discovery order.
  const ordered = [...transcripts].sort((a, b) => {
    if (a.earliest === null && b.earliest === null) return 0;
    if (a.earliest === null) return 1;
    if (b.earliest === null) return -1;
    return a.earliest - b.earliest;
  });

  const counted = new Set<string>();
  const days = new Map<string, DayTotals>();

  for (const transcript of ordered) {
    for (const entry of transcript.entries) {
      const hash = entry[0];
      if (hash !== null) {
        if (counted.has(hash)) continue;
        counted.add(hash);
      }
      const timestamp = entry[1];
      if (timestamp === null) continue;

      const model = entry[2] >= 0 ? transcript.models[entry[2]] : undefined;
      const input = entry[3];
      const output = entry[4];
      const cacheCreation = entry[5];
      const cacheRead = entry[6];
      const cost =
        model === undefined
          ? 0
          : responseCost(model, input, output, cacheCreation, cacheRead);

      const date = localDate(timestamp);
      let day = days.get(date);
      if (!day) {
        day = { ...emptyTotals(), models: new Map(), modelsUsed: new Set() };
        days.set(date, day);
      }
      day.inputTokens += input;
      day.outputTokens += output;
      day.cacheCreationTokens += cacheCreation;
      day.cacheReadTokens += cacheRead;
      day.cost += cost;

      // "<synthetic>" marks messages Claude Code made up locally (an API
      // error notice, say). They stay in the day's totals, with no tokens,
      // and out of the model list.
      if (model === "<synthetic>") continue;
      if (model !== undefined) day.modelsUsed.add(model);
      const modelName = model ?? "unknown";
      let totals = day.models.get(modelName);
      if (!totals) {
        totals = emptyTotals();
        day.models.set(modelName, totals);
      }
      totals.inputTokens += input;
      totals.outputTokens += output;
      totals.cacheCreationTokens += cacheCreation;
      totals.cacheReadTokens += cacheRead;
      totals.cost += cost;
    }
  }

  // Accept both YYYY-MM-DD and YYYYMMDD.
  const sinceKey = since?.replace(/-/g, "");

  return [...days.entries()]
    .filter(([date]) => !sinceKey || date.replace(/-/g, "") >= sinceKey)
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, day]) => ({
      date,
      source: "claude-code" as const,
      inputTokens: day.inputTokens,
      outputTokens: day.outputTokens,
      cacheCreationTokens: day.cacheCreationTokens,
      cacheReadTokens: day.cacheReadTokens,
      totalCost: day.cost,
      modelsUsed: [...day.modelsUsed],
      modelBreakdowns: [...day.models.entries()]
        .map(([modelName, totals]) => ({ modelName, ...totals }))
        .sort((a, b) => b.cost - a.cost),
    }));
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Extract Claude Code usage, one entry per local day, newest first.
 *
 * Call `loadLivePricing()` first so costs use current LiteLLM rates.
 *
 * @param since - Optional YYYY-MM-DD; days before it are left out
 */
export async function extractClaudeCodeData(since?: string): Promise<SyncDay[]> {
  const dirs = getClaudeConfigDirs();
  if (dirs.length === 0) return [];

  const paths = (
    await Promise.all(dirs.map((dir) => findTranscripts(join(dir, PROJECTS_DIR))))
  ).flat();
  if (paths.length === 0) return [];

  try {
    return aggregateTranscripts(await loadTranscripts(paths, await readCache()), since);
  } catch {
    // Cache records are checked before use, so this shouldn't happen. If one
    // still trips the fold, the cache is the suspect: read everything from
    // the transcripts and replace it.
    return aggregateTranscripts(await loadTranscripts(paths, {}), since);
  }
}
