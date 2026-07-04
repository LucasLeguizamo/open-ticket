/**
 * Read-only catalog queries for agentic discovery
 * (MCP `search_events` / `get_ticket` / `set_reminder`).
 * Lives in lib/ (app layer): it reads data, it is not the purchase pipeline —
 * the core only knows StorePort and this module takes no part in payments.
 */
import { and, asc, eq, gte, ilike, inArray, or, type SQL } from "drizzle-orm";
import { getDb } from "@/db/client";
import { event, ticketType } from "@/db/schema";

export interface TicketTypeSummary {
  id: string;
  name: string;
  price_minor: number;
  currency: string;
  /** purchasable inventory right now (quota - issued - reserved) */
  available: number;
  status: string;
}

export interface EventSummary {
  id: string;
  title: string;
  description: string;
  slug: string;
  venue: string | null;
  image_url: string | null;
  starts_at: string;
  timezone: string;
  currency: string;
  status: string;
  ticket_types: TicketTypeSummary[];
}

function toTicketTypeSummary(
  tt: typeof ticketType.$inferSelect,
  currency: string,
): TicketTypeSummary {
  return {
    id: tt.id,
    name: tt.name,
    price_minor: tt.priceMinor,
    currency,
    available: Math.max(0, tt.quota - tt.issued - tt.reserved),
    status: tt.status,
  };
}

/** Published upcoming events, with their visible ticket types. */
export async function searchEvents(
  query?: string,
  limit = 20,
): Promise<EventSummary[]> {
  const db = getDb();
  const filters: SQL[] = [
    eq(event.status, "published"),
    gte(event.startsAt, new Date()),
  ];
  if (query) {
    const q = `%${query}%`;
    const textMatch = or(
      ilike(event.title, q),
      ilike(event.description, q),
      ilike(event.venue, q),
    );
    if (textMatch) filters.push(textMatch);
  }
  const events = await db
    .select()
    .from(event)
    .where(and(...filters))
    .orderBy(asc(event.startsAt))
    .limit(limit);
  if (events.length === 0) return [];

  const types = await db
    .select()
    .from(ticketType)
    .where(
      and(
        inArray(
          ticketType.eventId,
          events.map((e) => e.id),
        ),
        eq(ticketType.status, "active"),
      ),
    );

  return events.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    slug: e.slug,
    venue: e.venue,
    image_url: e.imageUrl,
    starts_at: e.startsAt.toISOString(),
    timezone: e.timezone,
    currency: e.currency,
    status: e.status,
    ticket_types: types
      .filter((t) => t.eventId === e.id)
      .map((t) => toTicketTypeSummary(t, e.currency)),
  }));
}

export interface TicketTypeDetail extends TicketTypeSummary {
  event: {
    id: string;
    title: string;
    venue: string | null;
    starts_at: string;
    timezone: string;
    status: string;
  };
}

/** Detail for a ticket type (price, availability, currency) before buying. */
export async function getTicketTypeDetail(
  ticketTypeId: string,
): Promise<TicketTypeDetail | null> {
  const db = getDb();
  const rows = await db
    .select({ tt: ticketType, ev: event })
    .from(ticketType)
    .innerJoin(event, eq(ticketType.eventId, event.id))
    .where(eq(ticketType.id, ticketTypeId))
    .limit(1);
  const row = rows[0];
  if (row?.ev.status !== "published") return null;
  return {
    ...toTicketTypeSummary(row.tt, row.ev.currency),
    event: {
      id: row.ev.id,
      title: row.ev.title,
      venue: row.ev.venue,
      starts_at: row.ev.startsAt.toISOString(),
      timezone: row.ev.timezone,
      status: row.ev.status,
    },
  };
}

/** Published event by slug + its ticket types (public page /e/[slug]). */
export async function getPublishedEventBySlug(slug: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(event)
    .where(eq(event.slug, slug))
    .limit(1);
  const ev = rows[0];
  if (ev?.status !== "published") return null;
  const types = await db
    .select()
    .from(ticketType)
    .where(and(eq(ticketType.eventId, ev.id), eq(ticketType.status, "active")));
  return {
    event: ev,
    ticketTypes: types.map((t) => toTicketTypeSummary(t, ev.currency)),
  };
}

/** Published event by id (for set_reminder with event_id). */
export async function getPublishedEvent(eventId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(event)
    .where(eq(event.id, eventId))
    .limit(1);
  const ev = rows[0];
  if (ev?.status !== "published") return null;
  return ev;
}
