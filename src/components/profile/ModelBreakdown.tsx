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
import { MODEL_COLORS } from "@/lib/chart-utils";
import { friendlyModelName } from "@/lib/models";

interface ModelDataPoint {
  modelName: string;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
}

interface ModelBreakdownProps {
  data: ModelDataPoint[];
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
