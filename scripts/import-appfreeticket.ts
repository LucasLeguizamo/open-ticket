/**
 * Demo: import the next upcoming FreeTicket (appfreeticket.com) events into
 * OpenTicket via the deterministic URL import (M2).
 *   pnpm tsx scripts/import-appfreeticket.ts            # dry-run: extract + print
 *   pnpm tsx scripts/import-appfreeticket.ts --seed     # publish the ones with data
 *
 * Unlike the Luma demo, these are genuinely upcoming (COP, Bogotá) so the real
 * extracted date is used — no projection. ponytail: throwaway operator script.
 */
import "dotenv/config";
import { and, eq, inArray, like } from "drizzle-orm";
import { randomId } from "@/core";
import { getDb } from "@/db/client";
import { event, ticketType } from "@/db/schema";
import { importFromUrl } from "@/lib/import";

const BASE = "https://appfreeticket.com/eventos";
const SLUGS = [
  "los-rookies-repechaje-a-la-final",
  "que-hputa-terapia-julio",
  "beats-julio",
  "la-logia",
  "gordconsejos-julio",
];
const WANT = 3; // the 3 next ones with usable data

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "event";

async function main() {
  const seed = process.argv.includes("--seed");
  const db = seed ? getDb() : null;

  if (seed && db) {
    const prior = await db
      .select({ id: event.id })
      .from(event)
      .where(
        and(
          eq(event.organizerId, "org_demo"),
          like(event.imageUrl, "%appfreeticket%"),
        ),
      );
    if (prior.length) {
      const ids = prior.map((e) => e.id);
      await db.delete(ticketType).where(inArray(ticketType.eventId, ids));
      await db.delete(event).where(inArray(event.id, ids));
      console.log(`cleaned ${ids.length} prior imported events`);
    }
  }

  let seeded = 0;
  for (const slug of SLUGS) {
    if (seed && seeded >= WANT) break;
    const url = `${BASE}/${slug}`;
    try {
      const r = await importFromUrl(url);
      const d = r.draft;
      console.log(`\n▶ ${url}`);
      console.log(`  source=${r.source} coverage=${r.coverage}`);
      console.log(`  title:   ${d.title ?? "—"}`);
      console.log(`  startsAt:${d.startsAt ?? "—"}`);
      console.log(`  venue:   ${d.venue ?? "—"}`);
      console.log(`  image:   ${d.imageUrl ?? "—"}`);
      console.log(`  prices:  ${JSON.stringify(d.detectedPrices ?? null)}`);

      const isUpcoming = d.startsAt ? new Date(d.startsAt) > new Date() : false;
      if (seed && db && d.title && d.startsAt && isUpcoming) {
        const id = randomId("evt");
        const s = `${slugify(d.title)}-${id.slice(-4)}`;
        await db.insert(event).values({
          id,
          organizerId: "org_demo",
          title: d.title,
          description: `${d.description ?? ""}\n\n(imported from appfreeticket.com/eventos/${slug})`,
          slug: s,
          venue: d.venue ?? null,
          imageUrl: d.imageUrl ?? null,
          startsAt: new Date(d.startsAt),
          timezone: "America/Bogota",
          currency: d.currency ?? "COP",
          status: "published",
        });
        const priceMinor = d.detectedPrices?.[0]?.priceMinor ?? 5000000;
        await db.insert(ticketType).values({
          id: randomId("tt"),
          eventId: id,
          name: "General",
          priceMinor,
          quota: 100,
          status: "active",
        });
        seeded++;
        console.log(`  → seeded published event ${id} (/e/${s})`);
      }
    } catch (e) {
      console.log(`\n✗ ${url}  ${(e as Error).message}`);
    }
  }
  if (seed) console.log(`\nseeded ${seeded} events`);
  process.exit(0);
}

void main();
