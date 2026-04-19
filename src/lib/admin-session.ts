import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { env } from "@/lib/env";

// To revoke all admin sessions (suspected compromise, offboarding):
// rotate ADMIN_PASSWORD or AUTH_SECRET — either invalidates every existing
// cookie because the HMAC key depends on both. Without rotation, sessions
// expire naturally after ADMIN_SESSION_TTL_MS.
export const ADMIN_COOKIE_NAME = "admin_session";
export const ADMIN_SESSION_TTL_MS = 4 * 60 * 60 * 1000;

function sessionKey(): Buffer {
  // Binding the key to ADMIN_PASSWORD means rotating the password
  // invalidates all outstanding sessions — matches the mental model of
  // "changing the password logs everyone out."
  return createHmac("sha256", env.AUTH_SECRET)
    .update("clawdboard/admin-session/v1")
    .update("\0")
    .update(env.ADMIN_PASSWORD ?? "")
    .digest();
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer | null {
  try {
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
  } catch {
    return null;
  }
}

export function signAdminToken(ttlMs: number = ADMIN_SESSION_TTL_MS): string {
  const nonce = randomBytes(16);
  const expiresAt = Date.now() + ttlMs;
  const expBuf = Buffer.alloc(8);
  expBuf.writeBigUInt64BE(BigInt(expiresAt));
  const payload = Buffer.concat([nonce, expBuf]);
  const sig = createHmac("sha256", sessionKey()).update(payload).digest();
  return `${b64urlEncode(payload)}.${b64urlEncode(sig)}`;
}

export function verifyAdminToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const payload = b64urlDecode(parts[0]);
  const sig = b64urlDecode(parts[1]);
  if (!payload || !sig || payload.length !== 24 || sig.length !== 32) return false;

  const expected = createHmac("sha256", sessionKey()).update(payload).digest();
  if (!timingSafeEqual(sig, expected)) return false;

  const expiresAt = Number(payload.readBigUInt64BE(16));
  return Date.now() < expiresAt;
}
