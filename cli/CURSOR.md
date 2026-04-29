# Cursor extraction architecture

This document describes how clawdboard's CLI extracts AI usage data from
[Cursor](https://cursor.com) — the IDE that ships its own chat panel and agent
mode. Source code lives in [`src/cursor.ts`](src/cursor.ts).

## Where Cursor stores its data

Cursor is an Electron app that persists chat/agent state in a single SQLite
database (`state.vscdb`) under its global storage directory:

| OS      | Path                                                                  |
| ------- | --------------------------------------------------------------------- |
| Windows | `%APPDATA%\Cursor\User\globalStorage\state.vscdb`                     |
| macOS   | `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` |
| Linux   | `~/.config/Cursor/User/globalStorage/state.vscdb`                     |

The path can be overridden via `CURSOR_DATA_DIR` (must be the full path to
`state.vscdb`, not the parent directory).

While Cursor is running it holds an exclusive SQLite lock on the file. The
extractor copies `state.vscdb` to the OS temp directory before opening it
read-only, then deletes the copy on the way out.

## Relevant SQLite schema

Cursor uses two tables:

- `ItemTable(key TEXT PRIMARY KEY, value BLOB)` — VS Code-style key/value
  settings, machine ID, telemetry counters, etc. **Not used for extraction.**
- `cursorDiskKV(key TEXT PRIMARY KEY, value BLOB)` — Cursor's per-conversation
  storage. The `value` is a UTF-8 JSON document.

Within `cursorDiskKV`, only two key prefixes are read by this extractor:

| Key prefix                          | Purpose                                                                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `composerData:{composerId}`         | Per-conversation metadata. Holds `createdAt` (epoch ms), and depending on schema version, `modelConfig.modelName` and/or `usageData: {model: {costInCents, amount}}`. |
| `bubbleId:{composerId}:{bubbleId}`  | Individual messages. The relevant fields are `tokenCount: {inputTokens, outputTokens}` and the optional `timingInfo.clientStartTime` (epoch ms).                    |

Other prefixes (`messageRequestContext:*`, `checkpointId:*`, `codeBlockDiff:*`,
`inlineDiffs-*`, etc.) are ignored — they hold prompts, code, and diffs, none
of which clawdboard reads.

## The extraction algorithm

Implemented in [`extractCursorData()`](src/cursor.ts):

1. **Resolve the database path** for the current platform; bail with `[]` if
   the file doesn't exist.
2. **Copy `state.vscdb` to a temp file** so the read can't be blocked by
   Cursor's exclusive lock.
3. **Open the temp DB read-only** with `better-sqlite3`.
4. **Build a composer metadata map** by scanning every `composerData:*` row
   (`buildComposerMeta`). For each composer extract:
   - `createdAt` (epoch ms; rejected if implausibly small).
   - Candidate model names, ordered by reliability:
     1. Keys of `usageData` (older `_v: 3, 6` composers — also gives us cost).
     2. `modelConfig.modelName` (newer `_v: 9+` composers — but the literal
        string `"default"` is **skipped** because it's a UI placeholder, not
        a real model name).
     3. Fallback: `"cursor-mixed"`.
   - The raw `usageData` map (model → `{costInCents, amount}`).
5. **Iterate every `bubbleId:{cid}:{bid}` row** (`collectBubbleRecords`):
   - Skip rows where `tokenCount` is missing or both `inputTokens` and
     `outputTokens` are zero.
   - Resolve a `YYYY-MM-DD` date by preferring `timingInfo.clientStartTime`
     (when present and post-2001), falling back to the parent composer's
     `createdAt`. If neither yields a valid date, drop the row.
   - Apply the optional `since` filter at this stage so we don't waste
     accumulator work.
6. **Distribute composer cost across its bubbles** (`distributeComposerCosts`),
   weighted by `(inputTokens + outputTokens)`. The last bubble in each composer
   receives the remainder so the per-composer sum equals
   `totalCostInCents` exactly (no rounding drift). Cents → dollars happens here.
7. **Accumulate** into the shared `Record<date, DayAccumulator>` map using the
   composer's primary model name.
8. **Convert and return** via `accumulatorToSyncDays(byDate, "cursor")`.

## Schema versioning notes

Cursor's `composerData` shape has evolved several times. The key version
markers found in this repo's data so far:

| `_v` | Token storage                                                  | Model info present                               |
| ---- | -------------------------------------------------------------- | ------------------------------------------------ |
| 1    | Inline `conversation[]` with embedded token totals             | None — `usageData` absent or empty.              |
| 2    | Separate `bubbleId:*` entries                                  | None.                                            |
| 3    | Separate `bubbleId:*` entries                                  | `usageData` populated with model → cost/amount. |
| 6    | Separate `bubbleId:*` entries                                  | `usageData` populated.                           |
| 9    | Separate `bubbleId:*` entries                                  | `modelConfig.modelName` (often `"default"`).     |
| 10+  | Separate `bubbleId:*` entries (older entries)                  | `modelConfig.modelName`.                         |
| 14, 15, 16 | **Server-side** — local `bubbleId:*` rows are not written | `modelConfig.modelName`.                         |

**The data cliff at ~Sep 2025.** Starting with `_v: 14+`, Cursor moved
conversation content (and per-bubble token counts) entirely to its servers.
The local DB still stores composer headers, encrypted blobs, and metadata —
but no `bubbleId:*` rows for those composers. This extractor therefore
returns nothing for sessions that ran on those versions. Recent usage requires
the Cursor account API and is **out of scope** for this module.

## Privacy

The extractor reads only the four shapes listed above. It never reads:

- `text`, `richText`, `richEditorJSON` — prompt and assistant message content.
- `relevantFiles`, `attachedCodeChunks`, `gitDiffs`, `recentlyViewedFiles` —
  project paths and code.
- `intermediateChunks`, `toolResults`, `summarizedComposers` — tool I/O and
  conversation summaries.
- `cursorRules`, `notepads`, `images`, `webReferences` — user-supplied content.

Everything that leaves the machine is funneled through the same Zod allowlist
(`SyncDaySchema` in [`schemas.ts`](src/schemas.ts)) used by the other
extractors. See [`README.md`](README.md#privacy) for the broader privacy
guarantee.

## Why a fourth extractor instead of extending an existing one?

Each existing extractor (`opencode.ts`, `codex.ts`, ccusage for Claude Code)
reads from a single tool's native on-disk format. Cursor's format — SQLite
with JSON-encoded blobs spread across two key prefixes — has nothing in
common with the others, and the OS-aware path resolution differs too. Mirroring
the existing per-source pattern keeps each extractor's failure modes isolated
and makes the orchestration in [`extract.ts`](src/extract.ts) trivial to read.
