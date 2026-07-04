/**
 * Public live ticker (FR 13) — SSE consumable by the landing page and by
 * any client (`curl -N /api/ticker`). No PII: only what the ticker_event
 * table already exposes.
 *
 * ponytail: polls the DB every 2.5s. With Supabase Realtime (or LISTEN/NOTIFY)
 * this becomes real push; the SSE contract toward the client does not change.
 * On Vercel the function expires at ~300s and EventSource reconnects on its own.
 */
import { desc, gte } from "drizzle-orm";
import { getDb } from "@/db/client";
import { tickerEvent } from "@/db/schema";

const POLL_MS = 2500;
const HEARTBEAT_EVERY = 6; // ~15s without news → keep-alive comment

export async function GET(req: Request): Promise<Response> {
  const db = getDb();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let cursor = new Date(0);
      let quietPolls = 0;
      let closed = false;
      // Postgres stores µs and Date truncates to ms → gte cursor + dedupe by id.
      // The Set grows ≤ ~hundreds per connection (Vercel cuts off at ~300s): ok.
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
          // connection closed or DB down: close cleanly, the client reconnects
          if (!closed) {
            closed = true;
            clearInterval(timer);
            try {
              controller.close();
            } catch {
              /* already closed */
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
          /* already closed */
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
