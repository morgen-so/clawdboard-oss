import "server-only";

import { type NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";

/** Extract the Bearer token from an Authorization header, if present. */
export function bearerToken(header: string | null): string | null {
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

type ApiTokenAuth =
  | { user: typeof users.$inferSelect; response?: never }
  | { user?: never; response: NextResponse };

/**
 * Authenticate a CLI request via its `Authorization: Bearer <api token>`
 * header. Returns the matching user row, or the 401 response to send back.
 */
export async function authenticateApiToken(
  req: NextRequest
): Promise<ApiTokenAuth> {
  const token = bearerToken(req.headers.get("authorization"));
  if (!token) {
    return {
      response: NextResponse.json(
        { error: "Missing authorization token" },
        { status: 401 }
      ),
    };
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.apiToken, token))
    .limit(1);

  if (!user) {
    return {
      response: NextResponse.json({ error: "Invalid token" }, { status: 401 }),
    };
  }

  return { user };
}

type SessionAuth =
  | { userId: string; response?: never }
  | { userId?: never; response: NextResponse };

/**
 * Require a signed-in session for an API route. Returns the user id, or
 * the 401 response to send back.
 */
export async function requireSessionUser(): Promise<SessionAuth> {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { userId: session.user.id };
}

/**
 * Verify the CRON_SECRET Bearer token (constant-time compare). Returns the
 * 401 response to send, or null when authorized — or when no secret is
 * configured (local dev).
 */
export function verifyCronSecret(req: NextRequest): NextResponse | null {
  const cronSecret = env.CRON_SECRET;
  if (!cronSecret) return null;

  const token = bearerToken(req.headers.get("authorization"));
  if (
    !token ||
    token.length !== cronSecret.length ||
    !timingSafeEqual(Buffer.from(token), Buffer.from(cronSecret))
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
