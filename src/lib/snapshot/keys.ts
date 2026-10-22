// Pure helpers for the public-data snapshot (see ./index.ts). No server
// imports, so the unit tests can load this file directly.

/**
 * A file older than this is ignored and readers go to the database instead,
 * so a stalled cron degrades to live reads rather than serving old numbers
 * forever. The hourly cron rewrites every file, so a healthy file is at most
 * an hour old.
 */
export const SNAPSHOT_MAX_AGE_MS = 3 * 60 * 60 * 1000;

export interface SnapshotFile {
  builtAt: string;
  entries: Record<string, unknown>;
}

/**
 * Entry key for one call. Trailing undefined args are dropped, so
 * `getUserSummary(id, "7d")` and `getUserSummary(id, "7d", undefined)` share
 * an entry, the way callers that leave out the optional range expect.
 */
export function snapshotKey(name: string, args: readonly unknown[]): string {
  let end = args.length;
  while (end > 0 && args[end - 1] === undefined) end--;
  return `${name}:${JSON.stringify(args.slice(0, end))}`;
}

/** Clock skew between instances that a build time may show. */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Young enough to serve. Entries for "today" and "last 7 days" are computed
 * against the UTC date at build time, so a file from yesterday (UTC) is never
 * served, even a minute after midnight; reads go live until the midnight cron
 * has rebuilt it. A build time in the future beyond clock skew is treated as
 * bad too, or that file could never be replaced.
 */
export function isFresh(file: SnapshotFile, now = Date.now()): boolean {
  const built = Date.parse(file.builtAt);
  return (
    Number.isFinite(built) &&
    now - built <= SNAPSHOT_MAX_AGE_MS &&
    built - now <= MAX_CLOCK_SKEW_MS &&
    utcDay(built) === utcDay(now)
  );
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** JSON turns Dates into strings; give the named fields their Dates back. */
export function reviveDates<T>(value: T, fields: readonly string[]): T {
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const field of fields) {
    const v = out[field];
    if (typeof v === "string") out[field] = new Date(v);
  }
  return out as T;
}
