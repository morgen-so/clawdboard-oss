"use client";

import { useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { format, parseISO } from "date-fns";
import type { DailyTrendPoint } from "@/lib/db/stats";
import { COST_COLOR, TOOLTIP_STYLES } from "@/lib/chart-utils";

type Metric = "cost" | "users";

const USERS_COLOR = "#3b82f6";

function formatCurrency(value: number): string {
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

function formatXAxisDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "MMM d");
  } catch {
    return dateStr;
  }
}

export function CommunityTrendChart({ data }: { data: DailyTrendPoint[] }) {
  const [metric, setMetric] = useState<Metric>("cost");

  // Compute 7-day moving average for cost
  const smoothedData = useMemo(() => {
    return data.map((point, i) => {
      const window = data.slice(Math.max(0, i - 6), i + 1);
      const avgCost = window.reduce((s, p) => s + p.cost, 0) / window.length;
      const avgUsers =
        window.reduce((s, p) => s + p.activeUsers, 0) / window.length;
      return {
        ...point,
        smoothCost: Math.round(avgCost * 100) / 100,
        smoothUsers: Math.round(avgUsers * 10) / 10,
      };
    });
  }, [data]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            Daily Community Usage
          </h3>
          <p className="text-xs text-muted font-mono mt-0.5">
            Last {data.length} days &middot; 7-day moving average
          </p>
        </div>
        <div className="flex items-center rounded-lg border border-border bg-background overflow-hidden">
          {(
            [
              { value: "cost", label: "Cost" },
              { value: "users", label: "Active Users" },
            ] as const
          ).map((m) => (
            <button
              key={m.value}
              onClick={() => setMetric(m.value)}
              className={`px-3 py-1.5 font-mono text-xs font-medium transition-colors whitespace-nowrap ${
                metric === m.value
                  ? "bg-accent text-background"
                  : "text-foreground/60 hover:text-foreground hover:bg-surface-hover"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <AreaChart
          data={smoothedData}
          margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="statsCostGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={COST_COLOR} stopOpacity={0.3} />
              <stop offset="95%" stopColor={COST_COLOR} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="statsUsersGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={USERS_COLOR} stopOpacity={0.3} />
              <stop offset="95%" stopColor={USERS_COLOR} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border-color)"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tickFormatter={formatXAxisDate}
            stroke="var(--muted)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={50}
          />
          {metric === "cost" && (
            <YAxis
              tickFormatter={formatCurrency}
              stroke="var(--muted)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={60}
            />
          )}
          {metric === "users" && (
            <YAxis
              stroke="var(--muted)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={40}
            />
          )}
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.05)" }}
            {...TOOLTIP_STYLES}
            formatter={(value: number | undefined, name: string | undefined) => {
              const v = value ?? 0;
              if (name === "smoothCost") return [`$${v.toFixed(2)}`, "Avg Daily Cost"];
              if (name === "smoothUsers") return [v.toFixed(1), "Avg Active Users"];
              return [String(v), name ?? ""];
            }}
            labelFormatter={(label) => formatXAxisDate(String(label))}
          />
          {metric === "cost" && (
            <Area
              type="monotone"
              dataKey="smoothCost"
              stroke={COST_COLOR}
              strokeWidth={2}
              fill="url(#statsCostGrad)"
            />
          )}
          {metric === "users" && (
            <Area
              type="monotone"
              dataKey="smoothUsers"
              stroke={USERS_COLOR}
              strokeWidth={2}
              fill="url(#statsUsersGrad)"
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
