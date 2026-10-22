import { NextResponse, after, type NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/api-auth";
import { markRecapSeen } from "@/lib/db/recaps";
import { rateLimit } from "@/lib/rate-limit";
import { rebuildUserSnapshot, runSnapshotJob } from "@/lib/snapshot/build";

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

  // The profile's recap strip reads seenAt from the snapshot.
  after(() => runSnapshotJob("recap seen", () => rebuildUserSnapshot(session.userId)));

  return NextResponse.json({ ok: true });
}
