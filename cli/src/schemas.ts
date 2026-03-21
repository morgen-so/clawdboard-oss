import { z } from "zod";

/**
 * Zod schemas for the sync payload -- the strict allowlist that defines
 * which fields are permitted to leave the user's machine.
 *
 * CRITICAL: Every field here is individually named. No spread operators,
 * no passthrough. If a field isn't in these schemas, it cannot appear
 * in the sync payload.
 */

/**
 * Schema for a single model's token breakdown within a day.
 * Only aggregate metrics -- no session IDs, project paths, or other identifying data.
 */
const ModelBreakdownSchema = z.object({
  modelName: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cost: z.number().nonnegative(),
});

/**
 * Schema for a single day's aggregate usage data.
 * Date is validated as YYYY-MM-DD format.
 * All token counts must be non-negative integers.
 * Total cost must be non-negative.
 */
export const SyncDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z
    .enum(["claude-code", "opencode", "codex"])
    .nullable()
    .optional(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  totalCost: z.number().nonnegative(),
  modelsUsed: z.array(z.string()),
  modelBreakdowns: z.array(ModelBreakdownSchema),
});

/**
 * Schema for the complete sync payload.
 * Maximum 365 days per sync to prevent abuse and enforce reasonable payload sizes.
 */
export const SyncPayloadSchema = z.object({
  days: z.array(SyncDaySchema).max(365),
  syncIntervalMs: z.number().int().positive().optional(),
  machineId: z.string().uuid().optional(),
});

/** TypeScript type for a single day's sync data. */
export type SyncDay = z.infer<typeof SyncDaySchema>;

/** TypeScript type for the complete sync payload. */
export type SyncPayload = z.infer<typeof SyncPayloadSchema>;
