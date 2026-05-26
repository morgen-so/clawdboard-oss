#!/usr/bin/env node

/**
 * Weekly pricing drift checker.
 *
 * Fetches a pinned commit of BerriAI/litellm's model_prices_and_context_window.json
 * — the de-facto community pricing source for LLM models — and compares it
 * against cli/src/pricing.ts. Differences are written to the file in-place
 * so the GitHub Action can commit and open a PR.
 *
 * Models in our table that aren't covered by litellm (OpenCode-Zen tier,
 * gpt-oss, certain Gemini 3.x preview rates) are reported as "skipped —
 * manual review" and included in the PR body's verification checklist, but
 * do not fail the run.
 *
 * Why litellm: provider pricing pages are not a stable contract. The
 * previous Playwright-based scraper had been silently failing for both
 * OpenAI and Google since at least 2026-04-20. litellm is updated within
 * hours of provider price changes and used in production by tools like
 * Aider, Continue.dev, Helicone, OpenRouter.
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRICING_FILE = resolve(__dirname, "../cli/src/pricing.ts");

// Pinned litellm commit. Bump quarterly during PR review. The auto-PR
// body includes a checklist item reminding reviewers to consider bumping.
const LITELLM_SHA = "06f6cfc5ae377edc9b6067475f2402fa34161e60";
const LITELLM_URL = `https://raw.githubusercontent.com/BerriAI/litellm/${LITELLM_SHA}/model_prices_and_context_window.json`;

// Models that legitimately aren't in litellm and stay hand-maintained.
// Listed here so the script reports them honestly instead of silently
// skipping. Matches the keys exactly as they appear in cli/src/pricing.ts.
const MANUALLY_MAINTAINED = new Set([
  // OpenCode-Zen tier curated open-source models
  "glm-5.1",
  "mimo-v2.5-pro",
  "deepseek-v4-pro",
  "kimi-k2.6",
  "qwen3",
  "minimax",
  // OpenAI gpt-oss (open-weight)
  "gpt-oss-120b",
  "gpt-oss-20b",
  // Retired/legacy provider models — litellm only carries the dated SKU
  // (e.g. claude-3-5-sonnet-20241022) under provider-prefixed namespaces.
  // Rates are frozen post-retirement; hand-maintained is fine.
  "claude-3-5-sonnet",
  "claude-3-5-haiku",
  "claude-3-sonnet",
  "o1-mini",
  // Gemini 3.x — currently flagged "VERIFY" in pricing.ts (rates not public).
  // litellm has "gemini-3-pro-preview" / "gemini-3-flash-preview" but our
  // table uses bare keys; treat as manual until Google publishes rates.
  "gemini-3-pro",
  "gemini-3-flash",
]);

// Sanity threshold: litellm's full pricing file has hundreds of entries.
// If we get back fewer than this, we probably hit an HTML error page or a
// stale empty file. Loud failure instead of silent partial verification.
const LITELLM_MIN_ENTRIES = 100;

// ---------------------------------------------------------------------------
// Parse current pricing table from TypeScript source
// ---------------------------------------------------------------------------

function parsePricingTable(source) {
  const entries = {};
  const re =
    /"([^"]+)":\s*\{\s*input:\s*([\d.]+),\s*output:\s*([\d.]+),\s*cacheWrite:\s*([\d.]+),\s*cacheRead:\s*([\d.]+)\s*\}/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    entries[m[1]] = {
      input: parseFloat(m[2]),
      output: parseFloat(m[3]),
      cacheWrite: parseFloat(m[4]),
      cacheRead: parseFloat(m[5]),
    };
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Fetch litellm pricing JSON
// ---------------------------------------------------------------------------

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "clawdboard-pricing-checker/2.0",
        Accept: "application/json",
      },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Convert a litellm entry (cost-per-token) into our pricing-table format
 * (cost per 1M tokens). Returns null if input/output are missing — we
 * don't want to overwrite a real rate with a partial entry.
 */
function litellmToTable(entry) {
  if (
    entry == null ||
    typeof entry.input_cost_per_token !== "number" ||
    typeof entry.output_cost_per_token !== "number"
  ) {
    return null;
  }
  // Round to 6 decimal places to avoid floating-point noise like
  // 0.024999999999999998 when converting cost-per-token to per-1M.
  const toPer1M = (v) => Math.round((v ?? 0) * 1_000_000 * 1e6) / 1e6;
  return {
    input: toPer1M(entry.input_cost_per_token),
    output: toPer1M(entry.output_cost_per_token),
    cacheWrite: toPer1M(entry.cache_creation_input_token_cost),
    cacheRead: toPer1M(entry.cache_read_input_token_cost),
  };
}

/**
 * Find the litellm entry for one of our table keys. We prefer the bare
 * key (e.g. "claude-opus-4-6") but fall back to a date-suffixed variant
 * (e.g. "claude-opus-4-6-20260205") if the bare key isn't present.
 */
function findLitellmEntry(litellm, key) {
  if (litellm[key]) return litellm[key];

  // Match dated variants: <key>-YYYY-MM-DD or <key>-YYYYMMDD
  const datedRe = new RegExp(
    `^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d{4}-?\\d{2}-?\\d{2}$`
  );
  const candidates = Object.keys(litellm).filter((k) => datedRe.test(k));
  if (candidates.length === 0) return null;
  // Sort lexicographically; latest date wins.
  candidates.sort();
  return litellm[candidates[candidates.length - 1]];
}

async function fetchLitellmPricing(tableKeys) {
  const json = await fetchJson(LITELLM_URL);
  if (typeof json !== "object" || json === null) {
    throw new Error("litellm response is not a JSON object");
  }
  const totalKeys = Object.keys(json).length;
  if (totalKeys < LITELLM_MIN_ENTRIES) {
    throw new Error(
      `litellm JSON has only ${totalKeys} entries (< ${LITELLM_MIN_ENTRIES}); refusing to trust it`
    );
  }

  const prices = {};
  for (const key of tableKeys) {
    if (MANUALLY_MAINTAINED.has(key)) continue;
    const entry = findLitellmEntry(json, key);
    if (!entry) continue;
    const converted = litellmToTable(entry);
    if (converted) prices[key] = converted;
  }
  return { prices, totalKeys };
}

// ---------------------------------------------------------------------------
// Comparison and update
// ---------------------------------------------------------------------------

function comparePricing(current, fetched) {
  const diffs = [];

  for (const [model, fetchedPrices] of Object.entries(fetched)) {
    const currentPrices = current[model];
    if (!currentPrices) {
      diffs.push({ model, type: "new_model", fetched: fetchedPrices });
      continue;
    }

    for (const field of ["input", "output", "cacheWrite", "cacheRead"]) {
      if (
        fetchedPrices[field] !== undefined &&
        Math.abs(fetchedPrices[field] - currentPrices[field]) > 0.001
      ) {
        diffs.push({
          model,
          field,
          current: currentPrices[field],
          fetched: fetchedPrices[field],
        });
      }
    }
  }

  return diffs;
}

function updatePricingFile(source, diffs) {
  let updated = source;

  for (const diff of diffs) {
    if (diff.type === "new_model") continue;

    const { model, field, fetched } = diff;
    const modelEscaped = model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const entryRe = new RegExp(
      `("${modelEscaped}":\\s*\\{[^}]*?)${field}:\\s*[\\d.]+`,
      "s"
    );
    updated = updated.replace(entryRe, `$1${field}: ${fetched}`);
  }

  // Update the "Last verified" date
  const today = new Date().toISOString().slice(0, 10);
  updated = updated.replace(
    /Last verified: \d{4}-\d{2}-\d{2}/,
    `Last verified: ${today}`
  );

  return updated;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const source = readFileSync(PRICING_FILE, "utf-8");
  const current = parsePricingTable(source);
  const tableKeys = Object.keys(current);
  const tableSize = tableKeys.length;

  console.log(`Loaded ${tableSize} models from pricing table.`);
  console.log(`Fetching litellm pricing @ ${LITELLM_SHA.slice(0, 7)}...`);

  let fetched, totalKeys;
  try {
    ({ prices: fetched, totalKeys } = await fetchLitellmPricing(tableKeys));
  } catch (err) {
    console.error(`\n❌ Failed to fetch litellm pricing: ${err.message}`);
    console.error(`   URL: ${LITELLM_URL}`);
    process.exit(1);
  }

  const verifiedKeys = Object.keys(fetched);
  const manualKeys = tableKeys.filter((k) => MANUALLY_MAINTAINED.has(k));
  const unknownKeys = tableKeys.filter(
    (k) => !MANUALLY_MAINTAINED.has(k) && !fetched[k]
  );

  console.log(`  litellm has ${totalKeys} total entries.`);
  console.log(
    `  ${verifiedKeys.length} auto-verified, ${manualKeys.length} manually maintained, ${unknownKeys.length} expected-but-missing.`
  );

  if (unknownKeys.length > 0) {
    console.log(
      `\n⚠️  ${unknownKeys.length} model(s) expected in litellm but not found:`
    );
    for (const k of unknownKeys) console.log(`    - ${k}`);
    console.log(
      `   They may have been renamed upstream, or our key doesn't match litellm's. Manual review needed.`
    );
  }

  const diffs = comparePricing(current, fetched);

  if (diffs.length === 0) {
    console.log(
      `\n✅ ${verifiedKeys.length}/${tableSize} prices match litellm. ${manualKeys.length} manually maintained.`
    );
  } else {
    console.log(`\n🔄 Found ${diffs.length} pricing difference(s):\n`);
    for (const diff of diffs) {
      if (diff.type === "new_model") {
        console.log(
          `  NEW: ${diff.model} — input: $${diff.fetched.input}, output: $${diff.fetched.output}`
        );
      } else {
        console.log(
          `  ${diff.model}.${diff.field}: $${diff.current} → $${diff.fetched}`
        );
      }
    }

    const fieldDiffs = diffs.filter((d) => d.type !== "new_model");
    if (fieldDiffs.length > 0) {
      const updated = updatePricingFile(source, fieldDiffs);
      writeFileSync(PRICING_FILE, updated);
      console.log("\n📝 Updated cli/src/pricing.ts with new prices.");
    }
  }

  // Machine-readable summary consumed by the GitHub Action to populate
  // the PR description with a manual-review checklist.
  const summary = {
    litellmSha: LITELLM_SHA,
    tableSize,
    verified: verifiedKeys.length,
    manual: manualKeys,
    unknown: unknownKeys,
    diffs: diffs.length,
  };
  console.log("\n=== PRICING_CHECK_SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log("=== END_PRICING_CHECK_SUMMARY ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
