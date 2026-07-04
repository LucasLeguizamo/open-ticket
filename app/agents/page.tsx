/**
 * /agents — the showcase for agents and devs (arcade-skinned like the landing).
 * MCP server, tools, the autonomous wallet purchase, a copy-paste prompt to hand
 * another agent, and the discovery endpoints. URLs use the real request host.
 */
import { headers } from "next/headers";
import { Suspense } from "react";
import { SiteFooter } from "../site-footer";
import { CopyBlock } from "./copy-block";

// Public demo key from the seed — buy-scoped, Stripe test mode, wallet loaded.
const DEMO_KEY = "ot_live_demo_key_solo_para_test";

export const metadata = {
  title: "OpenTicket · for agents",
  description:
    "OpenTicket's MCP server, autonomous wallet purchase, and endpoints.",
};

const TOOLS: { name: string; desc: string }[] = [
  {
    name: "search_events",
    desc: "published events + ticket types (price, availability)",
  },
  { name: "get_ticket", desc: "details of a ticket type before buying" },
  {
    name: "buy_ticket",
    desc: "buys within spend_limit; wallet → confirmed, else checkout_url",
  },
  { name: "get_order", desc: "final status of an order" },
  { name: "set_reminder", desc: "email reminder + .ics with alarms" },
];

async function AgentContent() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "openticket.dev";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;

  const mcpConfig = `{
  "mcpServers": {
    "openticket": {
      "url": "${origin}/api/mcp",
      "headers": { "Authorization": "Bearer ${DEMO_KEY}" }
    }
  }
}`;

  const agentPrompt = `You have the OpenTicket MCP tools connected. Emulate a real purchase:
1. Call search_events and pick one event with an available ticket type.
2. Call buy_ticket with quantity 1, buyer_email "agent@test.com", a fresh
   idempotency_key, and spend_limit { amount_minor: 5000, currency: "USD" }.
3. Show me the result: status, order_id, the ticket code and the ics_path.
This demo key has a wallet loaded, so buy_ticket pays autonomously and returns
status "confirmed" (paid: true) instantly — no browser, no checkout page.`;

  const terminalRecipe = `# one-time: point otick at OpenTicket and paste the demo key
export OPENTICKET_BASE_URL=${origin}
echo ${DEMO_KEY} | otick login
# emulate a purchase (wallet → confirmed instantly, no browser)
otick events                                 # grab a ticket_type id (tt_...)
otick buy <tt_id> --limit 50USD --email agent@test.com`;

  const links: [string, string][] = [
    ["Events feed (JSON)", "/api/events"],
    ["Live ticker (SSE)", "/api/ticker"],
    ["llms.txt", "/llms.txt"],
    ["OpenAPI 3.1", "/openapi.json"],
  ];

  return (
    <>
      <section className="space-y-2">
        <p className="font-pixel text-[0.6rem] text-[var(--pg-green)]">
          # 0. install the skills — your agent learns the whole flow
        </p>
        <CopyBlock text="npx skills add LucasLeguizamo/openticket-skills --copy" />
      </section>

      <section className="space-y-2">
        <p className="font-pixel text-[0.6rem] text-[var(--pg-cyan)]">
          # 1. connect your agent (Claude Desktop, etc.)
        </p>
        <CopyBlock text={mcpConfig} variant="cyan" />
        <p className="text-xs text-[var(--pg-dim)]">
          MCP server (streamable HTTP): {origin}/api/mcp
        </p>
      </section>

      <section className="space-y-3">
        <p className="font-pixel text-[0.6rem] text-[var(--pg-magenta)]">
          # 2. tools
        </p>
        <ul className="space-y-1 text-xs">
          {TOOLS.map((t) => (
            <li key={t.name}>
              <span className="text-[var(--pg-green)]">▸ {t.name}</span>{" "}
              <span className="text-[var(--pg-dim)]">— {t.desc}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <p className="font-pixel text-[0.6rem] text-[var(--pg-yellow)]">
          # 3. autonomous purchase (agent wallet)
        </p>
        <p className="text-xs leading-relaxed text-[var(--pg-dim)]">
          An agent whose API key has a{" "}
          <span className="text-[var(--pg-green)]">wallet</span> loaded pays{" "}
          <span className="text-[var(--pg-green)]">off_session</span> — no
          browser, no checkout page. buy_ticket charges the wallet and issues
          the ticket in the same response:{" "}
          <span className="text-[var(--pg-green)]">
            status: confirmed · paid: true
          </span>
          . Without a wallet it falls back to hosted Stripe Checkout
          (pending_payment + checkout_url). Spend limits, idempotent retries and
          structured errors (sold_out · mandate_exceeded · payment_failed) apply
          either way.
        </p>
      </section>

      <section className="space-y-3">
        <p className="font-pixel text-[0.6rem] text-[var(--pg-green)]">
          # 4. emulate a purchase — hand this to any agent
        </p>
        <p className="text-xs text-[var(--pg-dim)]">
          Connect the server (step 1), then paste this prompt to your agent:
        </p>
        <CopyBlock text={agentPrompt} />
        <p className="text-xs text-[var(--pg-dim)]">Or from a terminal:</p>
        <CopyBlock text={terminalRecipe} variant="cyan" />
      </section>

      <section className="space-y-2">
        <p className="font-pixel text-[0.6rem] text-[var(--pg-cyan)]">
          # 5. discovery without MCP
        </p>
        <ul className="space-y-1 text-xs">
          {links.map(([label, href]) => (
            <li key={href}>
              <a
                className="text-[var(--pg-dim)] underline hover:text-[var(--pg-green)]"
                href={href}
              >
                {label}
              </a>{" "}
              <span className="text-[var(--pg-line)]">
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
    <main className="mx-auto max-w-3xl space-y-8 p-6 sm:p-8">
      <nav className="flex justify-between text-xs text-[var(--pg-dim)]">
        <a className="underline hover:text-[var(--pg-green)]" href="/">
          ← openticket
        </a>
        <span className="font-pixel text-[0.55rem]">/agents</span>
      </nav>

      <header className="space-y-3">
        <p className="text-xs text-[var(--pg-dim)]">
          $ openticket agents --help
        </p>
        <h1 className="font-pixel text-base leading-relaxed text-[var(--pg-ink)] sm:text-lg">
          Buy tickets programmatically
          <span className="pg-blink text-[var(--pg-green)]">_</span>
        </h1>
        <p className="text-sm text-[var(--pg-dim)]">
          Every ticket is discoverable and buyable by an agent — via{" "}
          <span className="text-[var(--pg-green)]">MCP</span>, paid from an
          agent <span className="text-[var(--pg-green)]">wallet</span> or hosted
          Stripe Checkout.
        </p>
      </header>

      <Suspense fallback={<p className="text-[var(--pg-dim)]">$ loading…</p>}>
        <AgentContent />
      </Suspense>

      <Suspense fallback={<p className="text-[var(--pg-dim)]">$ loading…</p>}>
        <SiteFooter />
      </Suspense>
    </main>
  );
}
