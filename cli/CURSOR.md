# Cursor extraction architecture

This document describes how clawdboard's CLI extracts AI usage data from
[Cursor](https://cursor.com) — the IDE that ships its own chat panel and agent
mode.

There are **two extractors** that together cover Cursor's full history:

| File | Covers | Source |
|---|---|---|
| [`src/cursor.ts`](src/cursor.ts) | Pre-Sep-2025 (legacy local format) | SQLite `state.vscdb` on disk |
| [`src/cursor-api.ts`](src/cursor-api.ts) | Post-Sep-2025 (server-side era) | `cursor.com` dashboard API |

Both extractors emit `source: "cursor"`. They run concurrently from
[`extract.ts`](src/extract.ts) and their results are concatenated.

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

---

# Server-side extraction (post-Sep 2025)

After the schema cliff described above, Cursor stopped writing per-bubble
token counts locally. To recover that data we call Cursor's own dashboard
API — the same endpoint the in-app Settings → Usage panel hits. Implemented
in [`src/cursor-api.ts`](src/cursor-api.ts).

## Where the auth comes from

Cursor's renderer is a Chromium webview, so it caches authenticated HTTP
responses to a Chromium-style disk cache:

| OS      | Cache file                                                              |
| ------- | ----------------------------------------------------------------------- |
| Windows | `%APPDATA%\Cursor\Cache\Cache_Data\data_1`                              |
| macOS   | `~/Library/Application Support/Cursor/Cache/Cache_Data/data_1`          |
| Linux   | `~/.config/Cursor/Cache/Cache_Data/data_1`                              |

Override via the `CURSOR_CACHE_DATA` env var (full path).

When Cursor checks for updates or fetches authenticated resources, the
`Authorization` / `Cookie` header value gets stored in the cached response
metadata. We scan the binary cache file for the JWT pattern `eyJ…\.eyJ…\.…`
and decode every match, then pick the right one:

1. Filter to JWTs whose `iss` claim ends with `cursor.sh`
   (other extensions stash unrelated JWTs in this same file).
2. Among those, prefer the JWT **without** a `type: "session"` claim — that's
   the long-lived `offline_access` token (typical `exp` is decades out).
3. If none of those are present, fall back to the still-valid `type: "session"`
   token with the latest `exp` (less ideal but better than nothing).
4. Read the `sub` claim, which looks like `auth0|<userId>` — strip the prefix
   to get the bare `userId`.

Nothing user-specific is hardcoded in the source — the JWT and userId are read
from disk at runtime, only ever held in memory, and used as the
`WorkosCursorSessionToken=<userId>::<jwt>` cookie value when calling the API.

## The endpoint

```
POST https://cursor.com/api/dashboard/get-aggregated-usage-events
Origin: https://cursor.com
Referer: https://cursor.com/dashboard
Cookie: WorkosCursorSessionToken=<urlencoded(userId::jwt)>
Content-Type: application/json

{ "startDate": <epoch_ms>, "endDate": <epoch_ms>,
  "page": 1, "pageSize": 100, "teamId": 0 }
```

Returns:

```jsonc
{
  "aggregations": [
    {
      "modelIntent": "claude-4.5-sonnet-thinking",
      "inputTokens": "517",
      "outputTokens": "16530",
      "cacheWriteTokens": "54805",
      "cacheReadTokens": "1088371",
      "totalCents": 78.153095,
      "tier": 1
    },
    ...
  ],
  "totalInputTokens": "...",
  "totalOutputTokens": "...",
  "totalCacheWriteTokens": "...",
  "totalCacheReadTokens": "...",
  "totalCostCents": 195.30955399999996
}
```

The `aggregations` are aggregated by `modelIntent` over the date window — so
to get **per-day** breakdown we call once per UTC day (24-hour window) and
attach each row to that date. Empty days are skipped. Days with model presence
but zero everywhere (free-plan use that didn't generate billable events) are
also skipped — the local-DB extractor covers them more accurately when
applicable.

## Algorithm

Implemented in [`extractCursorApiData()`](src/cursor-api.ts):

1. **Locate auth.** Read the disk-cache file; abort with `[]` if missing.
2. **Find the right JWT** by the rules above; abort with `[]` if none.
3. **Resolve the date range.** Honor `since` if given (YYYY-MM-DD); otherwise
   default to today minus 365 days.
4. **Loop one UTC day at a time.** For each day, build a 24-hour window in
   epoch ms, POST to the API. On 429/5xx, retry with exponential backoff (up
   to 2 retries). On persistent failure, skip the day and continue.
5. **Aggregate.** For every non-empty aggregation, push into the shared
   `accumulate(byDate, date, modelIntent, …)`. Cents are converted to dollars.
6. **Return** via `accumulatorToSyncDays(byDate, "cursor")`.

A 50 ms sleep between calls keeps us comfortably under any sane rate limit.
For a year-long backfill that's about 18 seconds total.

## What the model names look like

The API uses `modelIntent` strings — sometimes a real model identifier, but
sometimes a Cursor-internal classifier. Examples observed:

| modelIntent | What it is |
|---|---|
| `claude-4.5-sonnet-thinking`, `claude-3.7-sonnet`, `gpt-5.2-codex`, etc. | Real upstream model used |
| `composer-1`, `composer-1.5` | Cursor's internal composer router for multi-step agent runs |
| `agent_review` | Cursor's agent-review pass |
| `default` | Whatever the user's selected default was at the time |

These are passed through as-is to clawdboard's `modelsUsed` and
`modelBreakdowns[].modelName`. Pricing is taken from the API's `totalCents`
(no need to re-derive from token counts via [`pricing.ts`](src/pricing.ts)).

## Privacy

Same allowlist as every other extractor. The only outbound HTTP call is to
Cursor's own dashboard API, with the user's existing auth, sending only the
date window we want totals for. The response is mapped through Zod via the
shared `SyncDaySchema`. No prompts, code, file paths, project names, or
session IDs are read or transmitted at any point.
