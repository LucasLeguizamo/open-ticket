# OpenTicket — agent-native ticketing

*"Your agent handles the checkout."* Plataforma tipo Luma donde cada ticket es comprable por un agente (MCP hoy; ACP/x402 después). Norte: [frontpage.sh](https://www.frontpage.sh/agents). Contexto completo: [PRD.md](PRD.md) · [docs/SYNTHESIS.md](docs/SYNTHESIS.md).

## Setup local

```bash
pnpm install
cp .env.example .env        # completar: DATABASE_URL, STRIPE_SECRET_KEY (sk_test_), AUTH_SECRET
pnpm db:push                # schema → Postgres
pnpm db:seed                # datos demo
pnpm dev                    # localhost:3000
```

Webhook Stripe local (terminal aparte):

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
# pegar el whsec_... impreso en STRIPE_WEBHOOK_SECRET
```

Verificar: `pnpm test` (unit) · `pnpm test:integration` (Postgres real) · `pnpm agent:race` (3 agentes, último ticket).

Harness de automejora — **una** pasada que corre todo (lint → tests → build → server real → endpoints agent-native → carrera de agentes) y separa FAIL (código roto) de BLOCKED (falta credencial/config externa):

```bash
pnpm harness
```

---

## Ejecución: paquete agent-native (nivel frontpage.sh/agents)

Objetivo: que un agente descubra, entienda y compre sin ayuda humana. Orden por impacto/esfuerzo; cada paso termina con su verificación. Subagentes: usar `ot-protocols` para pasos 2-4, `ot-frontend` para paso 1, `ot-devops` para pasos 6-7.

**Estado (2026-07-03):** pasos 1, 2, 3, 4, 6, 7 ✅ hechos y verificados. Paso 5 (repo `openticket-skills`) pendiente — es un repo aparte, fuera de esta app.

### Paso 1 — Página `/agents` (S)

La vitrina para agentes y devs. Ruta `app/agents/page.tsx`, estética CLI como la landing.

Contenido mínimo:
- URL del MCP server (`https://<dominio>/api/mcp`) + las 4 tools (`search_events`, `get_ticket`, `buy_ticket`, `set_reminder`) con ejemplo de payload.
- Snippet de conexión para Claude/clientes MCP (JSON de configuración copy-paste).
- Links a `/llms.txt`, `/openapi.json`, `GET /api/events`.
- Comando de skills cuando exista el paso 5.

✅ Verificar: la página renderiza y un `curl` a cada URL listada responde.

### Paso 2 — `GET /api/events` (S)

Feed JSON público sin auth: eventos publicados + tipos de ticket + precio + cupo restante. Es el precursor del feed ACP de F2 — mismo query, serialización simple primero.

- Ruta: `app/api/events/route.ts`. Reusar `lib/catalog.ts` (ya tiene el query).
- Sin datos personales. Cache corto (30-60s) — es para descubrimiento, no para checkout.

✅ Verificar: `curl localhost:3000/api/events | jq` devuelve eventos del seed.

### Paso 3 — `llms.txt` (S)

Archivo estático en `public/llms.txt` (o route handler). Formato [llmstxt.org](https://llmstxt.org): qué es OpenTicket, URL del MCP, endpoints públicos, cómo comprar. Agentes que no hablan MCP descubren por acá.

✅ Verificar: `curl localhost:3000/llms.txt` legible y sin URLs rotas.

### Paso 4 — `/openapi.json` (S)

Spec OpenAPI 3.1 de los endpoints públicos (`/api/events`, `/api/ticker`, subscribe del paso 6). Generar desde los schemas Zod existentes (`core/adapter/rails/schemas.ts`) con `zod-to-openapi` — no escribir el spec a mano, se desincroniza.

- Ruta: `app/openapi.json/route.ts`.

✅ Verificar: pegar el output en editor.swagger.io → 0 errores.

### Paso 5 — Repo de skills instalables (M)

Distribución tipo `npx skills add DFectuoso/frontpage-sh-skills`. Repo nuevo `openticket-skills` con:

```
skills/
  openticket-search-events/SKILL.md   # cómo consultar el feed/MCP
  openticket-buy-ticket/SKILL.md      # flujo de compra: mandate, idempotency key, manejo de sold_out
```

Cada SKILL.md le enseña a cualquier agente a usar el MCP sin configuración: URL, tools, errores estructurados (`sold_out`, `mandate_exceeded`), y que el idempotency key lo genera el agente y lo repite en reintentos.

✅ Verificar: `npx skills add <org>/openticket-skills --copy` en un proyecto limpio → Claude compra un ticket de test guiado solo por la skill.

### Paso 6 — Digest subscribe (S)

`POST /api/newsletter/subscribe` público (email + opt-in). Solo guarda el suscriptor (tabla nueva vía `ot-db`); el envío del digest es F3, no bloquea.

- Validación Zod + rate-limit básico (es endpoint público).

✅ Verificar: POST con email válido → 200 y fila en DB; email basura → 400.

### Paso 7 — API keys + rate-limit (M) — antes de abrir el feed público

PRD FR-11. API key simple v1 (hash en DB, header `Authorization: Bearer`), rate-limit por key en los endpoints de compra. Los GET de descubrimiento quedan sin auth.

✅ Verificar: compra MCP sin key → 401; con key → ok; ráfaga sobre el límite → 429.

### Requisito transversal

Todo input de agente pasa por schemas Zod (trust boundary, PRD §7). Ningún paso introduce un endpoint que acepte input sin validar.

## Después de esto

Deploy a Vercel + webhook Stripe de producción + commit inicial del repo (ver agente `ot-devops`), y luego F2 del [PRD](PRD.md): feed ACP formal + conformance + x402 stretch.
