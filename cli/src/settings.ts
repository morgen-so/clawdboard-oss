import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEBOUNCE_MINUTES } from "./hook.js";
import { buildDebounceCommand } from "./accumulator.js";

/**
 * A single hook entry within a hook group.
 */
export interface HookEntry {
  type: string;
  command: string;
  async?: boolean;
  timeout?: number;
}

/**
 * A hook group, optionally scoped to specific tools via matcher.
 */
export interface HookGroup {
  matcher?: string;
  hooks: HookEntry[];
}

/**
 * Claude Code settings.json structure.
 * Uses index signature to preserve all unknown keys (permissions, statusLine, etc.)
 */
export interface ClaudeSettings {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
}

const HOOK_EVENT = "Stop";

const CLAUDE_DIR = join(homedir(), ".claude");
const SETTINGS_PATH = join(CLAUDE_DIR, "settings.json");

/**
 * Read and parse ~/.claude/settings.json.
 * Returns {} if file doesn't exist, is empty, or has invalid JSON.
 */
export async function readSettings(): Promise<ClaudeSettings> {
  try {
    const raw = await readFile(SETTINGS_PATH, "utf-8");
    const trimmed = raw.trim();
    if (!trimmed) return {};
    return JSON.parse(trimmed) as ClaudeSettings;
  } catch {
    return {};
  }
}

/**
 * Write settings to ~/.claude/settings.json.
 * Creates the ~/.claude/ directory if it doesn't exist.
 */
export async function writeSettings(settings: ClaudeSettings): Promise<void> {
  await mkdir(CLAUDE_DIR, { recursive: true });
  await writeFile(
    SETTINGS_PATH,
    JSON.stringify(settings, null, 2) + "\n",
    "utf-8"
  );
}

/**
 * Check if a hook group list contains a clawdboard hook matching the given predicate.
 */
function hasClawdboardHook(
  groups: HookGroup[],
  predicate?: (command: string) => boolean
): boolean {
  return groups.some((group) =>
    group.hooks.some(
      (h) =>
        h.command.includes("clawdboard") &&
        (predicate ? predicate(h.command) : true)
    )
  );
}

/**
 * Check if the current optimized hook is installed on the Stop event.
 */
function hasCurrentHook(settings: ClaudeSettings): boolean {
  const stop = settings.hooks?.[HOOK_EVENT] ?? [];
  // A hook built with an older interval is outdated, so the next hook-sync
  // rewrites it with the current one.
  return hasClawdboardHook(stop, (cmd) => cmd.includes(`-mmin -${DEBOUNCE_MINUTES}`));
}

/**
 * Check if a legacy ccboard hook exists in PostToolUse.
 */
function hasLegacyHook(settings: ClaudeSettings): boolean {
  const postToolUse = settings.hooks?.PostToolUse ?? [];
  return postToolUse.some((group) =>
    group.hooks.some((h) => h.command.includes("ccboard"))
  );
}



/**
 * Remove all hook groups containing ccboard or clawdboard from a group list.
 */
function removeMatchingHooks(groups: HookGroup[]): HookGroup[] {
  return groups.filter(
    (group) =>
      !group.hooks.some(
        (h) =>
          h.command.includes("ccboard") || h.command.includes("clawdboard")
      )
  );
}

/**
 * Build the optimized hook entry with shell-level debounce.
 *
 * The bash wrapper checks if ~/.clawdboard/last-sync was modified within the
 * debounce window. If so, it exits immediately without spawning Node/npx.
 * This prevents CPU spikes when many concurrent agents trigger the hook.
 */
function buildHookEntry(): HookGroup {
  return {
    hooks: [
      {
        type: "command",
        command: buildDebounceCommand(DEBOUNCE_MINUTES),
        async: true,
        timeout: 120,
      },
    ],
  };
}

/**
 * Pure function: install, upgrade, or migrate the clawdboard hook to Stop.
 *
 * - If the current hook already exists on Stop → alreadyInstalled: true
 * - If an old hook exists on PostToolUse → remove it and install on Stop
 * - If the legacy ccboard hook exists → remove it and install on Stop (migrated: true)
 * - If neither exists → install fresh on Stop
 *
 * Preserves ALL existing keys (permissions, statusLine, etc.)
 */
export function installHook(settings: ClaudeSettings): {
  settings: ClaudeSettings;
  alreadyInstalled: boolean;
  migrated: boolean;
} {
  if (hasCurrentHook(settings)) {
    return { settings, alreadyInstalled: true, migrated: false };
  }

  const migrated = hasLegacyHook(settings);

  // Clean up any old hooks from PostToolUse
  const cleanedPostToolUse = removeMatchingHooks(
    settings.hooks?.PostToolUse ?? []
  );

  // Clean up any old hooks from Stop (shouldn't exist, but be safe)
  const cleanedStop = removeMatchingHooks(
    settings.hooks?.[HOOK_EVENT] ?? []
  );

  const merged: ClaudeSettings = {
    ...settings,
    hooks: {
      ...settings.hooks,
      // Preserve PostToolUse without clawdboard/ccboard hooks
      PostToolUse: cleanedPostToolUse,
      // Install on Stop
      [HOOK_EVENT]: [...cleanedStop, buildHookEntry()],
    },
  };

  // Clean up empty PostToolUse array
  if (merged.hooks!.PostToolUse.length === 0) {
    delete merged.hooks!.PostToolUse;
  }

  return { settings: merged, alreadyInstalled: false, migrated };
}
