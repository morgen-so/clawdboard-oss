# clawdboard

Track and compare your AI coding agent usage across developers. Supports Claude Code, OpenCode, Codex, and Cursor. See who's spending the most, longest streaks, model breakdowns, and more.

**[clawdboard.ai](https://clawdboard.ai)**

## Quick Start

```bash
npx clawdboard
```

That's it. This opens your browser, authenticates via GitHub, syncs your usage data, and installs an auto-sync hook — all in one step.

## How It Works

1. **Auth** — Sign in with GitHub (device flow, no secrets in the terminal)
2. **Extract** — Reads your local agent usage logs (Claude Code, OpenCode, Codex, Cursor)
3. **Sync** — Uploads aggregate metrics (tokens, cost, models) to the leaderboard
4. **Auto-sync** — A Claude Code hook syncs in the background every 2 hours

## Commands

| Command | Description |
|---|---|
| `clawdboard auth` | Authenticate with GitHub |
| `clawdboard sync` | Manually sync usage data |
| `clawdboard rank` | Show your rank and percentile |
| `clawdboard leaderboard` | Show the top users |
| `clawdboard setup` | Re-install the auto-sync hook |

### Options

```bash
clawdboard sync --since 2025-01-01   # Sync from a specific date
clawdboard sync --dry-run             # Preview without uploading
clawdboard leaderboard --period 30d   # 7d, 30d, this-month, ytd
clawdboard leaderboard --limit 20     # Show more users
```

## Privacy

Only aggregate numbers leave your machine — never your prompts, code, or project names.

Every field is explicitly allowlisted and validated through a Zod schema before upload. The full extraction logic is in [`src/extract.ts`](src/extract.ts).

**What's shared:** date, token counts, cost, model names.
**What's never shared:** prompts, responses, file paths, project names, session IDs.

## Claude Code Plugin

clawdboard is also available as a Claude Code plugin with slash commands:

- `/clawdboard:stats` — Check your rank
- `/clawdboard:sync` — Trigger a sync
- `/clawdboard:leaderboard` — View the leaderboard

## Requirements

- Node.js 18+
- A [Claude Code](https://claude.ai/code) installation with usage history

## License

MIT
