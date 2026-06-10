import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  users,
  dailyAggregates,
  pageVisits,
  rankSnapshots,
  teamMembers,
  teams,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const session = await requireSessionUser();
  if (session.response) return session.response;

  const { userId } = session;

  const [profileRows, aggregates, visits, snapshots, memberships] =
    await Promise.all([
      db
        .select({
          name: users.name,
          email: users.email,
          githubUsername: users.githubUsername,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),
      db
        .select()
        .from(dailyAggregates)
        .where(eq(dailyAggregates.userId, userId)),
      db.select().from(pageVisits).where(eq(pageVisits.userId, userId)),
      db.select().from(rankSnapshots).where(eq(rankSnapshots.userId, userId)),
      db
        .select({
          teamId: teamMembers.teamId,
          teamName: teams.name,
          teamSlug: teams.slug,
          role: teamMembers.role,
          joinedAt: teamMembers.joinedAt,
        })
        .from(teamMembers)
        .innerJoin(teams, eq(teams.id, teamMembers.teamId))
        .where(eq(teamMembers.userId, userId)),
    ]);

  const profile = profileRows[0];

  const data = {
    exportedAt: new Date().toISOString(),
    profile,
    dailyAggregates: aggregates,
    pageVisits: visits,
    rankSnapshots: snapshots,
    teamMemberships: memberships,
  };

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="clawdboard-export-${profile?.githubUsername ?? userId}.json"`,
    },
  });
}
