/**
 * Página de orden — destino del success/cancel del checkout hospedado y del
 * link del email. Estética CLI (tech-stack: landing dev-native llega en F1).
 * Cache Components: la data de la orden es dinámica → va bajo <Suspense>.
 */
import { Suspense } from "react";
import { getPurchaseCore } from "@/lib/context";

const STATUS_LINE: Record<string, string> = {
  pending_payment: "⧗ pendiente de pago",
  confirmed: "✓ confirmada",
  expired: "✗ expirada (cupo liberado)",
  cancelled: "✗ cancelada",
  refunded: "↩ reembolsada",
};

async function OrderDetail({ orderId }: { orderId: string }) {
  const result = await getPurchaseCore().getOrderResult(orderId);
  if (!result) return <p className="mt-4">error: orden no encontrada</p>;
  return (
    <div className="mt-4 space-y-3">
      <p>
        {STATUS_LINE[result.status] ?? result.status} —{" "}
        <strong>{result.event.title}</strong>
      </p>
      <p className="text-neutral-500">
        {result.event.startsAt.toISOString()}
        {result.event.venue ? ` · ${result.event.venue}` : ""}
      </p>
      <p>
        total: {(result.amount.amountMinor / 100).toFixed(2)}{" "}
        {result.amount.currency}
      </p>
      {result.status === "pending_payment" && result.checkoutUrl && (
        <p>
          <a className="text-green-500 underline" href={result.checkoutUrl}>
            → completar pago
          </a>{" "}
          <span className="text-neutral-500">
            (reserva hasta {result.expiresAt?.toISOString()})
          </span>
        </p>
      )}
      {result.tickets.length > 0 && (
        <ul className="list-disc pl-5">
          {result.tickets.map((t) => (
            <li key={t.id} className="font-mono">
              {t.code} [{t.status}]
            </li>
          ))}
        </ul>
      )}
      {result.icsPath && (
        <p>
          <a className="text-green-500 underline" href={result.icsPath}>
            → descargar .ics (recordatorios 24h y 1h antes)
          </a>
        </p>
      )}
    </div>
  );
}

async function OrderView({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  return (
    <>
      <p className="text-neutral-500">$ openticket order {orderId}</p>
      <OrderDetail orderId={orderId} />
    </>
  );
}

export default function OrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  return (
    <main className="mx-auto max-w-2xl p-8 text-sm">
      <Suspense
        fallback={<p className="text-neutral-500">$ cargando orden…</p>}
      >
        <OrderView params={params} />
      </Suspense>
    </main>
  );
}
