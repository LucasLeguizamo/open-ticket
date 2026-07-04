/**
 * Demo seed: 1 organizer + 2 published events + ticket types.
 * Idempotent (onConflictDoNothing) — running it N times never duplicates.
 * Usage: pnpm db:seed  (requires DATABASE_URL; loads .env via dotenv)
 */
import "dotenv/config";
import { createDb } from "../db/client";
import { apiKey, event, organizer, ticketType } from "../db/schema";
import { hashApiKey } from "../lib/api-key";
import { hashPassword } from "../lib/password";

/** Demo key for the agentic purchase channel (buy_ticket / pnpm agent:race). */
const DEMO_API_KEY =
  process.env.SEED_API_KEY ?? "ot_live_demo_key_solo_para_test";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = createDb(url, 2);

  await db
    .insert(organizer)
    .values({
      id: "org_demo",
      name: "CONCAT Events",
      email: "demo@onconcat.com",
      // demo login: demo@onconcat.com / demo1234 (test mode only)
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
          "The first agentic commerce conference in LATAM. Talks on ACP, MCP, x402, and agentic payments.",
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
        description: "Monthly meetup for MCP server builders. Live demos.",
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
      // quota of 1 on purpose: the "3 agents fight for the last ticket" scene (F1.5)
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
  console.log(`Demo API key (buy_ticket): ${DEMO_API_KEY}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
