# Design: Tech Stack — OpenTicket

**Status:** Propuesta para confirmar
**Version:** 0.1
**Relacionado:** [PRD.md](../PRD.md), [agent-commerce-adapter.md](./agent-commerce-adapter.md), [data-model.md](./data-model.md)

> Principio: **un repo, un deploy, TypeScript de punta a punta.** Next.js en Vercel
> ya hospeda la web humana, los endpoints ACP, el webhook de Stripe y el MCP server
> (streamable HTTP) en el mismo proyecto. No partir en microservicios hasta que la
> escala lo pida.

---

## 1. Stack propuesto

| Concern | Elección | Por qué | Descartado (y por qué) |
|---|---|---|---|
| Lenguaje | **TypeScript** en todo | Tipos compartidos entre web, ACP, MCP y schemas de tools | — |
| Framework / deploy | **Next.js (App Router) en Vercel** | Web + API routes + webhooks + MCP en un solo deployable. Fluid Compute corre Node completo | Backend aparte (Express/Nest) = otro servicio que mantener sin necesidad aún |
| DB | **Postgres (Supabase)** | El modelo necesita CHECK constraints + UPDATE condicional (inventario atómico). Supabase suma Auth y Realtime | Mongo (no encaja con constraints de inventario) |
| Acceso a datos | **Drizzle ORM** | SQL-first: deja escribir el `UPDATE ... WHERE issued+reserved+qty <= quota` tal cual, sin pelear con el ORM | Prisma (esconde el SQL crudo que acá es el core) |
| Pagos | **Stripe** (Connect + Checkout hospedado + webhooks) | Decisión ya tomada (ACP/Instant Checkout). Connect = payout por organizador (data-model Q1). Checkout link = pago hospedado (adapter Q1) | — |
| Ticker en vivo | **Supabase Realtime** sobre `ticker_event` → SSE al cliente | La tabla append-only ya existe; Realtime empuja cambios sin websocket propio | Socket server propio = infra extra |
| Email + `.ics` | **Resend** + `.ics` a mano (~30 líneas) | DX dev-native, buen deliverability, plantillas React (react-email). VCALENDAR/VEVENT/VALARM generado server-side sin dependencia (Q2) | SMTP propio / SES (más setup); lib `ics` (dependencia para algo trivial) |
| Auth organizador | **Supabase Auth** (magic link email) | Ya viene con la DB. Agentes NO usan sesión: entran por API key / mandate | Auth propio (reinventar) |
| MCP server | **@modelcontextprotocol/sdk** montado como route handler (streamable HTTP) en el mismo Next | Un solo deploy; tools `buy_ticket`/`set_reminder`/`get_order` comparten el core con ACP | Servicio MCP separado (fase posterior, si hace falta aislarlo) |
| ACP | Route handlers Next que implementan el spec ACP (feed + checkout) | Mismo `PurchaseCore` que MCP; solo cambia el adapter | — |
| Jobs (barrido de reservas, digest) | **Vercel Cron** | El sweep de `pending_payment` vencidas (data-model §4) y el digest son cron simples | Worker/queue dedicado (over-engineering para v1) |
| UI | **Tailwind + shadcn/ui** | Rápido, estética CLI/dev lograble con tipografía mono + layout minimalista | Component lib pesada |
| Validación | **Zod** | Un schema Zod por tool/endpoint → valida input de agentes (trust boundary, PRD §7) y deriva los JSON Schema de las tools MCP | Validación a mano |

---

## 2. Forma del repo (un solo Next app)

```
open-ticket/
├─ app/
│  ├─ (marketing)/          # landing CLI, ticker en vivo, páginas de evento
│  ├─ dashboard/            # organizador: crear evento, ventas, split humano/agente
│  ├─ api/
│  │  ├─ acp/               # endpoints ACP (feed, checkout session)
│  │  ├─ mcp/               # MCP server (streamable HTTP)
│  │  ├─ stripe/webhook/    # confirma pago → fulfill
│  │  └─ ticker/            # SSE stream desde Supabase Realtime
├─ core/                    # PurchaseCore + AgentCommerceAdapter (compartido por ACP y MCP)
│  ├─ purchase.ts           # pipeline fijo: resolveIntent→reserve→authorize→capture→fulfill
│  ├─ rails/                # acp.ts, mcp.ts, (ap2.ts, x402.ts, mpp.ts en fases)
│  ├─ inventory.ts          # reserva/confirma/libera atómico
│  ├─ tickets.ts, reminders.ts, email.ts, ics.ts
├─ db/                      # schema Drizzle + queries
├─ lib/                     # zod schemas, stripe client, supabase client
```

- **El `core/` no sabe de HTTP.** ACP y MCP son adaptadores delgados que llaman a `core`. Es literalmente el diseño del adapter doc.

<!-- ponytail: sin monorepo/turborepo, sin packages/. Un solo app hasta que un
     segundo deployable (p.ej. MCP aislado o app móvil) lo justifique. Extraer
     después es barato porque el core ya está desacoplado del transporte. -->

---

## 3. Servicios externos (cuentas a abrir)

| Servicio | Para | Plan inicial |
|---|---|---|
| Vercel | hosting + cron | Hobby/Pro |
| Supabase | Postgres + Auth + Realtime | Free → Pro |
| Stripe | pagos + Connect | pago por transacción |
| Resend | email transaccional + digest | Free (3k/mes) |

Fase posterior: Coinbase/x402 SDK (rail cripto), WhatsApp Business API (recordatorio LATAM).

---

## 4. Lo que NO entra en v1 (parkeado)

- **Turborepo / monorepo** — un solo app basta.
- **MCP como servicio separado** — vive dentro de Next hasta que necesite aislamiento/escala.
- **Redis / colas** — Vercel Cron cubre los jobs; no hay carga que amerite una queue.
- **x402 / AP2 SDKs** — rails de fase posterior (feature flag ya previsto en el adapter).
- **CDN/infra custom** — Vercel lo da.

---

## 5. Decisiones resueltas (2026-07-01)

| # | Decisión | Implicación |
|---|---|---|
| Q1 | **Supabase** (Postgres + Auth + Realtime) | Realtime alimenta el ticker, Auth cubre organizadores, un solo proveedor. MCP de Supabase ya conectado en esta sesión → provisioning directo |
| Q2 | **`.ics` a mano** (~30 líneas) | Cero dependencia; `core/ics.ts` genera VCALENDAR/VEVENT/VALARM (RFC 5545) |
| Q3 | **Terminal animada real** en la landing | Más esfuerzo de front (typing animation / comandos). El ticker se muestra dentro del "terminal". Riesgo: que no sea gimmick — mantenerla funcional (comandos reales que muestran eventos/compras), no decorativa |

<!-- ponytail: la única elección "no perezosa" fue Q3 (terminal animada vs mono/minimal).
     El usuario la pidió explícita: se construye. Contenerla a un componente aislado
     (TerminalHero) para que su complejidad no se filtre al resto del front. -->

### Nota de esfuerzo (Q3)
La terminal animada es el único componente con esfuerzo de front no trivial. Acotarlo:
- Un solo componente `TerminalHero` (typing + stream del ticker vía SSE).
- Comandos "reales" que reflejan datos vivos (`> otick feed`, `> otick buy evt_…`), no texto hardcodeado, para que sea prueba social y no decorado.
- Degradar a estático sin JS (accesibilidad / no-JS).
