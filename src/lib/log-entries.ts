interface LogItem {
  title: string;
  type: "feature" | "fix" | "improvement";
  description: string;
  image?: string; // path relative to /public, e.g. "/log/recap-stories.png"
}

export interface LogEntry {
  date: string; // YYYY-MM-DD
  items: LogItem[];
}

export const logEntries: LogEntry[] = [
  {
    date: "2026-05-05",
    items: [
      {
        title: "Deleting local sessions no longer shrinks your YTD",
        type: "fix",
        description:
          "Previously, if you cleared old Claude Code session files to reclaim disk space, your next sync would overwrite the server's per-day totals with the smaller numbers — silently erasing past usage from your dashboard. The sync endpoint now keeps the higher value per (date, source, machine), so deleting local files is non-destructive. To genuinely correct an inflated day (e.g. after a CLI bug double-counted), run `clawdboard sync --reset` to overwrite the server totals with your current local numbers.",
      },
    ],
  },
  {
    date: "2026-05-04",
    items: [
      {
        title: "Claude Code Desktop usage now tracked",
        type: "feature",
        description:
          "clawdboard now captures Claude Code Desktop sessions (Cowork and Dispatch) alongside the CLI. After your next sync, desktop usage shows up as its own source on your profile and the leaderboard so you can see how much work you're doing in each environment.",
      },
      {
        title: "Three new tools: Gemini CLI, Copilot CLI, Antigravity",
        type: "feature",
        description:
          "Added support for Google Gemini CLI, GitHub Copilot CLI, and Google Antigravity. Antigravity is opt-in (run `clawdboard antigravity enable`) since it requires hitting Google's usage API. Each shows up as a separate source on your profile and the leaderboard.",
      },
      {
        title: "OpenCode now split by provider tier",
        type: "improvement",
        description:
          "OpenCode usage is broken out by tier — OpenCode Go and OpenCode Zen sessions now appear separately from your Anthropic, OpenAI, or OpenRouter usage routed through OpenCode. Previously everything was bucketed under a single \"OpenCode\" total, which hid which subscription you were actually using. Older data is reassigned on your next sync.",
      },
      {
        title: "Mobile, accessibility, and visual polish",
        type: "improvement",
        description:
          "A round of design fixes: stronger contrast on muted text for WCAG AA compliance, a global focus-visible ring for keyboard navigation, headlines that scale with viewport, structured skeletons on profile charts while data loads, larger touch targets on time-filter pills, and several mobile fixes (leaderboard no longer overflows, footer nav wraps, long usernames wrap).",
      },
      {
        title: "Team creation reliability and tighter security defaults",
        type: "fix",
        description:
          "Creating a team is now atomic — a failure mid-creation no longer leaves orphaned, unreachable teams in your account. The CLI also stores its config token with restrictive 0600 permissions (previously world-readable on shared machines), and session lifetimes were shortened (user sessions 2 years → 30 days, admin sessions 24h → 4h). Existing sessions keep their current expiry.",
      },
    ],
  },
  {
    date: "2026-04-19",
    items: [
      {
        title: "More reliable leaderboard around the top of the hour",
        type: "fix",
        description:
          "The hourly job that refreshes the leaderboard was briefly taking the data offline while it rebuilt, causing occasional 500 errors on page loads and CLI sync requests near each refresh. It now refreshes in place without blocking reads or writes — the site stays available through every tick.",
      },
      {
        title: "Safer Codex config cleanup on upgrade",
        type: "improvement",
        description:
          "The Codex legacy-block cleanup now matches only the exact 3-line block we originally wrote, so any [[hooks.*]] sections or top-level `hooks = ...` assignments you added yourself are left untouched.",
      },
    ],
  },
  {
    date: "2026-04-17",
    items: [
      {
        title: "Fix Codex CLI hook installation",
        type: "fix",
        description:
          "The Codex auto-sync hook was writing to config.toml with unescaped quotes, which broke Codex's TOML parser and prevented the CLI from starting. It was also using the wrong file — Codex reads hooks from hooks.json, not config.toml. The CLI now writes a valid ~/.codex/hooks.json and sets features.codex_hooks = true in config.toml, and auto-heals any legacy broken block on upgrade. Affected users: run `npx clawdboard@latest setup` (or manually delete the `# clawdboard auto-sync` block from ~/.codex/config.toml first if Codex won't start).",
      },
    ],
  },
  {
    date: "2026-04-01",
    items: [
      {
        title: "Auto-migrate from PostToolUse to Stop hook",
        type: "fix",
        description:
          "The auto-sync hook was firing on every tool call instead of once per session, causing unnecessary CPU usage — especially with multiple concurrent sessions. This update auto-migrates your hook to the Stop event (fires once when a session ends) with a shell-level debounce. The migration happens automatically on your next sync. If you want to fix it immediately, run: clawdboard setup",
      },
    ],
  },
  {
    date: "2026-03-31",
    items: [
      {
        title: "Faster hook-sync startup",
        type: "improvement",
        description:
          "The auto-sync hook now detects if clawdboard is globally installed and calls it directly, skipping npm package resolution overhead. Falls back to npx for users without a global install.",
      },
    ],
  },
  {
    date: "2026-03-14",
    items: [
      {
        title: "Multi-tool support: OpenCode & Codex CLI",
        type: "feature",
        description:
          "clawdboard now tracks usage from OpenCode and Codex CLI alongside Claude Code. Your profile and leaderboard stats automatically break down usage by tool.",
      },
      {
        title: "Weekly & monthly recap stories",
        type: "feature",
        description:
          "Your profile now shows weekly and monthly recap cards with generative visuals — a quick snapshot of your usage patterns, top models, and activity streaks.",
        image: "/log/recap-stories.png",
      },
      {
        title: "Changelog page",
        type: "feature",
        description:
          "You're looking at it. clawdboard now has a changelog so you can keep up with new features and fixes.",
      },
      {
        title: "Contribute page",
        type: "feature",
        description:
          "New contribute page linked from the footer with ways to get involved — report bugs, request features, submit PRs, or help with translations.",
      },
      {
        title: "Updated pricing for Claude 4.6 & Gemini models",
        type: "improvement",
        description:
          "The CLI now uses current pricing for Claude 4.6 and Gemini models, so your cost estimates stay accurate as providers update their rates.",
      },
    ],
  },
  {
    date: "2025-03-12",
    items: [
      {
        title: "Better badge wizard experience",
        type: "improvement",
        description:
          "Improved the badge setup wizard for users who don't have a GitHub profile README yet. The wizard now detects this and guides you through creating one before adding your clawdboard badge.",
      },
    ],
  },
  {
    date: "2025-03-11",
    items: [
      {
        title: "Smarter sync hook",
        type: "fix",
        description:
          "Moved the auto-sync hook from PostToolUse to Stop with shell-level debounce. This prevents redundant syncs during rapid tool calls and reduces unnecessary API traffic.",
      },
      {
        title: "Team stats refresh on membership changes",
        type: "fix",
        description:
          "Team stats cache now invalidates when members join or leave. Previously, the leaderboard could show stale team totals until the next hourly refresh.",
      },
    ],
  },
  {
    date: "2025-03-10",
    items: [
      {
        title: "Teams are public by default",
        type: "improvement",
        description:
          "New teams are now public by default so they show up on the teams leaderboard immediately. You can still make your team private in team settings.",
      },
    ],
  },
  {
    date: "2025-03-09",
    items: [
      {
        title: "Team invites and notifications",
        type: "feature",
        description:
          "You can now invite people to your team directly from clawdboard. Invitees get a notification with a one-click join link. Team owners can manage pending invites from team settings.",
      },
    ],
  },
  {
    date: "2025-03-08",
    items: [
      {
        title: "Improved charts for single-day views",
        type: "improvement",
        description:
          "Single-day chart selections now show a proper bar chart instead of a confusing single-point line. Empty states and hover cursors were also cleaned up.",
      },
    ],
  },
  {
    date: "2025-03-07",
    items: [
      {
        title: "All signed-up users visible on leaderboard",
        type: "fix",
        description:
          "Users who signed up but haven't synced yet now appear on the leaderboard with zero stats instead of being invisible. This makes it easier to find and invite teammates.",
      },
      {
        title: "Cache tokens counted in totals",
        type: "fix",
        description:
          "Cache read and creation tokens are now included in total token counts across the leaderboard and team views. Previously only input and output tokens were summed.",
      },
    ],
  },
  {
    date: "2025-03-05",
    items: [
      {
        title: "Custom date range picker",
        type: "feature",
        description:
          "Added a custom date range picker to the time filter. Select any start and end date to see usage stats for exactly the period you care about.",
      },
    ],
  },
  {
    date: "2025-03-03",
    items: [
      {
        title: "Internationalization support",
        type: "feature",
        description:
          "clawdboard is now available in English, French, German, and Spanish. The site auto-detects your browser language and you can switch manually from the header.",
      },
    ],
  },
];
