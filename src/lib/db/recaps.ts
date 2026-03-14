import "server-only";

import { db } from "@/lib/db";
import { recaps } from "./schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import type { RecapData } from "./schema";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RecapRow {
  id: string;
  type: string;
  periodStart: string;
  periodEnd: string;
  data: RecapData;
  seenAt: Date | null;
  createdAt: Date;
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Get unseen recaps for a user, most recent first.
 * Only returns the latest unseen recap (by design — no stacking).
 */
export async function getUnseenRecaps(userId: string): Promise<RecapRow[]> {
  return db
    .select({
      id: recaps.id,
      type: recaps.type,
      periodStart: recaps.periodStart,
      periodEnd: recaps.periodEnd,
      data: recaps.data,
      seenAt: recaps.seenAt,
      createdAt: recaps.createdAt,
    })
    .from(recaps)
    .where(and(eq(recaps.userId, userId), isNull(recaps.seenAt)))
    .orderBy(desc(recaps.createdAt))
    .limit(1);
}

/**
 * Mark a recap as seen. Verifies ownership.
 */
export async function markRecapSeen(
  recapId: string,
  userId: string
): Promise<boolean> {
  const result = await db
    .update(recaps)
    .set({ seenAt: new Date() })
    .where(and(eq(recaps.id, recapId), eq(recaps.userId, userId)));
  return (result.rowCount ?? 0) > 0;
}

/**
 * Get all recaps for a user (seen + unseen), most recent first.
 * Used on the profile page recap strip.
 */
export async function getAllRecaps(userId: string): Promise<RecapRow[]> {
  return db
    .select({
      id: recaps.id,
      type: recaps.type,
      periodStart: recaps.periodStart,
      periodEnd: recaps.periodEnd,
      data: recaps.data,
      seenAt: recaps.seenAt,
      createdAt: recaps.createdAt,
    })
    .from(recaps)
    .where(eq(recaps.userId, userId))
    .orderBy(desc(recaps.createdAt))
    .limit(20);
}

/**
 * Get a recap by ID (for ownership verification).
 */
export async function getRecapById(recapId: string) {
  const [row] = await db
    .select({
      id: recaps.id,
      userId: recaps.userId,
      type: recaps.type,
      periodStart: recaps.periodStart,
      periodEnd: recaps.periodEnd,
      data: recaps.data,
      seenAt: recaps.seenAt,
      createdAt: recaps.createdAt,
    })
    .from(recaps)
    .where(eq(recaps.id, recapId))
    .limit(1);
  return row ?? null;
}
