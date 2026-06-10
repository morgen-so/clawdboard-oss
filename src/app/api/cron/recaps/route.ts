import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { verifyCronSecret } from "@/lib/api-auth";
import { generateAllRecaps } from "@/lib/recaps/generate";

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { key: "cron-recaps", limit: 2 });
  if (limited) return limited;

  try {
    // Verify CRON_SECRET if set (skip in local dev where it's not configured)
    const unauthorized = verifyCronSecret(req);
    if (unauthorized) return unauthorized;

    const now = new Date();
    const utcDay = now.getUTCDay(); // 0=Sun, 1=Mon
    const utcDate = now.getUTCDate();

    const results: Record<string, number> = {};

    // Weekly recap: every Monday (covers previous Mon–Sun)
    if (utcDay === 1) {
      // periodEnd = yesterday (Sunday)
      const periodEnd = new Date(now);
      periodEnd.setUTCDate(periodEnd.getUTCDate() - 1);
      // periodStart = 7 days before periodEnd (Monday)
      const periodStart = new Date(periodEnd);
      periodStart.setUTCDate(periodStart.getUTCDate() - 6);
      // Previous period for deltas
      const prevEnd = new Date(periodStart);
      prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
      const prevStart = new Date(prevEnd);
      prevStart.setUTCDate(prevStart.getUTCDate() - 6);

      results.weekly = await generateAllRecaps(
        "weekly",
        periodStart.toISOString().slice(0, 10),
        periodEnd.toISOString().slice(0, 10),
        prevStart.toISOString().slice(0, 10),
        prevEnd.toISOString().slice(0, 10)
      );
    }

    // Monthly recap: 1st of every month (covers entire previous month)
    if (utcDate === 1) {
      // Previous month
      const prevMonthEnd = new Date(now);
      prevMonthEnd.setUTCDate(0); // last day of previous month
      const prevMonthStart = new Date(
        prevMonthEnd.getUTCFullYear(),
        prevMonthEnd.getUTCMonth(),
        1
      );
      // Two months ago for deltas
      const twoMonthsEnd = new Date(prevMonthStart);
      twoMonthsEnd.setUTCDate(0);
      const twoMonthsStart = new Date(
        twoMonthsEnd.getUTCFullYear(),
        twoMonthsEnd.getUTCMonth(),
        1
      );

      results.monthly = await generateAllRecaps(
        "monthly",
        prevMonthStart.toISOString().slice(0, 10),
        prevMonthEnd.toISOString().slice(0, 10),
        twoMonthsStart.toISOString().slice(0, 10),
        twoMonthsEnd.toISOString().slice(0, 10)
      );
    }

    // If neither Monday nor 1st, skip
    if (Object.keys(results).length === 0) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: `Not a recap day (UTC day=${utcDay}, date=${utcDate})`,
      });
    }

    return NextResponse.json({
      ok: true,
      generatedAt: now.toISOString(),
      recaps: results,
    });
  } catch (error) {
    console.error("[cron/recaps] Error generating recaps:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
