"use client";

import { useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  eachDayOfInterval,
  format,
  subDays,
  parseISO,
  startOfWeek,
  startOfMonth,
  startOfYear,
} from "date-fns";
import { useTranslations } from "next-intl";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import type { Period, DateRange } from "@/lib/db/leaderboard";
import {
  AXIS_COMMON,
  COST_COLOR,
  TOKENS_COLOR,
  TOOLTIP_STYLES,
} from "@/lib/chart-utils";
import {
  formatChartDate,
  formatTokensCompact,
  formatUsdPlain,
} from "@/lib/format";

interface UsageDataPoint {
  date: string;
  cost: number;
  tokens: number;
}

type Metric = "cost" | "tokens" | "both";
type Aggregation = "daily" | "weekly" | "monthly";

/** Below this many days of data the weekly/monthly toggle isn't worth showing. */
const AGGREGATION_MIN_DAYS = 8;

interface UsageChartProps {
  data: UsageDataPoint[];
  period: Period;
  range?: DateRange;
}

/**
 * Compute the start date for gap-filling based on the active period.
 */
function getPeriodStartDate(period: Period, range?: DateRange): Date {
  const today = new Date();
  switch (period) {
    case "today":
      return today;
    case "7d":
      return subDays(today, 6);
    case "30d":
      return subDays(today, 29);
    case "this-month":
      return startOfMonth(today);
    case "ytd":
      return startOfYear(today);
    case "custom":
      if (range) return parseISO(range.from);
      return subDays(today, 29);
  }
}

function getPeriodEndDate(period: Period, range?: DateRange): Date {
  if (period === "custom" && range) return parseISO(range.to);
  return new Date();
}

/**
 * Fill gaps in daily data so every day in the period has a value.
 */
function fillDateGaps(
  rawData: UsageDataPoint[],
  period: Period,
  range?: DateRange
): UsageDataPoint[] {
  const startDate = getPeriodStartDate(period, range);
  const endDate = getPeriodEndDate(period, range);

  const allDates = eachDayOfInterval({ start: startDate, end: endDate });

  const dataMap = new Map<string, UsageDataPoint>();
  for (const point of rawData) {
    dataMap.set(point.date, point);
  }

  return allDates.map((d) => {
    const dateStr = format(d, "yyyy-MM-dd");
    const existing = dataMap.get(dateStr);
    return existing ?? { date: dateStr, cost: 0, tokens: 0 };
  });
}

/**
 * Roll gap-filled daily points up into weekly or monthly buckets by summing
 * cost and tokens. Each bucket's `date` is its period start (week start = Monday,
 * month start = the 1st) so the existing date formatters keep working. Input is
 * sorted ascending and Map preserves insertion order, so output stays ordered.
 */
function aggregateData(
  daily: UsageDataPoint[],
  aggregation: Aggregation
): UsageDataPoint[] {
  if (aggregation === "daily") return daily;

  const buckets = new Map<string, UsageDataPoint>();
  for (const point of daily) {
    const d = parseISO(point.date);
    const bucketStart =
      aggregation === "weekly"
        ? startOfWeek(d, { weekStartsOn: 1 })
        : startOfMonth(d);
    const key = format(bucketStart, "yyyy-MM-dd");
    const existing = buckets.get(key);
    if (existing) {
      existing.cost += point.cost;
      existing.tokens += point.tokens;
    } else {
      buckets.set(key, { date: key, cost: point.cost, tokens: point.tokens });
    }
  }
  return Array.from(buckets.values());
}

function getPeriodTitle(period: Period, range: DateRange | undefined, t: (key: string, values?: Record<string, string>) => string): string {
  switch (period) {
    case "today":
      return t("usageToday");
    case "7d":
      return t("usage7d");
    case "30d":
      return t("usage30d");
    case "this-month":
      return t("usageThisMonth");
    case "ytd":
      return t("usageYtd");
    case "custom":
      if (range) {
        const fmt = (d: string) =>
          new Date(d + "T00:00:00").toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          });
        return t("usageCustom", { range: `${fmt(range.from)} – ${fmt(range.to)}` });
      }
      return t("usage");
  }
}


function tooltipFormatter(value: number | undefined, name: string | undefined) {
  const v = value ?? 0;
  if (name === "cost") return [formatUsdPlain(v), "Cost"];
  if (name === "tokens") return [formatTokensCompact(v), "Tokens"];
  return [String(v), name ?? ""];
}

/** Axis tick label: month name for monthly buckets, "Mon d" otherwise. */
function makeAxisTickFormatter(aggregation: Aggregation) {
  if (aggregation !== "monthly") return formatChartDate;
  return (dateStr: string) => {
    try {
      return format(parseISO(dateStr), "MMM");
    } catch {
      return dateStr;
    }
  };
}

/** Tooltip header: matches the bucket granularity. */
function makeTooltipLabelFormatter(
  aggregation: Aggregation,
  t: (key: string, values?: Record<string, string>) => string
) {
  return (label: unknown) => {
    const dateStr = String(label ?? "");
    if (aggregation === "monthly") {
      try {
        return format(parseISO(dateStr), "MMMM yyyy");
      } catch {
        return dateStr;
      }
    }
    if (aggregation === "weekly") {
      return t("weekOf", { date: formatChartDate(dateStr) });
    }
    return formatChartDate(dateStr);
  };
}

export function UsageChart({ data, period, range }: UsageChartProps) {
  const t = useTranslations("profile");
  const [metric, setMetric] = useState<Metric>("cost");
  const [aggregation, setAggregation] = useState<Aggregation>("daily");

  const filledData = useMemo(
    () => fillDateGaps(data, period, range),
    [data, period, range]
  );

  // Weekly/monthly only make sense once there's more than a week of data.
  const canAggregate = filledData.length >= AGGREGATION_MIN_DAYS;
  const effectiveAggregation: Aggregation = canAggregate ? aggregation : "daily";

  const chartData = useMemo(
    () => aggregateData(filledData, effectiveAggregation),
    [filledData, effectiveAggregation]
  );

  const axisTickFormatter = useMemo(
    () => makeAxisTickFormatter(effectiveAggregation),
    [effectiveAggregation]
  );
  const labelFormatter = useMemo(
    () => makeTooltipLabelFormatter(effectiveAggregation, t),
    [effectiveAggregation, t]
  );

  const METRICS: { value: Metric; label: string }[] = [
    { value: "cost", label: t("costMetric") },
    { value: "tokens", label: t("tokensMetric") },
    { value: "both", label: t("bothMetric") },
  ];

  const AGGREGATIONS: { value: Aggregation; label: string }[] = [
    { value: "daily", label: t("daily") },
    { value: "weekly", label: t("weekly") },
    { value: "monthly", label: t("monthly") },
  ];

  const title = getPeriodTitle(period, range, t);
  const showCost = metric === "cost" || metric === "both";
  const showTokens = metric === "tokens" || metric === "both";
  const isDual = metric === "both";
  const isSinglePoint = chartData.length <= 1;
  const hasData = chartData.some((d) => d.cost > 0 || d.tokens > 0);

  const toggleButtonClass = (active: boolean) =>
    `px-3 py-1.5 font-mono text-xs font-medium transition-colors whitespace-nowrap ${
      active
        ? "bg-accent text-background"
        : "text-foreground/60 hover:text-foreground hover:bg-surface-hover"
    }`;

  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
          {title}
          <InfoTooltip text="Estimated AI coding usage based on API token consumption and model pricing." />
        </h3>
        <div className="flex items-center gap-3 flex-wrap">
          {canAggregate && (
            <label className="flex items-center gap-1.5">
              <span className="font-mono text-xs font-medium text-foreground/60">
                {t("view")}
              </span>
              <select
                value={effectiveAggregation}
                onChange={(e) => setAggregation(e.target.value as Aggregation)}
                aria-label={t("view")}
                className="rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-xs font-medium text-foreground transition-colors hover:bg-surface-hover focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {AGGREGATIONS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex items-center rounded-lg border border-border bg-surface overflow-hidden">
            {METRICS.map((m) => (
              <button
                key={m.value}
                onClick={() => setMetric(m.value)}
                className={toggleButtonClass(metric === m.value)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {isSinglePoint && !hasData ? (
        <div className="flex flex-col items-center justify-center h-[300px] text-center">
          <p className="text-muted text-sm font-medium">{t("noActivity")}</p>
          <p className="text-muted/60 text-xs mt-1">{t("noActivityHint")}</p>
        </div>
      ) : isSinglePoint ? (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            data={chartData}
            margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
            barCategoryGap="60%"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={axisTickFormatter} {...AXIS_COMMON} />
            {showCost && (
              <YAxis yAxisId="left" tickFormatter={formatUsdPlain} {...AXIS_COMMON} width={60} />
            )}
            {showTokens && (
              <YAxis
                yAxisId={isDual ? "right" : "left"}
                orientation={isDual ? "right" : "left"}
                tickFormatter={formatTokensCompact}
                {...AXIS_COMMON}
                width={60}
              />
            )}
            <Tooltip cursor={{ fill: "rgba(255,255,255,0.05)" }} {...TOOLTIP_STYLES} formatter={tooltipFormatter} labelFormatter={labelFormatter} />
            {showCost && (
              <Bar dataKey="cost" yAxisId="left" fill={COST_COLOR} radius={[4, 4, 0, 0]} maxBarSize={120} />
            )}
            {showTokens && (
              <Bar
                dataKey="tokens"
                yAxisId={isDual ? "right" : "left"}
                fill={TOKENS_COLOR}
                radius={[4, 4, 0, 0]}
                maxBarSize={120}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart
            data={chartData}
            margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COST_COLOR} stopOpacity={0.3} />
                <stop offset="95%" stopColor={COST_COLOR} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="tokensGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={TOKENS_COLOR} stopOpacity={0.3} />
                <stop offset="95%" stopColor={TOKENS_COLOR} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={axisTickFormatter}
              {...AXIS_COMMON}
              interval="preserveStartEnd"
              minTickGap={40}
            />
            {showCost && (
              <YAxis yAxisId="left" tickFormatter={formatUsdPlain} {...AXIS_COMMON} width={60} />
            )}
            {showTokens && (
              <YAxis
                yAxisId={isDual ? "right" : "left"}
                orientation={isDual ? "right" : "left"}
                tickFormatter={formatTokensCompact}
                {...AXIS_COMMON}
                width={60}
              />
            )}
            <Tooltip cursor={{ fill: "rgba(255,255,255,0.05)" }} {...TOOLTIP_STYLES} formatter={tooltipFormatter} labelFormatter={labelFormatter} />
            {showCost && (
              <Area
                type="monotone"
                dataKey="cost"
                yAxisId="left"
                stroke={COST_COLOR}
                strokeWidth={2}
                fill="url(#costGradient)"
              />
            )}
            {showTokens && (
              <Area
                type="monotone"
                dataKey="tokens"
                yAxisId={isDual ? "right" : "left"}
                stroke={TOKENS_COLOR}
                strokeWidth={2}
                fill="url(#tokensGradient)"
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
