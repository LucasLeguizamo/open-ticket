/**
 * .ics on-demand por orden confirmada (architecture-review D3: no se persiste).
 * El id de orden es no-adivinable (randomId) — funciona como capability URL.
 */
import { generateIcs } from "@/core";
import { getStore } from "@/lib/context";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orderId: string }> },
): Promise<Response> {
  const { orderId } = await params;
  const detail = await getStore().getOrderDetail(orderId);
  if (detail?.order.status !== "confirmed") {
    return new Response("not found", { status: 404 });
  }
  const ics = generateIcs({
    uid: `${detail.order.id}@openticket`,
    title: detail.event.title,
    location: detail.event.venue ?? undefined,
    startsAt: detail.event.startsAt,
    endsAt: detail.event.endsAt,
    description: `Tickets: ${detail.tickets.map((t) => t.code).join(", ")}`,
  });
  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="openticket-${detail.order.id}.ics"`,
      "cache-control": "private, no-store",
    },
  });
}
