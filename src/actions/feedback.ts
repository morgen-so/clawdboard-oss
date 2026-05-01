"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { feedback } from "@/lib/db/schema";
import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { ADMIN_COOKIE_NAME, verifyAdminToken } from "@/lib/admin-session";
import type { ActionResult } from "@/lib/action-result";

const rateLimitMap = new Map<string, number>();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const last = rateLimitMap.get(key);
  if (last && now - last < 60_000) return false;

  // Self-clean when map gets large
  if (rateLimitMap.size > 500) {
    for (const [k, v] of rateLimitMap) {
      if (now - v > 60_000) rateLimitMap.delete(k);
    }
  }

  rateLimitMap.set(key, now);
  return true;
}

export async function submitFeedback(
  message: string,
  email?: string
): Promise<ActionResult> {
  // Validate message
  const trimmed = message.trim();
  if (trimmed.length < 10) {
    return { error: "Message must be at least 10 characters." };
  }
  if (trimmed.length > 2000) {
    return { error: "Message must be under 2000 characters." };
  }

  // Validate email if provided
  const trimmedEmail = email?.trim() || null;
  if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return { error: "Invalid email address." };
  }

  // Auth + headers in parallel (independent calls)
  const [session, headerStore] = await Promise.all([auth(), headers()]);
  const userId = session?.user?.id ?? null;
  const username = session?.user?.githubUsername ?? null;
  const ip = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim();
  const rateLimitKey = userId ?? ip ?? "anon";
  if (!checkRateLimit(rateLimitKey)) {
    return { error: "Please wait a minute before submitting again." };
  }

  try {
    await db.insert(feedback).values({
      userId,
      username,
      email: trimmedEmail,
      message: trimmed,
    });
  } catch (err) {
    console.error("Feedback insert error:", err);
    return { error: "Failed to submit feedback. Please try again." };
  }
}

export async function toggleFeedbackResolved(formData: FormData): Promise<void> {
  const cookieStore = await cookies();
  if (!verifyAdminToken(cookieStore.get(ADMIN_COOKIE_NAME)?.value)) return;

  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) return;
  const resolve = formData.get("resolve") === "1";

  await db
    .update(feedback)
    .set({ resolvedAt: resolve ? new Date() : null })
    .where(eq(feedback.id, id));

  revalidatePath("/admin", "layout");
}
