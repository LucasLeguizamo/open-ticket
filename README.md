# OpenTicket

**Your agent handles the checkout.**

OpenTicket is an agent-native ticketing platform: every ticket is discoverable and purchasable by an AI agent — not just by a human clicking "buy". An agent finds the event, pays within the user's spending limit via Stripe, gets the ticket issued, and the buyer receives an email with a calendar invite (`.ics`) with reminders. No scraping, no browser automation, no human in the loop.

```
$ your-agent: "get me a ticket for the jazz night on Friday, up to $50"
  ✓ search_events("jazz")        → evt_a1b2 · Jazz Night · $35
  ✓ buy_ticket(spend_limit: $50) → pending_payment · checkout_url
  ✓ payment confirmed            → ticket tkt_9f8e · .ics sent to your inbox
```

## Buy tickets with your agent (MCP)

Point any MCP client (Claude, or your own agent) at the server:

```json
{
  "mcpServers": {
    "openticket": { "url": "https://<host>/api/mcp" }
  }
}
```

| Tool | What it does |
|---|---|
| `search_events` | Find published events with ticket types, prices, and remaining availability |
| `get_ticket` | Inspect a ticket type before buying |
| `buy_ticket` | Purchase within a `spend_limit`; returns `pending_payment` + a Stripe `checkout_url` |
| `get_order` | Poll order status; returns tickets and the `.ics` link once confirmed |
| `set_reminder` | Schedule an email reminder with a `.ics` (24h and 1h alarms) |

Rules of the road for agents:

- **Idempotency:** you generate the `idempotency_key` and reuse it on every retry — retries return the same order, never a double charge.
- **Spending limits:** `buy_ticket` requires a `spend_limit` (amount + currency). Purchases above it are rejected with `mandate_exceeded` *before* any charge.
- **Structured errors:** `sold_out`, `mandate_exceeded`, `invalid_intent`, `event_unavailable`, `payment_failed` — machine-readable, safe to branch on.
- Discovery tools are open; `buy_ticket` requires an API key (`Authorization: Bearer`).

## Discovery without MCP

| Endpoint | Purpose |
|---|---|
| `GET /api/events` | Public JSON feed: published events, ticket types, prices (minor units), live availability |
| `GET /llms.txt` | Plain-text instructions for agents that don't speak MCP ([llmstxt.org](https://llmstxt.org)) |
| `GET /openapi.json` | OpenAPI 3.1 spec of the public endpoints |
| `GET /api/ticker` | Live activity stream (SSE), PII-free |

## For organizers

Create an event with ticket types, prices, and quotas; publish it; done — your tickets are instantly purchasable by every agent that speaks MCP, with zero integration work on your side. Flat 5% platform fee, same for human and agent sales. Inventory is enforced atomically in the database: no overselling, even with dozens of agents racing for the last ticket.

## How it works

```
agent ──MCP──▶ ┌─────────────────────────────────────────────┐
web   ──UI───▶ │ PurchaseCore (framework-free, core/)         │
               │ idempotency → spend limit → atomic reserve   │──▶ Stripe hosted checkout
               │ → order → [webhook] → issue → email + .ics   │
               └─────────────────────────────────────────────┘
```

One purchase pipeline, thin adapters per rail. Live today: **MCP** and **web**. On the roadmap behind the same adapter: **ACP** (OpenAI/Stripe Agentic Commerce Protocol), **x402** (HTTP 402 / stablecoin), **AP2** (mandates as verifiable credentials).

## Development & self-hosting

Contributor setup, test harness, and architecture notes: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Product spec lives in [PRD.md](PRD.md) and [docs/](docs/).

## License

[MIT](LICENSE)
