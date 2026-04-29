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
 * offline_access`, no `type: session` claim). We scan the cache file once,
 * extract the JWT, decode the user_id from its `sub` claim, and use both as
 * a `WorkosCursorSessionToken` cookie when calling the API.
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

import { existsSync, readFileSync } from "node:fs";
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
 * OS-aware path to Cursor's HTTP disk-cache file. The auth JWT lives somewhere
 * in this binary file as a side-effect of an authenticated update check.
 *
 * Override via CURSOR_CACHE_DATA env var (full path to the data_1 file).
 */
function getCursorCacheDataPath(): string {
  if (process.env.CURSOR_CACHE_DATA) return process.env.CURSOR_CACHE_DATA;

  const platform = process.platform;
  if (platform === "darwin") {
    return join(
      homedir(),
      "Library",
      "Application Support",
      "Cursor",
      "Cache",
      "Cache_Data",
      "data_1"
    );
  }
  if (platform === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "Cursor", "Cache", "Cache_Data", "data_1");
  }
  // Linux and others
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(xdgConfig, "Cursor", "Cache", "Cache_Data", "data_1");
}

// ---------------------------------------------------------------------------
// JWT scanning
// ---------------------------------------------------------------------------

interface AuthCreds {
  /** The JWT to send as the cookie value. */
  token: string;
  /** The user_id (without the "auth0|" prefix) needed for the cookie. */
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
 * Find Cursor's long-lived auth credentials by scanning the disk-cache file
 * for JWTs and picking the one issued by Cursor with the longest expiry that
 * lacks a `type: session` claim.
 *
 * Returns null when the cache is missing, or no valid Cursor JWT is present
 * (e.g., user has never signed in, or the cache was wiped).
 */
function findCursorAuth(): AuthCreds | null {
  const cachePath = getCursorCacheDataPath();
  if (!existsSync(cachePath)) return null;

  let buf: Buffer;
  try {
    buf = readFileSync(cachePath);
  } catch {
    return null;
  }

  // Treat the binary cache as latin1 so every byte maps 1:1 to a char and
  // the regex doesn't choke on invalid UTF-8 sequences.
  const text = buf.toString("latin1");

  // JWT shape: three base64url segments separated by dots, with the second
  // segment (the payload) starting with "eyJ" once base64url-encoded.
  const re = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

  type Candidate = { token: string; payload: Record<string, unknown> };
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tok = m[0];
    if (seen.has(tok)) continue;
    seen.add(tok);

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

  // sub claim looks like "auth0|user_xxx" -- strip the prefix.
  const sub = String(best.payload.sub ?? "");
  const match = /^auth0\|(.+)$/.exec(sub);
  if (!match) return null;

  return { token: best.token, userId: match[1] };
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
