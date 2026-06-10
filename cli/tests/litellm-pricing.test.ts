import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  convertLitellmEntry,
  loadLivePricing,
  lookupLivePricing,
  _setLiveTableForTests,
} from "../src/litellm-pricing.js";
import { getModelPricing, calculateCost } from "../src/pricing.js";

const FABLE = { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 };

afterEach(() => {
  _setLiveTableForTests(null);
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
      })
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await loadLivePricing();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(lookupLivePricing("claude-fable-5")).toEqual(FABLE);
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
