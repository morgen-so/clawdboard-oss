/**
 * Claude desktop app (Cowork / Dispatch) usage extraction.
 *
 * Reads audit.jsonl transcripts written by the desktop app's local-agent mode,
 * which are NOT covered by ccusage (it only scans ~/.claude/projects/).
 *
 * macOS path:
 *   ~/Library/Application Support/Claude/local-agent-mode-sessions/
 *     <userId>/<workspaceId>/<sessionDir>/audit.jsonl
 *
 * Each .jsonl row matching `type === "assistant"` carries the same
 * `message.usage.{input_tokens, output_tokens, cache_creation_input_tokens,
 * cache_read_input_tokens}` shape used by Claude Code CLI transcripts, plus
 * `message.model` and `_audit_timestamp` (ISO string).
 *
 * Privacy guarantees match the other extractors: only date, token counts,
 * cost, and model names are read.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { calculateCost } from "./pricing.js";
import { accumulate, accumulatorToSyncDays, type DayAccumulator } from "./accumulator.js";
import type { SyncDay } from "./schemas.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getDesktopSessionsRoot(): string | null {
  if (process.platform !== "darwin") return null;
  return join(
    homedir(),
    "Library",
    "Application Support",
    "Claude",
    "local-agent-mode-sessions"
  );
}

// ---------------------------------------------------------------------------
// Types (internal — only used for parsing, never sent to server)
// ---------------------------------------------------------------------------

interface AuditAssistantRow {
  type?: string;
  _audit_timestamp?: string;
  message?: {
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export function hasDesktopData(): boolean {
  const root = getDesktopSessionsRoot();
  return root !== null && existsSync(root);
}

/**
 * Walk the local-agent-mode-sessions tree and collect every audit.jsonl path.
 * Layout: <root>/<userId>/<workspaceId>/<sessionDir>/audit.jsonl
 */
async function findAuditFiles(root: string): Promise<string[]> {
  const out: string[] = [];

  let userIds: string[];
  try {
    userIds = await readdir(root);
  } catch {
    return out;
  }

  for (const userId of userIds) {
    const userPath = join(root, userId);
    let workspaceIds: string[];
    try {
      workspaceIds = await readdir(userPath);
    } catch {
      continue;
    }

    for (const workspaceId of workspaceIds) {
      const workspacePath = join(userPath, workspaceId);
      let entries: string[];
      try {
        entries = await readdir(workspacePath);
      } catch {
        continue;
      }

      for (const entry of entries) {
        const sessionPath = join(workspacePath, entry);
        const auditPath = join(sessionPath, "audit.jsonl");
        if (existsSync(auditPath)) {
          out.push(auditPath);
        }
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

export async function extractDesktopData(since?: string): Promise<SyncDay[]> {
  const root = getDesktopSessionsRoot();
  if (!root || !existsSync(root)) return [];

  let sinceMs = 0;
  if (since) {
    sinceMs = Date.parse(since);
    if (Number.isNaN(sinceMs)) {
      throw new Error(
        `Invalid --since value: ${JSON.stringify(since)}. Expected a parseable date (e.g. YYYY-MM-DD).`
      );
    }
  }
  const files = await findAuditFiles(root);
  const byDate: Record<string, DayAccumulator> = {};

  for (const file of files) {
    // Quick skip via mtime: if the file hasn't been touched since `since`, skip
    if (sinceMs) {
      try {
        const fileStat = await stat(file);
        if (fileStat.mtimeMs < sinceMs) continue;
      } catch {
        continue;
      }
    }

    let raw: string;
    try {
      raw = await readFile(file, "utf-8");
    } catch {
      continue;
    }

    for (const line of raw.split("\n")) {
      if (!line) continue;

      let row: AuditAssistantRow;
      try {
        row = JSON.parse(line) as AuditAssistantRow;
      } catch {
        continue;
      }

      if (row.type !== "assistant") continue;
      const usage = row.message?.usage;
      if (!usage) continue;

      const ts = row._audit_timestamp;
      if (!ts) continue;
      const tsMs = Date.parse(ts);
      if (Number.isNaN(tsMs)) continue;
      if (sinceMs && tsMs < sinceMs) continue;

      const date = new Date(tsMs).toISOString().slice(0, 10);
      const modelId = row.message?.model ?? "unknown";

      const input = Number(usage.input_tokens) || 0;
      const output = Number(usage.output_tokens) || 0;
      const cacheCreation = Number(usage.cache_creation_input_tokens) || 0;
      const cacheRead = Number(usage.cache_read_input_tokens) || 0;

      if (input === 0 && output === 0 && cacheCreation === 0 && cacheRead === 0) {
        continue;
      }

      const cost = calculateCost(modelId, {
        input,
        output,
        cacheCreation,
        cacheRead,
      });

      accumulate(byDate, date, modelId, {
        input,
        output,
        cacheCreation,
        cacheRead,
        cost,
      });
    }
  }

  return accumulatorToSyncDays(byDate, "claude-code-desktop");
}
