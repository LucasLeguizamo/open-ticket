/**
 * Ticker público en vivo (FR 13) — SSE consumible por la landing y por
 * cualquier cliente (`curl -N /api/ticker`). Sin PII: solo lo que ya expone
 * la tabla ticker_event.
 *
 * ponytail: polling a la DB cada 2.5s. Con Supabase Realtime (o LISTEN/NOTIFY)
 * esto se reemplaza por push real; el contrato SSE hacia el cliente no cambia.
 * En Vercel la función expira a los ~300s y EventSource reconecta solo.
 */
import { desc, gte } from "drizzle-orm";
import { getDb } from "@/db/client";
import { tickerEvent } from "@/db/schema";

const POLL_MS = 2500;
const HEARTBEAT_EVERY = 6; // ~15s sin novedades → comentario keep-alive

export async function GET(req: Request): Promise<Response> {
  const db = getDb();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let cursor = new Date(0);
      let quietPolls = 0;
      let closed = false;
      // Postgres guarda µs y Date trunca a ms → cursor gte + dedupe por id.
      // El Set crece ≤ ~centenares por conexión (Vercel corta a ~300s): ok.
      const seen = new Set<string>();

      const send = (row: typeof tickerEvent.$inferSelect) => {
        if (seen.has(row.id)) return;
        seen.add(row.id);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              id: row.id,
              type: row.type,
              event_id: row.eventId,
              event_title: row.eventTitle,
              bought_by_agent: row.boughtByAgent,
              rail: row.rail,
              at: row.createdAt.toISOString(),
            })}\n\n`,
          ),
        );
        if (row.createdAt > cursor) cursor = row.createdAt;
      };

      const initial = await db
        .select()
        .from(tickerEvent)
        .orderBy(desc(tickerEvent.createdAt))
        .limit(20);
      for (const row of initial.reverse()) send(row);

      const timer = setInterval(async () => {
        if (closed) return;
        try {
          const rows = await db
            .select()
            .from(tickerEvent)
            .where(gte(tickerEvent.createdAt, cursor))
            .orderBy(tickerEvent.createdAt)
            .limit(50);
          if (rows.length === 0) {
            quietPolls++;
            if (quietPolls >= HEARTBEAT_EVERY) {
              quietPolls = 0;
              controller.enqueue(encoder.encode(": ping\n\n"));
            }
            return;
          }
          quietPolls = 0;
          for (const row of rows) send(row);
        } catch {
          // conexión cerrada o DB caída: cerrar limpio, el cliente reconecta
          if (!closed) {
            closed = true;
            clearInterval(timer);
            try {
              controller.close();
            } catch {
              /* ya cerrado */
            }
          }
        }
      }, POLL_MS);

      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* ya cerrado */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
