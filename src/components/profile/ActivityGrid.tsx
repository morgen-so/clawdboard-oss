"use client";

import { useMemo } from "react";
import { eachDayOfInterval, format, subDays, getDay, parseISO } from "date-fns";
import { useTranslations } from "next-intl";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { formatUsdPlain } from "@/lib/format";

interface ActivityDataPoint {
  date: string;
  cost: number;
}

interface ActivityGridProps {
  data: ActivityDataPoint[];
}

/** Graduated intensity levels matching GitHub contribution colors */
const LEVEL_CLASSES = [
  "bg-[var(--border-color)]",  // Level 0: no activity
  "bg-green-900",              // Level 1: low
  "bg-green-700",              // Level 2: medium
  "bg-green-500",              // Level 3: high
  "bg-green-400",              // Level 4: very high
];

/**
 * Compute intensity level (0-4) from cost using quartiles of non-zero days.
 */
function computeThresholds(data: ActivityDataPoint[]): number[] {
  const nonZeroCosts = data
    .map((d) => d.cost)
    .filter((c) => c > 0)
    .sort((a, b) => a - b);

  if (nonZeroCosts.length === 0) return [0, 0, 0, 0];

  const q1 = nonZeroCosts[Math.floor(nonZeroCosts.length * 0.25)] ?? 0;
  const q2 = nonZeroCosts[Math.floor(nonZeroCosts.length * 0.5)] ?? 0;
  const q3 = nonZeroCosts[Math.floor(nonZeroCosts.length * 0.75)] ?? 0;

  return [0, q1, q2, q3];
}

/**
 * Map a daily cost to its intensity bucket (0-4) using precomputed thresholds.
 */
function getLevel(cost: number, thresholds: number[]): number {
  if (cost <= 0) return 0;
  if (cost <= thresholds[1]) return 1;
  if (cost <= thresholds[2]) return 2;
  if (cost <= thresholds[3]) return 3;
  return 4;
}

/** Day of week labels (Sun=0, Mon=1, ..., Sat=6) */
const DAY_LABELS: Record<number, string> = {
  1: "Mon",
  3: "Wed",
  5: "Fri",
};

/**
 * GitHub-style yearly heatmap of daily AI coding cost. Each cell is positioned
 * by its day-of-week (row) and week index (column) so partial weeks render in
 * the correct row instead of shifting the whole grid up.
 */
export function ActivityGrid({ data }: ActivityGridProps) {
  const t = useTranslations("profile");
  const gridData = useMemo(() => {
    const totalDays = 364; // 52 weeks
    const today = new Date();
    const startDate = subDays(today, totalDays - 1);

    const allDates = eachDayOfInterval({ start: startDate, end: today });

    // Build lookup map
    const costMap = new Map<string, number>();
    for (const point of data) {
      costMap.set(point.date, point.cost);
    }

    const thresholds = computeThresholds(data);

    // Organize into weeks (columns) with day-of-week rows
    // Each week starts on Sunday
    const cells: {
      date: string;
      displayDate: string;
      cost: number;
      level: number;
      dayOfWeek: number;
      weekIndex: number;
    }[] = [];

    // Find the first Sunday on or before startDate
    const startDayOfWeek = getDay(startDate);
    let weekIndex = 0;

    for (let i = 0; i < allDates.length; i++) {
      const d = allDates[i];
      const dateStr = format(d, "yyyy-MM-dd");
      const dayOfWeek = getDay(d);

      // Increment week when we hit Sunday (except at the very start)
      if (dayOfWeek === 0 && i > 0) {
        weekIndex++;
      }

      // Adjust weekIndex for the first partial week
      const adjustedWeekIndex =
        i === 0 ? 0 : dayOfWeek === 0 ? weekIndex : weekIndex;

      const cost = costMap.get(dateStr) ?? 0;
      cells.push({
        date: dateStr,
        displayDate: format(d, "MMM d, yyyy"),
        cost,
        level: getLevel(cost, thresholds),
        dayOfWeek,
        weekIndex: i === 0 && startDayOfWeek !== 0 ? 0 : adjustedWeekIndex,
      });
    }

    // Compute total weeks for grid sizing
    const totalWeeks = cells.length > 0 ? cells[cells.length - 1].weekIndex + 1 : 0;

    // Build month labels
    const monthLabels: { label: string; weekIndex: number }[] = [];
    let lastMonth = -1;
    for (const cell of cells) {
      const parsed = parseISO(cell.date);
      const month = parsed.getMonth();
      if (month !== lastMonth && cell.dayOfWeek === 0) {
        monthLabels.push({
          label: format(parsed, "MMM"),
          weekIndex: cell.weekIndex,
        });
        lastMonth = month;
      }
    }

    return { cells, totalWeeks, monthLabels };
  }, [data]);

  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
        {t("activity")}
        <InfoTooltip text="Daily estimated AI coding costs over the past year. Intensity is based on quartiles of your active days." />
      </h3>
      <div className="overflow-x-auto">
        <div className="inline-block">
          {/* Month labels */}
          <div
            className="flex text-xs text-muted mb-1"
            style={{ marginLeft: "28px" }}
          >
            {gridData.monthLabels.map((m, i) => (
              <span
                key={`${m.label}-${i}`}
                className="absolute"
                style={{
                  position: "relative",
                  left: `${m.weekIndex * 15}px`,
                  width: 0,
                  whiteSpace: "nowrap",
                }}
              >
                {/* Use a positioned approach for month labels */}
              </span>
            ))}
          </div>

          {/* Month label row using grid */}
          <div className="relative mb-1" style={{ marginLeft: "28px" }}>
            <div
              className="grid gap-[3px]"
              style={{
                gridTemplateColumns: `repeat(${gridData.totalWeeks}, 12px)`,
                height: "16px",
              }}
            >
              {Array.from({ length: gridData.totalWeeks }, (_, weekIdx) => {
                const monthLabel = gridData.monthLabels.find(
                  (m) => m.weekIndex === weekIdx
                );
                return (
                  <div
                    key={`month-${weekIdx}`}
                    className="text-xs text-muted overflow-visible whitespace-nowrap"
                  >
                    {monthLabel?.label ?? ""}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex gap-0">
            {/* Day labels */}
            <div
              className="grid gap-[3px] mr-1 flex-shrink-0"
              style={{
                gridTemplateRows: "repeat(7, 12px)",
                width: "24px",
              }}
            >
              {Array.from({ length: 7 }, (_, dayIdx) => (
                <div
                  key={`day-${dayIdx}`}
                  className="text-xs text-muted flex items-center justify-end pr-1"
                  style={{ height: "12px", fontSize: "9px" }}
                >
                  {DAY_LABELS[dayIdx] ?? ""}
                </div>
              ))}
            </div>

            {/* Grid cells */}
            <div
              className="grid gap-[3px]"
              style={{
                gridTemplateRows: "repeat(7, 12px)",
                gridTemplateColumns: `repeat(${gridData.totalWeeks}, 12px)`,
              }}
            >
              {gridData.cells.map((cell) => (
                <div
                  key={cell.date}
                  className={`w-3 h-3 rounded-sm ${LEVEL_CLASSES[cell.level]} transition-colors hover:ring-1 hover:ring-foreground/30`}
                  style={{
                    gridRow: cell.dayOfWeek + 1,
                    gridColumn: cell.weekIndex + 1,
                  }}
                  title={`${cell.displayDate}: ${formatUsdPlain(cell.cost)}`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
