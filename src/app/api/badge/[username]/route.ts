import { NextRequest } from "next/server";
import { generateBadgeSvg } from "@/lib/badge";
import { computeCurrentStreak } from "@/lib/streak";
import {
  getUserByUsername,
  getUserRank,
  getUserDailyData,
} from "@/lib/db/cached";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const limited = rateLimit(request, { key: "badge", limit: 30 });
  if (limited) return limited;
  const { username: rawUsername } = await params;
  const username = decodeURIComponent(rawUsername);

  const user = await getUserByUsername(username);

  if (!user) {
    // Return a "not found" badge (200 status) so GitHub READMEs don't show broken images
    const svg = generateBadgeSvg({
      label: "clawdboard",
      value: "not found",
      color: "999",
    });
    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=300",
      },
    });
  }

  // Fetch rank and daily data in parallel
  const [rank, dailyData] = await Promise.all([
    getUserRank(user.id),
    getUserDailyData(user.id),
  ]);

  const streak = computeCurrentStreak(dailyData);
  const value =
    streak > 0
      ? `Top ${rank.percentile}% | ${streak}d streak`
      : `Top ${rank.percentile}%`;

  const svg = generateBadgeSvg({
    label: "clawdboard",
    value,
  });

  // ETag for conditional requests (GitHub camo proxy, browsers)
  const etag = `W/"${Buffer.from(value).toString("base64url")}"`;

  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "public, max-age=3600, s-maxage=3600" } });
  }

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
      ETag: etag,
    },
  });
}
