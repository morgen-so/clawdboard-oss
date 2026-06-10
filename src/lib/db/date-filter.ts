import { sql, type SQL } from "drizzle-orm";
import type { Period } from "@/lib/constants";
import type { DateRange } from "./leaderboard";

/**
 * Single source of truth for mapping a leaderboard period to a SQL WHERE
 * fragment.
 *
 * `dateExpr` is the date-column expression of the calling query (bare
 * `date`, an aliased `da.date`, or a Drizzle column reference) — it is
 * inlined into the fragment, while custom-range bounds stay bound
 * parameters. "custom" without a valid range falls back to the 30-day
 * window.
 */
export function periodFilter(
  dateExpr: SQL,
  period: Period,
  range?: DateRange
): SQL {
  switch (period) {
    case "today":
      return sql`${dateExpr}::date = CURRENT_DATE`;
    case "7d":
      return sql`${dateExpr}::date >= CURRENT_DATE - 6`;
    case "30d":
      return sql`${dateExpr}::date >= CURRENT_DATE - 29`;
    case "this-month":
      return sql`${dateExpr}::date >= date_trunc('month', CURRENT_DATE)::date`;
    case "ytd":
      return sql`${dateExpr}::date >= date_trunc('year', CURRENT_DATE)::date`;
    case "custom":
      if (range) {
        return sql`${dateExpr}::date >= ${range.from}::date AND ${dateExpr}::date <= ${range.to}::date`;
      }
      return sql`${dateExpr}::date >= CURRENT_DATE - 29`;
  }
}

/**
 * Stats variant: optional period (undefined → match everything, labeled
 * "all time") with the human label, against a bare `date` column.
 */
export function statsDateFilter(
  period?: Period,
  range?: DateRange
): { filter: SQL; label: string } {
  if (!period) return { filter: sql`TRUE`, label: "all time" };
  return {
    filter: periodFilter(sql`date`, period, range),
    label: periodLabel(period, range),
  };
}

/** Human-readable label for a period (mirrors periodFilter's fallbacks). */
export function periodLabel(period: Period, range?: DateRange): string {
  switch (period) {
    case "today":
      return "today";
    case "7d":
      return "last 7 days";
    case "30d":
      return "last 30 days";
    case "this-month":
      return "this month";
    case "ytd":
      return "year to date";
    case "custom":
      return range ? `${range.from} to ${range.to}` : "last 30 days";
  }
}
