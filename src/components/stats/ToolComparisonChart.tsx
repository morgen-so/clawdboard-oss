"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import { TOOLTIP_STYLES, AXIS_COMMON } from "@/lib/chart-utils";

interface ToolComparisonPoint {
  date: string;
  claudeCode: number;
  opencode: number;
  codex: number;
  cursor: number;
}

interface ToolComparisonChartProps {
  data: ToolComparisonPoint[];
}

const TOOL_CONFIG = [
  { key: "claudeCode", label: "Claude Code", color: "#F9A615" },
  { key: "opencode", label: "OpenCode", color: "#3b82f6" },
  { key: "codex", label: "Codex CLI", color: "#10b981" },
  { key: "cursor", label: "Cursor", color: "#a855f7" },
] as const;

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function movingAverage(
  data: ToolComparisonPoint[],
  window = 7
): ToolComparisonPoint[] {
  return data.map((point, i) => {
    const start = Math.max(0, i - window + 1);
    const slice = data.slice(start, i + 1);
    const n = slice.length;
    return {
      date: point.date,
      claudeCode: slice.reduce((s, p) => s + p.claudeCode, 0) / n,
      opencode: slice.reduce((s, p) => s + p.opencode, 0) / n,
      codex: slice.reduce((s, p) => s + p.codex, 0) / n,
      cursor: slice.reduce((s, p) => s + p.cursor, 0) / n,
    };
  });
}

export function ToolComparisonChart({ data }: ToolComparisonChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-muted">No trend data available yet</p>
      </div>
    );
  }

  const smoothed = movingAverage(data);

  return (
    <div>
      <ResponsiveContainer width="100%" height={350}>
        <AreaChart data={smoothed} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="date"
            {...AXIS_COMMON}
            tickFormatter={formatDate}
            interval="preserveStartEnd"
            minTickGap={40}
          />
          <YAxis
            {...AXIS_COMMON}
            tickFormatter={(v: number) =>
              v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v.toFixed(0)}`
            }
          />
          <Tooltip
            {...TOOLTIP_STYLES}
            labelFormatter={(label) => formatDate(String(label))}
            formatter={(value, name) => [
              `$${(Number(value) || 0).toFixed(2)}`,
              String(name),
            ]}
          />
          <Legend
            verticalAlign="top"
            iconType="circle"
            wrapperStyle={{ fontSize: "12px", paddingBottom: "8px" }}
          />
          {TOOL_CONFIG.map((tool) => (
            <Area
              key={tool.key}
              type="monotone"
              dataKey={tool.key}
              name={tool.label}
              stroke={tool.color}
              fill={tool.color}
              fillOpacity={0.1}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      <p className="mt-2 text-center font-mono text-[10px] text-dim">
        7-day moving average of estimated daily cost per tool
      </p>
    </div>
  );
}
