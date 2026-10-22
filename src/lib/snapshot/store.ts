import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { BlobPreconditionFailedError, del, get, list, put } from "@vercel/blob";
import { env } from "@/lib/env";
import { isFresh, type SnapshotFile } from "./keys";

// Where snapshot files live. Production uses a private Vercel Blob store
// (BLOB_READ_WRITE_TOKEN): the files hold the same rows the pages redact
// before rendering, free-pass state included, so they must never be public.
// SNAPSHOT_DIR is a local stand-in for trying the snapshot path in dev.
// With neither set the snapshot is off and every read goes to the database.

const BLOB_PREFIX = "snapshot/v1/";

/**
 * How long one instance reuses a file before asking the store again, so a
 * rebuild shows up everywhere within a minute. Reads skip the blob CDN and
 * send the last ETag, so an unchanged file costs a 304 and no download.
 */
const REUSE_MS = 60_000;

type Backend = "blob" | "dir";

function backend(): Backend | null {
  if (env.BLOB_READ_WRITE_TOKEN) return "blob";
  if (env.SNAPSHOT_DIR) return "dir";
  return null;
}

export function snapshotEnabled(): boolean {
  return backend() !== null;
}

interface Held {
  at: number;
  etag: string | null;
  file: SnapshotFile | null;
}

/** Files one instance keeps parsed; past this the least recently read goes. */
const MAX_HELD = 300;

const held = new Map<string, Held>();
const pending = new Map<string, Promise<SnapshotFile | null>>();

/**
 * Read one snapshot file, or null when there is none, it can't be read, or
 * it's too old to trust. Never throws: a failed read means a live query.
 */
export async function readSnapshotFile(name: string): Promise<SnapshotFile | null> {
  const where = backend();
  if (!where) return null;

  const last = held.get(name);
  if (last && Date.now() - last.at < REUSE_MS) return usable(last.file);

  let request = pending.get(name);
  if (!request) {
    request = fetchFile(where, name, last).finally(() => pending.delete(name));
    pending.set(name, request);
  }
  return usable(await request);
}

function usable(file: SnapshotFile | null): SnapshotFile | null {
  return file && isFresh(file) ? file : null;
}

async function fetchFile(
  where: Backend,
  name: string,
  last: Held | undefined
): Promise<SnapshotFile | null> {
  try {
    if (where === "dir") {
      const raw = await fs.readFile(dirPath(name), "utf8");
      return hold(name, null, JSON.parse(raw) as SnapshotFile);
    }

    const result = await get(blobPath(name), {
      access: "private",
      useCache: false,
      ifNoneMatch: last?.etag ?? undefined,
    });
    if (!result) return hold(name, null, null);
    if (result.statusCode === 304 && last) return hold(name, last.etag, last.file);
    if (!result.stream) return hold(name, null, null);
    const raw = await new Response(result.stream).text();
    return hold(name, result.blob.etag, JSON.parse(raw) as SnapshotFile);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`[snapshot] read ${name} failed:`, err);
    }
    return hold(name, null, null);
  }
}

function hold(name: string, etag: string | null, file: SnapshotFile | null) {
  held.delete(name);
  held.set(name, { at: Date.now(), etag, file });
  if (held.size > MAX_HELD) held.delete(held.keys().next().value!);
  return file;
}

/**
 * Write a file built from data read at `builtAt`. Rebuilds can overlap (two
 * syncs, or a sync and the hourly cron), so a build never replaces a file
 * built from newer data. The write is conditional on the file it checked:
 * if another build lands in between, it checks again. Returns whether it wrote.
 */
export async function writeSnapshotFile(
  name: string,
  entries: Record<string, unknown>,
  builtAt: string
): Promise<boolean> {
  const where = backend();
  if (!where) return false;

  const file: SnapshotFile = { builtAt, entries };
  const body = JSON.stringify(file);

  for (let attempt = 0; attempt < 3; attempt++) {
    // Sends the held ETag, so an unchanged file costs a 304, not a download.
    const current = await fetchFile(where, name, held.get(name));
    if (current && isFresh(current) && Date.parse(current.builtAt) > Date.parse(builtAt)) {
      return false;
    }

    if (where === "dir") {
      await fs.mkdir(path.dirname(dirPath(name)), { recursive: true });
      await fs.writeFile(dirPath(name), body);
      hold(name, null, file);
      return true;
    }

    try {
      const written = await put(blobPath(name), body, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
        ifMatch: current ? (held.get(name)?.etag ?? undefined) : undefined,
      });
      // This instance sees its own write straight away.
      hold(name, written.etag, file);
      return true;
    } catch (err) {
      if (err instanceof BlobPreconditionFailedError) continue;
      throw err;
    }
  }
  return false;
}

export async function removeSnapshotFile(name: string): Promise<void> {
  const where = backend();
  if (!where) return;

  if (where === "dir") {
    await fs.rm(dirPath(name), { force: true });
  } else {
    await del(blobPath(name));
  }
  held.delete(name);
}

/** Names of the files under a folder, e.g. "users" gives "users/<id>". */
export async function listSnapshotFiles(folder: string): Promise<string[]> {
  const where = backend();
  if (!where) return [];

  if (where === "dir") {
    const files = await fs.readdir(path.join(env.SNAPSHOT_DIR!, folder)).catch(() => []);
    return files.filter((f) => f.endsWith(".json")).map((f) => `${folder}/${f.slice(0, -5)}`);
  }

  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: `${BLOB_PREFIX}${folder}/`, cursor });
    for (const blob of page.blobs) {
      names.push(blob.pathname.slice(BLOB_PREFIX.length, -".json".length));
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return names;
}

function blobPath(name: string) {
  return `${BLOB_PREFIX}${name}.json`;
}

function dirPath(name: string) {
  return path.join(env.SNAPSHOT_DIR!, `${name}.json`);
}
