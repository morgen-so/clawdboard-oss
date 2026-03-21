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
});

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

export const SyncPayloadSchema = z.object({
  days: z.array(SyncDaySchema).max(365),
  syncIntervalMs: z.number().int().positive().optional(),
  machineId: z.string().uuid().optional(),
});

export type SyncDay = z.infer<typeof SyncDaySchema>;
export type SyncPayload = z.infer<typeof SyncPayloadSchema>;
