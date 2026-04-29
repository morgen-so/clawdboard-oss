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
    website: "https://opencode.ai/",
  },
  "opencode-go": {
    slug: "opencode-go",
    name: "OpenCode Go",
    color: "#facc15",
    provider: "OpenCode",
    description:
      "OpenCode's Go subscription tier — a curated set of high-performance open-source models (GLM, MiMo, DeepSeek, Kimi, Qwen, MiniMax) accessed through the OpenCode TUI.",
    website: "https://opencode.ai/go",
  },
  "opencode-zen": {
    slug: "opencode-zen",
    name: "OpenCode Zen",
    color: "#a78bfa",
    provider: "OpenCode",
    description:
      "OpenCode's pay-as-you-go provider tier offering curated open-source models without a subscription, billed by usage through the OpenCode TUI.",
    website: "https://opencode.ai/zen",
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
  "gemini-cli": {
    slug: "gemini-cli",
    name: "Gemini CLI",
    color: "#8b5cf6",
    provider: "Google",
    description:
      "Google's official command-line coding agent powered by the Gemini family of models. Open source, with built-in multimodal and tool-use capabilities.",
    website: "https://github.com/google-gemini/gemini-cli",
  },
  antigravity: {
    slug: "antigravity",
    name: "Antigravity",
    color: "#06b6d4",
    provider: "Google",
    description:
      "Google's agent-first IDE — a VS Code fork with deeply-integrated agentic workflows powered by Gemini 3 and other frontier models.",
    website: "https://antigravity.google/",
  },
  "copilot-cli": {
    slug: "copilot-cli",
    name: "GitHub Copilot CLI",
    color: "#94a3b8",
    provider: "GitHub",
    description:
      "GitHub's agentic command-line coding assistant. Multi-model support (Claude, GPT, etc.) billed in premium-request units alongside token-level metrics.",
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
