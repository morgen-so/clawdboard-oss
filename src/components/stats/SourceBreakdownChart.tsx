"use client";

import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import { useTranslations } from "next-intl";

interface SourceDataPoint {
  source: string;
  totalCost: number;
  totalTokens: number;
  userCount: number;
}

interface SourceBreakdownChartProps {
  data: SourceDataPoint[];
}

const SOURCE_COLORS: Record<string, string> = {
  "claude-code": "#F9A615", // marigold (primary accent)
  opencode: "#3b82f6", // blue
  codex: "#10b981", // emerald
};

const SOURCE_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  codex: "Codex CLI",
};

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatTokens(count: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(count);
}

export function SourceBreakdownChart({ data }: SourceBreakdownChartProps) {
  const t = useTranslations("stats");

  if (data.length === 0) {
    return (
      <div>
        <h3 className="text-base font-semibold text-foreground mb-4">
          {t("sourceBreakdown")}
        </h3>
        <p className="text-sm text-muted">{t("noSourceData")}</p>
      </div>
    );
  }

  const chartData = data.map((d) => ({
    ...d,
    name: SOURCE_LABELS[d.source] ?? d.source,
    color: SOURCE_COLORS[d.source] ?? "#6366f1",
  }));

  return (
    <div>
      <h3 className="text-base font-semibold text-foreground mb-4">
        {t("sourceBreakdown")}
      </h3>
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={chartData}
            dataKey="totalCost"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: "#111113",
              border: "1px solid #23232a",
              borderRadius: "8px",
              fontSize: "12px",
              color: "#fafafa",
            }}
            itemStyle={{ color: "#fafafa" }}
            labelStyle={{ color: "#a1a1aa" }}
            formatter={(
              value: number | undefined,
              _name: string | undefined,
              props: { payload?: SourceDataPoint & { name: string } }
            ) => {
              const v = value ?? 0;
              const item = props?.payload;
              if (!item)
                return [formatCurrency(v), ""];
              return [
                `${formatCurrency(v)} (${formatTokens(item.totalTokens)} tokens, ${item.userCount} users)`,
                item.name,
              ];
            }}
          />
          <Legend
            verticalAlign="bottom"
            iconType="circle"
            wrapperStyle={{ fontSize: "12px", color: "#a1a1aa" }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
