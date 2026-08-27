/**
 * Backfill: populate users.api_token_hash for tokens issued before the column
 * existed.
 *
 * API auth (src/lib/api-auth.ts) looks tokens up by SHA-256 hash only, so any
 * user with a plaintext api_token and a NULL api_token_hash gets a 401 until
 * this has run. Run it after `drizzle-kit push` adds the column and before the
 * hash-only auth code is deployed. Safe to re-run: it only touches rows whose
 * hash is still NULL.
 *
 * Usage:
 *   node scripts/backfill-api-token-hash.mjs             # dry run, prints count
 *   node scripts/backfill-api-token-hash.mjs --execute   # apply
 *
 * DATABASE_URL is read from the environment, falling back to .env.local.
 */

import { readFileSync, existsSync } from "node:fs";

const EXECUTE = process.argv.includes("--execute");

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

const [{ count }] = await query(
  `SELECT count(*)::int AS count FROM users
   WHERE api_token IS NOT NULL AND api_token_hash IS NULL`
);
console.log(`${count} user(s) with a token but no hash`);

if (!EXECUTE) {
  console.log("Dry run. Re-run with --execute to apply.");
  process.exit(0);
}

// Same digest as hashApiToken() in src/lib/api-auth.ts: SHA-256 over the
// token's UTF-8 bytes, hex-encoded.
const updated = await query(
  `UPDATE users
   SET api_token_hash = encode(sha256(convert_to(api_token, 'UTF8')), 'hex')
   WHERE api_token IS NOT NULL AND api_token_hash IS NULL
   RETURNING id`
);
console.log(`Backfilled ${updated.length} row(s)`);
process.exit(0);
