"use server";

import { actionUser } from "./guards";
import { db } from "@/lib/db";
import { teamMembers } from "@/lib/db/schema";
import {
  getNotificationById,
  markNotificationActed,
} from "@/lib/db/notifications";
import { eq, and, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { revalidateTeamCaches } from "@/lib/db/cached";
import type { ActionResult } from "@/lib/action-result";

// ─── Shared validation ──────────────────────────────────────────────────────

type ValidationSuccess = {
  userId: string;
  notificationId: string;
  teamId: string;
};

async function validateTeamInviteNotification(
  formData: FormData
): Promise<{ error: string } | ValidationSuccess> {
  const user = await actionUser();
  if (!user) return { error: "Unauthorized" };

  const notificationId = formData.get("notificationId") as string;
  if (!notificationId) return { error: "Missing notificationId" };

  const notification = await getNotificationById(notificationId);
  if (!notification) return { error: "Notification not found" };
  if (notification.userId !== user.id)
    return { error: "Not your notification" };
  if (notification.type !== "team_invite")
    return { error: "Invalid notification type" };
  if (notification.actedAt) return { error: "Already acted on" };

  return {
    userId: user.id,
    notificationId,
    teamId: notification.data.teamId as string,
  };
}

// ─── Accept team invite ──────────────────────────────────────────────────────

export async function acceptTeamInvite(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const result = await validateTeamInviteNotification(formData);
  if ("error" in result) return result;

  const { userId, notificationId, teamId } = result;

  await Promise.all([
    db
      .update(teamMembers)
      .set({ status: "active", joinedAt: new Date() })
      .where(
        and(
          eq(teamMembers.teamId, teamId),
          eq(teamMembers.userId, userId),
          eq(teamMembers.status, "pending"),
          isNull(teamMembers.leftAt)
        )
      ),
    markNotificationActed(notificationId),
  ]);

  revalidateTeamCaches();
  revalidatePath("/team", "layout");
}

// ─── Decline team invite ─────────────────────────────────────────────────────

export async function declineTeamInvite(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const result = await validateTeamInviteNotification(formData);
  if ("error" in result) return result;

  const { userId, notificationId, teamId } = result;

  await Promise.all([
    db
      .update(teamMembers)
      .set({ leftAt: new Date() })
      .where(
        and(
          eq(teamMembers.teamId, teamId),
          eq(teamMembers.userId, userId),
          eq(teamMembers.status, "pending"),
          isNull(teamMembers.leftAt)
        )
      ),
    markNotificationActed(notificationId),
  ]);

  revalidateTeamCaches();
  revalidatePath("/team", "layout");
}
