/**
 * Public JSON discovery feed (README step 2) — precursor of the F2 ACP feed.
 * Published events + ticket types with price and remaining quota. No PII,
 * no auth: it exists so an agent can discover what is buyable.
 *
 * Reuses lib/catalog.searchEvents (same query as the MCP `search_events`).
 */
import { searchEvents } from "@/lib/catalog";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const query = url.searchParams.get("q") ?? undefined;
  const events = await searchEvents(query);
  return Response.json(
    { events, count: events.length },
    {
      headers: {
        // discovery, not checkout: quota may be 30-60s stale (README)
        "cache-control": "public, max-age=30, s-maxage=60",
      },
    },
  );
}
