/**
 * Model display names and per-family SEO metadata.
 *
 * Raw model IDs (e.g., "claude-opus-4-5-20251101") are stored in JSONB;
 * URL slugs strip the date suffix ("claude-opus-4-5", done in SQL via
 * regexp_replace when slugs are generated).
 */

// ─── Friendly display names ─────────────────────────────────────────────────

const MODEL_NAME_RE = /^claude-([a-z]+)-(\d+)(?:-(\d))?(?:-\d{6,})?$/;
const MODEL_NAME_LEGACY_RE = /^claude-(\d+)(?:-(\d))?-([a-z]+)(?:-\d{6,})?$/;

/**
 * Map raw API model IDs to friendly display names.
 * e.g., "claude-opus-4-5-20251101" -> "Opus 4.5"
 */
export function friendlyModelName(raw: string): string {
  // New-style: claude-{family}-{major}-{minor}-{date} or claude-{family}-{major}-{date}
  const m = raw.match(MODEL_NAME_RE);
  if (m) {
    const family = m[1].charAt(0).toUpperCase() + m[1].slice(1);
    const version = m[3] ? `${m[2]}.${m[3]}` : m[2];
    return `${family} ${version}`;
  }
  // Legacy: claude-{major}-{minor}-{family}-{date} or claude-{major}-{family}-{date}
  const legacy = raw.match(MODEL_NAME_LEGACY_RE);
  if (legacy) {
    const version = legacy[2] ? `${legacy[1]}.${legacy[2]}` : legacy[1];
    const family = legacy[3].charAt(0).toUpperCase() + legacy[3].slice(1);
    return `${family} ${version}`;
  }
  return raw;
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
