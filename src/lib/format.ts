import { format, parseISO } from "date-fns";

/**
 * Shared display formatters.
 *
 * Several variants coexist deliberately — they produce different output
 * styles used in different surfaces (tables vs charts vs OG images).
 * Check the sample output in each doc comment before swapping one for
 * another.
 */

/** 1234567 → "1.2M", 4321 → "4.3k", 789 → "789" */
export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
}

/** 1234567890 → "1.2B", 3456789 → "3.5M", 5678 → "5.7k", 789 → "789" */
export function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
}

/** Intl compact notation: 1234567890 → "1.2B", 5678 → "5.7K" (uppercase K) */
export function formatTokensCompact(count: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(count);
}

/** 12908.9 → "12,908.90" — grouped digits, no "$" (callers render the symbol separately) */
export function formatCostNumber(value: number | string): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** 1234.56 → "$1,234.56" (accepts the numeric-string costs stored in the DB) */
export function formatUsd(value: number | string): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

/** 1234.56 → "$1,235" — whole dollars */
export function formatUsdWhole(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/** 1234.56 → "$1234.56" — fixed two decimals, no thousands grouping */
export function formatUsdPlain(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** 1234.56 → "$1.2k", 45.6 → "$46" */
export function formatUsdShort(value: number | string): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;
}

/** 1234567 → "$1.23M", 234567 → "$235k", 4567 → "$4.6k", 45.6 → "$45.60" */
export function formatUsdCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 100_000) return `$${(n / 1_000).toFixed(0)}k`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

/** "2026-01-05" → "January 5, 2026" (falls back to the raw string) */
export function formatDateLong(dateStr: string): string {
  try {
    return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

/** Date → "January 5, 2026 at 3:42 PM GMT+1" — "last updated" stamps */
export function formatDateTimeLong(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** Date → "Jan 2026", null → "Unknown" */
export function formatMonthYear(date: Date | null): string {
  if (!date) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
  }).format(date);
}

/** "2026-01-05" → "Jan 5" — chart axis labels (falls back to the raw string) */
export function formatChartDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "MMM d");
  } catch {
    return dateStr;
  }
}

/** ("2026-01-05", "2026-02-01") → "Jan 5 – Feb 1, 2026" (UTC) */
export function formatDateRange(start: string, end: string): string {
  const s = new Date(start + "T12:00:00Z");
  const e = new Date(end + "T12:00:00Z");
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  };
  const startStr = s.toLocaleDateString("en-US", opts);
  const endStr = e.toLocaleDateString("en-US", { ...opts, year: "numeric" });
  return `${startStr} – ${endStr}`;
}
