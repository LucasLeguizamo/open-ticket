/**
 * API keys for the agentic purchase channel (README step 7, PRD FR-11).
 *
 * The raw key is high entropy (`ot_live_<40 hex>`) → unsalted SHA-256 is enough
 * for a deterministic, timing-safe lookup (no secret comparison happens in the
 * app: the DB's unique index does the matching). The key is only visible in
 * plaintext at creation time.
 */
import { createHash, randomBytes } from "node:crypto";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { and, eq, isNull } from "drizzle-orm";
import { randomId } from "@/core";
import { getDb } from "@/db/client";
import { apiKey } from "@/db/schema";

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Generates a new key. Returns the row to insert + the plaintext key (shown only once). */
export function generateApiKey(label = ""): {
  raw: string;
  row: typeof apiKey.$inferInsert;
} {
  const raw = `ot_live_${randomBytes(20).toString("hex")}`;
  return {
    raw,
    row: { id: randomId("key"), keyHash: hashApiKey(raw), label },
  };
}

/** Looks up the key by hash; null if it does not exist or has been revoked. */
export async function verifyApiKey(
  raw: string,
): Promise<{ id: string } | null> {
  if (!raw) return null;
  const rows = await getDb()
    .select({ id: apiKey.id })
    .from(apiKey)
    .where(and(eq(apiKey.keyHash, hashApiKey(raw)), isNull(apiKey.revokedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/** verifyToken for withMcpAuth (required:false): no valid key → no authInfo. */
export async function verifyApiKeyToken(
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;
  const rec = await verifyApiKey(bearerToken);
  if (!rec) return undefined;
  return { token: bearerToken, clientId: rec.id, scopes: ["buy_ticket"] };
}

// ponytail: in-memory rate limit per key (30 purchases/min). Best-effort — on
// Vercel serverless it does not span instances. Upgrade to Redis/KV (mcp-handler
// already supports redisUrl) if real abuse warrants it; good enough for v1.
const HITS = new Map<string, { count: number; resetAt: number }>();
const LIMIT = 30;
const WINDOW_MS = 60_000;

export function apiKeyRateLimited(
  keyId: string,
  now: number = Date.now(),
): boolean {
  const cur = HITS.get(keyId);
  if (!cur || now > cur.resetAt) {
    HITS.set(keyId, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  cur.count++;
  return cur.count > LIMIT;
}
