# Development

Local setup for contributors and self-hosters.

```bash
pnpm install
cp .env.example .env        # fill in: DATABASE_URL, STRIPE_SECRET_KEY (sk_test_), AUTH_SECRET
pnpm db:push                # schema → Postgres
pnpm db:seed                # demo data
pnpm dev                    # localhost:3000
```

Local Stripe webhooks (separate terminal):

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
# paste the printed whsec_... into STRIPE_WEBHOOK_SECRET
```

## Verify

One pass — lint, tests, build, a real server, every public endpoint, and a 3-agent race for the last ticket:

```bash
pnpm harness
```

It separates **FAIL** (broken code, exit 1) from **BLOCKED** (missing external credential/config). Piecemeal:

- `pnpm test` — unit tests
- `pnpm test:integration` — inventory concurrency against a real Postgres
- `pnpm agent:race` — N agents race for the last ticket; exactly one wins
- `pnpm lint` / `pnpm lint:fix` — Biome
- `pnpm build:check` — build into `.next-build` (safe while `pnpm dev` is running)

CI ([.github/workflows/ci.yml](../.github/workflows/ci.yml)) runs lint → unit → integration (Postgres 16 service) → build on every push and PR.

## Architecture

The purchase pipeline lives in [core/](../core/) — framework-free TypeScript, extractable as a package. Rails (MCP, web; ACP/x402/AP2 later) are thin adapters over the same `PurchaseCore`. Design docs: [agent-commerce-adapter.md](agent-commerce-adapter.md), [data-model.md](data-model.md), [test-strategy.md](test-strategy.md).
