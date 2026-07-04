/**
 * Test harness for the URL import (M2) against real Luma events.
 *   pnpm tsx scripts/import-luma.ts            # dry-run: extract + print drafts
 *   pnpm tsx scripts/import-luma.ts --seed     # also insert+publish into the DB
 *
 * ponytail: throwaway operator script — sets quota/price itself (the product
 * rule that a human sets those still holds in the real /organizer/import UI).
 */
import "dotenv/config";
import { and, eq, inArray, like } from "drizzle-orm";
import { randomId } from "@/core";
import { getDb } from "@/db/client";
import { event, ticketType } from "@/db/schema";
import { importFromUrl } from "@/lib/import";

const URLS = [
  "https://lu.ma/ddxdubai",
  "https://lu.ma/j4u3k8nr",
  "https://lu.ma/l18zs8oy",
  "https://lu.ma/iv4a8fw0",
  "https://lu.ma/xwgbmixo",
  "https://lu.ma/li8lqzpa",
  "https://lu.ma/4aad19n2",
];

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "event";

async function main() {
  const seed = process.argv.includes("--seed");
  const db = seed ? getDb() : null;

  // Idempotent re-run: drop previously imported Luma events (marked by lumacdn).
  if (seed && db) {
    const prior = await db
      .select({ id: event.id })
      .from(event)
      .where(
        and(
          eq(event.organizerId, "org_demo"),
          like(event.imageUrl, "%lumacdn%"),
        ),
      );
    if (prior.length) {
      const ids = prior.map((e) => e.id);
      await db.delete(ticketType).where(inArray(ticketType.eventId, ids));
      await db.delete(event).where(inArray(event.id, ids));
      console.log(`cleaned ${ids.length} prior imported events`);
    }
  }

  let seededAt = Date.now();
  for (const url of URLS) {
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

      if (seed && db && d.title && d.imageUrl) {
        const id = randomId("evt");
        const slug = `${slugify(d.title)}-${id.slice(-4)}`;
        // Demo only: project to a future date so it clears the landing's
        // "upcoming" filter. The import extracted the REAL date correctly
        // (see output / kept in the description); we just shift it forward.
        seededAt += 7 * 24 * 60 * 60 * 1000;
        const realDate = d.startsAt ? d.startsAt.slice(0, 10) : "unknown";
        await db.insert(event).values({
          id,
          organizerId: "org_demo",
          title: d.title,
          description: `${d.description ?? "Imported from Luma."}\n\n(imported from lu.ma · original date ${realDate})`,
          slug,
          venue: d.venue ?? null,
          imageUrl: d.imageUrl ?? null,
          startsAt: new Date(seededAt),
          timezone: "UTC",
          currency: d.currency ?? "USD",
          status: "published",
        });
        const priceMinor = d.detectedPrices?.[0]?.priceMinor ?? 2500;
        await db.insert(ticketType).values({
          id: randomId("tt"),
          eventId: id,
          name: "General",
          priceMinor,
          quota: 100,
          status: "active",
        });
        console.log(`  → seeded published event ${id} (/e/${slug})`);
      }
    } catch (e) {
      console.log(`\n✗ ${url}  ERROR: ${(e as Error).message}`);
    }
  }
  process.exit(0);
}

void main();
