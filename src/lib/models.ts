/**
 * Model slug utilities for programmatic SEO pages.
 *
 * Raw model IDs (e.g., "claude-opus-4-5-20251101") are stored in JSONB.
 * URL slugs strip the date suffix: "claude-opus-4-5".
 * Pages match all raw IDs that produce the same slug.
 */

// Strip trailing date suffix (6–8 digits) from model IDs
const DATE_SUFFIX_RE = /-\d{6,8}$/;

/** Convert a raw model ID to a URL-safe slug. */
export function modelSlug(rawModelName: string): string {
  return rawModelName.replace(DATE_SUFFIX_RE, "");
}

/** Check if a raw model name matches a given slug. */
export function matchesSlug(rawModelName: string, slug: string): boolean {
  return modelSlug(rawModelName) === slug;
}

// ─── SEO metadata per model family ──────────────────────────────────────────

interface ModelSeoMeta {
  provider: string;
  tier: string;
  description: string;
  /** Keywords specific to this model family */
  keywords: string[];
}

const CLAUDE_BASE_KEYWORDS = [
  "claude code cost",
  "claude code usage",
  "ai coding statistics",
  "vibecoding",
];

const MODEL_SEO: Record<string, ModelSeoMeta> = {
  opus: {
    provider: "Anthropic",
    tier: "flagship",
    description:
      "the most capable model in Anthropic's Claude family, favored for complex coding tasks that require deep reasoning and extended context",
    keywords: [
      "claude opus cost",
      "claude opus usage",
      "claude opus statistics",
      "claude opus vs sonnet",
      "opus coding performance",
      ...CLAUDE_BASE_KEYWORDS,
    ],
  },
  sonnet: {
    provider: "Anthropic",
    tier: "balanced",
    description:
      "Anthropic's balanced model offering strong coding ability with faster response times and lower cost per token than Opus",
    keywords: [
      "claude sonnet cost",
      "claude sonnet usage",
      "claude sonnet statistics",
      "claude sonnet vs opus",
      "sonnet coding performance",
      ...CLAUDE_BASE_KEYWORDS,
    ],
  },
  haiku: {
    provider: "Anthropic",
    tier: "fast",
    description:
      "Anthropic's fastest and most cost-efficient model, used for quick coding tasks, autocomplete, and high-volume operations",
    keywords: [
      "claude haiku cost",
      "claude haiku usage",
      "claude haiku statistics",
      "haiku coding performance",
      ...CLAUDE_BASE_KEYWORDS,
    ],
  },
};

const OPENAI_BASE_KEYWORDS = [
  "codex cli usage",
  "opencode usage",
  "ai coding statistics",
  "openai coding cost",
];

/** Detect the model family from a slug and return SEO metadata. */
export function getModelSeoMeta(slug: string): ModelSeoMeta {
  // Claude models: claude-{family}-{version}
  const claudeMatch = slug.match(/^claude-([a-z]+)/);
  if (claudeMatch) {
    const family = claudeMatch[1];
    if (MODEL_SEO[family]) return MODEL_SEO[family];
    // Unknown Claude family — generic
    return {
      provider: "Anthropic",
      tier: "AI",
      description: `an Anthropic Claude model used for AI-assisted coding`,
      keywords: [...CLAUDE_BASE_KEYWORDS],
    };
  }

  // GPT-4o variants
  if (slug.startsWith("gpt-4o")) {
    return {
      provider: "OpenAI",
      tier: "flagship",
      description:
        "OpenAI's multimodal flagship model, used through Codex CLI and OpenCode for AI-assisted development",
      keywords: [
        "gpt-4o cost",
        "gpt-4o usage",
        "gpt-4o coding",
        "gpt-4o statistics",
        ...OPENAI_BASE_KEYWORDS,
      ],
    };
  }

  // OpenAI o-series reasoning models
  if (/^o\d/.test(slug)) {
    return {
      provider: "OpenAI",
      tier: "reasoning",
      description:
        "an OpenAI reasoning model designed for complex problem-solving, used through Codex CLI and OpenCode",
      keywords: [
        `${slug} cost`,
        `${slug} usage`,
        `${slug} coding`,
        "openai reasoning model",
        ...OPENAI_BASE_KEYWORDS,
      ],
    };
  }

  // OpenAI gpt-oss (open-weight; used via Antigravity and OpenRouter)
  if (slug.startsWith("gpt-oss")) {
    return {
      provider: "OpenAI",
      tier: "open-weight",
      description:
        "OpenAI's open-weight model series, used through Antigravity and OpenCode-compatible providers",
      keywords: [
        `${slug} cost`,
        `${slug} usage`,
        `${slug} coding`,
        "open weight model",
        ...OPENAI_BASE_KEYWORDS,
      ],
    };
  }

  // Google Gemini family
  if (slug.startsWith("gemini")) {
    const isPro = /pro/.test(slug);
    const isFlash = /flash/.test(slug);
    return {
      provider: "Google",
      tier: isPro ? "flagship" : isFlash ? "fast" : "balanced",
      description: isPro
        ? "Google's flagship Gemini model, used through Gemini CLI and Antigravity for complex coding tasks"
        : isFlash
          ? "Google's fast and cost-efficient Gemini model, used for high-volume coding operations"
          : "Google's Gemini family of multimodal models for AI-assisted development",
      keywords: [
        `${slug} cost`,
        `${slug} usage`,
        `${slug} coding`,
        "gemini cli usage",
        "google gemini cost",
        "ai coding statistics",
      ],
    };
  }

  // OpenCode Zen-tier curated open-source models
  // (GLM, MiMo, DeepSeek, Kimi, Qwen, MiniMax) — used via opencode-go / opencode-zen
  const ZEN_MATCH: Record<string, { provider: string; family: string }> = {
    glm: { provider: "Zhipu AI", family: "GLM" },
    mimo: { provider: "Xiaomi MiMo", family: "MiMo" },
    deepseek: { provider: "DeepSeek", family: "DeepSeek" },
    kimi: { provider: "Moonshot AI", family: "Kimi" },
    qwen: { provider: "Alibaba", family: "Qwen" },
    minimax: { provider: "MiniMax", family: "MiniMax" },
  };
  for (const [prefix, meta] of Object.entries(ZEN_MATCH)) {
    if (slug.startsWith(prefix)) {
      return {
        provider: meta.provider,
        tier: "open-source",
        description: `${meta.family}, an open-source model used through OpenCode Zen and OpenCode Go for AI-assisted coding`,
        keywords: [
          `${slug} cost`,
          `${slug} usage`,
          `${slug} coding`,
          `${meta.family.toLowerCase()} model statistics`,
          "open source ai coding",
          "opencode zen usage",
        ],
      };
    }
  }

  // Fallback
  return {
    provider: "Unknown",
    tier: "AI",
    description: "an AI model tracked through clawdboard for coding usage",
    keywords: ["ai coding cost", "ai coding usage", "ai model statistics"],
  };
}
