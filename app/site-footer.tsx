/**
 * Rich site footer — the whole agent-native surface in one place: endpoints,
 * MCP tools, install/config, organizer links, project. Arcade-skinned.
 * Async (reads headers() for the real origin) → render inside <Suspense>.
 */
import { headers } from "next/headers";

const SKILLS_CMD = "npx skills add LucasLeguizamo/openticket-skills --copy";

export async function SiteFooter() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "openticket.dev";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;

  const endpoints: [string, string][] = [
    ["MCP server", "/api/mcp"],
    ["Events feed (JSON)", "/api/events"],
    ["Live ticker (SSE)", "/api/ticker"],
    ["llms.txt", "/llms.txt"],
    ["OpenAPI 3.1", "/openapi.json"],
    ["Subscribe (POST)", "/api/newsletter/subscribe"],
    ["Ticket .ics", "/r/{orderId}"],
  ];
  const tools = [
    "search_events",
    "get_ticket",
    "buy_ticket",
    "get_order",
    "set_reminder",
  ];
  const organizers: [string, string][] = [
    ["Upload guide", "/organizer/guide"],
    ["Import from URL", "/organizer/import"],
    ["Dashboard / login", "/organizer"],
    ["Agent docs", "/agents"],
  ];
  const project: [string, string][] = [
    ["open-ticket (repo)", "https://github.com/LucasLeguizamo/open-ticket"],
    ["otick CLI (repo)", "https://github.com/LucasLeguizamo/otick"],
    [
      "openticket-skills",
      "https://github.com/LucasLeguizamo/openticket-skills",
    ],
  ];

  const heading = "mb-3 font-pixel text-[0.6rem]";
  const link = "text-[var(--pg-dim)] hover:text-[var(--pg-green)]";

  return (
    <footer className="pixel-box mt-4 space-y-6 p-6 text-xs">
      {/* connect line */}
      <div className="space-y-1 border-b-2 border-[var(--pg-line)] pb-4">
        <p className="font-pixel text-[0.6rem] text-[var(--pg-green)]">
          # connect an agent
        </p>
        <p className="break-all text-[var(--pg-dim)]">
          MCP (streamable HTTP):{" "}
          <span className="text-[var(--pg-cyan)]">{origin}/api/mcp</span>
        </p>
        <p className="break-all text-[var(--pg-dim)]">
          or install the skills:{" "}
          <span className="text-[var(--pg-green)]">{SKILLS_CMD}</span>
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-4">
        <div>
          <p className={`${heading} text-[var(--pg-cyan)]`}># endpoints</p>
          <ul className="space-y-1">
            {endpoints.map(([label, href]) => (
              <li key={href}>
                <a className={link} href={href}>
                  {label}
                </a>
                <span className="block text-[0.68rem] text-[var(--pg-line)]">
                  {href}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className={`${heading} text-[var(--pg-green)]`}># mcp tools</p>
          <ul className="space-y-1 text-[var(--pg-dim)]">
            {tools.map((t) => (
              <li key={t}>
                <span className="text-[var(--pg-green)]">▸</span> {t}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[0.68rem] text-[var(--pg-line)]">
            errors: sold_out · mandate_exceeded · invalid_intent
          </p>
        </div>

        <div>
          <p className={`${heading} text-[var(--pg-yellow)]`}># organizers</p>
          <ul className="space-y-1">
            {organizers.map(([label, href]) => (
              <li key={href}>
                <a className={link} href={href}>
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className={`${heading} text-[var(--pg-magenta)]`}># project</p>
          <ul className="space-y-1">
            {project.map(([label, href]) => (
              <li key={href}>
                <a className={link} href={href}>
                  {label}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[0.68rem] text-[var(--pg-line)]">
            MIT · open source
          </p>
        </div>
      </div>

      <p className="border-t-2 border-[var(--pg-line)] pt-4 font-pixel text-[0.5rem] leading-relaxed text-[var(--pg-dim)]">
        openticket v0.1 · rails: mcp ✓ · web ✓ · acp/x402/ap2 ⧗
      </p>
    </footer>
  );
}
