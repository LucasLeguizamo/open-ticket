/**
 * API keys del canal de compra agéntico (README paso 7, PRD FR-11).
 *
 * La key cruda es alta entropía (`ot_live_<40 hex>`) → SHA-256 sin salt alcanza
 * para un lookup determinista y resistente a timing (no hay comparación de
 * secretos en app: el índice unique de la DB hace el match). Solo se ve en claro
 * al crearla.
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

/** Genera una key nueva. Devuelve la fila a insertar + la key en claro (única vez). */
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

/** Busca la key por hash; null si no existe o está revocada. */
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

/** verifyToken para withMcpAuth (required:false): sin key válida → sin authInfo. */
export async function verifyApiKeyToken(
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;
  const rec = await verifyApiKey(bearerToken);
  if (!rec) return undefined;
  return { token: bearerToken, clientId: rec.id, scopes: ["buy_ticket"] };
}

// ponytail: rate-limit en memoria por key (30 compras/min). Best-effort — en
// Vercel serverless no cruza instancias. Subir a Redis/KV (mcp-handler ya soporta
// redisUrl) si el abuso real lo justifica; alcanza para v1.
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
