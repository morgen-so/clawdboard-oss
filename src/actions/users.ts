"use server";

import { actionUser } from "./guards";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { revalidateAllCaches } from "@/lib/db/cached";
import type { ActionResult } from "@/lib/action-result";
import { validatePublicUrl } from "@/lib/validate-url";
import { BADGES, MAX_PINNED_BADGES } from "@/lib/badges";

export async function deleteAccount(): Promise<ActionResult> {
  const user = await actionUser();
  if (!user) return { error: "Unauthorized" };

  await db.delete(users).where(eq(users.id, user.id));

  // User removal affects leaderboards, team stats, and all aggregate caches
  revalidateAllCaches();
  revalidatePath("/");
  revalidatePath("/teams");
}

export async function updateCookingUrl(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const user = await actionUser();
  if (!user) return { error: "Unauthorized" };

  const rawUrl = (formData.get("cookingUrl") as string)?.trim() || null;
  const rawLabel = (formData.get("cookingLabel") as string)?.trim() || null;

  // Validate URL if provided (with SSRF protection)
  let cookingUrl: string | null = null;
  if (rawUrl) {
    const result = validatePublicUrl(rawUrl);
    if ("error" in result) return { error: result.error };
    cookingUrl = result.href;
  }

  // Validate label
  const cookingLabel = rawLabel ? rawLabel.slice(0, 50) : null;

  // Clear both if URL is empty
  if (!cookingUrl) {
    await db
      .update(users)
      .set({ cookingUrl: null, cookingLabel: null })
      .where(eq(users.id, user.id));
  } else {
    await db
      .update(users)
      .set({ cookingUrl, cookingLabel })
      .where(eq(users.id, user.id));
  }

  revalidatePath("/");
  revalidatePath("/teams");
}

export async function dismissBadgePrompt(): Promise<ActionResult> {
  const user = await actionUser();
  if (!user) return { error: "Unauthorized" };

  await db
    .update(users)
    .set({ badgePromptDismissedAt: new Date() })
    .where(eq(users.id, user.id));

  revalidatePath("/");
}

export async function updatePinnedBadges(
  badgeIds: string[]
): Promise<ActionResult> {
  const user = await actionUser();
  if (!user) return { error: "Unauthorized" };

  const validIds = new Set(BADGES.map((b) => b.id));
  const filtered = badgeIds.filter((id) => validIds.has(id)).slice(0, MAX_PINNED_BADGES);

  await db
    .update(users)
    .set({ pinnedBadges: filtered })
    .where(eq(users.id, user.id));

  revalidatePath(`/user/${user.githubUsername}`);
  revalidatePath("/settings");
}
