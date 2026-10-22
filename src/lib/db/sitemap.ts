import { db } from "@/lib/db";
import { users, teams } from "@/lib/db/schema";
import { and, eq, isNotNull, isNull } from "drizzle-orm";

/**
 * The usernames and public team slugs the sitemap lists. Banned users are
 * left out: their profiles 404.
 */
export async function getSitemapPaths(): Promise<{
  usernames: string[];
  teamSlugs: string[];
}> {
  const [userRows, teamRows] = await Promise.all([
    db
      .select({ githubUsername: users.githubUsername })
      .from(users)
      .where(and(isNotNull(users.githubUsername), isNull(users.bannedAt))),
    db
      .select({ slug: teams.slug })
      .from(teams)
      .where(and(eq(teams.isPublic, true), isNull(teams.deletedAt))),
  ]);

  return {
    usernames: userRows.flatMap((u) => (u.githubUsername ? [u.githubUsername] : [])),
    teamSlugs: teamRows.map((t) => t.slug),
  };
}
