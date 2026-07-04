/**
 * Seed de demo: 1 organizador + 2 eventos publicados + ticket types.
 * Idempotente (onConflictDoNothing) — correr N veces no duplica.
 * Uso: pnpm db:seed  (requiere DATABASE_URL; carga .env vía dotenv)
 */
import "dotenv/config";
import { createDb } from "../db/client";
import { apiKey, event, organizer, ticketType } from "../db/schema";
import { hashApiKey } from "../lib/api-key";
import { hashPassword } from "../lib/password";

/** Key demo para el canal de compra agéntico (buy_ticket / pnpm agent:race). */
const DEMO_API_KEY =
  process.env.SEED_API_KEY ?? "ot_live_demo_key_solo_para_test";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada");
  const db = createDb(url, 2);

  await db
    .insert(organizer)
    .values({
      id: "org_demo",
      name: "CONCAT Events",
      email: "demo@onconcat.com",
      // login demo: demo@onconcat.com / demo1234 (solo test mode)
      passwordHash: hashPassword("demo1234"),
    })
    .onConflictDoUpdate({
      target: organizer.id,
      set: { passwordHash: hashPassword("demo1234") },
    });

  const in30d = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const in45d = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000);

  await db
    .insert(event)
    .values([
      {
        id: "evt_demo_conf",
        organizerId: "org_demo",
        title: "Agent Commerce Conf Bogotá",
        description:
          "La primera conferencia LATAM de agentic commerce. Charlas de ACP, MCP, x402 y pagos agénticos.",
        slug: "agent-commerce-conf",
        venue: "Ágora Bogotá",
        startsAt: in30d,
        currency: "USD",
        status: "published",
      },
      {
        id: "evt_demo_meetup",
        organizerId: "org_demo",
        title: "MCP Builders Meetup",
        description:
          "Meetup mensual de builders de MCP servers. Demos en vivo.",
        slug: "mcp-builders-meetup",
        venue: "Selina Chapinero",
        startsAt: in45d,
        currency: "USD",
        status: "published",
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(ticketType)
    .values([
      {
        id: "tt_conf_general",
        eventId: "evt_demo_conf",
        name: "General",
        priceMinor: 4500,
        quota: 100,
      },
      {
        id: "tt_conf_vip",
        eventId: "evt_demo_conf",
        name: "VIP",
        priceMinor: 12000,
        quota: 20,
      },
      // cupo 1 a propósito: escena "3 agentes pelean el último ticket" (F1.5)
      {
        id: "tt_meetup_last",
        eventId: "evt_demo_meetup",
        name: "Last Ticket",
        priceMinor: 1000,
        quota: 1,
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(apiKey)
    .values({
      id: "key_demo",
      keyHash: hashApiKey(DEMO_API_KEY),
      label: "demo (seed)",
    })
    .onConflictDoUpdate({
      target: apiKey.id,
      set: { keyHash: hashApiKey(DEMO_API_KEY), revokedAt: null },
    });

  console.log(
    "seed OK: evt_demo_conf (tt_conf_general, tt_conf_vip) · evt_demo_meetup (tt_meetup_last)",
  );
  console.log(`API key demo (buy_ticket): ${DEMO_API_KEY}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
