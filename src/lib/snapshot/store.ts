import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { del, get, put } from "@vercel/blob";
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
  held.set(name, { at: Date.now(), etag, file });
  return file;
}

export async function writeSnapshotFile(
  name: string,
  entries: Record<string, unknown>
): Promise<void> {
  const where = backend();
  if (!where) return;

  const file: SnapshotFile = { builtAt: new Date().toISOString(), entries };
  const body = JSON.stringify(file);

  if (where === "dir") {
    await fs.mkdir(path.dirname(dirPath(name)), { recursive: true });
    await fs.writeFile(dirPath(name), body);
  } else {
    await put(blobPath(name), body, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
  }
  // This instance sees its own write straight away.
  hold(name, null, file);
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

function blobPath(name: string) {
  return `${BLOB_PREFIX}${name}.json`;
}

function dirPath(name: string) {
  return path.join(env.SNAPSHOT_DIR!, `${name}.json`);
}
