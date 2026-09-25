/**
 * Read-only SQLite access for extractors (Cursor, Hermes).
 *
 * Prefers better-sqlite3, an optional dependency with a native build. When
 * that is missing (the build failed, or npm 12+ skipped its install script,
 * which it does by default), falls back to Node's built-in node:sqlite
 * (Node 22.13+ / 23.4+). Returns null when neither is available, and the
 * extractor skips its source.
 *
 * Only the surface the extractors use is exposed: prepare().all/get, close.
 * BLOB columns come back as Buffer from either driver.
 */

export interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}

export interface SqliteDb {
  prepare(sql: string): SqliteStatement;
  close(): void;
}

type Driver = "better-sqlite3" | "node:sqlite";

/**
 * Open an existing SQLite file read-only, or return null if no driver can.
 * `CLAWDBOARD_SQLITE_DRIVER` forces one driver (used by the tests).
 */
export async function openReadonlySqlite(path: string): Promise<SqliteDb | null> {
  const forced = process.env.CLAWDBOARD_SQLITE_DRIVER;
  const drivers: Driver[] = forced
    ? (["better-sqlite3", "node:sqlite"] as const).filter((d) => d === forced)
    : ["better-sqlite3", "node:sqlite"];

  for (const driver of drivers) {
    try {
      if (driver === "better-sqlite3") return await openWithBetterSqlite(path);
      if (driver === "node:sqlite") return await openWithNodeSqlite(path);
    } catch {
      continue;
    }
  }
  return null;
}

async function openWithBetterSqlite(path: string): Promise<SqliteDb> {
  const { default: BetterSqlite3 } = await import("better-sqlite3");
  return new BetterSqlite3(path, { readonly: true, fileMustExist: true });
}

async function openWithNodeSqlite(path: string): Promise<SqliteDb> {
  const { DatabaseSync } = await importNodeSqlite();
  const db = new DatabaseSync(path, { readOnly: true });
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        all: (...params) =>
          stmt.all(...(params as never[])).map((row) => blobsToBuffers(row)),
        get: (...params) => {
          const row = stmt.get(...(params as never[]));
          return row === undefined ? undefined : blobsToBuffers(row);
        },
      };
    },
    close: () => db.close(),
  };
}

/**
 * node:sqlite prints an ExperimentalWarning to stderr on load (Node 22–24),
 * which would show on every sync. Swallow that one warning while importing.
 */
async function importNodeSqlite(): Promise<typeof import("node:sqlite")> {
  const emitWarning = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const type = typeof rest[0] === "string" ? rest[0] : (rest[0] as { type?: string })?.type;
    const text = typeof warning === "string" ? warning : warning.message;
    if (type === "ExperimentalWarning" && text.includes("SQLite")) return;
    return (emitWarning as (...args: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    return await import("node:sqlite");
  } finally {
    process.emitWarning = emitWarning;
  }
}

/** node:sqlite returns BLOBs as Uint8Array; the extractors expect Buffer. */
function blobsToBuffers(row: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] =
      value instanceof Uint8Array && !Buffer.isBuffer(value)
        ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
        : value;
  }
  return out;
}
