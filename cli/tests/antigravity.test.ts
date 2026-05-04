import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractAntigravityData,
  hasAntigravityData,
} from "../src/antigravity.js";

interface JsonObject {
  [key: string]: unknown;
}

function createTempDir(prefix: string): string {
  const dir = join(
    tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeOauthCreds(geminiHome: string, creds: JsonObject): void {
  writeFileSync(
    join(geminiHome, "oauth_creds.json"),
    JSON.stringify(creds),
    "utf-8"
  );
}

function writeClawdboardConfig(clawdboardHome: string, config: JsonObject): void {
  mkdirSync(clawdboardHome, { recursive: true });
  writeFileSync(
    join(clawdboardHome, "config.json"),
    JSON.stringify(config),
    "utf-8"
  );
}

describe("Antigravity extractor", () => {
  let geminiHome: string;
  let clawdboardHome: string;
  const originalGeminiHome = process.env.GEMINI_HOME;
  const originalClawdboardHome = process.env.CLAWDBOARD_HOME;
  const originalFetch = global.fetch;

  beforeEach(() => {
    geminiHome = createTempDir("gemini");
    clawdboardHome = createTempDir("clawdboard-home");
    process.env.GEMINI_HOME = geminiHome;
    process.env.CLAWDBOARD_HOME = clawdboardHome;
  });

  afterEach(() => {
    rmSync(geminiHome, { recursive: true, force: true });
    rmSync(clawdboardHome, { recursive: true, force: true });
    if (originalGeminiHome === undefined) {
      delete process.env.GEMINI_HOME;
    } else {
      process.env.GEMINI_HOME = originalGeminiHome;
    }
    if (originalClawdboardHome === undefined) {
      delete process.env.CLAWDBOARD_HOME;
    } else {
      process.env.CLAWDBOARD_HOME = originalClawdboardHome;
    }
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("hasAntigravityData", () => {
    it("returns false when oauth_creds.json is missing", () => {
      expect(hasAntigravityData()).toBe(false);
    });

    it("returns true when oauth_creds.json exists (config gate is in extractor)", () => {
      writeOauthCreds(geminiHome, { access_token: "tok" });
      expect(hasAntigravityData()).toBe(true);
    });
  });

  describe("opt-in gate", () => {
    it("returns [] when antigravity.enabled is not set in config", async () => {
      writeOauthCreds(geminiHome, {
        access_token: "tok",
        expiry_date: Date.now() + 3600000,
      });
      // No clawdboard config written → not opted in

      global.fetch = vi.fn() as unknown as typeof fetch;

      const result = await extractAntigravityData();
      expect(result).toEqual([]);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("returns [] when antigravity.enabled is explicitly false", async () => {
      writeClawdboardConfig(clawdboardHome, {
        antigravity: { enabled: false },
      });
      writeOauthCreds(geminiHome, {
        access_token: "tok",
        expiry_date: Date.now() + 3600000,
      });

      global.fetch = vi.fn() as unknown as typeof fetch;

      const result = await extractAntigravityData();
      expect(result).toEqual([]);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("attempts the API call when opted in and creds present", async () => {
      writeClawdboardConfig(clawdboardHome, {
        antigravity: { enabled: true },
      });
      writeOauthCreds(geminiHome, {
        access_token: "valid-token",
        expiry_date: Date.now() + 3600000,
      });

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          metrics: [
            {
              model: "gemini-3-pro",
              date: "2026-03-10",
              inputTokens: 1000,
              outputTokens: 500,
              cachedTokens: 0,
            },
          ],
        }),
      }) as unknown as typeof fetch;

      const result = await extractAntigravityData();
      expect(global.fetch).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe("antigravity");
      expect(result[0].date).toBe("2026-03-10");
      expect(result[0].inputTokens).toBe(1000);
      expect(result[0].modelsUsed).toEqual(["gemini-3-pro"]);
    });
  });

  describe("token refresh", () => {
    it("refreshes the token when expired and uses the new one", async () => {
      writeClawdboardConfig(clawdboardHome, {
        antigravity: { enabled: true },
      });
      writeOauthCreds(geminiHome, {
        access_token: "expired-token",
        refresh_token: "refresh-tok",
        client_id: "client-id",
        client_secret: "client-secret",
        expiry_date: Date.now() - 3600000, // expired 1h ago
      });

      const fetchMock = vi
        .fn()
        // First call: token refresh
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "new-token" }),
        })
        // Second call: usage API
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            metrics: [
              {
                model: "gemini-3-pro",
                date: "2026-03-10",
                inputTokens: 100,
                outputTokens: 50,
              },
            ],
          }),
        });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await extractAntigravityData();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      // First call should be the token refresh endpoint
      const firstCallUrl = String(fetchMock.mock.calls[0][0]);
      expect(firstCallUrl).toContain("oauth2.googleapis.com/token");
      // Second call should be Cloud Code API with the new token
      const secondCallInit = fetchMock.mock.calls[1][1] as RequestInit;
      const headers = secondCallInit.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer new-token");
      expect(result).toHaveLength(1);
    });

    it("returns [] if refresh fails", async () => {
      writeClawdboardConfig(clawdboardHome, {
        antigravity: { enabled: true },
      });
      writeOauthCreds(geminiHome, {
        access_token: "expired-token",
        refresh_token: "refresh-tok",
        client_id: "client-id",
        client_secret: "client-secret",
        expiry_date: Date.now() - 3600000,
      });

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
      }) as unknown as typeof fetch;

      const result = await extractAntigravityData();
      expect(result).toEqual([]);
    });

    it("returns [] if refresh_token is missing and access_token expired", async () => {
      writeClawdboardConfig(clawdboardHome, {
        antigravity: { enabled: true },
      });
      writeOauthCreds(geminiHome, {
        access_token: "expired-token",
        expiry_date: Date.now() - 3600000,
      });

      global.fetch = vi.fn() as unknown as typeof fetch;

      const result = await extractAntigravityData();
      expect(result).toEqual([]);
    });
  });

  describe("API failure handling", () => {
    it("returns [] when the API returns 401", async () => {
      writeClawdboardConfig(clawdboardHome, {
        antigravity: { enabled: true },
      });
      writeOauthCreds(geminiHome, {
        access_token: "tok",
        expiry_date: Date.now() + 3600000,
      });

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
      }) as unknown as typeof fetch;

      const result = await extractAntigravityData();
      expect(result).toEqual([]);
    });

    it("returns [] when the API returns malformed JSON", async () => {
      writeClawdboardConfig(clawdboardHome, {
        antigravity: { enabled: true },
      });
      writeOauthCreds(geminiHome, {
        access_token: "tok",
        expiry_date: Date.now() + 3600000,
      });

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ not_metrics: "broken" }),
      }) as unknown as typeof fetch;

      const result = await extractAntigravityData();
      expect(result).toEqual([]);
    });

    it("returns [] when fetch throws", async () => {
      writeClawdboardConfig(clawdboardHome, {
        antigravity: { enabled: true },
      });
      writeOauthCreds(geminiHome, {
        access_token: "tok",
        expiry_date: Date.now() + 3600000,
      });

      global.fetch = vi
        .fn()
        .mockRejectedValueOnce(new Error("network down")) as unknown as typeof fetch;

      const result = await extractAntigravityData();
      expect(result).toEqual([]);
    });
  });

  describe("filtering", () => {
    it("respects since filter", async () => {
      writeClawdboardConfig(clawdboardHome, {
        antigravity: { enabled: true },
      });
      writeOauthCreds(geminiHome, {
        access_token: "tok",
        expiry_date: Date.now() + 3600000,
      });

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          metrics: [
            { model: "gemini-3-pro", date: "2026-03-08", inputTokens: 100, outputTokens: 50 },
            { model: "gemini-3-pro", date: "2026-03-12", inputTokens: 200, outputTokens: 100 },
          ],
        }),
      }) as unknown as typeof fetch;

      const result = await extractAntigravityData("2026-03-10");
      expect(result).toHaveLength(1);
      expect(result[0].date).toBe("2026-03-12");
    });
  });

  describe("privacy", () => {
    it("SyncDay output is allowlisted-fields-only", async () => {
      writeClawdboardConfig(clawdboardHome, {
        antigravity: { enabled: true },
      });
      writeOauthCreds(geminiHome, {
        access_token: "tok",
        expiry_date: Date.now() + 3600000,
      });

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          metrics: [
            {
              model: "gemini-3-pro",
              date: "2026-03-10",
              inputTokens: 1000,
              outputTokens: 500,
              // Stub additional fields the API may surface but we should not pass through
              userEmail: "secret@example.com",
              projectId: "secret-project",
              prompt: "the prompt content",
            },
          ],
        }),
      }) as unknown as typeof fetch;

      const result = await extractAntigravityData();
      const json = JSON.stringify(result);
      expect(json).not.toContain("secret@example.com");
      expect(json).not.toContain("secret-project");
      expect(json).not.toContain("prompt content");
    });
  });
});
