/**
 * Cursor server-side usage data extraction (post-Sep 2025).
 *
 * Cursor changed its storage architecture around mid-September 2025. Composers
 * created after that point no longer have local `bubbleId:*` rows with token
 * counts -- the conversation content (and per-bubble token counts) live on
 * Cursor's servers. The local SQLite extractor in `cursor.ts` therefore
 * returns nothing for that period.
 *
 * This module fills the gap by calling Cursor's own dashboard API to fetch
 * per-day, per-model usage aggregates. It uses the user's existing Cursor
 * authentication -- no separate login flow.
 *
 * AUTH DISCOVERY: Cursor caches authenticated HTTP responses in its Chromium
 * disk cache. One of those cached responses contains the long-lived auth JWT
 * (issuer https://authentication.cursor.sh, scope `openid profile email
 * offline_access`, no `type: session` claim). The on-disk layout depends on
 * which Chromium cache backend Cursor was built against:
 *
 *   - Windows builds tend to use the older "blockfile" backend, where the
 *     JWT lives inside a single `Cache_Data/data_1` blob.
 *   - macOS / modern Linux builds use the "simple" backend, where the JWT
 *     lives inside one of the per-entry files in `Cache_Data/<hash>_0`.
 *
 * We handle both: the resolver returns the `Cache_Data` directory itself,
 * and the scanner reads either the single file or every file in the
 * directory and runs the same JWT regex over the bytes. Once we have a
 * candidate set we decode each payload, prefer the long-lived offline_access
 * token, decode the user_id from its `sub` claim, and use both as a
 * `WorkosCursorSessionToken` cookie when calling the API.
 *
 * The auth and user_id are read from disk at runtime -- nothing user-specific
 * is encoded in this source file.
 *
 * API: POST https://cursor.com/api/dashboard/get-aggregated-usage-events
 *      body: { startDate, endDate, page, pageSize, teamId } (epoch ms)
 *      returns: { aggregations: [{ modelIntent, inputTokens, outputTokens,
 *                cacheWriteTokens, cacheReadTokens, totalCents, tier }],
 *                totalInputTokens, totalOutputTokens, totalCostCents, ... }
 *
 * STRATEGY: Iterate one UTC day at a time over the requested range so we get
 * per-day per-model aggregates (the API returns whole-range aggregations when
 * called with a multi-day window). Days where the API returns no aggregations
 * (or aggregations with all zeros -- model presence on the free plan) are
 * skipped.
 *
 * PRIVACY: This module reads only the auth JWT (used to call the API) and
 * the API's aggregated response. No prompts, code, file paths, project names,
 * or session IDs are read or transmitted. All data leaves through the same
 * Zod allowlist used by every other extractor.
 *
 * Requires Node 18+ (uses global `fetch`).
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { accumulate, accumulatorToSyncDays, type DayAccumulator } from "./accumulator.js";
import type { SyncDay } from "./schemas.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_URL = "https://cursor.com/api/dashboard/get-aggregated-usage-events";
const ORIGIN = "https://cursor.com";
const REFERER = "https://cursor.com/dashboard";

/** Default lookback when --since isn't passed (covers ~12 months of usage). */
const DEFAULT_LOOKBACK_DAYS = 365;

/**
 * Comma-separated list of YYYY-MM-DD dates to skip entirely. Set via env var
 * `CURSOR_API_SKIP_DATES`. Useful when the local-DB extractor (cursor.ts) has
 * higher-quality cost data for specific dates than the dashboard API does --
 * common during the pre-Sep-2025 free-plan period, where the API reports
 * `totalCents: 0` for billable events that the local DB recorded with real
 * cost data via `composerData.usageData.costInCents`. Skipping those days
 * here prevents the API extractor from overwriting better data on the
 * server's per-(user,date,source,machine) upsert key.
 */
function getApiSkipDates(): Set<string> {
  const raw = process.env.CURSOR_API_SKIP_DATES;
  if (!raw) return new Set();
  const out = new Set<string>();
  for (const piece of raw.split(",")) {
    const d = piece.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) out.add(d);
  }
  return out;
}

/** Polite per-call delay so we don't hammer the API. */
const PER_DAY_DELAY_MS = 50;

/** How long to wait for a single HTTP response before bailing. */
const REQUEST_TIMEOUT_MS = 30_000;

/** Max retries for transient errors (429 / 5xx). */
const MAX_RETRIES = 2;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/**
 * OS-aware path to Cursor's Chromium HTTP cache. Returns the `Cache_Data`
 * directory itself; the layout *inside* it depends on which Chromium cache
 * backend Cursor was built against:
 *
 *  - **Blockfile cache** (Windows builds we've seen): a single `data_1` blob
 *    file alongside `index`, `data_0`, etc. The auth JWT ends up inline in
 *    `data_1` as a side-effect of authenticated requests.
 *  - **Simple cache** (macOS, modern Linux): one binary file per cached
 *    response, named like `<hash>_0`, plus an `index` file. The JWT lives
 *    inside whichever per-entry file held the last authenticated response.
 *
 * `findCursorAuth()` handles both layouts: if the resolved path is a regular
 * file it's read directly (blockfile / explicit-file override); if it's a
 * directory every entry is scanned (simple cache). The same JWT regex applies
 * to both because we only care about the bytes, not the cache schema.
 *
 * Override via the `CURSOR_CACHE_DATA` env var. The override may point at a
 * directory (treated as a simple-cache root) OR at a single file (treated as
 * a blockfile-style blob, useful for tests and for users who know exactly
 * which entry holds the JWT).
 */
function getCursorCacheRoot(): string {
  if (process.env.CURSOR_CACHE_DATA) return process.env.CURSOR_CACHE_DATA;

  const platform = process.platform;
  if (platform === "darwin") {
    return join(
      homedir(),
      "Library",
      "Application Support",
      "Cursor",
      "Cache",
      "Cache_Data"
    );
  }
  if (platform === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "Cursor", "Cache", "Cache_Data");
  }
  // Linux and others
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(xdgConfig, "Cursor", "Cache", "Cache_Data");
}

/**
 * JWT shape: three base64url segments separated by dots, with the first two
 * (header + payload) starting with "eyJ" once base64url-encoded.
 *
 * Defined as a module-level constant because multiple call sites use it
 * (`findCursorAuth`, plus tests via the same module surface).
 */
const JWT_REGEX = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

/**
 * Read every cache entry under `root` and yield candidate JWTs.
 *
 * Accepts either a single file (blockfile cache or test fixture) or a
 * directory of per-entry files (simple cache). Errors on individual file
 * reads are swallowed so a single locked / mid-write entry doesn't break
 * extraction. The literal `index` file inside a simple cache is skipped --
 * it's a metadata index, not a response payload, and contains no JWTs.
 *
 * Returns the deduplicated list of token strings; the caller is responsible
 * for decoding and selecting the right one.
 */
function scanCacheForJwts(root: string): string[] {
  let stat;
  try {
    stat = statSync(root);
  } catch {
    return [];
  }

  const tokens = new Set<string>();
  const collect = (buf: Buffer): void => {
    // latin1 maps every byte 1:1 to a char so the regex never chokes on
    // invalid UTF-8 inside the binary cache payload.
    const text = buf.toString("latin1");
    let m: RegExpExecArray | null;
    const re = new RegExp(JWT_REGEX.source, "g");
    while ((m = re.exec(text)) !== null) tokens.add(m[0]);
  };

  if (stat.isFile()) {
    try {
      collect(readFileSync(root));
    } catch {
      /* unreadable -- nothing to do */
    }
    return [...tokens];
  }

  if (stat.isDirectory()) {
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      return [];
    }
    for (const entry of entries) {
      if (entry === "index") continue; // simple-cache metadata; never has JWTs
      const p = join(root, entry);
      try {
        const s = statSync(p);
        if (!s.isFile()) continue;
        collect(readFileSync(p));
      } catch {
        /* mid-write / permission denied / vanished -- skip */
      }
    }
  }

  return [...tokens];
}

// ---------------------------------------------------------------------------
// JWT decoding & auth selection
// ---------------------------------------------------------------------------

interface AuthCreds {
  /** The JWT to send as the cookie value. */
  token: string;
  /** The user_id (the suffix of `sub` after `<provider>|`) needed for the cookie. */
  userId: string;
}

/**
 * Decode a JWT payload (claims). We only read claims to identify the right
 * token -- we do NOT validate the signature (the server does that).
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const padded = parts[1] + "=".repeat((4 - (parts[1].length % 4)) % 4);
    // Convert base64url -> base64
    const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(base64, "base64").toString("utf-8");
    const obj: unknown = JSON.parse(json);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      return obj as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Find Cursor's long-lived auth credentials by scanning the disk cache for
 * JWTs (across both Chromium cache backends -- see `getCursorCacheRoot`)
 * and picking the one issued by Cursor with the longest expiry that lacks a
 * `type: session` claim.
 *
 * Returns null when the cache is missing, or no valid Cursor JWT is present
 * (e.g., user has never signed in, or the cache was wiped).
 */
function findCursorAuth(): AuthCreds | null {
  const root = getCursorCacheRoot();
  if (!existsSync(root)) return null;

  const tokens = scanCacheForJwts(root);
  if (tokens.length === 0) return null;

  type Candidate = { token: string; payload: Record<string, unknown> };
  const candidates: Candidate[] = [];

  for (const tok of tokens) {
    const payload = decodeJwtPayload(tok);
    if (!payload) continue;

    const iss = String(payload.iss ?? "");
    if (!iss.endsWith("cursor.sh")) continue;

    candidates.push({ token: tok, payload });
  }

  // Prefer tokens without "type": "session" (long-lived offline_access).
  // Among those, pick the one with the largest exp.
  let best: Candidate | null = null;
  for (const c of candidates) {
    if (c.payload.type === "session") continue;
    const exp = Number(c.payload.exp ?? 0);
    if (!best || exp > Number(best.payload.exp ?? 0)) best = c;
  }
  // Fallback: if no long-lived token, pick the still-valid session token
  // with the latest expiry (less ideal but better than nothing).
  if (!best) {
    const nowSec = Math.floor(Date.now() / 1000);
    for (const c of candidates) {
      const exp = Number(c.payload.exp ?? 0);
      if (exp <= nowSec) continue;
      if (!best || exp > Number(best.payload.exp ?? 0)) best = c;
    }
  }
  if (!best) return null;

  // Cursor's `sub` claim is `<provider>|<userId>`. Providers seen in the wild:
  // auth0 (email/password), google-oauth2 (Sign in with Google), github
  // (Sign in with GitHub), apple (Sign in with Apple). The cookie format only
  // needs the suffix, so we strip whatever comes before the first pipe.
  const sub = String(best.payload.sub ?? "");
  const pipeIdx = sub.indexOf("|");
  if (pipeIdx < 0 || pipeIdx === sub.length - 1) return null;
  const userId = sub.slice(pipeIdx + 1);

  return { token: best.token, userId };
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

interface ApiAggregation {
  modelIntent?: string;
  inputTokens?: string | number;
  outputTokens?: string | number;
  cacheWriteTokens?: string | number;
  cacheReadTokens?: string | number;
  totalCents?: number;
  tier?: number;
}

interface ApiResponse {
  aggregations?: ApiAggregation[];
}

async function fetchDayAggregations(
  startMs: number,
  endMs: number,
  auth: AuthCreds
): Promise<ApiResponse> {
  const cookieValue = encodeURIComponent(`${auth.userId}::${auth.token}`);
  const body = JSON.stringify({
    startDate: startMs,
    endDate: endMs,
    page: 1,
    pageSize: 100,
    teamId: 0,
  });

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "User-Agent": "clawdboard-cli (+https://clawdboard.ai)",
          "Accept": "application/json",
          "Content-Type": "application/json",
          "Origin": ORIGIN,
          "Referer": REFERER,
          "Cookie": `WorkosCursorSessionToken=${cookieValue}`,
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);

      // Retry only on transient errors
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status}`);
        await sleep(500 * Math.pow(2, attempt));
        continue;
      }
      if (!res.ok) {
        // Non-transient (auth, etc.) -- swallow body to avoid leaking it.
        await res.text().catch(() => "");
        throw new Error(`Cursor API returned HTTP ${res.status}`);
      }
      return (await res.json()) as ApiResponse;
    } catch (e) {
      clearTimeout(timer);
      lastError = e;
      // AbortError or network failure -- retry with backoff
      if (attempt < MAX_RETRIES) {
        await sleep(500 * Math.pow(2, attempt));
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Cursor API request failed");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Quick check used by the orchestrator's "no data" guard: do we have what we
 * need to call the Cursor dashboard API?
 */
export function hasCursorApiAuth(): boolean {
  return findCursorAuth() !== null;
}

/**
 * Iterate one UTC day at a time over [since, today], call the Cursor dashboard
 * API for each, and aggregate model usage into SyncDay[].
 *
 * Returns [] when:
 *   - no Cursor auth JWT is on disk (user not signed in / Cursor never used)
 *   - the API returns no usage in the requested range
 *   - the API call fails persistently (errors are swallowed -- the caller's
 *     other extractors should still produce data)
 *
 * @param since - YYYY-MM-DD inclusive. Default: today minus DEFAULT_LOOKBACK_DAYS.
 */
export async function extractCursorApiData(since?: string): Promise<SyncDay[]> {
  const auth = findCursorAuth();
  if (!auth) return [];

  const today = new Date();
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  );

  let startUtc: number;
  if (since) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(since);
    if (!m) return []; // invalid since -- silently skip
    startUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  } else {
    startUtc = todayUtc - DEFAULT_LOOKBACK_DAYS * 86_400_000;
  }
  if (startUtc > todayUtc) return [];

  const skipDates = getApiSkipDates();
  const byDate: Record<string, DayAccumulator> = {};

  for (let dayStartMs = startUtc; dayStartMs <= todayUtc; dayStartMs += 86_400_000) {
    const dayEndMs = dayStartMs + 86_400_000;
    const dateStr = new Date(dayStartMs).toISOString().slice(0, 10);

    if (skipDates.has(dateStr)) continue;

    let resp: ApiResponse;
    try {
      resp = await fetchDayAggregations(dayStartMs, dayEndMs, auth);
    } catch {
      // Persistent failure on this day -- skip, keep going. The other extractors
      // and other days are unaffected.
      await sleep(PER_DAY_DELAY_MS);
      continue;
    }

    const aggs = resp.aggregations ?? [];
    for (const a of aggs) {
      const modelName = a.modelIntent ?? "unknown";
      const input = toIntNonNeg(a.inputTokens);
      const output = toIntNonNeg(a.outputTokens);
      const cacheCreation = toIntNonNeg(a.cacheWriteTokens);
      const cacheRead = toIntNonNeg(a.cacheReadTokens);
      const cents = Number(a.totalCents ?? 0) || 0;

      // Skip "model presence" rows that have zero everywhere -- Cursor returns
      // these for free-plan periods where the model was used but no billable
      // event was recorded. The local SQLite extractor (cursor.ts) covers
      // those days more accurately when applicable.
      if (input === 0 && output === 0 && cacheCreation === 0 && cacheRead === 0 && cents === 0) {
        continue;
      }

      accumulate(byDate, dateStr, modelName, {
        input,
        output,
        cacheCreation,
        cacheRead,
        cost: cents / 100,
      });
    }

    if (PER_DAY_DELAY_MS > 0) await sleep(PER_DAY_DELAY_MS);
  }

  return accumulatorToSyncDays(byDate, "cursor");
}

function toIntNonNeg(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}
