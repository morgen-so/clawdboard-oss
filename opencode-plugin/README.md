# clawdboard-opencode

[clawdboard](https://clawdboard.ai) plugin for [OpenCode](https://opencode.ai) — automatically track your AI coding usage on the leaderboard.

## Setup

### 1. Authenticate with clawdboard

```bash
npx clawdboard auth
```

This opens your browser to link your GitHub account, runs your first sync, and installs auto-sync.

### 2. Install the plugin

Add to your `opencode.json`:

```json
{
  "plugin": ["clawdboard-opencode"]
}
```

Then install the package in your OpenCode config directory, using whichever package manager you have:

```bash
cd ~/.config/opencode && npm install clawdboard-opencode
# or: cd ~/.config/opencode && bun add clawdboard-opencode
```

**Alternative:** Copy `src/index.ts` directly to `~/.config/opencode/plugins/clawdboard.ts`.

### 3. Use OpenCode normally

The plugin triggers a sync on `session.idle` (debounced to every 2 hours). The clawdboard CLI handles all data extraction and upload.

## How it works

The plugin is a thin wrapper (~20 lines). On `session.idle`, it runs `npx clawdboard hook-sync`, which:

1. Reads OpenCode message files from `~/.local/share/opencode/storage/message/`
2. Aggregates token counts, costs, and model usage by day
3. Sanitizes through a Zod privacy allowlist (no prompts, code, paths, or session IDs)
4. Uploads to the clawdboard API

This is the same architecture used for Claude Code — durable file-based extraction, not transient events.

## What gets sent

Only aggregate metrics per day:

- Date (YYYY-MM-DD)
- Token counts (input, output, cache creation, cache read)
- Total cost (calculated from tokens using published model pricing)
- Model names (e.g., "claude-sonnet-4-20250514")

## Already using Claude Code too?

If you already have the clawdboard CLI installed for Claude Code, your OpenCode usage is automatically included on your next sync. No plugin needed — the CLI reads both data sources.

## Check your rank

```bash
npx clawdboard rank
```

Or visit [clawdboard.ai](https://clawdboard.ai).
