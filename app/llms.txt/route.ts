/**
 * llms.txt (README step 3, llmstxt.org format) — how an agent that does NOT
 * speak MCP discovers and buys on OpenTicket. Route handler (not a static file)
 * so URLs use the real host of each environment (preview/prod), no placeholder.
 */
export function GET(req: Request): Response {
  const origin = new URL(req.url).origin;
  const body = `# OpenTicket

> Agent-native ticketing: every ticket is discoverable and buyable by an AI
> agent. Payments via Stripe (hosted checkout). "Your agent handles the checkout."

## Discovery
- [Events feed (JSON)](${origin}/api/events): published events + ticket types with price (minor units), ISO 4217 currency and available quota.
- [Live ticker (SSE)](${origin}/api/ticker): public activity stream, no PII.
- [OpenAPI 3.1](${origin}/openapi.json): spec of the public endpoints.

## Buying via MCP (recommended)
- MCP server (streamable HTTP): ${origin}/api/mcp
- Tools: search_events, get_ticket, buy_ticket, set_reminder.
- buy_ticket returns pending_payment + checkout_url (Stripe). Check the status with get_order.
- ALWAYS retry with the same idempotency_key (you, the client, generate it).
- Structured errors: sold_out, mandate_exceeded, invalid_intent.

## Notes
- Honor the user's spend_limit in buy_ticket.
- Discovery GETs require no auth. Buying may require an API key once the public feed opens up.
`;
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=3600",
    },
  });
}
