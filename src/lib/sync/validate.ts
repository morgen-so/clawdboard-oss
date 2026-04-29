import { z } from "zod";

// Server-side Zod schemas for sync payload validation (defense-in-depth).
// Mirrors the CLI-side schemas to catch any payload issues at the API boundary.

const ModelBreakdownSchema = z.object({
  modelName: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cost: z.number().nonnegative(),
  /** Optional: GitHub Copilot CLI premium-request count for this model on this day. */
  premiumRequests: z.number().int().nonnegative().optional(),
});

/**
 * Allowed source slugs. Mirrors cli/src/schemas.ts SOURCE_VALUES.
 */
export const SOURCE_VALUES = [
  "claude-code",
  "opencode",
  "opencode-go",
  "opencode-zen",
  "codex",
  "gemini-cli",
  "antigravity",
  "copilot-cli",
] as const;

export type SourceValue = (typeof SOURCE_VALUES)[number];

export const SyncDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.enum(SOURCE_VALUES).nullable().optional(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  totalCost: z.number().nonnegative(),
  modelsUsed: z.array(z.string()),
  modelBreakdowns: z.array(ModelBreakdownSchema),
  /** Optional: GitHub Copilot CLI premium-request count for this day. */
  premiumRequests: z.number().int().nonnegative().optional(),
});

export const SyncPayloadSchema = z.object({
  days: z.array(SyncDaySchema).max(365),
  syncIntervalMs: z.number().int().positive().optional(),
  machineId: z.string().uuid().optional(),
  /**
   * Optional: when set, the server will, for each (user, date, machine)
   * where one of the listed source slugs is being upserted, also clear any
   * legacy `opencode` row on the same key. Used to migrate data from the
   * pre-providerID-split era to the new branded-tier sources without
   * double-counting.
   *
   * Example: `["opencode-go", "opencode-zen"]` — for each day in this sync
   * payload tagged with one of these sources, delete the corresponding
   * `source: "opencode"` row first.
   */
  reassignFromOpencode: z.array(z.enum(SOURCE_VALUES)).optional(),
});

export type SyncDay = z.infer<typeof SyncDaySchema>;
export type SyncPayload = z.infer<typeof SyncPayloadSchema>;
