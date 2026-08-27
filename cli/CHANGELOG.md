# Changelog

All notable changes to the `clawdboard` CLI are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses semver loosely while pre-1.0.

## [0.3.6] - 2026-08-27

### Added

- **Pi extractor (`pi`).** Reads session JSONL logs at
  `~/.pi/agent/sessions/<project>/<timestamp>_<uuid>.jsonl` (honours
  `PI_CODING_AGENT_SESSION_DIR` and `PI_CODING_AGENT_DIR`). Counts every
  assistant message, including ones on abandoned branches. Pi already
  normalizes provider accounting to disjoint input / cache-read counts, so
  no subset correction is applied.
- **Hermes Agent extractor (`hermes`).** Reads the SQLite state DB at
  `~/.hermes/state.db` (honours `HERMES_HOME`), copying it (and its WAL)
  to a temp dir first so it never contends with a running Hermes process.
  Uses the per-model `session_model_usage` table when present, otherwise
  session totals. Only interactive sessions are counted (`cli`, `tui`,
  `desktop`, `acp`, web UI); cron jobs, kanban runs, sub-agent `tool`
  runs, and chat-gateway traffic (Telegram, Discord, WhatsApp, …) are
  excluded.
- **DeepSeek Harness extractor (`deepseek-harness`).** Reads dsh's
  append-only session logs at `~/.dsh/sessions/<project>/<id>/session.jsonl.zstd`
  (honours `DSH_HOME`). Zstandard logs are decoded frame by frame via
  `node:zlib` (Node ≥ 22.15); a torn trailing frame is ignored. Plain
  `session.jsonl` logs (`compression: none`) are read too.

## [0.3.2] - 2026-05-05

### Added

- **`clawdboard sync --reset`.** Forces the server to overwrite stored daily
  totals with the current local numbers, even if smaller. Use this to correct
  an inflated day (e.g. after a CLI bug double-counted). Default sync now
  keeps the higher value per (date, source, machine) server-side, so deleting
  local session files no longer shrinks your dashboard history.

## [0.3.0] - 2026-05-04

### Added

- **Claude desktop app extractor (`claude-code-desktop`).** Captures usage
  from Cowork / Dispatch sessions written by the Claude desktop app's
  local-agent mode. Reads `~/Library/Application Support/Claude/local-agent-mode-sessions/<userId>/<workspaceId>/<sessionDir>/audit.jsonl`.
  macOS only for now. Closes the gap where ccusage missed in-app coding
  agent activity.
- **Gemini CLI extractor (`gemini-cli`).** Reads JSONL chat logs at
  `~/.gemini/tmp/<project>/chats/`, with `$rewindTo` handling so rewound
  turns are dropped from totals.
- **GitHub Copilot CLI extractor (`copilot-cli`).** Reads
  `~/.copilot/session-state/<id>/events.jsonl` and surfaces premium-request
  counts alongside token-level metrics. Handles U+2028 / U+2029 codepoint
  sanitization (gh/copilot-cli#2012).
- **Antigravity extractor (`antigravity`, opt-in).** Calls Google's
  Cloud Code API using gemini-cli's local OAuth credentials at
  `~/.gemini/oauth_creds.json`. Disabled by default; enable explicitly
  with `clawdboard antigravity enable`. Refresh-token flow is in-memory;
  the auth file is never written to. Errors are swallowed silently.
- **OpenCode tier split.** OpenCode sessions are now bucketed by
  `providerID` into three sources: the catch-all `opencode` (direct API
  keys for anthropic / openai / openrouter / etc.), `opencode-go` (the
  Go subscription tier), and `opencode-zen` (pay-as-you-go provider tier).
  Existing `source: "opencode"` rows are migrated automatically on next
  sync via the new `reassignFromOpencode` server hint, with no
  double-counting. Also handles the new flat-file storage layout used by
  the Go OpenCode binary.
- **Per-source breakdown** in `clawdboard sync --dry-run` output, showing
  days / tokens / cost contributed by each source.
- **Pricing entries** for Gemini 2.x / 3.x family, OpenCode Zen-tier
  curated models (GLM, MiMo, DeepSeek, Kimi, Qwen, MiniMax), and gpt-oss.

### Fixed

- `clawdboard sync --since <invalid-date>` no longer silently disables
  filtering. The CLI now throws with a clear error if the date can't be
  parsed.

### Privacy

Privacy boundary unchanged. Every new extractor reads only date, token
counts, cost, and model names — no prompts, file paths, project names,
or session IDs. The strict Zod allowlist in `src/schemas.ts` validates
every payload before upload.

## [0.2.x] and earlier

See git history at <https://github.com/morgen-so/clawdboard-oss/commits/main>.
