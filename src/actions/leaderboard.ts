"use server";

import {
  getLeaderboardData,
  VALID_PERIODS,
  VALID_SORTS,
  VALID_ORDERS,
  parseDateRange,
  type Period,
  type SortCol,
  type SortOrder,
  type LeaderboardResult,
  redactStreakPasses,
} from "@/lib/db/cached";
import { auth } from "@/lib/auth";

export async function loadMoreRows(
  period: string,
  sort: string,
  order: string,
  offset: number,
  limit = 100,
  rangeFrom?: string,
  rangeTo?: string
): Promise<LeaderboardResult> {
  // Validate inputs
  const validPeriod: Period = VALID_PERIODS.includes(period as Period)
    ? (period as Period)
    : "7d";
  const validSort: SortCol = VALID_SORTS.includes(sort as SortCol)
    ? (sort as SortCol)
    : "cost";
  const validOrder: SortOrder = VALID_ORDERS.includes(order as SortOrder)
    ? (order as SortOrder)
    : "desc";

  const safeOffset = Math.max(0, Math.floor(offset));
  const safeLimit = Math.min(200, Math.max(1, Math.floor(limit)));

  const range = validPeriod === "custom"
    ? parseDateRange(rangeFrom, rangeTo)
    : undefined;

  const [result, session] = await Promise.all([
    getLeaderboardData(validPeriod, validSort, validOrder, range, safeLimit, safeOffset),
    auth(),
  ]);

  // Free passes are private — the same redaction the first page gets.
  return {
    ...result,
    rows: redactStreakPasses(result.rows, session?.user?.id),
  };
}
