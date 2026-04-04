import { stat, writeFile, mkdir, copyFile, open } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig, getServerUrl } from "./config.js";
import { ApiClient } from "./api-client.js";
import { extractAndSanitize } from "./extract.js";
import { readSettings, writeSettings, installHook } from "./settings.js";
import { installOpenCodePlugin } from "./opencode-setup.js";
import { installCodexHook } from "./codex-setup.js";
import { getMachineId } from "./machine-id.js";

export const DEBOUNCE_MS = 2 * 60 * 60 * 1000; // 2 hours
export const DEBOUNCE_MINUTES = DEBOUNCE_MS / 60_000; // used by shell-level debounce in settings.ts
const CLAWDBOARD_DIR = join(homedir(), ".clawdboard");
const SYNC_MARKER = join(CLAWDBOARD_DIR, "last-sync");
const LOCK_FILE = join(CLAWDBOARD_DIR, "hook-sync.lock");

// Legacy path for migration from ccboard → clawdboard
const OLD_SYNC_MARKER = join(homedir(), ".ccboard", "last-sync");

/**
 * Check if enough time has elapsed since the last sync.
 * Returns true if the last-sync file doesn't exist or is >= 2 hours old.
 */
export async function shouldSync(): Promise<boolean> {
  // Migrate last-sync marker from ~/.ccboard/ if needed
  if (!existsSync(SYNC_MARKER) && existsSync(OLD_SYNC_MARKER)) {
    try {
      await mkdir(CLAWDBOARD_DIR, { recursive: true });
      await copyFile(OLD_SYNC_MARKER, SYNC_MARKER);
    } catch {
      // Migration failure is non-fatal
    }
  }

  try {
    const info = await stat(SYNC_MARKER);
    const elapsed = Date.now() - info.mtimeMs;
    return elapsed >= DEBOUNCE_MS;
  } catch {
    // File doesn't exist = never synced = should sync
    return true;
  }
}

/**
 * Write the current timestamp to the last-sync marker file.
 * Creates the ~/.clawdboard/ directory if needed.
 */
export async function markSynced(): Promise<void> {
  await mkdir(CLAWDBOARD_DIR, { recursive: true });
  await writeFile(SYNC_MARKER, new Date().toISOString(), "utf-8");
}

/**
 * Acquire an exclusive lock using O_EXCL (atomic create-or-fail).
 * Returns a release function on success, or null if another process holds the lock.
 * Stale locks older than 5 minutes get one retry after removal.
 */
async function acquireLock(): Promise<(() => Promise<void>) | null> {
  await mkdir(CLAWDBOARD_DIR, { recursive: true });

  const releaseFn = async (): Promise<void> => {
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(LOCK_FILE);
    } catch {
      // Best-effort cleanup
    }
  };

  const tryCreate = async (): Promise<(() => Promise<void>) | null> => {
    try {
      const fd = await open(LOCK_FILE, "wx"); // O_CREAT | O_EXCL — atomic
      await fd.writeFile(String(process.pid), "utf-8");
      await fd.close();
      return releaseFn;
    } catch {
      return null;
    }
  };

  // Fast path: try to create the lock
  const acquired = await tryCreate();
  if (acquired) return acquired;

  // Lock exists — check if it's stale (crashed process)
  try {
    const info = await stat(LOCK_FILE);
    if (Date.now() - info.mtimeMs <= 5 * 60 * 1000) {
      return null; // Fresh lock held by another process
    }
    const { unlink } = await import("node:fs/promises");
    await unlink(LOCK_FILE);
  } catch {
    return null; // Can't stat or unlink — another process may have cleaned up
  }

  // One retry after removing stale lock — O_EXCL ensures only one winner
  return tryCreate();
}

/**
 * Main hook logic -- run by the Stop hook via `npx clawdboard hook-sync`.
 *
 * This function:
 * 1. Acquires exclusive lock (skip if another hook-sync is running)
 * 2. Checks debounce (skip if synced within 2 hours)
 * 3. Writes optimistic timestamp (narrow TOCTOU race window)
 * 4. Loads config and checks for auth token (exit silently if none)
 * 5. Extracts and sanitizes usage data
 * 6. Uploads to server
 *
 * ALL errors are swallowed silently. This is an async background hook --
 * stdout/stderr go nowhere useful, and the hook must never fail or
 * interrupt the user's Claude Code session.
 */
export async function runHookSync(): Promise<void> {
  let releaseLock: (() => Promise<void>) | null = null;
  try {
    // Step 1: Acquire exclusive lock — bail if another hook-sync is running
    releaseLock = await acquireLock();
    if (!releaseLock) {
      return;
    }

    // Step 2: Auto-upgrade hooks BEFORE debounce check.
    // This is critical: users with the old PostToolUse hook fire hook-sync on
    // every tool call. By migrating to the Stop hook here (before the debounce
    // exit), the very first invocation that acquires the lock will remove the
    // PostToolUse hook and install the debounced Stop hook — fixing the problem
    // permanently without waiting for a successful sync cycle.
    try {
      const settings = await readSettings();
      const { settings: upgraded, alreadyInstalled } = installHook(settings);
      if (!alreadyInstalled) {
        await writeSettings(upgraded);
      }
    } catch {
      // Hook upgrade failure is non-fatal
    }

    try {
      await installOpenCodePlugin();
    } catch {
      // OpenCode plugin upgrade failure is non-fatal
    }

    try {
      await installCodexHook();
    } catch {
      // Codex hook upgrade failure is non-fatal
    }

    // Step 3: Check debounce
    if (!(await shouldSync())) {
      return;
    }

    // Step 4: Optimistic timestamp write (prevents race condition per research Pitfall 4)
    await markSynced();

    // Step 5: Load config, check auth
    const config = await loadConfig();
    if (!config.apiToken) {
      // No auth token = exit silently (per research Pitfall 6)
      return;
    }

    // Step 6: Extract and sanitize usage data
    let payload;
    try {
      payload = await extractAndSanitize();
    } catch {
      // Extraction failure = exit silently
      return;
    }

    if (payload.days.length === 0) {
      return;
    }

    // Step 7: Upload to server
    const machineId = await getMachineId();
    const serverUrl = getServerUrl(config);
    const client = new ApiClient(serverUrl, config.apiToken);
    await client.sync({ ...payload, syncIntervalMs: DEBOUNCE_MS, machineId });
  } catch {
    // Swallow all errors -- async hook must exit cleanly
  } finally {
    if (releaseLock) {
      await releaseLock();
    }
  }
}
