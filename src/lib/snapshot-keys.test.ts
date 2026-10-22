// Run with: npm test
//
// The snapshot answers a page's read only when the page's call and the
// rebuild's call land on the same key, so key drift silently turns every read
// back into a database query. These pin the rules both sides rely on.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SNAPSHOT_MAX_AGE_MS,
  isFresh,
  reviveDates,
  snapshotKey,
} from "./snapshot/keys.ts";

test("trailing undefined args share the key of the shorter call", () => {
  assert.equal(
    snapshotKey("userSummary", ["u1", "7d", undefined]),
    snapshotKey("userSummary", ["u1", "7d"])
  );
  assert.equal(snapshotKey("communityStats", [undefined, undefined]), "communityStats:[]");
});

test("different args, names or a set range give different keys", () => {
  assert.notEqual(snapshotKey("userDaily", ["u1"]), snapshotKey("userDaily", ["u1", "7d"]));
  assert.notEqual(snapshotKey("userDaily", ["u1"]), snapshotKey("userSummary", ["u1"]));
  assert.notEqual(
    snapshotKey("leaderboard", ["custom", "cost", "desc"]),
    snapshotKey("leaderboard", ["custom", "cost", "desc", { from: "2026-01-01", to: "2026-01-31" }])
  );
});

test("a file is fresh up to the max age and stale after it", () => {
  const now = Date.parse("2026-10-22T12:00:00Z"); // noon UTC: max age stays within the day
  const at = (ms: number) => ({ builtAt: new Date(now - ms).toISOString(), entries: {} });
  assert.equal(isFresh(at(0), now), true);
  assert.equal(isFresh(at(SNAPSHOT_MAX_AGE_MS), now), true);
  assert.equal(isFresh(at(SNAPSHOT_MAX_AGE_MS + 1), now), false);
  assert.equal(isFresh({ builtAt: "not a date", entries: {} }, now), false);
  // A build time in the future: fine within clock skew, bad beyond it.
  assert.equal(isFresh(at(-60_000), now), true);
  assert.equal(isFresh(at(-60 * 60 * 1000), now), false);
});

test("a file built before midnight UTC is stale right after it", () => {
  const justAfterMidnight = Date.parse("2026-10-23T00:01:00Z");
  const file = { builtAt: "2026-10-22T23:59:00.000Z", entries: {} };
  assert.equal(isFresh(file, justAfterMidnight), false);
  assert.equal(isFresh(file, Date.parse("2026-10-22T23:59:30Z")), true);
});

test("reviveDates restores the named fields and leaves the rest", () => {
  const revived = reviveDates(
    { createdAt: "2026-10-01T00:00:00.000Z", lastSyncAt: null, name: "x" },
    ["createdAt", "lastSyncAt"]
  );
  assert.ok((revived.createdAt as unknown) instanceof Date);
  assert.equal((revived.createdAt as unknown as Date).toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(revived.lastSyncAt, null);
  assert.equal(revived.name, "x");
  assert.equal(reviveDates(null, ["createdAt"]), null);
});
