import "server-only";

import { executeRows } from "@/lib/db";
import { sql } from "drizzle-orm";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface UserSearchResult {
  id: string;
  github_username: string | null;
  name: string | null;
  image: string | null;
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Search users by GitHub username or display name (case-insensitive).
 * Optionally excludes users who are already active or pending members of a team.
 * Returns max 10 results.
 */
export async function searchUsers(
  query: string,
  excludeTeamId?: string
): Promise<UserSearchResult[]> {
  const pattern = `%${query}%`;

  const excludeFilter = excludeTeamId
    ? sql`AND u.id NOT IN (
        SELECT tm.user_id FROM team_members tm
        WHERE tm.team_id = ${excludeTeamId} AND tm.left_at IS NULL
      )`
    : sql``;

  return executeRows<UserSearchResult>(sql`
    SELECT u.id, u.github_username, u.name, u.image
    FROM users u
    WHERE (u.github_username ILIKE ${pattern} OR u.name ILIKE ${pattern})
    ${excludeFilter}
    ORDER BY u.github_username ASC
    LIMIT 10
  `);
}
