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
 *   node scripts/backfill-cached-tokens.mjs                            # dry run
 *   node scripts/backfill-cached-tokens.mjs --execute --cutoff <ISO>   # apply
 *   node scripts/backfill-cached-tokens.mjs --execute --cutoff <ISO> --refresh-mv
 *
 * --cutoff is REQUIRED with --execute: pass the timestamp at which the fixed
 * server (the /api/sync version guard) went live. Only rows last synced before
 * the cutoff are considered — anything written after it came from a fixed CLI
 * and is already correct. Without this, a later run could "correct" genuinely
 * uncorrected-LOOKING but correct new rows (a low-cache day from a fixed CLI
 * has the same value shape as an uncorrected row).
 *
 * DATABASE_URL is read from the environment, falling back to .env.local.
 *
 * Safety — idempotent via a ledger, not value shapes: corrected row ids are
 * recorded in backfill_cached_tokens_ledger and never touched again, so
 * re-runs and crash-resumes are safe. Value-shape invariants (cache_read <=
 * input on the row and every breakdown element) are kept as an additional
 * refuse-to-touch gate, but they are not the idempotency mechanism: a
 * corrected row with a low cache ratio keeps the same shape, which is why the
 * ledger exists.
 */

import { readFileSync, existsSync } from "node:fs";

const AFFECTED_SOURCES = ["codex", "gemini-cli", "copilot-cli", "antigravity"];
const EXECUTE = process.argv.includes("--execute");
const REFRESH_MV = process.argv.includes("--refresh-mv");

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const cutoffArg = argValue("--cutoff");
if (EXECUTE && !cutoffArg) {
  console.error(
    "--cutoff <ISO timestamp> is required with --execute (the moment the fixed sync guard deployed)."
  );
  process.exit(1);
}
const CUTOFF = cutoffArg ?? new Date().toISOString();
if (Number.isNaN(Date.parse(CUTOFF))) {
  console.error(`Invalid --cutoff timestamp: ${CUTOFF}`);
  process.exit(1);
}

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
    newCostTotal += cost;
    return { ...mb, inputTokens: input, cost: Math.round(cost * 10000) / 10000 };
  });
  return {
    // Row-level identity, not the breakdown sum: GREATEST-merged rows can
    // carry a gap between the row columns and the breakdowns (5 rows in
    // production, up to ~75M tokens). input - cacheRead is exact either way.
    inputTokens: Math.max(0, Number(row.input_tokens) - Number(row.cache_read_tokens)),
    totalCost: Math.round(newCostTotal * 10000) / 10000,
    breakdowns: newBreakdowns,
  };
}

// ── Main
console.log(`Cutoff: only rows last synced before ${CUTOFF} are considered.`);

// Ledger: the idempotency mechanism. Ids recorded here are never re-corrected.
await query(`
  CREATE TABLE IF NOT EXISTS backfill_cached_tokens_ledger (
    id text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

let grandBefore = 0;
let grandAfter = 0;

for (const source of AFFECTED_SOURCES) {
  const rows = await query(
    `SELECT da.id, da.input_tokens, da.output_tokens, da.cache_creation_tokens,
            da.cache_read_tokens, da.total_cost, da.model_breakdowns
     FROM daily_aggregates da
     LEFT JOIN backfill_cached_tokens_ledger l ON l.id = da.id
     WHERE da.source = $1
       AND l.id IS NULL
       AND da.synced_at < $2
       AND da.cache_read_tokens > 0
       AND da.cache_read_tokens <= da.input_tokens`,
    [source, CUTOFF]
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
      await query(
        `INSERT INTO backfill_cached_tokens_ledger (id) VALUES ($1)
         ON CONFLICT (id) DO NOTHING`,
        [row.id]
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
