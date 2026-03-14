/** Shared constants and utilities for recharts components */

export const MODEL_COLORS = [
  "#F9A615", // marigold (accent)
  "#3b82f6", // blue
  "#10b981", // emerald
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
  "#6366f1", // indigo
];

export const COST_COLOR = "#F9A615";
export const TOKENS_COLOR = "#06b6d4";

export const TOOLTIP_STYLES = {
  contentStyle: {
    backgroundColor: "#111113",
    border: "1px solid #23232a",
    borderRadius: "8px",
    fontSize: "12px",
    color: "#fafafa",
  },
  itemStyle: { color: "#fafafa" } as const,
  labelStyle: { color: "#a1a1aa" } as const,
};

export const AXIS_COMMON = {
  stroke: "var(--muted)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

const MODEL_NAME_RE = /^claude-([a-z]+)-(\d+)(?:-(\d))?(?:-\d{6,})?$/;
const MODEL_NAME_LEGACY_RE = /^claude-(\d+)(?:-(\d))?-([a-z]+)(?:-\d{6,})?$/;

/**
 * Map raw API model IDs to friendly display names.
 * e.g., "claude-opus-4-5-20251101" -> "Opus 4.5"
 */
export function friendlyModelName(raw: string): string {
  const m = raw.match(MODEL_NAME_RE);
  if (m) {
    const family = m[1].charAt(0).toUpperCase() + m[1].slice(1);
    const version = m[3] ? `${m[2]}.${m[3]}` : m[2];
    return `${family} ${version}`;
  }
  const legacy = raw.match(MODEL_NAME_LEGACY_RE);
  if (legacy) {
    const version = legacy[2] ? `${legacy[1]}.${legacy[2]}` : legacy[1];
    const family = legacy[3].charAt(0).toUpperCase() + legacy[3].slice(1);
    return `${family} ${version}`;
  }
  return raw;
}
