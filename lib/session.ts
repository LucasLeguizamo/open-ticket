/**
 * Organizer session: httpOnly cookie signed with HMAC (AUTH_SECRET).
 * Format: `<organizerId>.<expiresMs>.<hmac>`. No sessions table —
 * stateless, expires on its own; revoking = rotating AUTH_SECRET.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "ot_session";
const MAX_AGE_S = 30 * 24 * 60 * 60;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error("AUTH_SECRET is not set (minimum 16 chars)");
  }
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export async function createSession(organizerId: string): Promise<void> {
  const payload = `${organizerId}.${Date.now() + MAX_AGE_S * 1000}`;
  (await cookies()).set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function getSessionOrganizerId(): Promise<string | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const at = raw.lastIndexOf(".");
  if (at < 0) return null;
  const payload = raw.slice(0, at);
  const sig = Buffer.from(raw.slice(at + 1));
  const expected = Buffer.from(sign(payload));
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected))
    return null;
  const [organizerId, expires] = payload.split(".");
  if (!organizerId || !expires || Number(expires) < Date.now()) return null;
  return organizerId;
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
