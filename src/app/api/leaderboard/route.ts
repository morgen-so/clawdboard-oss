import { NextRequest, NextResponse } from "next/server";
import { getLeaderboardData, VALID_PERIODS, VALID_SORTS, VALID_ORDERS, parseDateRange } from "@/lib/db/leaderboard";
import type { Period, SortCol, SortOrder } from "@/lib/db/leaderboard";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { key: "leaderboard", limit: 15 });
  if (limited) return limited;

  try {
    const params = req.nextUrl.searchParams;

    const period = (params.get("period") ?? "7d") as Period;
    const sort = (params.get("sort") ?? "cost") as SortCol;
    const order = (params.get("order") ?? "desc") as SortOrder;
    const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "10", 10) || 10, 1), 50);

    if (!VALID_PERIODS.includes(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }
    if (!VALID_SORTS.includes(sort)) {
      return NextResponse.json({ error: "Invalid sort" }, { status: 400 });
    }
    if (!VALID_ORDERS.includes(order)) {
      return NextResponse.json({ error: "Invalid order" }, { status: 400 });
    }

    const range = period === "custom"
      ? parseDateRange(params.get("from"), params.get("to"))
      : undefined;

    if (period === "custom" && !range) {
      return NextResponse.json(
        { error: "Custom period requires valid 'from' and 'to' date parameters (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    const { rows } = await getLeaderboardData(period, sort, order, range, limit);

    const entries = rows.map((row) => ({
      rank: row.rank,
      username: row.githubUsername,
      totalCost: row.totalCost,
      totalTokens: row.totalTokens,
      activeDays: row.activeDays,
      streak: row.currentStreak,
      // Free-pass state is deliberately absent: it's private to each user and
      // this endpoint is unauthenticated.
    }));

    return NextResponse.json({ period, sort, order, entries });
  } catch (error) {
    console.error("Leaderboard API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
