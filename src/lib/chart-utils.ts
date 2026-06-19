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
/** Second series when overlaying another user's usage for comparison. */
export const COMPARE_COLOR = "#8b5cf6"; // violet

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
