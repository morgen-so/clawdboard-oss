/**
 * Hermes Agent (Nous Research) usage data extraction.
 *
 * Hermes keeps all session state in a single SQLite database:
 *
 *   ~/.hermes/state.db        (HERMES_HOME relocates ~/.hermes)
 *
 * The DB runs in WAL mode and the CLI / gateway process may hold it open, so
 * — like the Cursor extractor — we copy `state.db` (plus its `-wal` file, so
 * not-yet-checkpointed rows are visible) to a temp directory and open the
 * copy read-only. The older per-session `~/.hermes/sessions/*.jsonl` files
 * are no longer written by Hermes and are not read here.
 *
 * Relevant schema (SCHEMA_VERSION 26):
 *
 *   sessions(id, source, model, started_at REAL — epoch seconds,
 *            input_tokens, output_tokens, cache_read_tokens,
 *            cache_write_tokens, reasoning_tokens, estimated_cost_usd, ...)
 *   session_model_usage(session_id, model, task, first_seen, input_tokens,
 *            output_tokens, cache_read_tokens, cache_write_tokens, ...)
 *
 * Both tables hold CUMULATIVE per-session counters incremented per API call.
 * `session_model_usage` breaks a session down per model (a session can
 * switch models, and auxiliary calls — vision, compression, titling — may
 * use a different one); when it has rows for a session they're used,
 * otherwise the session-level totals under `sessions.model` are.
 *
 * Hermes normalizes every provider's accounting to DISJOINT counts
 * (`prompt_tokens = input + cache_read + cache_write` in its own words), so
 * no subset correction is needed. `reasoning_tokens` is a breakdown of
 * `output_tokens`, not an addition.
 *
 * Hermes tags every session with the surface that drove it. Only
 * interactive developer surfaces are counted (see INTERACTIVE_SOURCES):
 * the terminal (`cli`, `tui`), the desktop app, editor integrations
 * (`acp`), and the web UI. Scheduled `cron` jobs, kanban runs, webhooks,
 * `tool` sub-agent runs, and chat gateways (Telegram, Discord, Slack,
 * WhatsApp, Signal, IRC, …) are left out — they aren't a developer coding.
 * Empty/NULL source is treated as CLI, matching Hermes's own reporting.
 *
 * Cost is recomputed from token counts via our pricing table (not
 * `estimated_cost_usd`) so estimates stay comparable across sources.
 *
 * Same privacy guarantees as the other extractors: only aggregate metrics
 * (date, model, token counts, cost) leave the machine — no message content,
 * titles, cwd, git metadata, or session ids.
 */

import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { calculateCost } from "./pricing.js";
import {
  accumulate,
  accumulatorToSyncDays,
  type DayAccumulator,
} from "./accumulator.js";
import type { SyncDay } from "./schemas.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Get the Hermes home directory. Respects HERMES_HOME. */
function getHermesHome(): string {
  const fromEnv = process.env.HERMES_HOME;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
  return join(homedir(), ".hermes");
}

function getDbPath(): string {
  return join(getHermesHome(), "state.db");
}

// ---------------------------------------------------------------------------
// Internal types — only used during parsing, never sent to server
// ---------------------------------------------------------------------------

interface SessionRow {
  id: string;
  model: string | null;
  started_at: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
}

interface ModelUsageRow {
  session_id: string;
  model: string | null;
  first_seen: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
}

/**
 * Session sources that count as a developer driving the agent. Everything
 * else (cron, kanban, webhook, tool, chat platforms, custom sources) is
 * excluded. Allowlist rather than denylist so a new gateway can't inflate
 * the leaderboard before we've looked at it.
 */
export const INTERACTIVE_SOURCES = ["cli", "tui", "desktop", "acp", "webui", "web"] as const;

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** Check whether Hermes session data exists on this machine. */
export function hasHermesData(): boolean {
  return existsSync(getDbPath());
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Hermes stores router-style ids for some providers ("anthropic/claude-…",
 * "openrouter/…"). Keep the bare model id so the same model merges with
 * other sources on the leaderboard and prices through the same table.
 */
export function normalizeHermesModel(model: string | null | undefined): string {
  const raw = typeof model === "string" ? model.trim() : "";
  if (!raw) return "unknown";
  const slash = raw.lastIndexOf("/");
  const bare = slash >= 0 ? raw.slice(slash + 1) : raw;
  return bare || "unknown";
}

/** Epoch seconds (Hermes's `time.time()`) → YYYY-MM-DD in UTC. Null when unusable. */
function epochToDate(value: number | null | undefined): { date: string; ms: number } | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  // Tolerate millisecond values should a future schema switch units.
  const ms = value > 1e12 ? value : value * 1000;
  return { date: new Date(ms).toISOString().slice(0, 10), ms };
}

function nonNeg(n: number | null | undefined): number {
  return Math.max(0, Math.round(Number(n) || 0));
}

function cleanupTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return row !== undefined;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Read the Hermes state DB and aggregate interactive sessions into daily usage data.
 *
 * @param since - Optional YYYY-MM-DD date; sessions started before this are skipped.
 */
export async function extractHermesData(since?: string): Promise<SyncDay[]> {
  const dbPath = getDbPath();
  if (!existsSync(dbPath)) return [];

  const sinceMs = since ? new Date(since).getTime() : 0;

  // Copy the DB (and WAL, if any) so we never contend with Hermes's own
  // connection. The copies share a basename so SQLite pairs them up.
  const tmpDir = join(
    tmpdir(),
    `hermes-state-${process.pid}-${Date.now()}-${randomUUID()}`
  );
  const tmpDb = join(tmpDir, "state.db");
  try {
    mkdirSync(tmpDir, { recursive: true });
    copyFileSync(dbPath, tmpDb);
    if (existsSync(`${dbPath}-wal`)) {
      copyFileSync(`${dbPath}-wal`, `${tmpDb}-wal`);
    }
  } catch {
    cleanupTempDir(tmpDir);
    return [];
  }

  let db: Database.Database;
  try {
    // Lazy-load the native module so it is never required unless this machine
    // actually has Hermes data. If the optional native binary is missing or
    // failed to build, skip Hermes extraction instead of crashing the CLI.
    const { default: BetterSqlite3 } = await import("better-sqlite3");
    db = new BetterSqlite3(tmpDb, { readonly: true, fileMustExist: true });
  } catch {
    cleanupTempDir(tmpDir);
    return [];
  }

  try {
    if (!tableExists(db, "sessions")) return [];

    const placeholders = INTERACTIVE_SOURCES.map(() => "?").join(", ");
    const sessions = db
      .prepare(
        `SELECT id, model, started_at, input_tokens, output_tokens,
                cache_read_tokens, cache_write_tokens
         FROM sessions
         WHERE source IN (${placeholders}) OR source = '' OR source IS NULL`
      )
      .all(...INTERACTIVE_SOURCES) as SessionRow[];

    // Per-model rows, grouped by session. Absent on pre-v2x schemas.
    const usageBySession = new Map<string, ModelUsageRow[]>();
    if (tableExists(db, "session_model_usage")) {
      const rows = db
        .prepare(
          `SELECT session_id, model, first_seen, input_tokens, output_tokens,
                  cache_read_tokens, cache_write_tokens
           FROM session_model_usage`
        )
        .all() as ModelUsageRow[];
      for (const row of rows) {
        const list = usageBySession.get(row.session_id) ?? [];
        list.push(row);
        usageBySession.set(row.session_id, list);
      }
    }

    const byDate: Record<string, DayAccumulator> = {};

    const add = (
      when: { date: string; ms: number } | null,
      model: string | null,
      tokens: Pick<
        SessionRow,
        "input_tokens" | "output_tokens" | "cache_read_tokens" | "cache_write_tokens"
      >
    ): void => {
      if (!when) return;
      if (sinceMs && when.ms < sinceMs) return;
      const input = nonNeg(tokens.input_tokens);
      const output = nonNeg(tokens.output_tokens);
      const cacheRead = nonNeg(tokens.cache_read_tokens);
      const cacheWrite = nonNeg(tokens.cache_write_tokens);
      if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) return;

      const modelId = normalizeHermesModel(model);
      const cost = calculateCost(modelId, {
        input,
        output,
        cacheCreation: cacheWrite,
        cacheRead,
      });
      accumulate(byDate, when.date, modelId, {
        input,
        output,
        cacheCreation: cacheWrite,
        cacheRead,
        cost,
      });
    };

    for (const session of sessions) {
      const startedAt = epochToDate(session.started_at);
      const perModel = usageBySession.get(session.id);
      const hasPerModel =
        perModel !== undefined &&
        perModel.some(
          (r) =>
            nonNeg(r.input_tokens) +
              nonNeg(r.output_tokens) +
              nonNeg(r.cache_read_tokens) +
              nonNeg(r.cache_write_tokens) >
            0
        );

      if (hasPerModel) {
        for (const row of perModel) {
          add(epochToDate(row.first_seen) ?? startedAt, row.model, row);
        }
      } else {
        add(startedAt, session.model, session);
      }
    }

    return accumulatorToSyncDays(byDate, "hermes");
  } finally {
    try {
      db.close();
    } catch {
      /* best effort */
    }
    cleanupTempDir(tmpDir);
  }
}
