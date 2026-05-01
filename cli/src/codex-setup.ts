/**
 * Codex CLI hook auto-installation.
 *
 * Codex's hook engine (verified against openai/codex codex-rs/hooks/src/
 * engine/discovery.rs and codex-rs/core/config.schema.json) reads hooks from
 * `<codex_folder>/hooks.json` — NOT from config.toml — and is gated by
 * `features.codex_hooks = true` in config.toml.
 *
 * Pre-v0.2.5 this module wrote a [[hooks.Stop]] block into config.toml.
 * Codex silently ignored it, and embedded `"` chars in the shell command
 * broke TOML parsing entirely (see GitHub issue reports). We now write the
 * hook into hooks.json (quote-safe JSON) and flip the feature flag in
 * config.toml, cleaning up any legacy block on upgrade.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEBOUNCE_MINUTES } from "./hook.js";
import { buildDebounceCommand, type InstallResult } from "./accumulator.js";

const LEGACY_MARKER = "# clawdboard auto-sync";

function codexPaths() {
  const dir = join(homedir(), ".codex");
  return {
    dir,
    config: join(dir, "config.toml"),
    hooks: join(dir, "hooks.json"),
  };
}

interface CodexHookHandler {
  type: string;
  command: string;
  timeout?: number;
}

interface CodexMatcherGroup {
  matcher?: string;
  hooks: CodexHookHandler[];
}

type CodexEventName =
  | "PreToolUse"
  | "PostToolUse"
  | "SessionStart"
  | "UserPromptSubmit"
  | "Stop";

export interface CodexHooksFile {
  hooks?: Partial<Record<CodexEventName, CodexMatcherGroup[]>>;
}

/**
 * Strip the legacy `# clawdboard auto-sync` block from a config.toml source.
 * Older CLI versions wrote [[hooks.Stop]] into config.toml; codex ignored the
 * block and the unescaped `"` chars inside the command broke TOML parsing.
 *
 * The legacy block we wrote was always exactly 3 lines:
 *   # clawdboard auto-sync
 *   [[hooks.Stop]]
 *   hooks = [{ type = "command", command = "...", timeout = 120 }]
 *
 * Match that exact shape only. Anything else the user wrote (including their
 * own [[hooks.*]] sections) is left alone. If the marker is orphaned — no
 * [[hooks.Stop]] on the next line — strip just the marker comment.
 */
export function stripLegacyHookBlock(source: string): string {
  const markerIdx = source.indexOf(LEGACY_MARKER);
  if (markerIdx === -1) return source;

  const lines = source.split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes(LEGACY_MARKER)) {
      out.push(line);
      continue;
    }

    // Found the marker. Check whether the next two lines match the known
    // legacy shape: [[hooks.Stop]] followed by a `hooks = ...` line.
    const next = lines[i + 1];
    const afterNext = lines[i + 2];
    const isLegacyShape =
      next !== undefined &&
      next.trim() === "[[hooks.Stop]]" &&
      afterNext !== undefined &&
      /^\s*hooks\s*=\s*/.test(afterNext);

    if (isLegacyShape) {
      // Consume marker + [[hooks.Stop]] + hooks = ... line.
      i += 2;
      // Swallow a single trailing blank line so we don't leave a widening gap.
      if (lines[i + 1]?.trim() === "") i += 1;
    }
    // If the shape didn't match, we've already skipped the marker by not
    // pushing it — leave everything else untouched.
  }

  return out.join("\n");
}

/**
 * Ensure `codex_hooks = true` under the [features] table.
 * Idempotent: if any `codex_hooks = ...` assignment is already present, the
 * source is returned unchanged — we respect an explicit false, even though
 * our hooks.json won't fire in that case.
 */
export function ensureCodexHooksFeature(source: string): string {
  if (/\bcodex_hooks\s*=/.test(source)) return source;

  const headerMatch = source.match(/^\[features\]\s*$/m);
  if (headerMatch && headerMatch.index !== undefined) {
    const insertAt = headerMatch.index + headerMatch[0].length;
    return source.slice(0, insertAt) + "\ncodex_hooks = true" + source.slice(insertAt);
  }

  const trimmed = source.replace(/\s+$/, "");
  const separator = trimmed.length === 0 ? "" : "\n\n";
  return trimmed + separator + "[features]\ncodex_hooks = true\n";
}

/**
 * Insert or replace the clawdboard Stop hook in a hooks.json structure.
 * Existing non-clawdboard hooks (across all events) are preserved.
 */
export function upsertClawdboardStopHook(existing: CodexHooksFile): CodexHooksFile {
  const command = buildDebounceCommand(DEBOUNCE_MINUTES);
  const newHook: CodexHookHandler = { type: "command", command, timeout: 120 };

  const stop = existing.hooks?.Stop ?? [];
  const filtered = stop
    .map((group) => ({
      ...group,
      hooks: group.hooks.filter((h) => !h.command.includes("clawdboard")),
    }))
    .filter((group) => group.hooks.length > 0);

  filtered.push({ hooks: [newHook] });

  return {
    ...existing,
    hooks: {
      ...(existing.hooks ?? {}),
      Stop: filtered,
    },
  };
}

export function isCodexHookInstalled(): boolean {
  const { config, hooks } = codexPaths();
  if (!existsSync(hooks)) return false;
  try {
    const hooksContent = readFileSync(hooks, "utf-8");
    if (!hooksContent.includes("clawdboard")) return false;
    if (!hooksContent.includes(`mmin -${DEBOUNCE_MINUTES}`)) return false;
    const configContent = existsSync(config) ? readFileSync(config, "utf-8") : "";
    return /\bcodex_hooks\s*=\s*true\b/.test(configContent);
  } catch {
    return false;
  }
}

export async function installCodexHook(): Promise<InstallResult> {
  const { dir, config: configPath, hooks: hooksPath } = codexPaths();
  await mkdir(dir, { recursive: true });

  const configBefore = existsSync(configPath)
    ? await readFile(configPath, "utf-8").catch(() => "")
    : "";

  const hooksBeforeStr = existsSync(hooksPath)
    ? await readFile(hooksPath, "utf-8").catch(() => "")
    : "";

  let hooksBefore: CodexHooksFile = {};
  if (hooksBeforeStr.trim()) {
    try {
      hooksBefore = JSON.parse(hooksBeforeStr) as CodexHooksFile;
    } catch {
      hooksBefore = {};
    }
  }

  const hadLegacy = configBefore.includes(LEGACY_MARKER);
  const configAfter = ensureCodexHooksFeature(stripLegacyHookBlock(configBefore));
  const hooksAfter = upsertClawdboardStopHook(hooksBefore);
  const hooksAfterStr = JSON.stringify(hooksAfter, null, 2) + "\n";

  const configChanged = configBefore !== configAfter;
  const hooksChanged = hooksBeforeStr !== hooksAfterStr;

  if (!configChanged && !hooksChanged) {
    return { installed: false, alreadyInstalled: true, updated: false };
  }

  if (configChanged) await writeFile(configPath, configAfter, "utf-8");
  if (hooksChanged) await writeFile(hooksPath, hooksAfterStr, "utf-8");

  const hadPrior = hadLegacy || hooksBeforeStr.includes("clawdboard");
  return {
    installed: !hadPrior,
    alreadyInstalled: false,
    updated: hadPrior,
  };
}
