import { stat, writeFile, mkdir, copyFile } from "node:fs/promises";
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
 * Main hook logic -- run by the Stop hook via `npx clawdboard hook-sync`.
 *
 * This function:
 * 1. Checks debounce (skip if synced within 2 hours)
 * 2. Writes optimistic timestamp (narrow TOCTOU race window)
 * 3. Loads config and checks for auth token (exit silently if none)
 * 4. Extracts and sanitizes usage data
 * 5. Uploads to server
 *
 * ALL errors are swallowed silently. This is an async background hook --
 * stdout/stderr go nowhere useful, and the hook must never fail or
 * interrupt the user's Claude Code session.
 */
export async function runHookSync(): Promise<void> {
  try {
    // Step 1: Check debounce
    if (!(await shouldSync())) {
      return;
    }

    // Step 2: Optimistic timestamp write (prevents race condition per research Pitfall 4)
    await markSynced();

    // Step 3: Load config, check auth
    const config = await loadConfig();
    if (!config.apiToken) {
      // No auth token = exit silently (per research Pitfall 6)
      return;
    }

    // Step 4: Extract and sanitize usage data
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

    // Step 5: Upload to server
    const machineId = await getMachineId();
    const serverUrl = getServerUrl(config);
    const client = new ApiClient(serverUrl, config.apiToken);
    await client.sync({ ...payload, syncIntervalMs: DEBOUNCE_MS, machineId });

    // Step 6: Auto-upgrade hooks if running old versions.
    // This is the last thing we do — if it fails, the sync already succeeded.
    try {
      const settings = await readSettings();
      const { settings: upgraded, alreadyInstalled } = installHook(settings);
      if (!alreadyInstalled) {
        await writeSettings(upgraded);
      }
    } catch {
      // Claude Code hook upgrade failure is non-fatal
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
  } catch {
    // Swallow all errors -- async hook must exit cleanly
  }
}
