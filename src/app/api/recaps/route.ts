import { NextResponse, type NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/api-auth";
import { getUnseenRecaps } from "@/lib/db/recaps";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, { key: "recaps", limit: 60 });
  if (limited) return limited;

  const session = await requireSessionUser();
  if (session.response) return session.response;

  const recaps = await getUnseenRecaps(session.userId);
  return NextResponse.json(recaps);
}
