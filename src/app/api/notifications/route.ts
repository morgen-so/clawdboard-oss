import { NextResponse, type NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/api-auth";
import { getUnactedNotifications } from "@/lib/db/notifications";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, { key: "notifications", limit: 60 });
  if (limited) return limited;

  const session = await requireSessionUser();
  if (session.response) return session.response;

  const notifications = await getUnactedNotifications(session.userId);
  return NextResponse.json(notifications);
}
