/**
 * Landing dev-native / estética CLI (FR 15): el agente es el protagonista.
 * Hero + snippet de integración MCP + ticker en vivo + próximos eventos.
 */

import { connection } from "next/server";
import { Suspense } from "react";
import { searchEvents } from "@/lib/catalog";
import { LiveTicker } from "./live-ticker";

const MCP_SNIPPET = `{
  "mcpServers": {
    "openticket": { "url": "https://openticket.dev/api/mcp" }
  }
}
# tools: search_events · get_ticket · buy_ticket · get_order · set_reminder`;

async function UpcomingEvents() {
  await connection(); // request-time: la lista y el "available" son dinámicos
  const events = await searchEvents(undefined, 6);
  if (events.length === 0) {
    return (
      <p className="text-neutral-600">
        $ openticket events → (vacío) crea el primero
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {events.map((e) => (
        <li key={e.id} className="rounded border border-neutral-800 p-3">
          <p>
            <a className="underline" href={`/e/${e.slug}`}>
              <strong>{e.title}</strong>
            </a>{" "}
            <span className="text-neutral-500">
              {e.starts_at.slice(0, 10)}
              {e.venue ? ` · ${e.venue}` : ""}
            </span>
          </p>
          <p className="text-neutral-500">
            {e.ticket_types
              .map(
                (t) =>
                  `${t.name} ${(t.price_minor / 100).toFixed(2)} ${t.currency} (${t.available} left)`,
              )
              .join(" · ")}
          </p>
          <p className="text-neutral-600">
            id: {e.id} · tickets: {e.ticket_types.map((t) => t.id).join(", ")}
          </p>
        </li>
      ))}
    </ul>
  );
}

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl space-y-10 p-8 text-sm">
      <nav className="flex justify-between text-neutral-500">
        <span>openticket</span>
        <a className="underline hover:text-green-500" href="/organizer">
          organizadores → login
        </a>
      </nav>
      <header className="space-y-3">
        <p className="text-neutral-500">$ openticket --help</p>
        <h1 className="text-2xl font-bold">
          Your agent handles the checkout.
          <span className="animate-pulse">▌</span>
        </h1>
        <p className="text-neutral-400">
          Ticketing agent-native: cada ticket es descubrible y comprable por un
          agente vía <span className="text-green-500">MCP</span> (ACP y x402 en
          camino). Pago con Stripe, recordatorio .ics automático.
        </p>
      </header>

      <section className="space-y-2">
        <p className="text-neutral-500"># conecta tu agente (Claude, etc.)</p>
        <pre className="overflow-x-auto rounded border border-neutral-800 bg-neutral-950 p-4 text-green-400">
          {MCP_SNIPPET}
        </pre>
      </section>

      <section className="space-y-2">
        <p className="text-neutral-500"># actividad en vivo</p>
        <LiveTicker />
      </section>

      <section className="space-y-2">
        <p className="text-neutral-500"># próximos eventos</p>
        <Suspense fallback={<p className="text-neutral-600">$ cargando…</p>}>
          <UpcomingEvents />
        </Suspense>
      </section>

      <footer className="text-neutral-600">
        openticket v0.1 · rails: mcp ✓ · web ✓ · acp/x402/ap2{" "}
        <span title="feature flags">⧗</span>
      </footer>
    </main>
  );
}
