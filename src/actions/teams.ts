"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { teams, teamMembers, users } from "@/lib/db/schema";
import {
  generateUniqueSlug,
  getTeamMembership,
  getActiveOwnerCount,
  getActiveMemberCount,
} from "@/lib/db/teams";
import { createNotification } from "@/lib/db/notifications";
import { eq, and, isNull, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { revalidateTeamCaches } from "@/lib/db/cached";
import crypto from "crypto";
import type { ActionResult } from "@/lib/action-result";
import { validatePublicUrl } from "@/lib/validate-url";

// ─── Create team ────────────────────────────────────────────────────────────

export async function createTeam(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };

  const name = (formData.get("name") as string)?.trim();
  if (!name || name.length < 2 || name.length > 50) {
    return { error: "Team name must be between 2 and 50 characters" };
  }

  const slug = await generateUniqueSlug(name);
  const inviteToken = crypto.randomBytes(24).toString("base64url");
  const teamId = crypto.randomUUID();
  const userId = session.user.id;

  // Single-statement atomicity via modifying CTE — Postgres guarantees both
  // INSERTs succeed or fail together, compensating for Neon HTTP's lack of
  // transaction support.
  await db.execute(sql`
    WITH new_team AS (
      INSERT INTO teams (id, name, slug, invite_token, created_by)
      VALUES (${teamId}, ${name}, ${slug}, ${inviteToken}, ${userId})
      RETURNING id
    )
    INSERT INTO team_members (id, team_id, user_id, role)
    SELECT gen_random_uuid(), id, ${userId}, 'owner' FROM new_team
  `);

  revalidatePath("/team", "layout");
  redirect(`/team/${slug}?created=true`);
}

// ─── Join team ──────────────────────────────────────────────────────────────

export async function joinTeam(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };

  const teamId = formData.get("teamId") as string;
  const token = formData.get("token") as string;

  if (!teamId || !token) return { error: "Missing team or token" };

  // Look up team by ID
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, teamId), isNull(teams.deletedAt)))
    .limit(1);

  if (!team) return { error: "Team not found" };
  if (team.inviteToken !== token) {
    redirect(`/join/${team.slug}?error=invalid`);
  }
  if (team.isLocked) {
    redirect(`/join/${team.slug}?token=${token}&error=locked`);
  }

  // Atomic insert: skips if already a member
  const userId = session.user.id;
  const result = await db.execute(sql`
    INSERT INTO team_members (id, team_id, user_id, role)
    VALUES (gen_random_uuid(), ${teamId}, ${userId}, 'member')
    ON CONFLICT (team_id, user_id) WHERE left_at IS NULL DO NOTHING
  `);

  if (result.rowCount === 0) {
    // Already a member
    redirect(`/team/${team.slug}`);
  }

  revalidateTeamCaches();
  revalidatePath(`/team/${team.slug}`);
  redirect(`/team/${team.slug}`);
}

// ─── Leave team ─────────────────────────────────────────────────────────────

export async function leaveTeam(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };

  const teamId = formData.get("teamId") as string;
  if (!teamId) return { error: "Missing teamId" };

  const membership = await getTeamMembership(teamId, session.user.id);
  if (!membership) return { error: "Not a member of this team" };

  // If owner, check they're not the last owner
  if (membership.role === "owner") {
    const ownerCount = await getActiveOwnerCount(teamId);
    if (ownerCount <= 1) {
      return {
        error: "You are the last owner. Transfer ownership before leaving.",
      };
    }
  }

  // Set left_at on active membership
  await db
    .update(teamMembers)
    .set({ leftAt: new Date() })
    .where(
      and(
        eq(teamMembers.teamId, teamId),
        eq(teamMembers.userId, session.user.id),
        isNull(teamMembers.leftAt)
      )
    );

  // If no active members remain, soft-delete the team
  const remainingCount = await getActiveMemberCount(teamId);
  if (remainingCount === 0) {
    await db
      .update(teams)
      .set({ deletedAt: new Date() })
      .where(eq(teams.id, teamId));
  }

  revalidateTeamCaches();
  revalidatePath("/team", "layout");
  redirect("/my-team");
}

// ─── Remove member ──────────────────────────────────────────────────────────

export async function removeMember(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };

  const teamId = formData.get("teamId") as string;
  const memberId = formData.get("memberId") as string;
  if (!teamId || !memberId) return { error: "Missing teamId or memberId" };

  // Verify caller is owner
  const callerMembership = await getTeamMembership(teamId, session.user.id);
  if (!callerMembership || callerMembership.role !== "owner") {
    return { error: "Only owners can remove members" };
  }

  // Verify target is active member
  const targetMembership = await getTeamMembership(teamId, memberId);
  if (!targetMembership) return { error: "Member not found" };

  // Set left_at on target membership
  await db
    .update(teamMembers)
    .set({ leftAt: new Date() })
    .where(
      and(
        eq(teamMembers.teamId, teamId),
        eq(teamMembers.userId, memberId),
        isNull(teamMembers.leftAt)
      )
    );

  revalidateTeamCaches();
  revalidatePath("/team", "layout");
}

// ─── Transfer ownership ─────────────────────────────────────────────────────

export async function transferOwnership(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };

  const teamId = formData.get("teamId") as string;
  const newOwnerId = formData.get("newOwnerId") as string;
  if (!teamId || !newOwnerId)
    return { error: "Missing teamId or newOwnerId" };

  // Verify caller is owner
  const callerMembership = await getTeamMembership(teamId, session.user.id);
  if (!callerMembership || callerMembership.role !== "owner") {
    return { error: "Only owners can transfer ownership" };
  }

  // Verify target is active member
  const targetMembership = await getTeamMembership(teamId, newOwnerId);
  if (!targetMembership) return { error: "Target member not found" };

  // Update target's role to owner
  await db
    .update(teamMembers)
    .set({ role: "owner" })
    .where(
      and(
        eq(teamMembers.teamId, teamId),
        eq(teamMembers.userId, newOwnerId),
        isNull(teamMembers.leftAt)
      )
    );

  revalidatePath("/team", "layout");
}

// ─── Rotate invite token ────────────────────────────────────────────────────

export async function rotateInviteToken(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };

  const teamId = formData.get("teamId") as string;
  if (!teamId) return { error: "Missing teamId" };

  // Verify caller is owner
  const callerMembership = await getTeamMembership(teamId, session.user.id);
  if (!callerMembership || callerMembership.role !== "owner") {
    return { error: "Only owners can rotate invite token" };
  }

  const newToken = crypto.randomBytes(24).toString("base64url");
  await db
    .update(teams)
    .set({ inviteToken: newToken })
    .where(eq(teams.id, teamId));

  revalidatePath("/team", "layout");
}

// ─── Toggle team lock ───────────────────────────────────────────────────────

export async function toggleTeamLock(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };

  const teamId = formData.get("teamId") as string;
  if (!teamId) return { error: "Missing teamId" };

  // Verify caller is owner
  const callerMembership = await getTeamMembership(teamId, session.user.id);
  if (!callerMembership || callerMembership.role !== "owner") {
    return { error: "Only owners can toggle team lock" };
  }

  await db.execute(
    sql`UPDATE teams SET is_locked = NOT is_locked WHERE id = ${teamId}`
  );

  revalidatePath("/team", "layout");
}

// ─── Toggle team public ─────────────────────────────────────────────────────

export async function toggleTeamPublic(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };

  const teamId = formData.get("teamId") as string;
  if (!teamId) return { error: "Missing teamId" };

  // Verify caller is owner
  const callerMembership = await getTeamMembership(teamId, session.user.id);
  if (!callerMembership || callerMembership.role !== "owner") {
    return { error: "Only owners can toggle public visibility" };
  }

  await db.execute(
    sql`UPDATE teams SET is_public = NOT is_public WHERE id = ${teamId}`
  );

  revalidateTeamCaches();
  revalidatePath("/team", "layout");
}

// ─── Update team cooking URL ────────────────────────────────────────────────

export async function updateTeamCookingUrl(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };

  const teamId = formData.get("teamId") as string;
  if (!teamId) return { error: "Missing teamId" };

  // Verify caller is owner
  const callerMembership = await getTeamMembership(teamId, session.user.id);
  if (!callerMembership || callerMembership.role !== "owner") {
    return { error: "Only owners can update the cooking link" };
  }

  const rawUrl = (formData.get("cookingUrl") as string)?.trim() || null;
  const rawLabel = (formData.get("cookingLabel") as string)?.trim() || null;

  // Validate URL if provided (with SSRF protection)
  let cookingUrl: string | null = null;
  if (rawUrl) {
    const result = validatePublicUrl(rawUrl);
    if ("error" in result) return { error: result.error };
    cookingUrl = result.href;
  }

  const cookingLabel = rawLabel ? rawLabel.slice(0, 50) : null;

  if (!cookingUrl) {
    await db
      .update(teams)
      .set({ cookingUrl: null, cookingLabel: null })
      .where(eq(teams.id, teamId));
  } else {
    await db
      .update(teams)
      .set({ cookingUrl, cookingLabel })
      .where(eq(teams.id, teamId));
  }

  revalidatePath("/teams");
  revalidatePath("/team", "layout");
}

// ─── Clear team cooking URL ─────────────────────────────────────────────────

export async function clearTeamCookingUrl(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };

  const teamId = formData.get("teamId") as string;
  if (!teamId) return { error: "Missing teamId" };

  // Verify caller is owner
  const callerMembership = await getTeamMembership(teamId, session.user.id);
  if (!callerMembership || callerMembership.role !== "owner") {
    return { error: "Only owners can update the cooking link" };
  }

  await db
    .update(teams)
    .set({ cookingUrl: null, cookingLabel: null })
    .where(eq(teams.id, teamId));

  revalidatePath("/teams");
  revalidatePath("/team", "layout");
}

// ─── Rename team ────────────────────────────────────────────────────────────

export async function renameTeam(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };

  const teamId = formData.get("teamId") as string;
  const name = (formData.get("name") as string)?.trim();
  if (!teamId) return { error: "Missing teamId" };
  if (!name || name.length < 2 || name.length > 50) {
    return { error: "Team name must be between 2 and 50 characters" };
  }

  // Verify caller is owner
  const callerMembership = await getTeamMembership(teamId, session.user.id);
  if (!callerMembership || callerMembership.role !== "owner") {
    return { error: "Only owners can rename the team" };
  }

  const newSlug = await generateUniqueSlug(name);
  await db
    .update(teams)
    .set({ name, slug: newSlug })
    .where(eq(teams.id, teamId));

  revalidatePath("/team", "layout");
  redirect(`/team/${newSlug}/settings`);
}

// ─── Invite user to team ─────────────────────────────────────────────────────

export async function inviteToTeam(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };

  const teamId = formData.get("teamId") as string;
  const targetUserId = formData.get("targetUserId") as string;
  if (!teamId || !targetUserId) return { error: "Missing teamId or targetUserId" };

  // Verify caller, team, target user, and existing membership in parallel
  const [callerMembership, [team], [targetUser], existingMembership] =
    await Promise.all([
      getTeamMembership(teamId, session.user.id),
      db
        .select()
        .from(teams)
        .where(and(eq(teams.id, teamId), isNull(teams.deletedAt)))
        .limit(1),
      db
        .select({ id: users.id, githubUsername: users.githubUsername })
        .from(users)
        .where(eq(users.id, targetUserId))
        .limit(1),
      db
        .select({ id: teamMembers.id, status: teamMembers.status })
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, teamId),
            eq(teamMembers.userId, targetUserId),
            isNull(teamMembers.leftAt)
          )
        )
        .limit(1),
    ]);

  if (!callerMembership) return { error: "You are not a member of this team" };
  if (!team) return { error: "Team not found" };
  if (team.isLocked) return { error: "Team is locked and not accepting new members" };
  if (!targetUser) return { error: "User not found" };

  if (existingMembership.length > 0) {
    const status = existingMembership[0].status;
    if (status === "active") return { error: "User is already a member" };
    if (status === "pending") return { error: "User has already been invited" };
  }

  // Insert pending membership + notification in parallel
  await Promise.all([
    db.insert(teamMembers).values({
      teamId,
      userId: targetUserId,
      role: "member",
      status: "pending",
    }),
    createNotification(targetUserId, "team_invite", {
      teamId: team.id,
      teamName: team.name,
      teamSlug: team.slug,
      invitedBy: session.user.githubUsername ?? session.user.name ?? "Someone",
      invitedByImage: session.user.image ?? null,
    }),
  ]);

  revalidateTeamCaches();
  revalidatePath("/team", "layout");
}
