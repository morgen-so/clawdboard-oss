import type { Period } from "@/lib/constants";

export interface PeriodRange {
  from: string;
  to: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function localDateAtStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(date: Date, days: number): Date {
  const next = localDateAtStart(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function getClientPeriodRange(
  period: Period,
  now = new Date()
): PeriodRange | undefined {
  if (period === "custom") return undefined;

  const today = localDateAtStart(now);
  const to = formatLocalDate(today);

  switch (period) {
    case "today":
      return { from: to, to };
    case "7d":
      return { from: formatLocalDate(addLocalDays(today, -6)), to };
    case "30d":
      return { from: formatLocalDate(addLocalDays(today, -29)), to };
    case "this-month":
      return {
        from: formatLocalDate(new Date(today.getFullYear(), today.getMonth(), 1)),
        to,
      };
    case "ytd":
      return {
        from: formatLocalDate(new Date(today.getFullYear(), 0, 1)),
        to,
      };
  }
}

export function getClientTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function decodeTimeZoneParam(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function formatDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) return date.toISOString().slice(0, 10);
  return `${year}-${month}-${day}`;
}

function addDateStringDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function getServerPeriodRange(
  period: Period,
  timeZoneParam: string | undefined | null,
  now = new Date()
): PeriodRange | undefined {
  if (period === "custom") return undefined;

  const timeZone = decodeTimeZoneParam(timeZoneParam);
  if (!timeZone || !isValidTimeZone(timeZone)) return undefined;

  const to = formatDateInTimeZone(now, timeZone);
  const year = to.slice(0, 4);
  const month = to.slice(5, 7);

  switch (period) {
    case "today":
      return { from: to, to };
    case "7d":
      return { from: addDateStringDays(to, -6), to };
    case "30d":
      return { from: addDateStringDays(to, -29), to };
    case "this-month":
      return { from: `${year}-${month}-01`, to };
    case "ytd":
      return { from: `${year}-01-01`, to };
  }
}
