/**
 * Landing — arcade 8-bit skin fused with the agent-native substance (FR 15).
 * Pixel-font titles + monospace body; the MCP snippet, live ticker and event
 * list stay: the agent is still the protagonist, now at the arcade.
 */

import { connection } from "next/server";
import { Suspense } from "react";
import { searchEvents } from "@/lib/catalog";
import { ArcadeCabinet } from "./arcade-sprite";
import { LiveTicker } from "./live-ticker";
import { SiteFooter } from "./site-footer";

const MCP_SNIPPET = `{
  "mcpServers": {
    "openticket": { "url": "https://openticket.dev/api/mcp" }
  }
}
# tools: search_events · get_ticket · buy_ticket · get_order · set_reminder`;

/**
 * Ask a Cloudflare-image CDN (Luma uses one) for a tiny version so that
 * upscaling it with image-rendering:pixelated gives a real 8-bit look — and a
 * lighter payload. Non-matching URLs are used as-is.
 */
function pixelSrc(url: string): string {
  return url.replace(/width=\d+,height=\d+/, "width=192,height=192");
}

async function UpcomingEvents() {
  await connection(); // request-time: the list and "available" are dynamic
  const events = await searchEvents(undefined, 6);
  if (events.length === 0) {
    return (
      <p className="text-[var(--pg-dim)]">
        $ openticket events → (empty) create the first one
      </p>
    );
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {events.map((e) => (
        <li key={e.id} className="pixel-box pixel-box--magenta overflow-hidden">
          {e.image_url && (
            // biome-ignore lint/performance/noImgElement: intentional low-res pixelated CDN image; next/image would re-optimize and undo the 8-bit look
            <img
              src={pixelSrc(e.image_url)}
              alt={e.title}
              className="pixelated h-32 w-full border-b-2 border-[var(--pg-magenta)] object-cover"
            />
          )}
          <div className="p-4">
            <a
              className="font-pixel text-[0.72rem] leading-relaxed text-[var(--pg-cyan)] hover:text-[var(--pg-yellow)]"
              href={`/e/${e.slug}`}
            >
              {e.title}
            </a>
            <p className="mt-2 text-xs text-[var(--pg-dim)]">
              {e.starts_at.slice(0, 10)}
              {e.venue ? ` · ${e.venue}` : ""}
            </p>
            <div className="mt-1 text-xs text-[var(--pg-green)]">
              {e.ticket_types.map((t) => (
                <span key={t.id} className="block">
                  ▸ {t.name} {(t.price_minor / 100).toFixed(2)} {t.currency} ·{" "}
                  {t.available} left
                </span>
              ))}
            </div>
            <a className="pixel-btn mt-3 text-[0.6rem]" href={`/e/${e.slug}`}>
              ▶ Buy ticket
            </a>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl space-y-10 p-6 sm:p-8">
      {/* marquee */}
      <div className="pixel-box pixel-box--magenta bg-[var(--pg-panel)] p-3 text-center">
        <span className="font-pixel text-sm text-[var(--pg-magenta)] sm:text-lg">
          ★ OPENTICKET ★
        </span>
      </div>

      <nav className="flex justify-between text-xs text-[var(--pg-dim)]">
        <span className="font-pixel text-[0.6rem] text-[var(--pg-green)]">
          insert coin
        </span>
        <a
          className="pixel-btn pixel-btn--ghost text-[0.55rem]"
          href="/organizer"
        >
          Organizers → login
        </a>
      </nav>

      {/* hero */}
      <header className="grid items-center gap-6 sm:grid-cols-[140px_1fr]">
        <ArcadeCabinet className="pixelated mx-auto h-40 w-auto drop-shadow-[6px_6px_0_rgba(0,0,0,0.6)]" />
        <div className="space-y-4">
          <h1 className="font-pixel text-lg leading-relaxed text-[var(--pg-ink)] sm:text-xl">
            Your agent handles the checkout
            <span className="pg-blink text-[var(--pg-green)]">_</span>
          </h1>
          <p className="text-sm text-[var(--pg-dim)]">
            Agent-native ticketing: every ticket is discoverable and buyable by
            an agent via <span className="text-[var(--pg-green)]">MCP</span>{" "}
            (ACP and x402 on the way). Stripe payments, automatic .ics reminder.
          </p>
          <div className="flex flex-wrap gap-3">
            <a className="pixel-btn text-[0.6rem]" href="#connect">
              ▶ Connect agent
            </a>
            <a
              className="pixel-btn pixel-btn--magenta text-[0.6rem]"
              href="#events"
            >
              ★ Browse events
            </a>
          </div>
        </div>
      </header>

      {/* connect / MCP */}
      <section id="connect" className="space-y-2">
        <p className="font-pixel text-[0.6rem] text-[var(--pg-cyan)]">
          # connect your agent (Claude, etc.)
        </p>
        <pre className="pixel-box pixel-box--green overflow-x-auto p-4 text-xs text-[var(--pg-green)]">
          {MCP_SNIPPET}
        </pre>
      </section>

      {/* live activity */}
      <section className="space-y-2">
        <p className="font-pixel text-[0.6rem] text-[var(--pg-magenta)]">
          # live activity
        </p>
        <div className="pixel-box p-4">
          <LiveTicker />
        </div>
      </section>

      {/* upcoming events */}
      <section id="events" className="space-y-3">
        <p className="font-pixel text-[0.6rem] text-[var(--pg-yellow)]">
          # upcoming events
        </p>
        <Suspense fallback={<p className="text-[var(--pg-dim)]">$ loading…</p>}>
          <UpcomingEvents />
        </Suspense>
      </section>

      <Suspense fallback={<p className="text-[var(--pg-dim)]">$ loading…</p>}>
        <SiteFooter />
      </Suspense>
    </main>
  );
}
