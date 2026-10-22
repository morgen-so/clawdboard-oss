/**
 * clawdboard plugin for OpenCode
 *
 * Thin wrapper that triggers `npx clawdboard hook-sync` on session.idle.
 * The CLI handles all data extraction, privacy sanitization, and upload.
 *
 * Install: add "clawdboard-opencode" to the plugin array in opencode.json,
 * or copy this file to ~/.config/opencode/plugins/.
 *
 * Auth: run `npx clawdboard auth` first to get an API token.
 */

import type { Plugin } from "opencode/plugin";

const DEBOUNCE_MINUTES = 240;

const plugin: Plugin = async ({ $ }) => ({
  "session.idle": async () => {
    try {
      // Shell-level debounce: skip if last-sync was updated within 4 hours.
      // This avoids spawning npx on every idle event.
      // The clawdboard CLI handles extraction, privacy sanitization, and upload.
      await $`bash -c ${`f=$HOME/.clawdboard/last-sync; [ -f "$f" ] && [ -n "$(find "$f" -mmin -${DEBOUNCE_MINUTES} 2>/dev/null)" ] && exit 0; npx clawdboard hook-sync`}`.quiet();
    } catch {
      // Swallow all errors — must never interrupt the user's work
    }
  },
});

export default plugin;
