import "server-only";

import { auth } from "@/lib/auth";
import type { Session } from "next-auth";
import { getTeamMembership } from "@/lib/db/teams";

type ActionUser = NonNullable<Session["user"]> & { id: string };

/**
 * The signed-in user for a server action, or null when unauthenticated.
 * Actions return `{ error: "Unauthorized" }` on null rather than throwing,
 * matching the useActionState contract.
 */
export async function actionUser(): Promise<ActionUser | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return null;
  return { ...user, id: user.id };
}

/**
 * Verify the caller holds the owner role on the team. Returns null when
 * authorized, or the action error to return (message is per-action).
 */
export async function requireTeamOwner(
  teamId: string,
  userId: string,
  error: string
): Promise<{ error: string } | null> {
  const membership = await getTeamMembership(teamId, userId);
  if (!membership || membership.role !== "owner") {
    return { error };
  }
  return null;
}
