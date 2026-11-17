import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ModelPricing } from "./pricing.js";

/**
 * Live model pricing from LiteLLM's community-maintained pricing file.
 *
 * The static table in pricing.ts goes stale the day a new model launches;
 * LiteLLM's model_prices_and_context_window.json is updated within hours of
 * provider announcements. We fetch it at most once per 24h, cache it on disk,
 * and fall back to the static table when offline.
 *
 * Two tables are built from the one file:
 *
 *   1. The flat table (lookupLivePricing): USD per 1M tokens, exact-match
 *      only (raw ID and date/bracket-suffix-stripped ID) — no fuzzy matching,
 *      so a miss falls through to the static table's prefix logic rather than
 *      risking a wrong-model price. Used by every source except Claude Code.
 *
 *   2. The tiered table (calculateTieredCost): USD per token with the
 *      above-200k rates, matched the way ccusage matches models. Claude Code
 *      usage was priced by ccusage through 0.3.9, and the leaderboard ranks
 *      by cost, so that source keeps ccusage's arithmetic exactly.
 */

const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
// After a failed fetch, don't retry (and re-pay the timeout) until this much
// time has passed — each CLI invocation is a fresh process, so without a
// persisted marker an offline machine would stall on every single sync.
const FAILURE_BACKOFF_MS = 60 * 60 * 1000;
const CACHE_FILE = "pricing-cache.json";

// Sanity floor: the litellm file has thousands of entries. A tiny result
// means we fetched an error page or a truncated body — don't trust it.
const MIN_ENTRIES = 200;

/**
 * One LiteLLM entry as ccusage reads it: USD per token (not per 1M), null
 * where the file has no rate. Positional to keep the disk cache small:
 * [input, output, cacheWrite, cacheRead,
 *  inputAbove200k, outputAbove200k, cacheWriteAbove200k, cacheReadAbove200k]
 */
export type TieredRates = [
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
];

/** A tiered-table row on disk: model name, then its rates. */
type TieredRow = [string, ...TieredRates];

interface CacheFile {
  fetchedAt: string;
  models: Record<string, ModelPricing>;
  /**
   * Every LiteLLM entry in file order (the order decides fuzzy matches).
   * Absent in caches written by 0.3.9 or older; such a cache is refetched.
   */
  tiered?: TieredRow[];
  /** Set when the last fetch attempt failed; cleared by a successful fetch. */
  failedAt?: string;
}

let liveTable: Map<string, ModelPricing> | null = null;
let tieredTable: Map<string, TieredRates> | null = null;
/** Model name → matched rates (null = no match). Reset with the table. */
let tieredMatches = new Map<string, TieredRates | null>();

function getCachePath(): string {
  const dir = process.env.CLAWDBOARD_HOME ?? join(homedir(), ".clawdboard");
  return join(dir, CACHE_FILE);
}

/**
 * Convert one litellm entry (USD per token) to our ModelPricing
 * (USD per 1M tokens). Returns null for entries that aren't priced
 * chat-style models (embeddings, image models, free tiers, etc.).
 */
export function convertLitellmEntry(entry: unknown): ModelPricing | null {
  if (typeof entry !== "object" || entry === null) return null;
  const e = entry as Record<string, unknown>;
  if (typeof e.input_cost_per_token !== "number") return null;
  if (typeof e.output_cost_per_token !== "number") return null;
  return {
    input: e.input_cost_per_token * 1_000_000,
    output: e.output_cost_per_token * 1_000_000,
    cacheWrite:
      typeof e.cache_creation_input_token_cost === "number"
        ? e.cache_creation_input_token_cost * 1_000_000
        : 0,
    cacheRead:
      typeof e.cache_read_input_token_cost === "number"
        ? e.cache_read_input_token_cost * 1_000_000
        : 0,
  };
}

function buildTable(raw: Record<string, unknown>): Map<string, ModelPricing> {
  const table = new Map<string, ModelPricing>();
  for (const [key, entry] of Object.entries(raw)) {
    const converted = convertLitellmEntry(entry);
    if (converted) table.set(key, converted);
  }
  return table;
}

/** The cost fields ccusage reads, in TieredRates order. */
const TIERED_FIELDS = [
  "input_cost_per_token",
  "output_cost_per_token",
  "cache_creation_input_token_cost",
  "cache_read_input_token_cost",
  "input_cost_per_token_above_200k_tokens",
  "output_cost_per_token_above_200k_tokens",
  "cache_creation_input_token_cost_above_200k_tokens",
  "cache_read_input_token_cost_above_200k_tokens",
] as const;

/**
 * Fields ccusage's pricing schema also checks. An entry where any checked
 * field is present but not a number (LiteLLM's `sample_spec` documents
 * `max_tokens` with a string) is left out of its table altogether.
 */
const TIERED_CHECKED_ONLY_FIELDS = [
  "max_tokens",
  "max_input_tokens",
  "max_output_tokens",
  "input_cost_per_token_above_128k_tokens",
  "output_cost_per_token_above_128k_tokens",
] as const;

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && !Number.isNaN(value));
}

/**
 * Build the tiered table from the raw LiteLLM file: every object entry that
 * passes ccusage's schema, priced or not, in file order. Unpriced entries
 * stay in because ccusage's fuzzy match can land on them (and price at 0).
 */
export function buildTieredRows(raw: Record<string, unknown>): TieredRow[] {
  const rows: TieredRow[] = [];
  for (const [name, entry] of Object.entries(raw)) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (!TIERED_FIELDS.every((f) => isOptionalNumber(e[f]))) continue;
    if (!TIERED_CHECKED_ONLY_FIELDS.every((f) => isOptionalNumber(e[f]))) continue;
    const rates = TIERED_FIELDS.map((f) => (e[f] as number | undefined) ?? null);
    rows.push([name, ...(rates as TieredRates)]);
  }
  return rows;
}

function setTieredTable(rows: TieredRow[] | null): void {
  tieredTable = rows
    ? new Map(rows.map((row) => [row[0], row.slice(1) as TieredRates]))
    : null;
  tieredMatches = new Map();
}

async function readCache(): Promise<CacheFile | null> {
  try {
    const parsed = JSON.parse(await readFile(getCachePath(), "utf8"));
    if (typeof parsed?.fetchedAt !== "string") return null;
    if (typeof parsed?.models !== "object" || parsed.models === null) return null;
    if (!Array.isArray(parsed.tiered)) delete parsed.tiered;
    return parsed as CacheFile;
  } catch {
    return null;
  }
}

/** Load both in-memory tables from a disk cache. */
function useCache(cached: CacheFile): void {
  liveTable = new Map(Object.entries(cached.models));
  setTieredTable(cached.tiered ?? null);
}

async function writeCache(
  models: Map<string, ModelPricing>,
  tiered: TieredRow[]
): Promise<void> {
  try {
    const cachePath = getCachePath();
    await mkdir(join(cachePath, ".."), { recursive: true });
    const file: CacheFile = {
      fetchedAt: new Date().toISOString(),
      models: Object.fromEntries(models),
      tiered,
    };
    await writeFile(cachePath, JSON.stringify(file), "utf8");
  } catch {
    // Cache write failure is non-fatal — next run just re-fetches.
  }
}

/** Record a failed fetch so the next invocation can skip the retry timeout. */
async function writeFailureMarker(cached: CacheFile | null): Promise<void> {
  try {
    const cachePath = getCachePath();
    await mkdir(join(cachePath, ".."), { recursive: true });
    const file: CacheFile = {
      fetchedAt: cached?.fetchedAt ?? new Date(0).toISOString(),
      models: cached?.models ?? {},
      ...(cached?.tiered ? { tiered: cached.tiered } : {}),
      failedAt: new Date().toISOString(),
    };
    await writeFile(cachePath, JSON.stringify(file), "utf8");
  } catch {
    // Non-fatal — worst case the next run retries the fetch.
  }
}

/**
 * Load live pricing into memory: fresh disk cache if available, otherwise
 * fetch from LiteLLM (falling back to a stale cache when offline).
 * Never throws — on total failure the live table stays empty and
 * getModelPricing() uses the static table.
 */
export async function loadLivePricing(): Promise<void> {
  if (liveTable) return;

  const cached = await readCache();
  // A cache written by 0.3.9 or older has no tiered table, so it counts as
  // stale even when fresh: one refetch upgrades it.
  if (
    cached?.tiered &&
    Date.now() - Date.parse(cached.fetchedAt) < CACHE_TTL_MS
  ) {
    useCache(cached);
    return;
  }

  // A recent failure is on record: skip the fetch (and its timeout) until
  // the backoff elapses, using whatever stale data we have.
  if (
    cached?.failedAt &&
    Date.now() - Date.parse(cached.failedAt) < FAILURE_BACKOFF_MS
  ) {
    useCache(cached);
    return;
  }

  try {
    const response = await fetch(LITELLM_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = (await response.json()) as Record<string, unknown>;
    const table = buildTable(raw);
    if (table.size < MIN_ENTRIES) throw new Error(`only ${table.size} entries`);
    const tiered = buildTieredRows(raw);
    liveTable = table;
    setTieredTable(tiered);
    await writeCache(table, tiered);
  } catch {
    // Offline or upstream broken: a stale cache still beats the static
    // table, and recording the failure lets the next run skip the timeout.
    if (cached) useCache(cached);
    await writeFailureMarker(cached);
  }
}

/**
 * Normalize a model ID for pricing lookups (shared by the live table and
 * the static table in pricing.ts — keep ONE normalizer so an ID can't slip
 * between layers and land on DEFAULT_PRICING):
 *   "claude-fable-5[1m]"          → "claude-fable-5"  (context-window marker)
 *   "claude-sonnet-4-20250514"    → "claude-sonnet-4" (date suffix)
 *   "gpt-4o-2024-08-06"           → "gpt-4o"
 */
export function normalizeModelId(modelId: string): string {
  return modelId
    .replace(/\[[^\]]*\]$/, "")
    .replace(/-\d{4}-?\d{2}-?\d{2}$/, "");
}

/** Exact-match lookup in the live table. Null when absent or not loaded. */
export function lookupLivePricing(modelId: string): ModelPricing | null {
  if (!liveTable) return null;
  return (
    liveTable.get(modelId) ?? liveTable.get(normalizeModelId(modelId)) ?? null
  );
}

// ---------------------------------------------------------------------------
// Tiered pricing: ccusage-compatible, used for Claude Code usage only
// ---------------------------------------------------------------------------

/** Prefixes ccusage tries in front of a Claude Code model name. */
const CLAUDE_PROVIDER_PREFIXES = [
  "anthropic/",
  "claude-3-5-",
  "claude-3-",
  "claude-",
  "openrouter/openai/",
];

/** Token count above which the above-200k rate applies to the excess. */
const TIER_THRESHOLD = 200_000;

/**
 * Find a model's rates the way ccusage does: the exact name, then the name
 * behind each provider prefix, then the first table entry (in file order)
 * whose name contains the model name or is contained in it.
 */
function matchTieredRates(
  table: Map<string, TieredRates>,
  modelName: string
): TieredRates | null {
  const known = tieredMatches.get(modelName);
  if (known !== undefined) return known;

  let match: TieredRates | null = table.get(modelName) ?? null;
  for (let i = 0; match === null && i < CLAUDE_PROVIDER_PREFIXES.length; i++) {
    match = table.get(CLAUDE_PROVIDER_PREFIXES[i] + modelName) ?? null;
  }
  if (match === null) {
    const lower = modelName.toLowerCase();
    for (const [key, rates] of table) {
      const comparison = key.toLowerCase();
      if (comparison.includes(lower) || lower.includes(comparison)) {
        match = rates;
        break;
      }
    }
  }

  tieredMatches.set(modelName, match);
  return match;
}

function tieredCost(
  tokens: number,
  basePrice: number | null,
  abovePrice: number | null
): number {
  if (tokens <= 0) return 0;
  if (tokens > TIER_THRESHOLD && abovePrice !== null) {
    let cost = (tokens - TIER_THRESHOLD) * abovePrice;
    if (basePrice !== null) cost += TIER_THRESHOLD * basePrice;
    return cost;
  }
  return basePrice !== null ? tokens * basePrice : 0;
}

/**
 * Cost of one Claude Code API response, in USD, priced exactly as ccusage
 * prices it: per-token LiteLLM rates, the above-200k rate on the part of
 * each token type over 200k, and 0 for a model LiteLLM has no entry for.
 *
 * Returns null when the tiered table isn't loaded (offline with no cache),
 * so the caller can fall back to the static table.
 */
export function calculateTieredCost(
  modelName: string,
  tokens: {
    input: number;
    output: number;
    cacheCreation: number;
    cacheRead: number;
  }
): number | null {
  if (!tieredTable) return null;
  if (modelName === "") return 0;
  const rates = matchTieredRates(tieredTable, modelName);
  if (rates === null) return 0;
  // Summed in ccusage's order, so totals match to the last bit.
  return (
    tieredCost(tokens.input, rates[0], rates[4]) +
    tieredCost(tokens.output, rates[1], rates[5]) +
    tieredCost(tokens.cacheCreation, rates[2], rates[6]) +
    tieredCost(tokens.cacheRead, rates[3], rates[7])
  );
}

/** Test hooks — inject or clear the in-memory tables without network/disk. */
export function _setLiveTableForTests(
  models: Record<string, ModelPricing> | null
): void {
  liveTable = models ? new Map(Object.entries(models)) : null;
}

export function _setTieredTableForTests(
  raw: Record<string, unknown> | null
): void {
  setTieredTable(raw ? buildTieredRows(raw) : null);
}
