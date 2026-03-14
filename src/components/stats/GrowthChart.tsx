"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { GrowthPoint } from "@/lib/db/stats";
import { TOOLTIP_STYLES } from "@/lib/chart-utils";

const COLOR = "#10b981";

export function GrowthChart({ data }: { data: GrowthPoint[] }) {
  if (data.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-foreground">
          Community Growth
        </h3>
        <p className="text-xs text-muted font-mono mt-0.5">
          Cumulative registered developers by week
        </p>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <AreaChart
          data={data}
          margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={COLOR} stopOpacity={0.3} />
              <stop offset="95%" stopColor={COLOR} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border-color)"
            vertical={false}
          />
          <XAxis
            dataKey="week"
            stroke="var(--muted)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={60}
          />
          <YAxis
            stroke="var(--muted)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.05)" }}
            {...TOOLTIP_STYLES}
            formatter={(value: number | undefined, name: string | undefined) => {
              const v = value ?? 0;
              if (name === "cumulativeUsers")
                return [v.toLocaleString(), "Total Users"];
              return [String(v), name ?? ""];
            }}
            labelFormatter={(label) => `Week of ${label}`}
          />
          <Area
            type="monotone"
            dataKey="cumulativeUsers"
            stroke={COLOR}
            strokeWidth={2}
            fill="url(#growthGrad)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
