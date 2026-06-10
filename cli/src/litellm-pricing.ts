import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ModelPricing } from "./pricing.js";

/**
 * Live model pricing from LiteLLM's community-maintained pricing file.
 *
 * The static table in pricing.ts goes stale the day a new model launches;
 * LiteLLM's model_prices_and_context_window.json is updated within hours of
 * provider announcements (it's also what ccusage uses to price Claude Code
 * usage, so this keeps all sources consistent). We fetch it at most once per
 * 24h, cache it on disk, and fall back to the static table when offline.
 *
 * Lookup is exact-match only (raw ID and date/bracket-suffix-stripped ID) —
 * no fuzzy matching, so a miss here falls through to the static table's
 * prefix logic rather than risking a wrong-model price.
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

interface CacheFile {
  fetchedAt: string;
  models: Record<string, ModelPricing>;
  /** Set when the last fetch attempt failed; cleared by a successful fetch. */
  failedAt?: string;
}

let liveTable: Map<string, ModelPricing> | null = null;

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

async function readCache(): Promise<CacheFile | null> {
  try {
    const parsed = JSON.parse(await readFile(getCachePath(), "utf8"));
    if (typeof parsed?.fetchedAt !== "string") return null;
    if (typeof parsed?.models !== "object" || parsed.models === null) return null;
    return parsed as CacheFile;
  } catch {
    return null;
  }
}

async function writeCache(models: Map<string, ModelPricing>): Promise<void> {
  try {
    const cachePath = getCachePath();
    await mkdir(join(cachePath, ".."), { recursive: true });
    const file: CacheFile = {
      fetchedAt: new Date().toISOString(),
      models: Object.fromEntries(models),
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
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < CACHE_TTL_MS) {
    liveTable = new Map(Object.entries(cached.models));
    return;
  }

  // A recent failure is on record: skip the fetch (and its timeout) until
  // the backoff elapses, using whatever stale data we have.
  if (
    cached?.failedAt &&
    Date.now() - Date.parse(cached.failedAt) < FAILURE_BACKOFF_MS
  ) {
    liveTable = new Map(Object.entries(cached.models));
    return;
  }

  try {
    const response = await fetch(LITELLM_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const table = buildTable((await response.json()) as Record<string, unknown>);
    if (table.size < MIN_ENTRIES) throw new Error(`only ${table.size} entries`);
    liveTable = table;
    await writeCache(table);
  } catch {
    // Offline or upstream broken: a stale cache still beats the static
    // table, and recording the failure lets the next run skip the timeout.
    if (cached) liveTable = new Map(Object.entries(cached.models));
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

/** Test hooks — inject or clear the in-memory table without network/disk. */
export function _setLiveTableForTests(
  models: Record<string, ModelPricing> | null
): void {
  liveTable = models ? new Map(Object.entries(models)) : null;
}
