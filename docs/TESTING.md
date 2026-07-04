# Testing the platform

End-to-end test playbook for OpenTicket: every surface (web, MCP, CLI), both
payment paths (agent wallet off_session and hosted Stripe Checkout), all in
Stripe **test mode** — no real money.

## 0. One-time setup

```bash
pnpm install
# .env: STRIPE_SECRET_KEY=sk_test_...  DATABASE_URL=...  AUTH_SECRET=<32+ chars>
#       RESEND_API_KEY optional (empty → emails print to console)
pnpm db:push          # apply schema (Drizzle → Postgres/Supabase). NEVER db:generate.
pnpm db:seed          # 1 organizer + events + ticket types + the demo API key
```

Seeded credentials:
- Organizer login: `demo@onconcat.com` / `demo1234`
- Agent API key (buy-scoped, test): `ot_live_demo_key_solo_para_test`

## 1. Automated gate — one command

```bash
pnpm harness
```
Runs lint → unit → integration → build → boots the server on :3210 → curls the
whole agent-native surface → `agent:race`. Everything green = the platform is
healthy. `FAIL` = a code problem; `BLOCKED` = a config item you must provide.

Unit-only, fast: `pnpm test` (125 tests, includes the wallet matrix).

## 2. Run a server to poke by hand

```bash
pnpm dev              # http://localhost:3000  (MCP at /api/mcp)
```

## 3. Manual test matrix

### 3.1 Discovery endpoints (no auth)
```bash
curl -s localhost:3000/api/events | jq '.events[0]'
curl -s localhost:3000/llms.txt
curl -s localhost:3000/openapi.json | jq '.info'
curl -sN localhost:3000/api/ticker           # SSE stream
```

### 3.2 Organizer web (human)
1. `http://localhost:3000/organizer` → sign in with the seeded creds.
2. Create an event manually, **or** `/organizer/import` → paste a Luma/Eventbrite
   URL → review the pre-filled draft (title, date, venue, image) → set quota.
3. Publish. It now shows on the landing and in `/api/events`.
   - Guide: `/organizer/guide`.

### 3.3 Agent purchase via the wallet (autonomous, no browser) ⭐
```bash
# load the agent's wallet once (Stripe test customer + saved card)
pnpm tsx scripts/load-wallet.ts                 # --pm pm_card_chargeDeclined to test declines

# the agent buys — pick a tt_id from /api/events, then:
curl -s -X POST localhost:3000/api/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'authorization: Bearer ot_live_demo_key_solo_para_test' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"buy_ticket",
       "arguments":{"event_id":"evt_...","ticket_type_id":"tt_...","quantity":1,
       "buyer_email":"agent@test.com","idempotency_key":"t-001",
       "spend_limit":{"amount_minor":500000,"currency":"USD"}}}}'
```
Expected: `status:"confirmed"`, `paid:true`, a ticket `code`, `ics_path`, no
`checkout_url`. Re-run with the **same** `idempotency_key` → `duplicate:true`, no
second charge. `--pm pm_card_chargeDeclined` → `payment_failed`, inventory released.

### 3.4 Agent purchase via hosted checkout (no wallet)
Use an API key **without** a wallet → `buy_ticket` returns `pending_payment` +
`checkout_url`. Open it, pay with test card `4242 4242 4242 4242` (any future
expiry/CVC/ZIP). Forward the webhook so the ticket issues:
```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook   # paste whsec_ into .env
```
Then `get_order` / the `/orders/<id>` page flips to confirmed.

### 3.5 Agent race (inventory safety)
```bash
MCP_URL=http://localhost:3000/api/mcp AGENTS=3 pnpm agent:race
```
N agents fight for the last ticket; exactly one wins, the rest bounce `sold_out`.

### 3.6 CLI (`otick` / `npx otick`)
```bash
cd ../otick && npm run build
OPENTICKET_BASE_URL=http://localhost:3000 node dist/bin.js events
node dist/bin.js login                      # browser flow (or paste the demo key)
node dist/bin.js buy <tt_id> --limit 50USD --email agent@test.com
node dist/bin.js watch                      # live ticker in the terminal
```
Once published: `npx otick ...` (defaults to `https://open-ticket.onconcat.com`).

## 4. Test cards & payment methods (Stripe test mode)

| Scenario | Hosted card | Wallet `--pm` |
|---|---|---|
| Success | `4242 4242 4242 4242` | `pm_card_visa` |
| Declined | `4000 0000 0000 0002` | `pm_card_chargeDeclined` |
| 3DS / auth required | `4000 0025 0000 3155` | `pm_card_authenticationRequired` |

## 5. Public / hosted testing

Not deployed yet. To test on `https://open-ticket.onconcat.com` needs the D1
deploy: Vercel project + Supabase prod + `NEXT_PUBLIC_APP_URL` + the Stripe
webhook endpoint pointed at the domain. The CLI and skills already default to
that domain, so they light up the moment it deploys.
