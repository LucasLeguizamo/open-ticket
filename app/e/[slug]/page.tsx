/** Página pública del evento (US-001 AC: URL corta) + compra web (US-004). */
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getPublishedEventBySlug } from "@/lib/catalog";
import { buyWeb } from "../actions";

const inputCls =
  "rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-200";

const ERRORS: Record<string, string> = {
  sold_out: "cupo agotado",
  invalid_intent: "revisa email y cantidad",
  payment_failed: "no se pudo iniciar el pago, intenta de nuevo",
  event_unavailable: "el evento ya no está disponible",
  internal: "error inesperado, intenta de nuevo",
};

async function EventDetail({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug } = await params;
  const { error } = await searchParams;
  const data = await getPublishedEventBySlug(slug);
  if (!data) notFound();
  const { event: ev, ticketTypes } = data;

  return (
    <>
      <header className="space-y-2">
        <p className="text-neutral-500">$ openticket event {ev.slug}</p>
        <h1 className="text-2xl font-bold">{ev.title}</h1>
        <p className="text-neutral-500">
          {ev.startsAt.toISOString().slice(0, 16).replace("T", " ")} UTC
          {ev.venue ? ` · ${ev.venue}` : ""} · {ev.timezone}
        </p>
        {ev.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ev.imageUrl}
            alt={ev.title}
            className="max-h-64 rounded border border-neutral-800"
          />
        )}
        {ev.description && <p className="text-neutral-400">{ev.description}</p>}
      </header>

      {error && (
        <p className="rounded border border-red-900 bg-red-950 p-2 text-red-400">
          error: {ERRORS[error] ?? error}
        </p>
      )}

      <section className="space-y-3">
        <p className="text-neutral-500"># tickets</p>
        {ticketTypes.map((t) => (
          <form
            key={t.id}
            action={buyWeb}
            className="space-y-2 rounded border border-neutral-800 p-3"
          >
            <p>
              <strong>{t.name}</strong> — {(t.price_minor / 100).toFixed(2)}{" "}
              {t.currency}{" "}
              <span className="text-neutral-500">
                ({t.available} disponibles)
              </span>
            </p>
            <input type="hidden" name="slug" value={ev.slug} />
            <input type="hidden" name="event_id" value={ev.id} />
            <input type="hidden" name="ticket_type_id" value={t.id} />
            <div className="flex flex-wrap gap-2">
              <input
                className={inputCls}
                name="buyer_email"
                type="email"
                placeholder="email"
                required
              />
              <input
                className={`${inputCls} w-20`}
                name="quantity"
                type="number"
                min={1}
                max={10}
                defaultValue={1}
              />
              <button
                className="rounded bg-green-600 px-4 py-2 font-bold text-black disabled:opacity-40"
                type="submit"
                disabled={t.available === 0}
              >
                {t.available === 0 ? "sold out" : "comprar →"}
              </button>
            </div>
          </form>
        ))}
      </section>

      <footer className="text-neutral-600">
        ¿Eres un agente? Usa el MCP: <code>/api/mcp</code> · event_id:{" "}
        <code>{ev.id}</code>
      </footer>
    </>
  );
}

export default function EventPage(props: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <main className="mx-auto max-w-2xl space-y-8 p-8 text-sm">
      <Suspense
        fallback={<p className="text-neutral-500">$ cargando evento…</p>}
      >
        <EventDetail params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
