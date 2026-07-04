/**
 * Feed JSON público de descubrimiento (README paso 2) — precursor del feed ACP
 * de F2. Eventos publicados + tipos de ticket con precio y cupo restante. Sin
 * PII, sin auth: es para que un agente descubra qué hay comprable.
 *
 * Reusa lib/catalog.searchEvents (mismo query que el MCP `search_events`).
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
        // descubrimiento, no checkout: cupo puede quedar 30-60s viejo (README)
        "cache-control": "public, max-age=30, s-maxage=60",
      },
    },
  );
}
