/**
 * Backfill: correct the cached-token double count for OpenAI/Gemini-family sources.
 *
 * CLI versions before 0.3.5 treated cached tokens with Anthropic semantics for
 * every provider. OpenAI, Gemini, and Copilot report cached tokens as a SUBSET
 * of input_tokens, so the cached portion was counted twice in token totals and
 * billed twice in cost (once at the full input rate inside `input`, once at the
 * cache-read rate). This script rewrites historical rows for the affected
 * sources: per model breakdown, inputTokens becomes the uncached remainder and
 * cost is recomputed from the corrected components at current rates.
 *
 * Prerequisite: the CLI package must be built (pricing tables are reused from it):
 *   cd cli && npm install && npm run build
 *
 * Usage:
 *   node scripts/backfill-cached-tokens.mjs            # dry run (default)
 *   node scripts/backfill-cached-tokens.mjs --execute  # apply changes
 *   node scripts/backfill-cached-tokens.mjs --execute --refresh-mv
 *
 * DATABASE_URL is read from the environment, falling back to .env.local.
 *
 * Safety: idempotent by construction. Rows are only touched while they satisfy
 * the pre-fix invariant (cache_read_tokens <= input_tokens on the row AND on
 * every breakdown element); corrected rows no longer match and are skipped. A
 * source-level ratio gate refuses to run against data that already looks
 * corrected.
 */

import { readFileSync, existsSync } from "node:fs";

const AFFECTED_SOURCES = ["codex", "gemini-cli", "copilot-cli", "antigravity"];
const EXECUTE = process.argv.includes("--execute");
const REFRESH_MV = process.argv.includes("--refresh-mv");

// ── Pricing (reuse the CLI's exact resolution: litellm live → static → default)
let getModelPricing, loadLivePricing;
try {
  ({ getModelPricing } = await import(new URL("../cli/dist/pricing.js", import.meta.url)));
  ({ loadLivePricing } = await import(new URL("../cli/dist/litellm-pricing.js", import.meta.url)));
} catch (e) {
  console.error("Could not import CLI pricing. Build it first: cd cli && npm install && npm run build");
  console.error(String(e));
  process.exit(1);
}
await loadLivePricing();

// ── Database connection (same driver split as src/lib/db)
function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = new URL("../.env.local", import.meta.url);
  if (existsSync(envPath)) {
    const line = readFileSync(envPath, "utf8")
      .split("\n")
      .find((l) => l.startsWith("DATABASE_URL="));
    if (line) return line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
  }
  console.error("DATABASE_URL not set and not found in .env.local");
  process.exit(1);
}

const dbUrl = resolveDatabaseUrl();
let query; // (text, params) => Promise<rows>
if (dbUrl.includes("neon.tech")) {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(dbUrl);
  query = (text, params = []) => sql.query(text, params);
} else {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  query = async (text, params = []) => (await client.query(text, params)).rows;
  process.on("beforeExit", () => client.end());
}

// ── Correction
function correctRow(row) {
  const breakdowns = row.model_breakdowns ?? [];
  let newInputTotal = 0;
  let newCostTotal = 0;
  const newBreakdowns = breakdowns.map((mb) => {
    const cacheRead = Number(mb.cacheReadTokens) || 0;
    const cacheCreation = Number(mb.cacheCreationTokens) || 0;
    const output = Number(mb.outputTokens) || 0;
    const input = Math.max(0, (Number(mb.inputTokens) || 0) - cacheRead);
    const p = getModelPricing(mb.modelName ?? "unknown");
    const cost =
      (input * p.input) / 1e6 +
      (output * p.output) / 1e6 +
      (cacheCreation * p.cacheWrite) / 1e6 +
      (cacheRead * p.cacheRead) / 1e6;
    newInputTotal += input;
    newCostTotal += cost;
    return { ...mb, inputTokens: input, cost: Math.round(cost * 10000) / 10000 };
  });
  return {
    inputTokens: newInputTotal,
    totalCost: Math.round(newCostTotal * 10000) / 10000,
    breakdowns: newBreakdowns,
  };
}

// ── Main
let grandBefore = 0;
let grandAfter = 0;

for (const source of AFFECTED_SOURCES) {
  const rows = await query(
    `SELECT id, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
            total_cost, model_breakdowns
     FROM daily_aggregates
     WHERE source = $1
       AND cache_read_tokens > 0
       AND cache_read_tokens <= input_tokens`,
    [source]
  );

  if (rows.length === 0) {
    console.log(`${source}: no uncorrected rows (0 matching pre-fix invariant) — skipping`);
    continue;
  }

  // Source-level gate: uncorrected data has cache/input <= 1 on every row by the
  // WHERE clause; additionally require the aggregate ratio to look pre-fix.
  const totIn = rows.reduce((s, r) => s + Number(r.input_tokens), 0);
  const totCr = rows.reduce((s, r) => s + Number(r.cache_read_tokens), 0);
  const ratio = totCr / Math.max(1, totIn);
  if (ratio > 1) {
    console.log(`${source}: aggregate cache/input ratio ${ratio.toFixed(2)} > 1 looks corrected — skipping`);
    continue;
  }

  let before = 0;
  let after = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const breakdowns = row.model_breakdowns ?? [];
    // Element-level invariant: every breakdown must still be in pre-fix shape.
    const preFix = breakdowns.length > 0 && breakdowns.every(
      (mb) => (Number(mb.cacheReadTokens) || 0) <= (Number(mb.inputTokens) || 0)
    );
    if (!preFix) {
      skipped++;
      continue;
    }

    const fix = correctRow(row);
    before += Number(row.total_cost);
    after += fix.totalCost;

    if (EXECUTE) {
      await query(
        `UPDATE daily_aggregates
         SET input_tokens = $2, total_cost = $3, model_breakdowns = $4::jsonb
         WHERE id = $1 AND cache_read_tokens <= input_tokens`,
        [row.id, fix.inputTokens, fix.totalCost.toFixed(4), JSON.stringify(fix.breakdowns)]
      );
    }
    updated++;
  }

  grandBefore += before;
  grandAfter += after;
  console.log(
    `${source}: ${updated} rows ${EXECUTE ? "corrected" : "would be corrected"}` +
      `${skipped ? `, ${skipped} skipped (element invariant)` : ""} — ` +
      `cost $${Math.round(before).toLocaleString()} → $${Math.round(after).toLocaleString()}`
  );
}

console.log(
  `\nTOTAL: $${Math.round(grandBefore).toLocaleString()} → $${Math.round(grandAfter).toLocaleString()}` +
    (EXECUTE ? "" : "   (dry run — pass --execute to apply)")
);

if (EXECUTE && REFRESH_MV) {
  console.log("Refreshing leaderboard_mv...");
  await query(`REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_mv`);
  console.log("Done.");
}
process.exit(0);
