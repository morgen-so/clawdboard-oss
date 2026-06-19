/**
 * Model pricing for cost calculation.
 *
 * Used to calculate costs from token counts when the source data
 * doesn't include cost (e.g., OpenCode message files always have cost: 0).
 *
 * Pricing resolution order (see getModelPricing):
 *   1. Live LiteLLM pricing (litellm-pricing.ts) — fetched at sync time and
 *      disk-cached for 24h, so newly launched models are priced correctly
 *      without a CLI release.
 *   2. The static PRICING_TABLE below — offline fallback, plus models that
 *      LiteLLM doesn't carry (OpenCode Zen tier).
 *   3. DEFAULT_PRICING for anything unrecognized.
 *
 * Prices are per 1M tokens in USD. Cache write = 5-minute TTL rate.
 * A weekly GitHub Action checks the static table for drift against LiteLLM
 * and opens a PR if needed.
 *
 * Sources:
 *   Anthropic — https://platform.claude.com/docs/en/about-claude/pricing
 *   OpenAI   — https://platform.openai.com/docs/pricing
 *   Google   — https://ai.google.dev/gemini-api/docs/pricing
 *
 * Last verified: 2026-06-10
 */

import { lookupLivePricing, normalizeModelId } from "./litellm-pricing.js";

export interface ModelPricing {
  input: number; // USD per 1M input tokens
  output: number; // USD per 1M output tokens
  cacheWrite: number; // USD per 1M cache creation tokens (0 if N/A)
  cacheRead: number; // USD per 1M cache read tokens (0 if N/A)
}

/**
 * Pricing table keyed by model ID prefix.
 * Lookups strip date suffixes (e.g., "claude-sonnet-4-20250514" → "claude-sonnet-4").
 *
 * IMPORTANT: More-specific keys must come before less-specific ones.
 * "claude-opus-4-6" must be listed separately from "claude-opus-4" because
 * they have different prices ($5 vs $15 input).
 */
const PRICING_TABLE: Record<string, ModelPricing> = {
  // ── Anthropic Claude Fable 5 ─────────────────────────────────────────
  "claude-fable-5": { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 },

  // ── Anthropic Claude 4.6 ─────────────────────────────────────────────
  "claude-opus-4-6": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },

  // ── Anthropic Claude 4.5 ─────────────────────────────────────────────
  "claude-opus-4-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-sonnet-4-5": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },

  // ── Anthropic Claude 4.1 ─────────────────────────────────────────────
  "claude-opus-4-1": { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },

  // ── Anthropic Claude 4.0 ─────────────────────────────────────────────
  "claude-opus-4": { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  "claude-sonnet-4": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },

  // ── Anthropic Claude Haiku (latest) ──────────────────────────────────
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },

  // ── Anthropic Claude 3.5 family ──────────────────────────────────────
  "claude-3-5-sonnet": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-3-5-haiku": { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 },

  // ── Anthropic Claude 3 family ────────────────────────────────────────
  "claude-3-opus": { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  "claude-3-sonnet": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-3-haiku": { input: 0.25, output: 1.25, cacheWrite: 0.3, cacheRead: 0.03 },

  // ── OpenAI GPT-4o family ─────────────────────────────────────────────
  "gpt-4o": { input: 2.5, output: 10, cacheWrite: 0, cacheRead: 1.25 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cacheWrite: 0, cacheRead: 0.075 },

  // ── OpenAI o-series ──────────────────────────────────────────────────
  "o1": { input: 15, output: 60, cacheWrite: 0, cacheRead: 7.5 },
  "o1-mini": { input: 3, output: 12, cacheWrite: 0, cacheRead: 1.5 },
  "o3": { input: 2, output: 8, cacheWrite: 0, cacheRead: 0.5 },
  "o3-mini": { input: 1.1, output: 4.4, cacheWrite: 0, cacheRead: 0.55 },
  "o4-mini": { input: 1.1, output: 4.4, cacheWrite: 0, cacheRead: 0.275 },

  // ── Google Gemini ────────────────────────────────────────────────────
  "gemini-2.5-pro": { input: 1.25, output: 10, cacheWrite: 0, cacheRead: 0.125 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5, cacheWrite: 0, cacheRead: 0.03 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4, cacheWrite: 0, cacheRead: 0.01 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4, cacheWrite: 0, cacheRead: 0.025 },
  "gemini-2.0-flash-lite": { input: 0.075, output: 0.3, cacheWrite: 0, cacheRead: 0.01875 },

  // ── Google Gemini 3.x — VERIFY (rates not public; mirror 2.5 family) ─
  "gemini-3-pro": { input: 1.25, output: 10, cacheWrite: 0, cacheRead: 0 },
  "gemini-3-flash": { input: 0.3, output: 2.5, cacheWrite: 0, cacheRead: 0 },

  // ── OpenAI gpt-oss (open-weight; used via Antigravity) ───────────────
  "gpt-oss-120b": { input: 0.5, output: 1.5, cacheWrite: 0, cacheRead: 0 },
  "gpt-oss-20b": { input: 0.1, output: 0.4, cacheWrite: 0, cacheRead: 0 },

  // ── OpenCode Zen-tier curated open-source models — VERIFY ────────────
  // Used via providerID "opencode-go" / "opencode-zen". Rates are estimates
  // based on each provider's public API pricing as of 2026-04; OpenCode Zen
  // pricing may differ. Update when published rates are available.
  "glm-5.1": { input: 0.5, output: 2.0, cacheWrite: 0, cacheRead: 0 },
  "mimo-v2.5-pro": { input: 0.3, output: 1.2, cacheWrite: 0, cacheRead: 0 },
  "deepseek-v4-pro": { input: 0.27, output: 1.1, cacheWrite: 0, cacheRead: 0 },
  "kimi-k2.6": { input: 0.6, output: 2.5, cacheWrite: 0, cacheRead: 0 },
  "qwen3": { input: 0.4, output: 1.2, cacheWrite: 0, cacheRead: 0 },
  "minimax": { input: 0.2, output: 1.1, cacheWrite: 0, cacheRead: 0 },
};

/** Fallback pricing for unrecognized models — conservative mid-range estimate. */
const DEFAULT_PRICING: ModelPricing = {
  input: 3,
  output: 15,
  cacheWrite: 3.75,
  cacheRead: 0.3,
};

/**
 * Look up pricing for a model ID.
 * Live LiteLLM pricing first (exact match), then the static table
 * (exact match on normalized ID, then progressively shorter prefixes).
 * Normalization (date + bracket suffix stripping) is shared with the
 * live-table lookup — see normalizeModelId in litellm-pricing.ts.
 */
export function getModelPricing(modelId: string): ModelPricing {
  // Live pricing covers models launched after this CLI version shipped.
  const live = lookupLivePricing(modelId);
  if (live) return live;

  const normalized = normalizeModelId(modelId);

  // Exact match
  if (PRICING_TABLE[normalized]) {
    return PRICING_TABLE[normalized];
  }

  // Try progressively shorter prefixes (e.g., "claude-3-5-sonnet-v2" → "claude-3-5-sonnet")
  // Start from the full split length so that 2-part names like "kimi-k2.6" are also
  // checked against their first part ("kimi") when no exact match exists.
  const parts = normalized.split("-");
  for (let i = parts.length - 1; i >= 1; i--) {
    const prefix = parts.slice(0, i).join("-");
    if (PRICING_TABLE[prefix]) {
      return PRICING_TABLE[prefix];
    }
  }

  return DEFAULT_PRICING;
}

/**
 * Calculate cost from token counts and model ID.
 * Returns cost in USD.
 */
export function calculateCost(
  modelId: string,
  tokens: {
    input: number;
    output: number;
    cacheCreation: number;
    cacheRead: number;
  }
): number {
  const pricing = getModelPricing(modelId);

  return (
    (tokens.input * pricing.input) / 1_000_000 +
    (tokens.output * pricing.output) / 1_000_000 +
    (tokens.cacheCreation * pricing.cacheWrite) / 1_000_000 +
    (tokens.cacheRead * pricing.cacheRead) / 1_000_000
  );
}
