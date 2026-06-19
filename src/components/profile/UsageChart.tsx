"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { CompareControl } from "@/components/profile/CompareControl";
import type { Period, DateRange } from "@/lib/db/leaderboard";
import {
  AXIS_COMMON,
  COMPARE_COLOR,
  COST_COLOR,
  TOKENS_COLOR,
  TOOLTIP_STYLES,
} from "@/lib/chart-utils";
import {
  formatChartDate,
  formatTokensCompact,
  formatUsdPlain,
  formatUsdShort,
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
  /** Optional second user's daily data to overlay for comparison. */
  compareData?: UsageDataPoint[];
  /** Display label for the compare series (the compare user). */
  compareLabel?: string;
  /** Display label for the primary series (the profile owner). */
  primaryLabel?: string;
  /** GitHub username of the profile owner — drives the compare picker URL. */
  primaryUsername?: string;
  /** Active ?vs= username, or null when not comparing. */
  currentVs?: string | null;
  /** Whether the viewer can use the (auth-gated) user search. */
  canSearch?: boolean;
}

/** A merged row carrying both the primary (cost/tokens) and compare (…B) series. */
interface MergedDataPoint extends UsageDataPoint {
  costB?: number;
  tokensB?: number;
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


/**
 * Tooltip value formatter. Decides cost-vs-token formatting from the series
 * dataKey (so the compare `…B` series format correctly) and shows the series'
 * own `name` — the metric label normally, or the username in compare mode.
 */
function tooltipFormatter(
  value: number | undefined,
  name: string | undefined,
  item: { dataKey?: unknown } | undefined
) {
  const v = value ?? 0;
  const key = String(item?.dataKey ?? "");
  const isToken = key === "tokens" || key === "tokensB";
  return [isToken ? formatTokensCompact(v) : formatUsdPlain(v), name ?? ""];
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

export function UsageChart({
  data,
  period,
  range,
  compareData,
  compareLabel,
  primaryLabel,
  primaryUsername,
  currentVs = null,
  canSearch = false,
}: UsageChartProps) {
  const t = useTranslations("profile");
  const isCompare = !!compareData;
  const [metric, setMetric] = useState<Metric>("cost");
  const [aggregation, setAggregation] = useState<Aggregation>("daily");
  const [viewOpen, setViewOpen] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (viewMenuRef.current && !viewMenuRef.current.contains(e.target as Node)) {
        setViewOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setViewOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const filledData = useMemo(
    () => fillDateGaps(data, period, range),
    [data, period, range]
  );
  const filledCompare = useMemo(
    () => (compareData ? fillDateGaps(compareData, period, range) : null),
    [compareData, period, range]
  );

  // Weekly/monthly only make sense once there's more than a week of data.
  const canAggregate = filledData.length >= AGGREGATION_MIN_DAYS;
  const effectiveAggregation: Aggregation = canAggregate ? aggregation : "daily";

  const primaryChart = useMemo(
    () => aggregateData(filledData, effectiveAggregation),
    [filledData, effectiveAggregation]
  );
  const compareChart = useMemo(
    () =>
      filledCompare ? aggregateData(filledCompare, effectiveAggregation) : null,
    [filledCompare, effectiveAggregation]
  );

  // Merge both gap-filled+aggregated series onto a shared date axis. Both are
  // filled over the same period/range, so dates line up; a Map keeps it robust.
  const chartData = useMemo<MergedDataPoint[]>(() => {
    if (!compareChart) return primaryChart;
    const byDate = new Map(compareChart.map((d) => [d.date, d]));
    return primaryChart.map((d) => {
      const c = byDate.get(d.date);
      return { ...d, costB: c?.cost ?? 0, tokensB: c?.tokens ?? 0 };
    });
  }, [primaryChart, compareChart]);

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
    // "Both" overlays two metrics for one user; in compare mode the two lines
    // are the two users, so a single metric is the only sensible choice.
    ...(isCompare ? [] : [{ value: "both" as Metric, label: t("bothMetric") }]),
  ];
  // Coerce a stale "both" selection to a single metric when comparing.
  const effectiveMetric: Metric = isCompare && metric === "both" ? "cost" : metric;

  const AGGREGATIONS: { value: Aggregation; label: string }[] = [
    { value: "daily", label: t("daily") },
    { value: "weekly", label: t("weekly") },
    { value: "monthly", label: t("monthly") },
  ];
  const currentAggLabel =
    AGGREGATIONS.find((a) => a.value === effectiveAggregation)?.label ?? "";

  const title = getPeriodTitle(period, range, t);
  const showCost = effectiveMetric === "cost" || effectiveMetric === "both";
  const showTokens = effectiveMetric === "tokens" || effectiveMetric === "both";
  const isDual = effectiveMetric === "both";
  const isSinglePoint = chartData.length <= 1;
  const hasData = chartData.some(
    (d) => d.cost > 0 || d.tokens > 0 || (d.costB ?? 0) > 0 || (d.tokensB ?? 0) > 0
  );

  // Compare-mode legend: per-user totals for the active metric + a gap factor.
  const primaryColor = effectiveMetric === "tokens" ? TOKENS_COLOR : COST_COLOR;
  const primaryName = isCompare
    ? primaryLabel ?? t("costMetric")
    : effectiveMetric === "tokens"
      ? t("tokensMetric")
      : t("costMetric");
  const compareName = compareLabel ?? currentVs ?? "";
  const primaryTotal = chartData.reduce(
    (s, d) => s + (effectiveMetric === "tokens" ? d.tokens : d.cost),
    0
  );
  const compareTotal = chartData.reduce(
    (s, d) => s + (effectiveMetric === "tokens" ? d.tokensB ?? 0 : d.costB ?? 0),
    0
  );
  const formatTotal = (v: number) =>
    effectiveMetric === "tokens" ? formatTokensCompact(v) : formatUsdShort(v);
  const gapFactor =
    Math.min(primaryTotal, compareTotal) > 0
      ? Math.max(primaryTotal, compareTotal) /
        Math.min(primaryTotal, compareTotal)
      : null;

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
          {primaryUsername && (
            <CompareControl
              primaryUsername={primaryUsername}
              currentVs={currentVs}
              compareLabel={compareLabel ?? null}
              canSearch={canSearch}
            />
          )}
          {canAggregate && (
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-xs font-medium text-foreground/60">
                {t("view")}
              </span>
              <div className="relative" ref={viewMenuRef}>
                <button
                  type="button"
                  onClick={() => setViewOpen((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={viewOpen}
                  aria-label={t("view")}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-xs font-medium text-foreground transition-colors hover:bg-surface-hover focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  {currentAggLabel}
                  <svg
                    className={`h-3 w-3 text-foreground/50 transition-transform ${viewOpen ? "rotate-180" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                {viewOpen && (
                  <div
                    role="listbox"
                    className="absolute right-0 top-full z-50 mt-1 min-w-[8rem] overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
                  >
                    {AGGREGATIONS.map((a) => (
                      <button
                        key={a.value}
                        type="button"
                        role="option"
                        aria-selected={effectiveAggregation === a.value}
                        onClick={() => {
                          setAggregation(a.value);
                          setViewOpen(false);
                        }}
                        className={`block w-full px-3 py-1.5 text-left font-mono text-xs transition-colors hover:bg-surface-hover ${
                          effectiveAggregation === a.value
                            ? "font-bold text-accent"
                            : "text-foreground/70 hover:text-foreground"
                        }`}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="flex items-center rounded-lg border border-border bg-surface overflow-hidden">
            {METRICS.map((m) => (
              <button
                key={m.value}
                onClick={() => setMetric(m.value)}
                className={toggleButtonClass(effectiveMetric === m.value)}
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
              <Bar dataKey="cost" name={isCompare ? primaryName : t("costMetric")} yAxisId="left" fill={COST_COLOR} radius={[4, 4, 0, 0]} maxBarSize={120} />
            )}
            {showTokens && (
              <Bar
                dataKey="tokens"
                name={isCompare ? primaryName : t("tokensMetric")}
                yAxisId={isDual ? "right" : "left"}
                fill={TOKENS_COLOR}
                radius={[4, 4, 0, 0]}
                maxBarSize={120}
              />
            )}
            {isCompare && showCost && (
              <Bar dataKey="costB" name={compareName} yAxisId="left" fill={COMPARE_COLOR} radius={[4, 4, 0, 0]} maxBarSize={120} />
            )}
            {isCompare && showTokens && (
              <Bar dataKey="tokensB" name={compareName} yAxisId="left" fill={COMPARE_COLOR} radius={[4, 4, 0, 0]} maxBarSize={120} />
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
              <linearGradient id="compareGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COMPARE_COLOR} stopOpacity={0.25} />
                <stop offset="95%" stopColor={COMPARE_COLOR} stopOpacity={0} />
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
                name={isCompare ? primaryName : t("costMetric")}
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
                name={isCompare ? primaryName : t("tokensMetric")}
                yAxisId={isDual ? "right" : "left"}
                stroke={TOKENS_COLOR}
                strokeWidth={2}
                fill="url(#tokensGradient)"
              />
            )}
            {isCompare && showCost && (
              <Area
                type="monotone"
                dataKey="costB"
                name={compareName}
                yAxisId="left"
                stroke={COMPARE_COLOR}
                strokeWidth={2}
                fill="url(#compareGradient)"
              />
            )}
            {isCompare && showTokens && (
              <Area
                type="monotone"
                dataKey="tokensB"
                name={compareName}
                yAxisId="left"
                stroke={COMPARE_COLOR}
                strokeWidth={2}
                fill="url(#compareGradient)"
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      )}
      {isCompare && (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-border pt-3 font-mono text-xs">
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: primaryColor }}
              aria-hidden="true"
            />
            <span className="text-foreground">{primaryName}</span>
            <span className="text-foreground/60">{formatTotal(primaryTotal)}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: COMPARE_COLOR }}
              aria-hidden="true"
            />
            <span className="text-foreground">{compareName}</span>
            <span className="text-foreground/60">{formatTotal(compareTotal)}</span>
          </span>
          {gapFactor && gapFactor >= 1.05 && (
            <span className="text-muted">
              {t("vsGap", { factor: gapFactor.toFixed(1) })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
