import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildTieredRows,
  calculateTieredCost,
  convertLitellmEntry,
  loadLivePricing,
  lookupLivePricing,
  normalizeModelId,
  _setLiveTableForTests,
  _setTieredTableForTests,
} from "../src/litellm-pricing.js";
import { getModelPricing, calculateCost } from "../src/pricing.js";

const FABLE = { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 };
/** The same model as a tiered-table row on disk (USD per token). */
const FABLE_TIERED_ROW = ["claude-fable-5", 1e-5, 5e-5, 1.25e-5, 1e-6, null, null, null, null];

afterEach(() => {
  _setLiveTableForTests(null);
  _setTieredTableForTests(null);
  delete process.env.CLAWDBOARD_HOME;
  vi.unstubAllGlobals();
});

describe("convertLitellmEntry", () => {
  it("converts per-token costs to per-1M-token pricing", () => {
    expect(
      convertLitellmEntry({
        input_cost_per_token: 1e-5,
        output_cost_per_token: 5e-5,
        cache_creation_input_token_cost: 1.25e-5,
        cache_read_input_token_cost: 1e-6,
      })
    ).toEqual(FABLE);
  });

  it("defaults cache rates to 0 when absent", () => {
    const pricing = convertLitellmEntry({
      input_cost_per_token: 2.5e-6,
      output_cost_per_token: 1e-5,
    });
    expect(pricing).toEqual({ input: 2.5, output: 10, cacheWrite: 0, cacheRead: 0 });
  });

  it("rejects entries without input/output costs", () => {
    expect(convertLitellmEntry({ mode: "embedding" })).toBeNull();
    expect(convertLitellmEntry({ input_cost_per_token: 1e-6 })).toBeNull();
    expect(convertLitellmEntry(null)).toBeNull();
    expect(convertLitellmEntry("nope")).toBeNull();
  });
});

describe("lookupLivePricing", () => {
  it("returns null when the live table is not loaded", () => {
    expect(lookupLivePricing("claude-fable-5")).toBeNull();
  });

  it("matches exact model IDs", () => {
    _setLiveTableForTests({ "claude-fable-5": FABLE });
    expect(lookupLivePricing("claude-fable-5")).toEqual(FABLE);
  });

  it("strips bracket suffixes like [1m]", () => {
    _setLiveTableForTests({ "claude-fable-5": FABLE });
    expect(lookupLivePricing("claude-fable-5[1m]")).toEqual(FABLE);
  });

  it("strips date suffixes", () => {
    _setLiveTableForTests({ "claude-sonnet-4": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 } });
    expect(lookupLivePricing("claude-sonnet-4-20250514")?.input).toBe(3);
  });

  it("does not fuzzy-match unrelated models", () => {
    _setLiveTableForTests({ "claude-fable-5": FABLE });
    expect(lookupLivePricing("claude-fable-6")).toBeNull();
  });
});

describe("getModelPricing live-first resolution", () => {
  it("prefers live pricing over the static table", () => {
    _setLiveTableForTests({
      "claude-sonnet-4-6": { input: 99, output: 99, cacheWrite: 99, cacheRead: 99 },
    });
    expect(getModelPricing("claude-sonnet-4-6").input).toBe(99);
  });

  it("falls back to the static table when live misses", () => {
    _setLiveTableForTests({ "some-other-model": FABLE });
    expect(getModelPricing("claude-sonnet-4-6").input).toBe(3);
  });

  it("prices a brand-new model from live data end to end", () => {
    _setLiveTableForTests({ "claude-fable-5": FABLE });
    const cost = calculateCost("claude-fable-5", {
      input: 1_000_000,
      output: 1_000_000,
      cacheCreation: 0,
      cacheRead: 0,
    });
    expect(cost).toBe(60);
  });
});

describe("loadLivePricing disk cache", () => {
  it("loads from a fresh disk cache without fetching", async () => {
    const home = await mkdtemp(join(tmpdir(), "clawdboard-test-"));
    process.env.CLAWDBOARD_HOME = home;
    await writeFile(
      join(home, "pricing-cache.json"),
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        models: { "claude-fable-5": FABLE },
        tiered: [FABLE_TIERED_ROW],
      })
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await loadLivePricing();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(lookupLivePricing("claude-fable-5")).toEqual(FABLE);
    expect(
      calculateTieredCost("claude-fable-5", {
        input: 1_000_000,
        output: 1_000_000,
        cacheCreation: 0,
        cacheRead: 0,
      })
    ).toBe(60);
  });

  it("refetches a fresh cache written before the tiered table existed", async () => {
    const home = await mkdtemp(join(tmpdir(), "clawdboard-test-"));
    process.env.CLAWDBOARD_HOME = home;
    await writeFile(
      join(home, "pricing-cache.json"),
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        models: { "claude-fable-5": FABLE },
      })
    );
    const upstream: Record<string, unknown> = {
      "claude-fable-5": { input_cost_per_token: 1e-5, output_cost_per_token: 5e-5 },
      "unpriced-embedding-model": { mode: "embedding" },
    };
    for (let i = 0; i < 300; i++) {
      upstream[`model-${i}`] = { input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 };
    }
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(upstream), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await loadLivePricing();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const written = JSON.parse(await readFile(join(home, "pricing-cache.json"), "utf8"));
    // Both tables on disk; the tiered one keeps unpriced entries, in file order.
    expect(written.models["claude-fable-5"]).toMatchObject({ input: 10, output: 50 });
    expect(written.tiered.slice(0, 2)).toEqual([
      ["claude-fable-5", 1e-5, 5e-5, null, null, null, null, null, null],
      ["unpriced-embedding-model", null, null, null, null, null, null, null, null],
    ]);
    expect(written.tiered).toHaveLength(302);
  });

  it("uses an old-format cache as far as it goes when the refetch fails", async () => {
    const home = await mkdtemp(join(tmpdir(), "clawdboard-test-"));
    process.env.CLAWDBOARD_HOME = home;
    await writeFile(
      join(home, "pricing-cache.json"),
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        models: { "claude-fable-5": FABLE },
      })
    );
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));

    await loadLivePricing();

    expect(lookupLivePricing("claude-fable-5")).toEqual(FABLE);
    // No tiered table: Claude Code falls back to the static table.
    expect(
      calculateTieredCost("claude-fable-5", { input: 1, output: 1, cacheCreation: 0, cacheRead: 0 })
    ).toBeNull();
  });

  it("keeps the tiered table when recording a failed fetch", async () => {
    const home = await mkdtemp(join(tmpdir(), "clawdboard-test-"));
    process.env.CLAWDBOARD_HOME = home;
    await writeFile(
      join(home, "pricing-cache.json"),
      JSON.stringify({
        fetchedAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
        models: { "claude-fable-5": FABLE },
        tiered: [FABLE_TIERED_ROW],
      })
    );
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));

    await loadLivePricing();

    expect(
      calculateTieredCost("claude-fable-5", {
        input: 1_000_000,
        output: 0,
        cacheCreation: 0,
        cacheRead: 0,
      })
    ).toBe(10);
    const written = JSON.parse(await readFile(join(home, "pricing-cache.json"), "utf8"));
    expect(written.failedAt).toEqual(expect.any(String));
    expect(written.tiered).toEqual([FABLE_TIERED_ROW]);
  });

  it("fetches, converts, and writes the cache when stale", async () => {
    const home = await mkdtemp(join(tmpdir(), "clawdboard-test-"));
    process.env.CLAWDBOARD_HOME = home;

    // 300 priced entries to clear the MIN_ENTRIES sanity floor
    const upstream: Record<string, unknown> = {
      "claude-fable-5": {
        input_cost_per_token: 1e-5,
        output_cost_per_token: 5e-5,
        cache_creation_input_token_cost: 1.25e-5,
        cache_read_input_token_cost: 1e-6,
      },
      "unpriced-embedding-model": { mode: "embedding" },
    };
    for (let i = 0; i < 300; i++) {
      upstream[`model-${i}`] = { input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 };
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(upstream), { status: 200 }))
    );

    await loadLivePricing();

    expect(lookupLivePricing("claude-fable-5")).toEqual(FABLE);
    expect(lookupLivePricing("unpriced-embedding-model")).toBeNull();
    const written = JSON.parse(
      await readFile(join(home, "pricing-cache.json"), "utf8")
    );
    expect(written.models["claude-fable-5"]).toEqual(FABLE);
  });

  it("falls back to a stale cache when the fetch fails", async () => {
    const home = await mkdtemp(join(tmpdir(), "clawdboard-test-"));
    process.env.CLAWDBOARD_HOME = home;
    await writeFile(
      join(home, "pricing-cache.json"),
      JSON.stringify({
        fetchedAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
        models: { "claude-fable-5": FABLE },
      })
    );
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));

    await loadLivePricing();

    expect(lookupLivePricing("claude-fable-5")).toEqual(FABLE);
  });

  it("leaves the live table empty when fetch fails and no cache exists", async () => {
    const home = await mkdtemp(join(tmpdir(), "clawdboard-test-"));
    process.env.CLAWDBOARD_HOME = home;
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));

    await loadLivePricing();

    expect(lookupLivePricing("claude-fable-5")).toBeNull();
    // Static fallback still works
    expect(getModelPricing("claude-fable-5").input).toBe(10);
  });

  it("distrusts suspiciously small upstream responses", async () => {
    const home = await mkdtemp(join(tmpdir(), "clawdboard-test-"));
    process.env.CLAWDBOARD_HOME = home;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ "claude-fable-5": { input_cost_per_token: 1, output_cost_per_token: 1 } }),
            { status: 200 }
          )
      )
    );

    await loadLivePricing();

    expect(lookupLivePricing("claude-fable-5")).toBeNull();
  });
});

describe("fetch-failure backoff", () => {
  it("records the failure on disk so the next run can skip the fetch", async () => {
    const home = await mkdtemp(join(tmpdir(), "clawdboard-test-"));
    process.env.CLAWDBOARD_HOME = home;
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));

    await loadLivePricing();

    const written = JSON.parse(
      await readFile(join(home, "pricing-cache.json"), "utf8")
    );
    expect(typeof written.failedAt).toBe("string");
  });

  it("preserves stale models in the failure marker", async () => {
    const home = await mkdtemp(join(tmpdir(), "clawdboard-test-"));
    process.env.CLAWDBOARD_HOME = home;
    await writeFile(
      join(home, "pricing-cache.json"),
      JSON.stringify({
        fetchedAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
        models: { "claude-fable-5": FABLE },
      })
    );
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));

    await loadLivePricing();

    const written = JSON.parse(
      await readFile(join(home, "pricing-cache.json"), "utf8")
    );
    expect(typeof written.failedAt).toBe("string");
    expect(written.models["claude-fable-5"]).toEqual(FABLE);
  });

  it("skips the fetch while a recent failure is on record", async () => {
    const home = await mkdtemp(join(tmpdir(), "clawdboard-test-"));
    process.env.CLAWDBOARD_HOME = home;
    await writeFile(
      join(home, "pricing-cache.json"),
      JSON.stringify({
        fetchedAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
        models: { "claude-fable-5": FABLE },
        failedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      })
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await loadLivePricing();

    expect(fetchSpy).not.toHaveBeenCalled();
    // Stale models still serve lookups during the backoff window
    expect(lookupLivePricing("claude-fable-5")).toEqual(FABLE);
  });

  it("retries the fetch once the backoff has elapsed", async () => {
    const home = await mkdtemp(join(tmpdir(), "clawdboard-test-"));
    process.env.CLAWDBOARD_HOME = home;
    await writeFile(
      join(home, "pricing-cache.json"),
      JSON.stringify({
        fetchedAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
        models: {},
        failedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      })
    );
    const fetchSpy = vi.fn(async () => { throw new Error("still offline"); });
    vi.stubGlobal("fetch", fetchSpy);

    await loadLivePricing();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("clears the failure marker after a successful fetch", async () => {
    const home = await mkdtemp(join(tmpdir(), "clawdboard-test-"));
    process.env.CLAWDBOARD_HOME = home;
    await writeFile(
      join(home, "pricing-cache.json"),
      JSON.stringify({
        fetchedAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
        models: {},
        failedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      })
    );
    const upstream: Record<string, unknown> = {};
    for (let i = 0; i < 300; i++) {
      upstream[`model-${i}`] = { input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 };
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(upstream), { status: 200 }))
    );

    await loadLivePricing();

    const written = JSON.parse(
      await readFile(join(home, "pricing-cache.json"), "utf8")
    );
    expect(written.failedAt).toBeUndefined();
  });
});

describe("shared model-ID normalizer", () => {
  it("strips bracket suffixes in both lookup layers", () => {
    expect(normalizeModelId("claude-fable-5[1m]")).toBe("claude-fable-5");
    expect(normalizeModelId("claude-sonnet-4-20250514")).toBe("claude-sonnet-4");
    expect(normalizeModelId("gpt-4o-2024-08-06")).toBe("gpt-4o");
  });

  it("prices a bracket-suffixed ID from the static table when live misses", () => {
    // Regression: the static layer previously used its own normalizer that
    // did not strip "[1m]", so this fell through to DEFAULT_PRICING.
    _setLiveTableForTests({ "some-other-model": FABLE });
    expect(getModelPricing("claude-sonnet-4-5[1m]").input).toBe(3);
  });

  it("prices a bracket-suffixed ID from the static table when live is not loaded", () => {
    expect(getModelPricing("claude-sonnet-4-5[1m]").input).toBe(3);
  });
});

describe("tiered pricing (Claude Code)", () => {
  const TOKENS = { input: 1000, output: 100, cacheCreation: 10, cacheRead: 1 };
  const TABLE: Record<string, unknown> = {
    sample_spec: {
      max_tokens: "LEGACY parameter, a string",
      input_cost_per_token: 1,
      output_cost_per_token: 1,
    },
    "broken-cost": { input_cost_per_token: "0.1", output_cost_per_token: 1e-6 },
    "null-cost": { input_cost_per_token: null },
    "not-an-object": "nope",
    "unpriced-claude-mystery-9": { mode: "embedding" },
    "claude-sonnet-4-5": {
      input_cost_per_token: 3e-6,
      output_cost_per_token: 1.5e-5,
      cache_creation_input_token_cost: 3.75e-6,
      cache_read_input_token_cost: 3e-7,
      input_cost_per_token_above_200k_tokens: 6e-6,
      output_cost_per_token_above_200k_tokens: 2.25e-5,
      cache_creation_input_token_cost_above_200k_tokens: 7.5e-6,
      cache_read_input_token_cost_above_200k_tokens: 6e-7,
      max_tokens: 64000,
    },
    "anthropic/claude-opus-4-1": {
      input_cost_per_token: 1.5e-5,
      output_cost_per_token: 7.5e-5,
    },
    "claude-fable-5": {
      input_cost_per_token: 1e-5,
      output_cost_per_token: 5e-5,
      cache_creation_input_token_cost: 1.25e-5,
      cache_read_input_token_cost: 1e-6,
    },
    "only-above-rate": { output_cost_per_token_above_200k_tokens: 1e-6 },
  };

  it("keeps every entry ccusage's schema accepts, priced or not, in file order", () => {
    const rows = buildTieredRows(TABLE);
    expect(rows.map((row) => row[0])).toEqual([
      "unpriced-claude-mystery-9",
      "claude-sonnet-4-5",
      "anthropic/claude-opus-4-1",
      "claude-fable-5",
      "only-above-rate",
    ]);
    expect(rows[0].slice(1)).toEqual([null, null, null, null, null, null, null, null]);
    expect(rows[1].slice(1)).toEqual([3e-6, 1.5e-5, 3.75e-6, 3e-7, 6e-6, 2.25e-5, 7.5e-6, 6e-7]);
  });

  it("returns null until the table is loaded", () => {
    expect(calculateTieredCost("claude-fable-5", TOKENS)).toBeNull();
  });

  it("prices an exact match per token", () => {
    _setTieredTableForTests(TABLE);
    expect(calculateTieredCost("claude-fable-5", TOKENS)).toBe(
      1000 * 1e-5 + 100 * 5e-5 + 10 * 1.25e-5 + 1 * 1e-6
    );
  });

  it("finds a model behind a provider prefix", () => {
    _setTieredTableForTests(TABLE);
    expect(calculateTieredCost("claude-opus-4-1", TOKENS)).toBe(1000 * 1.5e-5 + 100 * 7.5e-5);
    // "claude-" + "sonnet-4-5"
    expect(calculateTieredCost("sonnet-4-5", TOKENS)).toBe(
      calculateTieredCost("claude-sonnet-4-5", TOKENS)
    );
  });

  it("falls back to the first entry that contains, or is contained in, the name", () => {
    _setTieredTableForTests(TABLE);
    // Contains "claude-fable-5"
    expect(calculateTieredCost("claude-fable-5-2", TOKENS)).toBe(
      calculateTieredCost("claude-fable-5", TOKENS)
    );
    // Case-insensitive, and contained in an entry's name
    expect(calculateTieredCost("OPUS-4", TOKENS)).toBe(
      calculateTieredCost("claude-opus-4-1", TOKENS)
    );
    // The first match in file order wins, even an unpriced one: cost 0.
    expect(calculateTieredCost("claude-mystery-9", TOKENS)).toBe(0);
  });

  it("prices an unknown or empty model at 0, as ccusage does", () => {
    _setTieredTableForTests(TABLE);
    expect(calculateTieredCost("some-other-vendor-model", TOKENS)).toBe(0);
    expect(calculateTieredCost("", TOKENS)).toBe(0);
  });

  it("charges the above-200k rate only on the part over 200k", () => {
    _setTieredTableForTests(TABLE);
    const cost = calculateTieredCost("claude-sonnet-4-5", {
      input: 200_001,
      output: 200_000,
      cacheCreation: 500_000,
      cacheRead: 1_000_000,
    });
    expect(cost).toBe(
      1 * 6e-6 +
        200_000 * 3e-6 +
        200_000 * 1.5e-5 +
        (300_000 * 7.5e-6 + 200_000 * 3.75e-6) +
        (800_000 * 6e-7 + 200_000 * 3e-7)
    );
  });

  it("uses the base rate past 200k when the model has no above-200k rate", () => {
    _setTieredTableForTests(TABLE);
    expect(
      calculateTieredCost("claude-fable-5", {
        input: 300_000,
        output: 0,
        cacheCreation: 0,
        cacheRead: 0,
      })
    ).toBe(300_000 * 1e-5);
  });

  it("handles a rate that exists only above 200k", () => {
    _setTieredTableForTests(TABLE);
    const tokens = { input: 0, cacheCreation: 0, cacheRead: 0 };
    expect(calculateTieredCost("only-above-rate", { ...tokens, output: 200_000 })).toBe(0);
    expect(calculateTieredCost("only-above-rate", { ...tokens, output: 200_010 })).toBe(10 * 1e-6);
  });
});
