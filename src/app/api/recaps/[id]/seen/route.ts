import { NextResponse, type NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/api-auth";
import { markRecapSeen } from "@/lib/db/recaps";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = rateLimit(request, { key: "recap-seen", limit: 30 });
  if (limited) return limited;

  const session = await requireSessionUser();
  if (session.response) return session.response;

  const { id } = await params;
  const updated = await markRecapSeen(id, session.userId);
  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
