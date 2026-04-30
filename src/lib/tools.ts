/**
 * Tool/source registry for stats pages.
 * Shared between /stats/tools and /stats/tools/[tool].
 *
 * User-facing descriptions live in `messages/{locale}.json` under
 * `statsTools.toolDescriptions.<slug>` and are read via next-intl by the
 * consumer (`src/app/[locale]/stats/tools/page.tsx`).
 */

export interface ToolMeta {
  slug: string;
  name: string;
  color: string;
  provider: string;
  website: string;
}

export const TOOL_REGISTRY: Record<string, ToolMeta> = {
  "claude-code": {
    slug: "claude-code",
    name: "Claude Code",
    color: "#F9A615",
    provider: "Anthropic",
    website: "https://claude.ai/claude-code",
  },
  opencode: {
    slug: "opencode",
    name: "OpenCode",
    color: "#3b82f6",
    provider: "Community",
    website: "https://opencode.ai/",
  },
  "opencode-go": {
    slug: "opencode-go",
    name: "OpenCode Go",
    color: "#facc15",
    provider: "OpenCode",
    website: "https://opencode.ai/go",
  },
  "opencode-zen": {
    slug: "opencode-zen",
    name: "OpenCode Zen",
    color: "#a78bfa",
    provider: "OpenCode",
    website: "https://opencode.ai/zen",
  },
  codex: {
    slug: "codex",
    name: "Codex CLI",
    color: "#10b981",
    provider: "OpenAI",
    website: "https://github.com/openai/codex",
  },
  "gemini-cli": {
    slug: "gemini-cli",
    name: "Gemini CLI",
    color: "#8b5cf6",
    provider: "Google",
    website: "https://github.com/google-gemini/gemini-cli",
  },
  antigravity: {
    slug: "antigravity",
    name: "Antigravity",
    color: "#06b6d4",
    provider: "Google",
    website: "https://antigravity.google/",
  },
  "copilot-cli": {
    slug: "copilot-cli",
    name: "GitHub Copilot CLI",
    color: "#94a3b8",
    provider: "GitHub",
    website: "https://github.com/github/copilot-cli",
  },
};

const FALLBACK_COLOR = "#6366f1";

export function getToolMeta(slug: string): ToolMeta {
  return (
    TOOL_REGISTRY[slug] ?? {
      slug,
      name: slug,
      color: FALLBACK_COLOR,
      provider: "Unknown",
      website: "",
    }
  );
}

/** Build ordered list of tools from live breakdown data, sorted by cost desc */
export function getActiveTools(
  breakdown: { source: string; totalCost: number }[]
): ToolMeta[] {
  return [...breakdown]
    .sort((a, b) => b.totalCost - a.totalCost)
    .map((b) => getToolMeta(b.source));
}

/** Format tool names as "A, B, and C" or "A and B" etc. */
export function toolNameList(tools: ToolMeta[]): string {
  const names = tools.map((t) => t.name);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}
