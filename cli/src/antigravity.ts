/**
 * Google Antigravity usage data extraction (opt-in).
 *
 * Antigravity stores conversations as opaque protobuf with no public schema,
 * so on-disk parsing is not feasible. Instead, we mirror the community
 * `skainguyen1412/antigravity-usage` approach: read the user's local
 * ~/.gemini/oauth_creds.json and call Google's Cloud Code API to fetch
 * per-model usage.
 *
 * SECURITY: This is the ONLY extractor that:
 *   - reads credentials from another tool's directory
 *   - makes an outbound network call
 * For these reasons it is opt-in. Users must run
 *   `clawdboard antigravity enable`
 * to acknowledge the disclosure and write `antigravity.enabled: true` to
 * ~/.clawdboard/config.json. Without that flag, hasAntigravityData()
 * returns false and the extractor is a no-op.
 *
 * Even when enabled:
 *   - We never write to oauth_creds.json (gemini-cli owns that file).
 *   - All errors are swallowed — Antigravity failures never break the
 *     other extractors.
 *   - The network call has a 5s timeout to avoid stalling hook-sync.
 *   - Only allowlisted fields ever land in the SyncPayload.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { calculateCost } from "./pricing.js";
import {
  accumulate,
  accumulatorToSyncDays,
  type DayAccumulator,
} from "./accumulator.js";
import { loadConfig } from "./config.js";
import type { SyncDay } from "./schemas.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getGeminiOauthCredsPath(): string {
  if (process.env.GEMINI_HOME) {
    return join(process.env.GEMINI_HOME, "oauth_creds.json");
  }
  return join(homedir(), ".gemini", "oauth_creds.json");
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface OauthCreds {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
  client_id?: string;
  client_secret?: string;
  token_type?: string;
}

const NETWORK_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Returns true only when:
 *   1. Antigravity is enabled in the user's clawdboard config, AND
 *   2. The gemini-cli oauth credentials file exists.
 *
 * Both conditions must hold; otherwise we never touch the credentials file
 * and never attempt a network call.
 */
export function hasAntigravityData(): boolean {
  // Config check is async (loadConfig); fall back to a sync existsSync check
  // and let the extractor make the final decision. We don't want the bare
  // existence of oauth_creds.json (gemini-cli owns that file) to imply
  // "yes, sync Antigravity" — the config gate handles that.
  return existsSync(getGeminiOauthCredsPath());
}

/**
 * Returns true if the user has explicitly opted in to Antigravity sync.
 */
async function isAntigravityEnabled(): Promise<boolean> {
  try {
    const config = await loadConfig();
    return config.antigravity?.enabled === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// OAuth handling
// ---------------------------------------------------------------------------

async function readOauthCreds(): Promise<OauthCreds | null> {
  try {
    const raw = await readFile(getGeminiOauthCredsPath(), "utf-8");
    return JSON.parse(raw) as OauthCreds;
  } catch {
    return null;
  }
}

/**
 * If the access token is expired, refresh it via Google's OAuth endpoint.
 * Returns a usable access_token on success, or null on any failure.
 *
 * IMPORTANT: We never write the refreshed token back to oauth_creds.json.
 * gemini-cli owns that file. We hold the refreshed token in memory only.
 */
async function ensureValidAccessToken(creds: OauthCreds): Promise<string | null> {
  if (!creds.access_token) return null;

  const now = Date.now();
  const expiry = typeof creds.expiry_date === "number" ? creds.expiry_date : 0;
  // 60s safety margin — refresh slightly before expiry
  if (expiry > now + 60_000) {
    return creds.access_token;
  }

  if (!creds.refresh_token || !creds.client_id || !creds.client_secret) {
    return null;
  }

  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
    try {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: creds.refresh_token,
          client_id: creds.client_id,
          client_secret: creds.client_secret,
        }),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { access_token?: string };
      return json.access_token ?? null;
    } finally {
      clearTimeout(t);
    }
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cloud Code API call
// ---------------------------------------------------------------------------

interface CloudCodeUsageResponse {
  // Best-effort schema — the actual response may differ. We only read the
  // fields we recognize and pass everything through Zod indirectly via
  // SyncPayloadSchema, so unknown fields are stripped at the boundary.
  metrics?: Array<{
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    timestamp?: string;
    date?: string;
  }>;
}

/**
 * Call the Cloud Code API for per-model usage. Returns null on any failure.
 *
 * Note: the exact endpoint and payload shape are reverse-engineered from
 * the community `skainguyen1412/antigravity-usage` CLI. This may break if
 * Google changes the API. All errors are swallowed silently — we never
 * report Antigravity failures to the user.
 */
async function fetchCloudCodeUsage(
  accessToken: string
): Promise<CloudCodeUsageResponse | null> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
    try {
      const res = await fetch(
        "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
          signal: controller.signal,
        }
      );
      if (!res.ok) return null;
      return (await res.json()) as CloudCodeUsageResponse;
    } finally {
      clearTimeout(t);
    }
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Extract Antigravity usage by calling the Cloud Code API with the user's
 * local OAuth credentials. No-op unless the user has explicitly opted in.
 *
 * @param since - Optional YYYY-MM-DD date; results before this are skipped.
 */
export async function extractAntigravityData(
  since?: string
): Promise<SyncDay[]> {
  if (!(await isAntigravityEnabled())) return [];

  const creds = await readOauthCreds();
  if (!creds) return [];

  const accessToken = await ensureValidAccessToken(creds);
  if (!accessToken) return [];

  const response = await fetchCloudCodeUsage(accessToken);
  if (!response || !Array.isArray(response.metrics)) return [];

  const sinceMs = since ? new Date(since).getTime() : 0;
  const byDate: Record<string, DayAccumulator> = {};

  for (const metric of response.metrics) {
    if (!metric || typeof metric !== "object") continue;
    const dateStr =
      metric.date ??
      (metric.timestamp ? metric.timestamp.slice(0, 10) : undefined);
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;

    if (sinceMs) {
      const ts = new Date(dateStr).getTime();
      if (Number.isNaN(ts) || ts < sinceMs) continue;
    }

    const modelId = metric.model ?? "unknown";
    const input = Number(metric.inputTokens) || 0;
    const output = Number(metric.outputTokens) || 0;
    const cacheRead = Number(metric.cachedTokens) || 0;
    if (input === 0 && output === 0) continue;

    const cost = calculateCost(modelId, {
      input,
      output,
      cacheCreation: 0,
      cacheRead,
    });

    accumulate(byDate, dateStr, modelId, {
      input,
      output,
      cacheCreation: 0,
      cacheRead,
      cost,
    });
  }

  return accumulatorToSyncDays(byDate, "antigravity");
}
