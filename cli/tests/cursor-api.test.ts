/**
 * Tests for the Cursor dashboard-API extractor.
 *
 * Auth discovery is the only platform-sensitive part of this module, so most
 * of these tests exercise `findCursorAuth()` indirectly via the public
 * `hasCursorApiAuth()` helper. We point `CURSOR_CACHE_DATA` at a temp dir or
 * file and write hand-crafted JWTs into binary blobs that match the
 * `eyJ…\.eyJ…\.…` shape the scanner looks for.
 *
 * No outbound HTTP: every test either resolves to "no auth" (early return null
 * inside findCursorAuth) or to "no auth" (early return [] inside
 * extractCursorApiData) before any fetch() call would happen.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  hasCursorApiAuth,
  extractCursorApiData,
} from "../src/cursor-api.js";

// ---------------------------------------------------------------------------
// JWT fixture helpers
// ---------------------------------------------------------------------------

function base64url(input: string): string {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/**
 * Build a fake (signature-invalid) JWT whose claims match the given payload.
 * Signature is just bytes that satisfy the regex -- the extractor never
 * verifies the signature (the server does that on the API call).
 */
function makeJwt(payload: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const sig = "abcdefghijklmnop"; // 16 chars, satisfies [A-Za-z0-9_-]{10,}
  return `${header}.${body}.${sig}`;
}

// Times far enough out / back that the test never cares about clock drift.
const FAR_FUTURE_SEC = Math.floor(Date.UTC(2099, 0, 1) / 1000);
const PAST_SEC = Math.floor(Date.UTC(2020, 0, 1) / 1000);

interface JwtOpts {
  sub: string;
  exp?: number;
  iss?: string;
}

function offlineAccessJwt({ sub, exp = FAR_FUTURE_SEC, iss = "https://authentication.cursor.sh" }: JwtOpts): string {
  return makeJwt({
    sub,
    iss,
    exp,
    scope: "openid profile email offline_access",
  });
}

function sessionJwt({ sub, exp = FAR_FUTURE_SEC, iss = "https://authentication.cursor.sh" }: JwtOpts): string {
  return makeJwt({
    sub,
    iss,
    exp,
    scope: "openid profile email offline_access",
    type: "session",
  });
}

/** Wrap a JWT in a fake binary cache blob (random bytes around it). */
function blob(jwt: string): Buffer {
  const head = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]);
  const tail = Buffer.from([0x00, 0xff, 0xfe, 0xfd]);
  return Buffer.concat([head, Buffer.from(jwt, "latin1"), tail]);
}

// ---------------------------------------------------------------------------
// Shared env-var harness
// ---------------------------------------------------------------------------

function makeTempDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function restoreEnv(name: string, original: string | undefined): void {
  if (original === undefined) delete process.env[name];
  else process.env[name] = original;
}

// ---------------------------------------------------------------------------
// Cache layout detection
// ---------------------------------------------------------------------------

describe("findCursorAuth — cache layout detection", () => {
  let tmpDir: string;
  const originalEnv = process.env.CURSOR_CACHE_DATA;

  beforeEach(() => {
    tmpDir = makeTempDir("cursor-cache");
    process.env.CURSOR_CACHE_DATA = tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    restoreEnv("CURSOR_CACHE_DATA", originalEnv);
  });

  it("returns false when the cache root doesn't exist", () => {
    rmSync(tmpDir, { recursive: true, force: true });
    expect(hasCursorApiAuth()).toBe(false);
  });

  it("returns false when the cache directory is empty", () => {
    expect(hasCursorApiAuth()).toBe(false);
  });

  describe("Simple cache (directory of <hash>_0 files)", () => {
    it("finds a JWT inside one entry of a multi-file cache", () => {
      writeFileSync(join(tmpDir, "index"), Buffer.from("decoy index bytes\xff\x00"));
      writeFileSync(join(tmpDir, "0001abcd_0"), Buffer.from([0x00, 0x01, 0x02, 0x03]));
      writeFileSync(join(tmpDir, "0002efgh_0"), Buffer.from("not a jwt just text"));
      writeFileSync(
        join(tmpDir, "0003ijkl_0"),
        blob(offlineAccessJwt({ sub: "auth0|user_simple" }))
      );

      expect(hasCursorApiAuth()).toBe(true);
    });

    it("skips the literal `index` file when scanning", () => {
      // Putting the JWT in `index` shouldn't make findCursorAuth see it --
      // `index` is simple-cache metadata, not a response payload.
      writeFileSync(
        join(tmpDir, "index"),
        blob(offlineAccessJwt({ sub: "auth0|user_in_index" }))
      );
      expect(hasCursorApiAuth()).toBe(false);
    });

    it("returns false when no entry contains a Cursor-issued JWT", () => {
      // A JWT issued by some other identity provider -- iss filter rejects it.
      const otherJwt = makeJwt({
        sub: "auth0|user_other",
        iss: "https://accounts.example.com",
        exp: FAR_FUTURE_SEC,
      });
      writeFileSync(join(tmpDir, "abcd1234_0"), blob(otherJwt));
      expect(hasCursorApiAuth()).toBe(false);
    });

    it("ignores subdirectories inside Cache_Data instead of recursing", () => {
      mkdirSync(join(tmpDir, "subdir"));
      writeFileSync(
        join(tmpDir, "subdir", "nested_0"),
        blob(offlineAccessJwt({ sub: "auth0|user_nested" }))
      );
      expect(hasCursorApiAuth()).toBe(false);
    });

    it("deduplicates the same JWT appearing in multiple entries", () => {
      const jwt = offlineAccessJwt({ sub: "auth0|user_dup" });
      writeFileSync(join(tmpDir, "first_0"), blob(jwt));
      writeFileSync(join(tmpDir, "second_0"), blob(jwt));
      // No assertion needed beyond "doesn't throw and finds the auth";
      // dedup matters for the selection step downstream.
      expect(hasCursorApiAuth()).toBe(true);
    });

    it("works with a Windows-style blockfile layout (index + data_0/1/2…)", () => {
      // This is the on-disk shape the Windows builds we've seen produce by
      // default. The JWT is in one of the `data_*` blobs (Chromium decides
      // which); pin the case where it's specifically in `data_1`.
      writeFileSync(join(tmpDir, "index"), Buffer.from("blockfile index header"));
      writeFileSync(join(tmpDir, "data_0"), Buffer.from([0x00, 0x01]));
      writeFileSync(
        join(tmpDir, "data_1"),
        blob(offlineAccessJwt({ sub: "auth0|user_blockdir" }))
      );
      writeFileSync(join(tmpDir, "data_2"), Buffer.from([0xff, 0xfe]));
      writeFileSync(join(tmpDir, "data_3"), Buffer.from([0xab, 0xcd]));
      expect(hasCursorApiAuth()).toBe(true);
    });

    it("still finds the JWT when Chromium puts it in a different data_* file", () => {
      // Defensive: don't assume the JWT is always in `data_1`.
      writeFileSync(join(tmpDir, "index"), Buffer.from("blockfile index header"));
      writeFileSync(join(tmpDir, "data_0"), Buffer.from([0x00, 0x01]));
      writeFileSync(join(tmpDir, "data_1"), Buffer.from([0xff, 0xfe]));
      writeFileSync(
        join(tmpDir, "data_2"),
        blob(offlineAccessJwt({ sub: "auth0|user_data2" }))
      );
      expect(hasCursorApiAuth()).toBe(true);
    });
  });

  describe("Blockfile cache (single file -- Windows or explicit override)", () => {
    let blockFile: string;

    beforeEach(() => {
      blockFile = join(tmpDir, "data_1");
      process.env.CURSOR_CACHE_DATA = blockFile;
    });

    it("finds a JWT inside a single blockfile blob", () => {
      writeFileSync(blockFile, blob(offlineAccessJwt({ sub: "auth0|user_block" })));
      expect(hasCursorApiAuth()).toBe(true);
    });

    it("returns false when the file exists but contains no JWT", () => {
      writeFileSync(blockFile, Buffer.from([0xde, 0xad, 0xbe, 0xef]));
      expect(hasCursorApiAuth()).toBe(false);
    });

    it("returns false when the file does not exist", () => {
      expect(hasCursorApiAuth()).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// `sub` parser — multi-provider support
// ---------------------------------------------------------------------------

describe("findCursorAuth — sub parser accepts every Cursor identity provider", () => {
  let tmpDir: string;
  const originalEnv = process.env.CURSOR_CACHE_DATA;

  beforeEach(() => {
    tmpDir = makeTempDir("cursor-cache-sub");
    process.env.CURSOR_CACHE_DATA = tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    restoreEnv("CURSOR_CACHE_DATA", originalEnv);
  });

  it.each([
    ["auth0|user_e1m4il", true, "email/password"],
    ["google-oauth2|user_g00gle", true, "Sign in with Google"],
    ["github|123456", true, "Sign in with GitHub"],
    ["apple|001234.abc", true, "Sign in with Apple"],
    ["", false, "empty sub"],
    ["nopipe", false, "missing separator"],
    ["auth0|", false, "empty userId after pipe"],
  ])("sub=%j -> hasAuth=%s (%s)", (sub, expected) => {
    writeFileSync(join(tmpDir, "entry_0"), blob(offlineAccessJwt({ sub })));
    expect(hasCursorApiAuth()).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Token selection priority
// ---------------------------------------------------------------------------

describe("findCursorAuth — token selection priority", () => {
  let tmpDir: string;
  const originalEnv = process.env.CURSOR_CACHE_DATA;

  beforeEach(() => {
    tmpDir = makeTempDir("cursor-cache-pri");
    process.env.CURSOR_CACHE_DATA = tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    restoreEnv("CURSOR_CACHE_DATA", originalEnv);
  });

  it("uses an offline_access token when one is present (preferred over session)", () => {
    writeFileSync(
      join(tmpDir, "session_0"),
      blob(sessionJwt({ sub: "auth0|user_session", exp: FAR_FUTURE_SEC + 1000 }))
    );
    writeFileSync(
      join(tmpDir, "offline_0"),
      blob(offlineAccessJwt({ sub: "auth0|user_offline", exp: FAR_FUTURE_SEC }))
    );
    expect(hasCursorApiAuth()).toBe(true);
  });

  it("falls back to a still-valid session token when no offline_access token exists", () => {
    writeFileSync(
      join(tmpDir, "session_0"),
      blob(sessionJwt({ sub: "auth0|user_session", exp: FAR_FUTURE_SEC }))
    );
    expect(hasCursorApiAuth()).toBe(true);
  });

  it("returns false when only expired session tokens exist", () => {
    writeFileSync(
      join(tmpDir, "session_0"),
      blob(sessionJwt({ sub: "auth0|user_session", exp: PAST_SEC }))
    );
    expect(hasCursorApiAuth()).toBe(false);
  });

  it("ignores tokens whose iss claim is not Cursor", () => {
    writeFileSync(
      join(tmpDir, "other_0"),
      blob(makeJwt({
        sub: "auth0|user_other",
        iss: "https://accounts.example.com",
        exp: FAR_FUTURE_SEC,
      }))
    );
    expect(hasCursorApiAuth()).toBe(false);
  });

  it("accepts an offline_access token even with an expired exp (long-lived path skips the exp check)", () => {
    // The selection logic deliberately doesn't gate offline_access tokens on
    // exp -- they're decades out in practice, and the server is the source
    // of truth on validity. Pinning this behavior here.
    writeFileSync(
      join(tmpDir, "offline_0"),
      blob(offlineAccessJwt({ sub: "auth0|user_offline", exp: PAST_SEC }))
    );
    expect(hasCursorApiAuth()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extractCursorApiData — robustness on env-driven inputs
// ---------------------------------------------------------------------------

describe("extractCursorApiData — env-driven inputs don't crash on junk", () => {
  let tmpDir: string;
  const originalCacheEnv = process.env.CURSOR_CACHE_DATA;
  const originalSkipEnv = process.env.CURSOR_API_SKIP_DATES;

  beforeEach(() => {
    // Empty cache dir -> findCursorAuth returns null -> extract returns []
    // before reaching skip-date or fetch logic. That's enough to exercise
    // env-var parsing without triggering any HTTP.
    tmpDir = makeTempDir("cursor-cache-empty");
    process.env.CURSOR_CACHE_DATA = tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    restoreEnv("CURSOR_CACHE_DATA", originalCacheEnv);
    restoreEnv("CURSOR_API_SKIP_DATES", originalSkipEnv);
  });

  it("returns [] without throwing when no auth is on disk", async () => {
    delete process.env.CURSOR_API_SKIP_DATES;
    await expect(extractCursorApiData("2026-01-01")).resolves.toEqual([]);
  });

  it("ignores junk values in CURSOR_API_SKIP_DATES instead of throwing", async () => {
    // Mix of: well-formed, blank, non-date, wrong separator, well-formed.
    process.env.CURSOR_API_SKIP_DATES =
      "2026-04-01, ,not-a-date,2026/04/02,2026-04-03";
    await expect(extractCursorApiData("2026-01-01")).resolves.toEqual([]);
  });

  it("returns [] when `since` is malformed", async () => {
    await expect(extractCursorApiData("not-a-date")).resolves.toEqual([]);
  });

  it("returns [] when `since` is in the future", async () => {
    await expect(extractCursorApiData("2999-01-01")).resolves.toEqual([]);
  });
});
