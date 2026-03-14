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
import type { ModelStats } from "@/lib/db/stats";
import { MODEL_COLORS, friendlyModelName } from "@/lib/chart-utils";
import { Link } from "@/i18n/navigation";

function formatCurrency(value: number): string {
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  return `$${value.toFixed(2)}`;
}

function formatTokensCompact(count: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(count);
}

export function ModelShareChart({
  data,
  linkToModelPages = false,
}: {
  data: ModelStats[];
  linkToModelPages?: boolean;
}) {
  if (data.length === 0) {
    return (
      <div>
        <h3 className="text-base font-semibold text-foreground mb-4">
          Model Popularity
        </h3>
        <p className="text-sm text-muted">No model data available yet.</p>
      </div>
    );
  }

  const chartData = data.map((d) => ({
    ...d,
    displayName: friendlyModelName(d.modelName),
    cost: parseFloat(d.totalCost),
  }));

  const chartHeight = Math.max(250, chartData.length * 48);

  return (
    <div>
      <div className="mb-4">
        <h3 className="text-base font-semibold text-foreground">
          Model Popularity
        </h3>
        <p className="text-xs text-muted font-mono mt-0.5">
          Total estimated cost by model across all users
        </p>
      </div>

      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
        >
          <XAxis
            type="number"
            tickFormatter={formatCurrency}
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
              props: { payload?: (typeof chartData)[number] },
            ) => {
              const item = props?.payload;
              const v = value ?? 0;
              if (!item) return [formatCurrency(v), ""];
              return [
                `${formatCurrency(v)} — ${item.costShare}% of total (${formatTokensCompact(item.totalTokens)} tokens, ${item.userCount} users)`,
                item.displayName,
              ];
            }}
            labelFormatter={() => ""}
          />
          <Bar dataKey="cost" radius={[0, 4, 4, 0]} barSize={24}>
            {chartData.map((_entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={MODEL_COLORS[index % MODEL_COLORS.length]}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Model detail cards for SEO content */}
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {chartData.slice(0, 6).map((model, i) => {
          const slug = model.modelName.replace(/-\d{6,8}$/, "");
          const inner = (
            <>
              <div
                className="h-3 w-3 rounded-full shrink-0"
                style={{
                  backgroundColor: MODEL_COLORS[i % MODEL_COLORS.length],
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm font-medium text-foreground truncate">
                  {model.displayName}
                </p>
                <p className="font-mono text-xs text-muted">
                  {formatCurrency(model.cost)} &middot;{" "}
                  {model.costShare}% of spend &middot;{" "}
                  {model.userCount} {model.userCount === 1 ? "user" : "users"}
                </p>
              </div>
              {linkToModelPages && (
                <span className="text-muted text-xs shrink-0">&rarr;</span>
              )}
            </>
          );

          return linkToModelPages ? (
            <Link
              key={model.modelName}
              href={`/stats/models/${slug}`}
              className="flex items-center gap-3 rounded-md border border-border bg-background p-3 transition-colors hover:border-accent/40 hover:bg-surface-hover"
            >
              {inner}
            </Link>
          ) : (
            <div
              key={model.modelName}
              className="flex items-center gap-3 rounded-md border border-border bg-background p-3"
            >
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}
