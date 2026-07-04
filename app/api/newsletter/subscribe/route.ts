/**
 * Digest subscribe (README step 6) — public endpoint that only stores the
 * subscriber. Sending the digest is F3; this does not block it.
 *
 * Trust boundary (PRD §7): email validated with Zod before touching the DB.
 */
import { z } from "zod";
import { randomId } from "@/core";
import { getDb } from "@/db/client";
import { digestSubscriber } from "@/db/schema";

const bodySchema = z.object({ email: z.string().email().max(254) });

// ponytail: in-memory rate limit per IP (10/min). Best-effort: on Vercel
// serverless it is not shared across instances. Move to KV/Upstash if real
// spam justifies it; good enough for v1.
const HITS = new Map<string, { count: number; resetAt: number }>();
const LIMIT = 10;
const WINDOW_MS = 60_000;

function rateLimited(ip: string, now: number): boolean {
  const cur = HITS.get(ip);
  if (!cur || now > cur.resetAt) {
    HITS.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  cur.count++;
  return cur.count > LIMIT;
}

export async function POST(req: Request): Promise<Response> {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (rateLimited(ip, Date.now())) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "invalid_email" }, { status: 400 });
  }

  // idempotent: re-subscribing the same email is not an error and does not duplicate the row.
  await getDb()
    .insert(digestSubscriber)
    .values({ id: randomId("sub"), email: parsed.data.email.toLowerCase() })
    .onConflictDoNothing({ target: digestSubscriber.email });

  return Response.json({ status: "subscribed" }, { status: 200 });
}
