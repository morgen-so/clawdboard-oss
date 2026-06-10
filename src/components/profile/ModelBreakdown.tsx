"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { useTranslations } from "next-intl";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { formatTokensCompact, formatUsdPlain } from "@/lib/format";

interface ModelDataPoint {
  modelName: string;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
}

interface ModelBreakdownProps {
  data: ModelDataPoint[];
}

const MODEL_COLORS = [
  "#F9A615", // marigold (accent)
  "#3b82f6", // blue
  "#10b981", // emerald
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
  "#6366f1", // indigo
];

const MODEL_NAME_RE = /^claude-([a-z]+)-(\d+)(?:-(\d))?(?:-\d{6,})?$/;
const MODEL_NAME_LEGACY_RE = /^claude-(\d+)(?:-(\d))?-([a-z]+)(?:-\d{6,})?$/;

/**
 * Map raw API model IDs to friendly display names.
 * e.g., "claude-opus-4-5-20251101" -> "Opus 4.5"
 */
function friendlyModelName(raw: string): string {
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
    const family =
      legacy[3].charAt(0).toUpperCase() + legacy[3].slice(1);
    return `${family} ${version}`;
  }
  return raw;
}


export function ModelBreakdown({ data }: ModelBreakdownProps) {
  const t = useTranslations("profile");

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
          {t("modelBreakdown")}
          <InfoTooltip text="Estimated cost and token usage per Claude model based on API consumption and published pricing." />
        </h3>
        <p className="text-sm text-muted">{t("noModelData")}</p>
      </div>
    );
  }

  // Map raw model IDs to friendly display names
  const chartData = data.map((d) => ({
    ...d,
    displayName: friendlyModelName(d.modelName),
  }));

  const chartHeight = Math.max(250, chartData.length * 40);

  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      <h3 className="text-lg font-semibold text-foreground mb-4">
        {t("modelBreakdown")}
      </h3>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
        >
          <XAxis
            type="number"
            tickFormatter={formatUsdPlain}
            stroke="var(--muted)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="displayName"
            stroke="var(--muted)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={120}
          />
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
              props: { payload?: ModelDataPoint & { displayName?: string } },
            ) => {
              const item = props?.payload;
              const v = value ?? 0;
              if (!item) return [formatUsdPlain(v), ""];
              return [
                `${formatUsdPlain(v)} (${formatTokensCompact(item.inputTokens)} in / ${formatTokensCompact(item.outputTokens)} out)`,
                item.displayName ?? item.modelName,
              ];
            }}
            labelFormatter={() => ""}
          />
          <Bar dataKey="totalCost" radius={[0, 4, 4, 0]} barSize={20}>
            {chartData.map((_entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={MODEL_COLORS[index % MODEL_COLORS.length]}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
