import type { SyncPayload } from "./schemas.js";
import { VERSION } from "./version.js";

const USER_AGENT = `clawdboard/${VERSION}`;

/**
 * Response from POST /api/auth/device/code
 */
export interface DeviceCodeResponse {
  user_code: string;
  device_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
}

/**
 * Response from POST /api/auth/device/token on success
 */
export interface DeviceTokenResponse {
  api_token: string;
}

/**
 * Response from POST /api/sync
 */
export interface SyncResponse {
  success: boolean;
  daysUpserted: number;
  /** Your current streak in days. Absent on older servers. */
  streak?: number;
  /** Your banked free passes. Private to you; absent on older servers. */
  streakPasses?: number;
  /** Days a free pass is currently holding your streak open. */
  streakFrozenFor?: number;
}

/**
 * Response from GET /api/rank
 */
export interface RankResponse {
  rank: number;
  totalUsers: number;
  percentile: number;
  totalCost: string;
}

/**
 * A single entry in the leaderboard response.
 */
export interface LeaderboardEntry {
  rank: number;
  username: string | null;
  totalCost: string;
  totalTokens: number;
  activeDays: number;
  streak: number;
}

/**
 * Response from GET /api/leaderboard
 */
export interface LeaderboardResponse {
  period: string;
  sort: string;
  order: string;
  entries: LeaderboardEntry[];
}

/**
 * Error thrown by the API client with status code and message.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * HTTP client for communicating with the clawdboard server API.
 * Uses native fetch (Node 18+).
 */
export class ApiClient {
  constructor(
    private readonly serverUrl: string,
    private readonly apiToken?: string
  ) {}

  /**
   * POST /api/sync -- Upload sanitized usage data.
   * Requires apiToken for Bearer authentication.
   */
  async sync(payload: SyncPayload): Promise<SyncResponse> {
    const res = await this.request("/api/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await this.safeJson(res);
      throw new ApiError(
        String(body?.error ?? `Server returned ${res.status}`),
        res.status
      );
    }

    return (await res.json()) as SyncResponse;
  }

  /**
   * GET /api/rank -- Fetch the authenticated user's rank.
   * Requires apiToken for Bearer authentication.
   */
  async getRank(): Promise<RankResponse> {
    const res = await this.request("/api/rank", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
      },
    });

    if (!res.ok) {
      const body = await this.safeJson(res);
      throw new ApiError(
        String(body?.error ?? `Server returned ${res.status}`),
        res.status
      );
    }

    return (await res.json()) as RankResponse;
  }

  /**
   * GET /api/leaderboard -- Fetch the public leaderboard.
   * No authentication required.
   */
  async getLeaderboard(opts: {
    limit?: number;
    period?: string;
  }): Promise<LeaderboardResponse> {
    const params = new URLSearchParams();
    if (opts.limit) params.set("limit", String(opts.limit));
    if (opts.period) params.set("period", opts.period);

    const res = await this.request(`/api/leaderboard?${params}`, {
      method: "GET",
    });

    if (!res.ok) {
      const body = await this.safeJson(res);
      throw new ApiError(
        String(body?.error ?? `Server returned ${res.status}`),
        res.status
      );
    }

    return (await res.json()) as LeaderboardResponse;
  }

  /**
   * POST /api/auth/device/code -- Create a device code for CLI authentication.
   * No authentication required.
   */
  async createDeviceCode(): Promise<DeviceCodeResponse> {
    const res = await this.request("/api/auth/device/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) {
      const body = await this.safeJson(res);
      throw new ApiError(
        String(body?.error ?? `Server returned ${res.status}`),
        res.status
      );
    }

    return (await res.json()) as DeviceCodeResponse;
  }

  /**
   * POST /api/auth/device/token -- Poll for device code authorization.
   * Returns api_token on success, null on "authorization_pending", throws on "expired_token".
   */
  async pollDeviceToken(
    deviceCode: string
  ): Promise<DeviceTokenResponse | null> {
    const res = await this.request("/api/auth/device/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_code: deviceCode }),
    });

    if (res.status === 200) {
      return (await res.json()) as DeviceTokenResponse;
    }

    const body = await this.safeJson(res);
    const error = String(body?.error ?? "");

    if (error === "authorization_pending") {
      return null;
    }

    if (error === "expired_token") {
      throw new ApiError("Device code has expired. Please run auth again.", 410);
    }

    throw new ApiError(
      error || `Server returned ${res.status}`,
      res.status
    );
  }

  /**
   * Make an HTTP request to the server with common headers.
   */
  private async request(
    path: string,
    init: RequestInit
  ): Promise<Response> {
    const url = `${this.serverUrl}${path}`;

    try {
      return await fetch(url, {
        ...init,
        headers: {
          "User-Agent": USER_AGENT,
          ...(init.headers as Record<string, string>),
        },
      });
    } catch (err) {
      if (
        err instanceof TypeError &&
        (err.message.includes("fetch") || err.message.includes("network"))
      ) {
        throw new ApiError(
          "Could not reach clawdboard server. Check your connection.",
          0
        );
      }
      throw err;
    }
  }

  /**
   * Safely parse JSON from a response, returning null on failure.
   */
  private async safeJson(
    res: Response
  ): Promise<Record<string, unknown> | null> {
    try {
      return (await res.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
