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
const CACHE_FILE = "pricing-cache.json";

// Sanity floor: the litellm file has thousands of entries. A tiny result
// means we fetched an error page or a truncated body — don't trust it.
const MIN_ENTRIES = 200;

interface CacheFile {
  fetchedAt: string;
  models: Record<string, ModelPricing>;
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
    // Offline or upstream broken: a stale cache still beats the static table.
    if (cached) liveTable = new Map(Object.entries(cached.models));
  }
}

/**
 * Normalize a model ID for lookup:
 *   "claude-fable-5[1m]"          → "claude-fable-5"  (context-window marker)
 *   "claude-sonnet-4-20250514"    → "claude-sonnet-4" (date suffix)
 *   "gpt-4o-2024-08-06"           → "gpt-4o"
 */
function normalizeForLookup(modelId: string): string {
  return modelId
    .replace(/\[[^\]]*\]$/, "")
    .replace(/-\d{4}-?\d{2}-?\d{2}$/, "");
}

/** Exact-match lookup in the live table. Null when absent or not loaded. */
export function lookupLivePricing(modelId: string): ModelPricing | null {
  if (!liveTable) return null;
  return (
    liveTable.get(modelId) ?? liveTable.get(normalizeForLookup(modelId)) ?? null
  );
}

/** Test hooks — inject or clear the in-memory table without network/disk. */
export function _setLiveTableForTests(
  models: Record<string, ModelPricing> | null
): void {
  liveTable = models ? new Map(Object.entries(models)) : null;
}
