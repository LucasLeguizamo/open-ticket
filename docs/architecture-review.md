# Architecture Review — OpenTicket

**Status:** Review del arquitecto
**Version:** 1.0
**Fecha:** 2026-07-01
**Revisa:** [PRD.md](../PRD.md), [tech-stack.md](./tech-stack.md), [agent-commerce-adapter.md](./agent-commerce-adapter.md), [data-model.md](./data-model.md)

> Veredicto global: el diseño es coherente y bien recortado (los `ponytail` ya
> mataron mucha sobre-ingeniería). Pero hay **una contradicción de fondo** que
> toca el core del pitch, **dos huecos reales de idempotencia/seguridad** no
> resueltos, y **scaffolding multi-rail que no debe construirse para el hackathon**.
> Todo lo demás: aprobado con ajustes menores.

---

## 1. Veredicto por documento

### 1.1 tech-stack.md — **Aprobado con 4 correcciones**

Stack correcto para "un repo, un deploy". Next.js + Supabase + Drizzle + Stripe +
Resend es la elección mínima que cumple. Correcciones concretas:

**C1 — Contradicción con PRD §9 sobre el MCP server (resolver a favor del tech-stack).**
El PRD §9 dice *"MCP server como servicio aparte (Node)"*; el tech-stack lo monta
como route handler dentro de Next. La decisión del tech-stack es la correcta para
el hackathon (un deploy, core compartido). **Acción:** corregir el PRD §9 para que
no contradiga —si no, alguien lo implementa como servicio aparte por seguir el PRD.

**C2 — SSE desde Vercel serverless es una trampa (riesgo concreto, no genérico).**
`api/ticker/` como SSE proxy sobre Supabase Realtime implica conexiones
long-lived en funciones serverless: cuentan tiempo de cómputo facturado y chocan
con límites de duración aun con Fluid Compute. **Recorte:** el navegador se
suscribe **directo** al canal de Supabase Realtime con el cliente JS (anon key,
RLS de solo lectura sobre `ticker_event`). Elimina la ruta `api/ticker/` entera.
La `TerminalHero` consume ese stream client-side. Menos código, cero sockets propios.

**C3 — Vercel Cron no barre reservas cada 15 min en Hobby.** El plan Hobby limita
cron a **1 vez/día**; el sweep de `pending_payment` vencidas (data-model §4, Q2=15min)
necesita frecuencia. **Acción:** (a) **expiración perezosa** — al leer disponibilidad
o al confirmar, tratar como libre cualquier reserva con `expires_at < now()` vía la
propia query condicional; el cron pasa a ser solo limpieza cosmética de estado. Esto
hace el inventario correcto **sin depender de cron**. (b) Si querés el cron real,
requiere plan Pro. Recomiendo (a): no atás la corrección de inventario a un scheduler.

**C4 — Drizzle vs migraciones de Supabase: definir dueño único del schema.** Ambas
herramientas pueden migrar. Si conviven, divergen. **Acción:** Drizzle Kit es el
dueño del schema (`drizzle-kit generate/push`); Supabase es solo el Postgres
gestionado. No usar el editor de tablas de Supabase ni `apply_migration` para DDL
de negocio.

Lo demás del tech-stack (Zod como trust boundary, `.ics` a mano, Resend, contadores
en DB) está bien y alineado con el PRD.

---

### 1.2 agent-commerce-adapter.md — **Aprobado el core; 3 problemas a resolver**

El pipeline fijo `resolveIntent→reserve→authorize→capture→fulfill` con rails
delgados es la abstracción correcta y es, además, **la jugada de protocolo** (ver §2).
Problemas:

**P1 — Contradicción interna: capture async (Q1/§2) vs. capture inline (tabla §4).**
La nota §2 y Q1 dicen que en v1 `capture` es asíncrono: `authorize` crea un
**checkout link de Stripe** y el cobro llega por webhook. Pero la **tabla §4** dice
que ACP y MCP hacen `authorizePayment = Crea Stripe PaymentIntent` y
`capturePayment = Confirma el PaymentIntent` (inline). No pueden ser ambas. En v1
manda Q1 (hosted link). **Acción:** reescribir la tabla §4 para v1 →
`authorizePayment` = reservar cupo + crear Checkout Session (link); `capturePayment`
= **no-op en la request**, lo dispara el webhook. La versión inline con PaymentIntent
queda etiquetada como fase posterior.

**P2 — "ACP nativo / Instant Checkout" en v1 es aspiracional, no real (impacta el pitch).**
ACP Instant Checkout completa el pago **programáticamente** con un shared payment
token: el agente cierra sin que un humano abra un link. El flujo hosted-link de Q1
es lo **opuesto** —requiere que alguien abra `checkout_url` en un navegador. Es
decir: con Q1, el canal 100% headless que vende el PRD (§1, §8) **no existe en v1**.
Es un recorte defendible para el hackathon (evita PCI, se arma en test mode), pero
hay que **decirlo explícito**: en v1 el agente *inicia* la compra y agenda, pero el
*pago* se completa fuera de banda. El demo end-to-end sigue siendo válido y potente;
solo no es "Instant Checkout" literal. **Recomendación:** aceptar el recorte, marcar
ACP-inline como F2, y en el demo usar el mismo hosted checkout para web y MCP (una
sola ruta de pago que probar).

**P3 — Idempotencia de webhook Stripe: no está diseñada (hueco duro, PRD §7 la exige).**
El adapter habla de idempotencia por `order.idempotency_key` (que cubre el reintento
del *agente*), pero **no** cubre el reintento del *webhook de Stripe*. Stripe reentrega
eventos; dos entregas del mismo `checkout.session.completed` pueden emitir tickets dos
veces si `fulfill` no está guardado. **Acción (obligatoria antes de código de pagos):**
1. Tabla `processed_stripe_event (event_id PK, processed_at)`; el handler hace
   `INSERT ... ON CONFLICT DO NOTHING` y si no insertó, sale (ya procesado).
2. El paso emisor de `fulfill` va detrás de un **UPDATE condicional que actúa de lock**:
   `UPDATE order SET status='confirmed' WHERE id=:id AND status='pending_payment'
   RETURNING *` — solo si afectó 1 fila se emiten tickets. Dos webhooks concurrentes:
   uno gana, el otro afecta 0 filas y no emite. Esto es lo que hace "idempotente" la
   transición que §5 del data-model afirma pero no implementa.

**P4 — `idempotency_key` global unique = fuga cross-buyer (trust boundary, riesgo real).**
El `idempotency_key` lo provee el agente y en el data-model es `UNIQUE` global. El
código `duplicate` devuelve *la orden previa*. Si el agente B envía (a propósito o por
colisión) un `idempotency_key` que ya usó el agente A, recibe la **orden de A** (email,
montos, checkout_url). **Acción:** el unique debe ser **compuesto y con scope de
comprador**, ej. `UNIQUE (rail, buyer_email, idempotency_key)`, o indexar sobre un
hash `sha256(rail || buyer_email || key)`. Nunca global.

**P5 — `spend_limit` en MCP es autodeclarado por el agente → no es un control de
seguridad en v1 (ser honesto).** En `buy_ticket` (§6) el `spend_limit` viene del input
del propio agente. Sin un mandate AP2 firmado, el agente puede declarar el límite que
quiera: no protege al usuario, solo documenta intención. **Acción:** mantener el campo
(shape a futuro), pero no venderlo como control. El control real en v1 es que el pago
hosted requiere completar el checkout —el gasto no ejecuta headless de todas formas.
Documentarlo así evita seguridad-teatro.

Trust boundary por lo demás bien encaminado: Zod en cada tool/endpoint, `payment_context`
opaco. Un pendiente: **validar/limitar `buyer_email`** (rate-limit por email, evitar que
el feed se use para enviar `.ics` a direcciones arbitrarias como vector de spam).

---

### 1.3 data-model.md — **Aprobado; el inventario atómico está bien**

**Inventario bajo concurrencia: correcto.** El `UPDATE ... WHERE (issued+reserved+:qty)
<= quota` toma row lock en Postgres y es seguro concurrentemente; el `CHECK
(issued+reserved <= quota)` es la red final. Esta es la parte más delicada del sistema
y está bien resuelta con contadores, sin locks de app ni colas. Aprobado tal cual.

Huecos/ajustes:

**D1 — Falta la tabla de idempotencia de webhooks** (ver P3). Agregar
`processed_stripe_event`.

**D2 — `idempotency_key UNIQUE` global** → cambiar a compuesto con scope de comprador
(ver P4). Es un cambio de constraint, hacerlo ahora.

**D3 — `reminder.ics_url` implica almacenar archivos, y no hay decisión de storage.**
El `.ics` (y el QR del ticket) tienen que vivir en algún lado si se persiste una URL.
**Recorte recomendado:** no persistir. Generar el `.ics` **on-demand** desde una ruta
`GET /r/:order_id.ics` (o `/t/:ticket_id.ics`) que lo renderiza desde la orden/evento.
Cero storage, cero columna `ics_url`. El QR igual: generar en el email/render, no
guardar imagen. Elimina la única dependencia de blob storage no declarada.

**D4 — Colapsar `order_item` en `order` para F0/F1.** El propio ponytail lo marca:
`buy_ticket` es single `ticket_type_id`. Hasta que ACP con carrito multi-tipo aterrice
(F1+), `order` con `ticket_type_id` + `quantity` basta. Reintroducir `order_item` cuando
el carrito ACP sea real. Menos joins, menos código.

**D5 — Semántica `amount_minor` para COP con Stripe (trampa concreta).** Stripe espera
montos en la unidad mínima según su tabla de monedas; para COP el manejo de decimales
no es obvio y un off-by-100 factura 100× de más o de menos. **Acción:** para el demo
del hackathon, **cobrar en USD (test mode)** y dejar COP solo como moneda de *display*.
Elimina el riesgo de FX/decimales en el único flujo que se demostrará.

**D6 — Stripe Connect en Colombia: solo test mode (blocker de producción, no de demo).**
Stripe no soporta cuentas Connect en Colombia; `organizer.stripe_account_id` real no
es obtenible sin entidad en país soportado (PRD §10 Q1 sigue abierto). **Para el
hackathon:** todo en **Stripe test mode** ignora geografía → el demo funciona. Marcar
explícito que la producción real depende de la decisión legal de §10 Q1. No es trabajo
de arquitectura, es de fundación legal.

Estados de `order` (§5) y los índices (§6) están bien. El índice `(status, expires_at)`
sirve tanto al cron como a la expiración perezosa (C3).

---

## 2. Estructura de repo propuesta

Un repo, un deploy, **sin turborepo** (correcto para hackathon). La clave open-source:
mantener `core/adapter` **con cero imports de Next/Vercel/Supabase-runtime** para que
la extracción a paquete sea un `git mv`, no un refactor.

```
open-ticket/
├─ app/
│  ├─ (marketing)/
│  │  ├─ page.tsx                 # landing CLI + TerminalHero (Realtime directo)
│  │  └─ e/[slug]/page.tsx        # página pública de evento
│  ├─ dashboard/
│  │  ├─ page.tsx                 # lista de eventos, split humano/agente
│  │  └─ events/[id]/page.tsx     # ventas, export CSV
│  ├─ r/[orderId]/route.ts        # GET .ics on-demand  (D3)
│  ├─ api/
│  │  ├─ acp/
│  │  │  ├─ feed/route.ts         # product feed ACP (F1)
│  │  │  └─ checkout/route.ts     # sesión ACP → PurchaseCore(acpAdapter)
│  │  ├─ mcp/route.ts             # MCP server streamable HTTP (F2)
│  │  └─ stripe/webhook/route.ts  # dedup event + fulfill  (P3)
│  └─ actions/                    # server actions del dashboard (crear evento…)
│
├─ core/                          # ⚠️ FRAMEWORK-FREE. Candidato #1 a paquete OSS.
│  ├─ adapter/
│  │  ├─ purchase-core.ts         # pipeline fijo run(raw, adapter)
│  │  ├─ types.ts                 # PurchaseIntent, RailAdapter, AgentCommerceError
│  │  ├─ errors.ts                # modelo de error común (adapter §5)
│  │  └─ rails/
│  │     ├─ web.ts                # checkout humano hosted
│  │     ├─ mcp.ts                # buy_ticket / set_reminder
│  │     ├─ acp.ts                # feed + checkout (F1)
│  │     └─ stubs/{ap2,x402,mpp}.ts   # detrás de feature flag, no-op en hackathon
│  ├─ inventory.ts                # reserve / confirm / release (SQL condicional)
│  ├─ tickets.ts                  # emisión + código único
│  ├─ ics.ts                      # VCALENDAR/VEVENT/VALARM (RFC 5545), sin deps
│  ├─ reminders.ts
│  └─ ports.ts                    # interfaces DB/email/payments (inyectadas)
│
├─ db/
│  ├─ schema.ts                   # Drizzle: tablas + CHECK + unique compuesto
│  ├─ queries.ts
│  └─ migrations/                 # drizzle-kit (dueño único del schema, C4)
│
├─ lib/
│  ├─ zod/                        # schemas por tool/endpoint (trust boundary)
│  ├─ stripe.ts                   # cliente + tipos de webhook
│  ├─ supabase.ts                 # cliente (auth + realtime client-side)
│  └─ email/                      # plantillas react-email + Resend
│
├─ components/
│  └─ terminal-hero.tsx           # componente aislado (tech-stack Q3)
└─ drizzle.config.ts
```

**Paquetes extraíbles (la jugada de protocolo, post-hackathon):**

| Paquete | Qué es | Por qué OSS gana |
|---|---|---|
| `@openticket/agent-commerce-adapter` | `core/adapter/` completo: pipeline + `RailAdapter` + modelo de error tipado | **El play principal.** Cualquier merchant adopta la misma interfaz y "habla ACP/MCP/AP2/x402" escribiendo solo `resolveIntent`+`authorize` por rail. Es un protocolo de facto, no una lib de tickets. Requiere que `core/` no toque HTTP ni DB directo → por eso `ports.ts` (dependencias inyectadas). |
| `@openticket/ics` | `core/ics.ts` | `.ics` con VALARM sin dependencias; útil suelto. Extracción trivial. |
| `@openticket/mcp-commerce` | `core/adapter/rails/mcp.ts` + schemas de `buy_ticket`/`set_reminder` | Tools MCP de comercio reutilizables por otros catálogos. |

Para que la extracción sea barata: `core/` recibe DB/email/Stripe como **puertos**
(`ports.ts`), nunca los importa. Es el desacople que ya pide el adapter doc, formalizado.
No crear `packages/` ahora; solo respetar la frontera de imports.

---

## 3. Plan de construcción F0 + F1 (scope hackathon)

Objetivo demoable: **agente compra ticket vía MCP → Stripe test mode → email + `.ics`.**
Priorizar ese hilo end-to-end sobre completitud. Tamaños S/M/L.

### F0 — Fundaciones (secuencial en su mayoría, es la base)

| # | Tarea | Dep | Tam | Paralelo |
|---|---|---|---|---|
| 0.1 | Bootstrap Next + Vercel + Supabase + Drizzle; `drizzle.config` como dueño del schema | — | S | — |
| 0.2 | Schema Drizzle: `organizer, event, ticket_type, order, ticket, reminder, ticker_event, processed_stripe_event` con CHECK inventario + unique compuesto de idempotencia (D2, D1). Sin `order_item` (D4) | 0.1 | M | — |
| 0.3 | `core/ports.ts` + `core/inventory.ts` (reserve/confirm/release con SQL condicional + expiración perezosa, C3) | 0.2 | M | con 0.4 |
| 0.4 | `core/ics.ts` (RFC 5545 + VALARM) + ruta `r/[orderId].ics` on-demand (D3) | 0.1 | S | con 0.3 |
| 0.5 | `core/adapter/`: `PurchaseCore.run`, `types`, `errors` (modelo §5). Rails: solo `web` real; `acp/mcp` esqueleto; ap2/x402/mpp stubs con flag | 0.3 | M | — |
| 0.6 | Stripe test mode: Checkout Session hosted (USD, D5) + `stripe/webhook` con dedup (P3) → `fulfill` | 0.3, 0.5 | M | — |
| 0.7 | `core/tickets.ts` (emisión + código único) + `lib/email` (Resend + react-email) enganchado a `fulfill` | 0.4, 0.6 | M | — |

**Hito F0:** una compra `web` end-to-end (crear orden → reservar → checkout hosted →
webhook → emite ticket → email + `.ics`) funciona en test mode. Es el 80% del riesgo técnico.

### F1 — Core + ACP + show

| # | Tarea | Dep | Tam | Paralelo |
|---|---|---|---|---|
| 1.1 | Auth organizador (Supabase magic link) + CRUD evento/ticket_type (server actions) + página pública `/e/[slug]` | F0 | M | con 1.2 |
| 1.2 | MCP server route handler: `search_events, get_ticket, buy_ticket, get_order, set_reminder` sobre el mismo `PurchaseCore` (adopta el hito F0) | 0.5-0.7 | L | con 1.1 |
| 1.3 | ACP feed + checkout route (hosted, alineado a P1) reusando el core | 0.5-0.7 | M | con 1.1 |
| 1.4 | Ticker: `ticker_event` escrito en `fulfill`; landing `TerminalHero` suscrita a Supabase Realtime directo (C2) | 0.7 | M | con 1.2 |
| 1.5 | Dashboard mínimo: ventas + split humano/agente + export CSV | 1.1 | M | con 1.4 |
| 1.6 | Digest email opt-in (`digest_subscriber`) + Vercel Cron o envío manual para demo | 0.7 | S | con 1.5 |

**Ruta crítica del demo:** 0.1→0.2→0.3→0.5→0.6→0.7→**1.2**. Si el tiempo aprieta,
**1.2 (MCP) es el músculo del pitch**; 1.3 (ACP), 1.5 (dashboard) y 1.6 (digest) son
sacrificables. La landing con ticker (1.4) es el segundo must porque es la prueba social
visible.

**Paralelización clave:** tras F0, dos frentes independientes — (A) agéntico:
1.2 + 1.3 + 1.4; (B) humano/organizador: 1.1 + 1.5 + 1.6. Un dev por frente.

**NO construir en hackathon (recorte explícito):** adapters AP2/x402/MPP reales
(quedan stub tras flag), captura ACP inline con PaymentIntent (P2), `order_item`/carrito
multi-tipo (D4), storage de `.ics`/QR (D3), SSE proxy propio (C2), refunds parciales,
multi-holder, multi-moneda de cobro (D5).

---

## 4. Decisiones que faltan (bloquean código) + recomendación

| # | Decisión abierta | Bloquea | Recomendación |
|---|---|---|---|
| A1 | **ACP: hosted link vs Instant Checkout inline en v1** (P1/P2 — hoy los docs se contradicen) | Diseño de `capture`, schema de salida de `buy_ticket`, ruta de webhook | **Hosted link para web *y* MCP en v1.** Una sola ruta de pago que probar; sin PCI; funciona en test mode. ACP-inline = F2. Actualizar tabla §4 del adapter. |
| A2 | **Idempotencia de webhook Stripe** (P3 — no diseñada) | `stripe/webhook`, tabla nueva, correctitud de emisión | Tabla `processed_stripe_event` (dedup por `event.id`) + `UPDATE order ... WHERE status='pending_payment' RETURNING` como lock de emisión. **Obligatoria antes de tocar pagos.** |
| A3 | **Scope de `idempotency_key`** (P4 — hoy global unique, fuga cross-buyer) | Constraint de `order`, lógica de `duplicate` | `UNIQUE (rail, buyer_email, idempotency_key)`. Cambiar el constraint ahora, es barato hoy y caro después. |
| A4 | **Storage de `.ics` / QR** (D3 — no decidido) | `reminder`/`ticket` schema, email | **On-demand, sin storage.** Ruta que renderiza `.ics` desde `order_id`; QR generado en render. Quitar `ics_url` como columna persistida. |
| A5 | **Moneda de cobro en el demo** (D5 — COP+Stripe = trampa de decimales) | `amount_minor`, integración Stripe | Cobrar en **USD test mode**; COP solo display. Multi-moneda real = post-hackathon. |
| A6 | **Dueño del schema: Drizzle vs Supabase** (C4) | Todo el flujo de migraciones | Drizzle Kit dueño único; Supabase solo hostea Postgres. |
| A7 | **Corrección de inventario: cron vs perezosa** (C3) | `inventory.ts`, dependencia de plan Vercel | Expiración **perezosa** en la query de disponibilidad/confirmación; cron opcional solo cosmético. No atar correctitud al scheduler. |
| A8 | **Frontera de extracción del adapter** (§2 — el play OSS) | Estructura de `core/`, `ports.ts` | Congelar `core/` como framework-free desde el día 1 (dependencias inyectadas). No crear `packages/` aún, pero respetar los imports para que la extracción a `@openticket/agent-commerce-adapter` sea un `git mv`. |

Decisiones del PRD §10 que **no** bloquean código de hackathon (test mode las evade),
pero sí producción: entidad legal Stripe (Q1/D6), IVA LATAM (Q3), política de refunds
(Q5). Dejarlas para post-demo.
