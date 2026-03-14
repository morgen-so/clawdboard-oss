import { NextRequest, NextResponse } from "next/server";
import {
  getCommunityStats,
  getModelStats,
  getSourceBreakdown,
  VALID_PERIODS,
  parseDateRange,
  type Period,
} from "@/lib/db/stats";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { key: "stats", limit: 15 });
  if (limited) return limited;

  try {
    const params = req.nextUrl.searchParams;

    // Parse optional period filter (defaults to all-time)
    const rawPeriod = params.get("period");
    const period = rawPeriod && VALID_PERIODS.includes(rawPeriod as Period)
      ? (rawPeriod as Period)
      : undefined;

    if (rawPeriod && !period) {
      return NextResponse.json(
        {
          error: `Invalid period. Valid values: ${VALID_PERIODS.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const range = period === "custom"
      ? parseDateRange(params.get("from"), params.get("to"))
      : undefined;

    if (period === "custom" && !range) {
      return NextResponse.json(
        {
          error:
            "Custom period requires valid 'from' and 'to' date parameters (YYYY-MM-DD)",
        },
        { status: 400 }
      );
    }

    const [community, models, sourceBreakdown] = await Promise.all([
      getCommunityStats(period, range),
      getModelStats(period, range),
      getSourceBreakdown(period, range),
    ]);

    const now = new Date().toISOString();

    return NextResponse.json(
      {
        generatedAt: now,
        period: {
          filter: period ?? "all",
          label: community.periodLabel,
          ...(range && { from: range.from, to: range.to }),
          note: "Omit the period parameter for all-time aggregates. Valid periods: today, 7d, 30d, this-month, ytd, custom (requires from & to).",
        },
        community: {
          totalUsers: community.totalUsers,
          activeUsers: community.activeUsers,
          totalEstimatedCost: community.totalCost,
          totalTokens: community.totalTokens,
          totalActiveDays: community.totalActiveDays,
          longestActiveStreak: community.longestStreak,
          avgCostPerUser: community.avgCostPerUser,
          medianCostPerUser: community.medianCostPerUser,
          busiestDay: {
            date: community.biggestSingleDayDate,
            estimatedCost: community.biggestSingleDayCost,
          },
        },
        models: models.map((m) => ({
          model: m.modelName,
          estimatedCost: m.totalCost,
          totalTokens: m.totalTokens,
          inputTokens: m.inputTokens,
          outputTokens: m.outputTokens,
          userCount: m.userCount,
          costSharePercent: m.costShare,
        })),
        sourceBreakdown: sourceBreakdown.map((s) => ({
          source: s.source,
          estimatedCost: s.totalCost,
          totalTokens: s.totalTokens,
          userCount: s.userCount,
        })),
        methodology: {
          source:
            "Local log files from Claude Code, OpenCode, and Codex CLI, parsed by the clawdboard CLI",
          costEstimation:
            "Token counts multiplied by published API rates (Anthropic, OpenAI, etc.). Not an actual bill — most users pay flat subscription fees.",
          coverage:
            "Self-selected sample of developers who opt in. Not representative of all AI coding tool users.",
          updateFrequency:
            "Users sync every 2 hours by default. Aggregate stats refresh hourly.",
        },
        attribution:
          "Data from clawdboard.ai — cite as: clawdboard, AI Coding Tool Community Usage Statistics, https://clawdboard.ai/stats",
      },
      {
        headers: {
          "Cache-Control":
            "public, s-maxage=3600, stale-while-revalidate=1800",
        },
      }
    );
  } catch (error) {
    console.error("Stats API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
