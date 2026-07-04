/**
 * Página /agents (README paso 1) — la vitrina para agentes y devs. Estética CLI
 * como la landing. Documenta el MCP server, las 4 tools con payload de ejemplo,
 * y los endpoints de descubrimiento (feed JSON, llms.txt, OpenAPI).
 *
 * URLs con el host real de la request (headers()) → correcto en preview y prod.
 */
import { headers } from "next/headers";
import { Suspense } from "react";

export const metadata = {
  title: "OpenTicket · para agentes",
  description:
    "MCP server, feed de eventos y endpoints públicos de OpenTicket.",
};

const TOOLS: { name: string; desc: string; payload: object }[] = [
  {
    name: "search_events",
    desc: "Busca eventos publicados y sus tipos de ticket (precio + cupo).",
    payload: { query: "jazz", limit: 20 },
  },
  {
    name: "get_ticket",
    desc: "Detalle de un tipo de ticket antes de comprar.",
    payload: { ticket_type_id: "tt_..." },
  },
  {
    name: "buy_ticket",
    desc: "Compra respetando spend_limit. Devuelve pending_payment + checkout_url.",
    payload: {
      event_id: "evt_...",
      ticket_type_id: "tt_...",
      quantity: 1,
      buyer_email: "user@example.com",
      idempotency_key: "generado-por-vos-repetir-en-reintentos",
      spend_limit: { amount_minor: 50000, currency: "USD" },
    },
  },
  {
    name: "set_reminder",
    desc: "Agenda recordatorio por email + devuelve .ics con alarmas (24h/1h).",
    payload: { event_id: "evt_...", buyer_email: "user@example.com" },
  },
];

async function AgentContent() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "openticket.dev";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;

  const mcpConfig = `{
  "mcpServers": {
    "openticket": { "url": "${origin}/api/mcp" }
  }
}`;

  const links: [string, string][] = [
    ["Feed de eventos (JSON)", "/api/events"],
    ["Ticker en vivo (SSE)", "/api/ticker"],
    ["llms.txt", "/llms.txt"],
    ["OpenAPI 3.1", "/openapi.json"],
  ];

  return (
    <>
      <section className="space-y-2">
        <p className="text-neutral-500">
          # 1. conectá tu agente (Claude, etc.)
        </p>
        <pre className="overflow-x-auto rounded border border-neutral-800 bg-neutral-950 p-4 text-green-400">
          {mcpConfig}
        </pre>
        <p className="text-neutral-600">
          MCP server (streamable HTTP): {origin}/api/mcp
        </p>
      </section>

      <section className="space-y-3">
        <p className="text-neutral-500"># 2. tools disponibles</p>
        {TOOLS.map((t) => (
          <div
            key={t.name}
            className="space-y-1 rounded border border-neutral-800 p-3"
          >
            <p>
              <strong className="text-green-500">{t.name}</strong>{" "}
              <span className="text-neutral-500">— {t.desc}</span>
            </p>
            <pre className="overflow-x-auto text-neutral-400">
              {JSON.stringify(t.payload, null, 2)}
            </pre>
          </div>
        ))}
        <p className="text-neutral-600">
          Errores estructurados: sold_out · mandate_exceeded · invalid_intent.
          Reintentá con la MISMA idempotency_key. Estado final: get_order.
        </p>
      </section>

      <section className="space-y-2">
        <p className="text-neutral-500"># 3. descubrimiento sin MCP</p>
        <ul className="space-y-1">
          {links.map(([label, href]) => (
            <li key={href}>
              <a className="underline hover:text-green-500" href={href}>
                {label}
              </a>{" "}
              <span className="text-neutral-600">
                {origin}
                {href}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

export default function AgentsPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-10 p-8 text-sm">
      <nav className="flex justify-between text-neutral-500">
        <a className="underline hover:text-green-500" href="/">
          ← openticket
        </a>
        <span>/agents</span>
      </nav>

      <header className="space-y-3">
        <p className="text-neutral-500">$ openticket agents --help</p>
        <h1 className="text-2xl font-bold">
          Comprá tickets programáticamente.
          <span className="animate-pulse">▌</span>
        </h1>
        <p className="text-neutral-400">
          Cada ticket es descubrible y comprable por un agente. Conectá por{" "}
          <span className="text-green-500">MCP</span> o consumí el feed JSON.
        </p>
      </header>

      <Suspense fallback={<p className="text-neutral-600">$ cargando…</p>}>
        <AgentContent />
      </Suspense>

      <footer className="text-neutral-600">
        openticket v0.1 · rails: mcp ✓ · web ✓ · acp/x402/ap2 ⧗
      </footer>
    </main>
  );
}
