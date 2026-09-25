import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { openReadonlySqlite } from "../src/sqlite.js";

// The node:sqlite fallback runs when better-sqlite3's native build is missing,
// which is the default for anyone installing with npm 12+ (no install scripts).
// The Cursor and Hermes suites also run end to end on it: see test:node-sqlite.

describe.each(["better-sqlite3", "node:sqlite"] as const)("openReadonlySqlite (%s)", (driver) => {
  let dir: string;
  let dbPath: string;
  const saved = process.env.CLAWDBOARD_SQLITE_DRIVER;

  beforeEach(() => {
    process.env.CLAWDBOARD_SQLITE_DRIVER = driver;
    dir = mkdtempSync(join(tmpdir(), "sqlite-test-"));
    dbPath = join(dir, "kv.db");
    const db = new Database(dbPath);
    db.exec("CREATE TABLE kv (key TEXT, value BLOB, n INTEGER)");
    const insert = db.prepare("INSERT INTO kv VALUES (?, ?, ?)");
    insert.run("blob", Buffer.from('{"a":1}'), 1);
    insert.run("text", '{"b":2}', 2);
    insert.run("null", null, 3);
    db.close();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (saved === undefined) delete process.env.CLAWDBOARD_SQLITE_DRIVER;
    else process.env.CLAWDBOARD_SQLITE_DRIVER = saved;
  });

  it("returns BLOBs as Buffer, so toString('utf-8') decodes them", async () => {
    // A bare Uint8Array's toString ignores the encoding and returns "123,34,…",
    // which would make every Cursor row fail to parse.
    const db = (await openReadonlySqlite(dbPath))!;
    const rows = db.prepare("SELECT key, value, n FROM kv ORDER BY n").all() as Array<{
      key: string;
      value: Buffer | string | null;
      n: number;
    }>;
    db.close();

    expect(Buffer.isBuffer(rows[0].value)).toBe(true);
    expect((rows[0].value as Buffer).toString("utf-8")).toBe('{"a":1}');
    expect(rows[1].value).toBe('{"b":2}');
    expect(rows[2].value).toBeNull();
    expect(rows[0].n).toBe(1);
  });

  it("binds parameters and returns undefined from get() when nothing matches", async () => {
    const db = (await openReadonlySqlite(dbPath))!;
    const hit = db.prepare("SELECT n FROM kv WHERE key = ?").get("text") as { n: number };
    const miss = db.prepare("SELECT n FROM kv WHERE key = ?").get("nope");
    const some = db.prepare("SELECT key FROM kv WHERE n IN (?, ?)").all(1, 3);
    db.close();

    expect(hit.n).toBe(2);
    expect(miss).toBeUndefined();
    expect(some).toHaveLength(2);
  });

  it("opens read-only", async () => {
    const db = (await openReadonlySqlite(dbPath))!;
    expect(() => db.prepare("INSERT INTO kv VALUES ('x', 'x', 9)").all()).toThrow();
    db.close();
  });

  it("returns null for a file that doesn't exist", async () => {
    expect(await openReadonlySqlite(join(dir, "missing.db"))).toBeNull();
  });

  it("prints no ExperimentalWarning", async () => {
    const warnings: string[] = [];
    const onWarning = (w: Error) => warnings.push(`${w.name}: ${w.message}`);
    process.on("warning", onWarning);
    try {
      const db = (await openReadonlySqlite(dbPath))!;
      db.close();
      await new Promise((r) => setImmediate(r));
    } finally {
      process.off("warning", onWarning);
    }
    expect(warnings.filter((w) => w.includes("SQLite"))).toEqual([]);
  });
});
