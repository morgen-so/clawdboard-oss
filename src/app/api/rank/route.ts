import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dailyAggregates, users } from "@/lib/db/schema";
import { eq, isNull, sql } from "drizzle-orm";
import { rateLimit } from "@/lib/rate-limit";
import { authenticateApiToken } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { key: "rank", limit: 15 });
  if (limited) return limited;

  try {
    // 1. Authenticate via Bearer token (same pattern as POST /api/sync)
    const tokenAuth = await authenticateApiToken(req);
    if (tokenAuth.response) return tokenAuth.response;
    const { user } = tokenAuth;

    if (user.bannedAt) {
      return NextResponse.json({ error: "Account suspended" }, { status: 403 });
    }

    // 2. Get the authenticated user's total cost
    const [userCostRow] = await db
      .select({
        totalCost: sql<string>`COALESCE(SUM(${dailyAggregates.totalCost}::numeric), 0)::text`,
      })
      .from(dailyAggregates)
      .where(eq(dailyAggregates.userId, user.id));

    const userTotalCost = parseFloat(userCostRow?.totalCost ?? "0");

    // 3. Count users with higher total cost (banned users are excluded from
    //    all leaderboards, so they don't affect rank either)
    const userTotals = db
      .select({
        userId: dailyAggregates.userId,
        total: sql<number>`SUM(${dailyAggregates.totalCost}::numeric)`.as("total"),
      })
      .from(dailyAggregates)
      .innerJoin(users, eq(users.id, dailyAggregates.userId))
      .where(isNull(users.bannedAt))
      .groupBy(dailyAggregates.userId)
      .as("user_totals");

    const [usersAboveRow] = await db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(userTotals)
      .where(sql`${userTotals.total} > ${userTotalCost}`);

    const usersAbove = usersAboveRow?.count ?? 0;

    // 4. Count total distinct users who have at least one daily_aggregates row
    const [totalUsersRow] = await db
      .select({
        count: sql<number>`count(DISTINCT ${dailyAggregates.userId})::int`,
      })
      .from(dailyAggregates)
      .innerJoin(users, eq(users.id, dailyAggregates.userId))
      .where(isNull(users.bannedAt));

    const totalUsers = totalUsersRow?.count ?? 0;

    // 5. Compute rank and percentile
    // If user has no data, they are last place among all users (or rank 1 if no users)
    const rank = totalUsers === 0 ? 1 : usersAbove + 1;
    const percentile =
      totalUsers <= 1
        ? 100
        : Math.round(((totalUsers - rank) / totalUsers) * 1000) / 10;

    return NextResponse.json({
      rank,
      totalUsers,
      percentile,
      totalCost: userTotalCost.toFixed(2),
    });
  } catch (error) {
    console.error("Rank error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
