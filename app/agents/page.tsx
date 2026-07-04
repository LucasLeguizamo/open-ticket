/**
 * /agents page (README step 1) — the showcase for agents and devs. CLI
 * aesthetic like the landing. Documents the MCP server, the 4 tools with
 * example payloads, and the discovery endpoints (JSON feed, llms.txt, OpenAPI).
 *
 * URLs use the real request host (headers()) → correct in preview and prod.
 */
import { headers } from "next/headers";
import { Suspense } from "react";

export const metadata = {
  title: "OpenTicket · for agents",
  description: "OpenTicket's MCP server, events feed, and public endpoints.",
};

const TOOLS: { name: string; desc: string; payload: object }[] = [
  {
    name: "search_events",
    desc: "Searches published events and their ticket types (price + availability).",
    payload: { query: "jazz", limit: 20 },
  },
  {
    name: "get_ticket",
    desc: "Details of a ticket type before buying.",
    payload: { ticket_type_id: "tt_..." },
  },
  {
    name: "buy_ticket",
    desc: "Buys while honoring spend_limit. Returns pending_payment + checkout_url.",
    payload: {
      event_id: "evt_...",
      ticket_type_id: "tt_...",
      quantity: 1,
      buyer_email: "user@example.com",
      idempotency_key: "generated-by-you-reuse-on-retries",
      spend_limit: { amount_minor: 50000, currency: "USD" },
    },
  },
  {
    name: "set_reminder",
    desc: "Schedules an email reminder + returns an .ics with alarms (24h/1h).",
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
    ["Events feed (JSON)", "/api/events"],
    ["Live ticker (SSE)", "/api/ticker"],
    ["llms.txt", "/llms.txt"],
    ["OpenAPI 3.1", "/openapi.json"],
  ];

  return (
    <>
      <section className="space-y-2">
        <p className="text-neutral-500">
          # 1. connect your agent (Claude, etc.)
        </p>
        <pre className="overflow-x-auto rounded border border-neutral-800 bg-neutral-950 p-4 text-green-400">
          {mcpConfig}
        </pre>
        <p className="text-neutral-600">
          MCP server (streamable HTTP): {origin}/api/mcp
        </p>
      </section>

      <section className="space-y-3">
        <p className="text-neutral-500"># 2. available tools</p>
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
          Structured errors: sold_out · mandate_exceeded · invalid_intent. Retry
          with the SAME idempotency_key. Final status: get_order.
        </p>
      </section>

      <section className="space-y-2">
        <p className="text-neutral-500"># 3. discovery without MCP</p>
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
          Buy tickets programmatically.
          <span className="animate-pulse">▌</span>
        </h1>
        <p className="text-neutral-400">
          Every ticket is discoverable and buyable by an agent. Connect via{" "}
          <span className="text-green-500">MCP</span> or consume the JSON feed.
        </p>
      </header>

      <Suspense fallback={<p className="text-neutral-600">$ loading…</p>}>
        <AgentContent />
      </Suspense>

      <footer className="text-neutral-600">
        openticket v0.1 · rails: mcp ✓ · web ✓ · acp/x402/ap2 ⧗
      </footer>
    </main>
  );
}
