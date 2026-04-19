import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHash, timingSafeEqual } from "crypto";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import {
  ADMIN_COOKIE_NAME,
  ADMIN_SESSION_TTL_MS,
  signAdminToken,
} from "@/lib/admin-session";

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, { key: "admin-login", limit: 5 });
  if (limited) return limited;

  const adminPassword = env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return NextResponse.json(
      { error: "Admin access not configured" },
      { status: 403 }
    );
  }

  let password: string;
  try {
    const body = await req.json();
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Hash both sides to fixed-length digests so the comparison has no
  // length-dependent branch that could leak the expected password length.
  const provided = createHash("sha256").update(password, "utf-8").digest();
  const expected = createHash("sha256").update(adminPassword, "utf-8").digest();

  if (!timingSafeEqual(provided, expected)) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const token = signAdminToken();

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: Math.floor(ADMIN_SESSION_TTL_MS / 1000),
    path: "/",
  });

  return NextResponse.json({ ok: true });
}
