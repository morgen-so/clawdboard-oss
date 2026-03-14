/**
 * Tool/source registry for stats pages.
 * Shared between /stats/tools and /stats/tools/[tool].
 */

export interface ToolMeta {
  slug: string;
  name: string;
  color: string;
  provider: string;
  description: string;
  website: string;
}

export const TOOL_REGISTRY: Record<string, ToolMeta> = {
  "claude-code": {
    slug: "claude-code",
    name: "Claude Code",
    color: "#F9A615",
    provider: "Anthropic",
    description:
      "Anthropic's official CLI for Claude. An agentic coding assistant that works directly in your terminal with full access to your codebase.",
    website: "https://claude.ai/claude-code",
  },
  opencode: {
    slug: "opencode",
    name: "OpenCode",
    color: "#3b82f6",
    provider: "Community",
    description:
      "An open-source terminal-based AI coding assistant that supports multiple LLM providers. Designed as a flexible alternative with provider-agnostic model support.",
    website: "https://github.com/opencode-ai/opencode",
  },
  codex: {
    slug: "codex",
    name: "Codex CLI",
    color: "#10b981",
    provider: "OpenAI",
    description:
      "OpenAI's command-line coding agent that uses GPT-4o and o-series models. Brings OpenAI's models to the terminal for code generation and editing.",
    website: "https://github.com/openai/codex",
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
      description: `An AI coding tool tracked on clawdboard.`,
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
