# PRD: OpenTicket — Agent-Native Ticketing Platform

**Status:** Draft
**Version:** 1.0
**Owner:** Lucas (lucasleguizamo21@gmail.com)
**Fecha:** 2026-07-01

---

## 1. Problem Statement

Las plataformas de tickets actuales (Luma, Eventbrite) están diseñadas para que un **humano** haga clic en "comprar". Con la llegada de agentes de IA que compran en nombre del usuario (ChatGPT Instant Checkout, Perplexity Comet, Copilot), los tickets que no son legibles ni comprables por un agente quedan **fuera del nuevo canal de venta**. OpenTicket es una plataforma tipo Luma donde cada ticket es nativamente comprable por un agente vía protocolos de agentic commerce, pagado con Stripe, y donde el agente agenda automáticamente el recordatorio al usuario.

**Por qué ahora:** ACP (OpenAI/Stripe) y AP2 (Google/Coinbase) se estandarizaron en 2025; Juniper proyecta ~$8B de gasto agéntico en 2026 → $1.5T en 2030. La ventana de ser "el ticketing agent-first" está abierta.

**Positioning (norte: frontpage.sh):** *"Your agent handles the checkout."* El agente es el **protagonista**, no un canal más: descubre, compra y agenda. La web humana es mínima (vitrina + ticker en vivo). Pago **Stripe-first** (humanos y agentes con tarjeta / ACP), con **x402/USDC opcional** para agentes cripto. Marca dev-native / estética CLI, con **ticker público en tiempo real** y **digest por email**.

---

## 2. Goals & Success Metrics

| Goal | Métrica | Target | Timeframe |
|---|---|---|---|
| Validar el canal agéntico (protagonista) | % de ventas cerradas por un agente | ≥40% de tx | 6 meses post-launch |
| Prueba social / ticker | Eventos de actividad mostrados en vivo | Ticker público en v1 | v1 |
| Retención por digest | Suscriptores al digest / open rate | ≥30% open | 3 meses |
| Compatibilidad de protocolo | Rails de agente vivos (MCP + Stripe core; x402 stretch) + feed ACP publicado + conformance ACP contra mock oficial | 1-2 rails vivos + feed | v1 (multi-rail incremental tras el adapter) |
| Liquidez de dos lados | Organizadores activos / eventos publicados | 50 org / 200 eventos | 6 meses |
| Monetización | GMV y take-rate efectivo | Take-rate ≥ 5% | 6 meses |
| Fricción del recordatorio | % de compras con .ics entregado y abierto | ≥ 70% | 3 meses |

---

## 3. Non-Goals (v1)

- App móvil nativa (web responsive primero).
- Reventa / mercado secundario de tickets.
- Streaming o gestión de eventos online (solo emisión y venta).
- Recordatorios por WhatsApp / push (parkeado → §11).
- Onboarding de pagos locales Mercado Pago para humanos (parkeado → §11).

---

## 4. User Personas

| Persona | Rol | Dolor | Job-to-be-done |
|---|---|---|---|
| **Aria — Agente de IA** ⭐ *(protagonista)* | ChatGPT/Claude comprando por el usuario | No puede descubrir ni cerrar la compra de un ticket de forma programática y confiable | "Encontrar el ticket correcto, pagar con el mandato del usuario, confirmar y agendar" |
| **Camila — Organizadora** | Crea eventos (conferencias, fiestas, workshops) en LATAM | Sus tickets no aparecen ni se venden dentro de asistentes de IA | "Publicar un evento y que los agentes lo compren, sin integrar nada yo misma" |
| **Lucas — Usuario final** | Le pide a su agente que le consiga entradas | Compra manual + se olvida del evento | "Que mi agente compre y me deje el recordatorio por email/.ics" |
| **Dev integrador** | Construye su propio agente/bot | No hay API/feed estándar de tickets | "Consumir un feed y un endpoint de checkout que ya hablen ACP/MCP/x402" |

> La web humana es **mínima** (vitrina de evento + ticker + digest). El grueso de la UX y del GMV pasa por Aria y el Dev integrador.

---

## 5. User Stories

```
US-001  Crear evento
As a organizadora, I want to crear un evento con fechas, venue y tipos de ticket
so that pueda empezar a vender.
AC:
  - [ ] Formulario: título, descripción, fecha/hora, venue, imagen, tipos de ticket (nombre, precio, cupo)
  - [ ] Página pública del evento con URL corta
  - [ ] Estado draft/publicado
Priority: Must | Effort: M

US-002  Emitir ticket ACP-compatible
As a plataforma, I want to exponer cada tipo de ticket como producto en un feed ACP
so that un agente pueda descubrirlo y comprarlo.
AC:
  - [ ] Product feed (schema ACP) por evento
  - [ ] Endpoints ACP: checkout_session create / update / complete
  - [ ] Inventario/cupo decrementado atómicamente al confirmar pago
Priority: Must | Effort: L

US-003  Comprar como agente vía MCP propio
As a agente MCP (Claude, etc.), I want to usar tools buy_ticket y set_reminder
so that pueda cerrar la compra y agendar el recordatorio.
AC:
  - [ ] MCP server con tools: search_events, get_ticket, buy_ticket, set_reminder
  - [ ] buy_ticket respeta límite de gasto (mandate) y devuelve confirmación + .ics
Priority: Must | Effort: L

US-004  Pagar con Stripe
As a comprador (humano o agente), I want to pagar de forma segura
so that reciba el ticket.
AC:
  - [ ] Stripe PaymentIntent / Instant Checkout
  - [ ] Webhook de confirmación → emite ticket + dispara recordatorio
  - [ ] Manejo de fallo/timeout con reintento idempotente
Priority: Must | Effort: M

US-005  Recibir recordatorio por email (.ics)
As a usuario final, I want to recibir un email con el ticket y un .ics
so that el evento quede en mi calendario.
AC:
  - [ ] Email transaccional con QR/código del ticket + adjunto .ics válido (RFC 5545)
  - [ ] .ics con alarma (VALARM) 24h y 1h antes
Priority: Must | Effort: S

US-006  Autorización de gasto del agente (mandate)
As a usuario, I want to que mi agente compre solo dentro de un límite
so that no gaste de más.
AC:
  - [ ] Soporte AP2 Mandates (Intent/Cart/Payment) verificables
  - [ ] Límite por monto, merchant y vigencia
Priority: Should | Effort: L

US-007  Pago agent-to-agent / micropago (x402)
As a dev/agente, I want to pagar por acceso al feed o cerrar compra en stablecoin
so that funcione sin tarjeta.
AC:
  - [ ] Endpoint con HTTP 402 + facilitador x402
Priority: Could | Effort: L

US-008  Dashboard del organizador
As a organizadora, I want to ver ventas, asistentes y qué % vino por agentes
so that entienda mi canal.
AC:
  - [ ] Métricas por evento; export CSV de compradores
  - [ ] Split de ventas humano vs agente
Priority: Should | Effort: M
```

---

## 6. Functional Requirements

1. **Gestión de eventos:** CRUD de eventos, tipos de ticket, cupos, estados (draft/publicado/agotado).
2. **Feed de productos ACP:** cada tipo de ticket serializado según el esquema del [Agentic Commerce Protocol](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol) (Apache 2.0), servido por evento y global.
3. **Endpoints ACP de checkout:** crear/actualizar/completar sesión de compra según spec ACP, para que ChatGPT Instant Checkout y clientes ACP cierren la compra.
4. **MCP server propio:** tools `search_events`, `get_ticket`, `buy_ticket`, `set_reminder` (transport JSON-RPC 2.0).
5. **Rail AP2:** aceptar Mandates (Intent, Cart, Payment) como W3C Verifiable Credentials; validar límites antes de cobrar.
6. **Rail x402:** endpoints machine-payable (HTTP 402) para micropago/acceso a feed y compra en stablecoin.
7. **Rail MPP (Machine Payments Protocol, Stripe+Tempo):** stub tras el `AgentCommerceAdapter` (feature flag, no implementado en v1). Es un rail 402 redundante con x402; la "capa de abstracción común" que este punto imaginaba ya es el propio adapter (§9). *(Corregido: el PRD lo llamaba "Merchant Payments Protocol" — ver docs/protocol-audit.md.)*
8. **Pagos Stripe:** PaymentIntents, webhooks idempotentes, emisión post-confirmación. Stripe es el procesador único de fiat en v1.
9. **Emisión de ticket:** genera ticket único (QR/código), valida cupo atómicamente, previene overselling.
10. **Recordatorio:** email transaccional + `.ics` (RFC 5545, con VALARM) tras cada compra; tool `set_reminder` para el flujo agéntico.
11. **Autenticación:** cuentas de organizador; los compradores agénticos operan por mandate/API key, sin cuenta obligatoria.
12. **Dashboard + reportes:** ventas, split humano/agente, export CSV.
13. **Ticker público en vivo:** feed en tiempo real de actividad (compras/emisiones, con evento y "comprado por agente"), en landing y como stream consumible (SSE/websocket). Sin datos personales del comprador.
14. **Digest por email:** resumen periódico opt-in (eventos nuevos, drops, actividad del ticker). Mismo canal transaccional que el recordatorio.
15. **Landing dev-native / estética CLI:** home minimalista con vibe CLI, snippet de integración (feed ACP / tool MCP / endpoint x402) visible para devs y agentes.

---

## 7. Non-Functional Requirements

- **Consistencia de inventario:** cupo decrementado en transacción atómica; cero overselling bajo concurrencia (constraint de DB, no lógica de app).
- **Idempotencia:** todo webhook de pago y llamada de compra debe ser idempotente (idempotency key).
- **Seguridad:** validar y firmar mandates; nunca ejecutar contenido de agentes como instrucciones; secretos de Stripe/keys fuera de logs; rate-limit por API key.
- **Trust boundary:** tratar entradas de agentes/feed como datos no confiables (input validation estricta en endpoints ACP/MCP).
- **Performance:** checkout agéntico p95 < 2s (excl. red del agente).
- **Disponibilidad:** 99.9% en endpoints de compra.
- **Accesibilidad:** web de organizador y página de evento WCAG 2.2 AA básica.
- **Cumplimiento:** PCI manejado por Stripe (no tocar PAN); GDPR/Habeas Data (Colombia Ley 1581) para datos de compradores.

---

## 8. UX / Flow Notes

**Flujo agéntico (núcleo):**
1. Agente descubre ticket vía feed ACP o `search_events` (MCP).
2. Agente crea sesión de checkout (ACP) o llama `buy_ticket` (MCP) con el mandate del usuario.
3. Plataforma valida mandate + cupo → crea Stripe PaymentIntent → confirma.
4. Webhook Stripe → emite ticket → envía email + `.ics` → devuelve confirmación al agente.
5. Agente (o la plataforma) agenda recordatorio.

**Edge cases:**
- Cupo agotado entre descubrimiento y pago → error `sold_out`, sin cargo.
- Mandate excede límite → rechazo `mandate_exceeded` antes de cobrar.
- Pago exitoso pero email falla → ticket queda emitido; reintento de envío + link de recuperación.
- Doble compra por reintento del agente → idempotency key evita doble cargo/emisión.
- Evento cancelado por organizador → reembolso vía Stripe + notificación.

**Empty states:** organizador sin eventos → CTA "Crear tu primer evento"; agente sin resultados → feed vacío estructurado.

---

## 9. Technical Constraints

- **Stripe sí o sí:** ACP está codesarrollado por Stripe. Como Stripe tiene disponibilidad limitada en Colombia, la **cuenta de cobro se abre vía entidad US/pais soportado o Stripe Connect** (decisión legal/fiscal → §10). Es la condición para tener compatibilidad nativa con Instant Checkout.
- **Multi-rail con capa de abstracción:** NO integrar cada rail end-to-end por separado. Definir un **`AgentCommerceAdapter` interno** (interfaz común: `resolveIntent → authorize → capture → fulfill`) y escribir un adaptador delgado por protocolo. Ajustes tras la auditoría de protocolos (docs/protocol-audit.md):
  - **Dos modos de capture:** `hosted` (Stripe Checkout link — web y MCP, v1) e `inline_spt` (Shared Payment Token delegado, requerido por ACP `/complete` — solo para conformance, fase posterior). El "Instant Checkout nativo" NO existe en v1.
  - **AP2 no es un rail paralelo sino un overlay de autorización:** separar el eje autorización (`ap2_mandate`) del eje settlement (`stripe` / `x402` / `mpp`).
  - **ACP es stateful** (sesión create/update/complete): el adapter no puede asumir un `run()` one-shot.
- Stack sugerido: Next.js (App Router) en Vercel + Postgres (Supabase) + Stripe. MCP server como servicio aparte (Node).
- `.ics` generado server-side (RFC 5545).
- Inventario con constraint de unicidad/contador en DB, no locks de aplicación.

---

## 10. Open Questions

| # | Pregunta | Owner | Due |
|---|---|---|---|
| 1 | ¿Entidad legal para Stripe (US LLC vs Stripe Connect vs partner)? | Lucas | Antes de dev de pagos |
| 2 | ~~¿MPP tiene spec pública estable?~~ **CERRADA:** existe y es estable (Machine Payments Protocol, Stripe+Tempo) pero es redundante con x402 → stub tras el adapter, fuera de los rails must de v1. | — | ✅ 2026-07-01 |
| 3 | ¿Impuestos sobre tickets en LATAM (IVA por país)? | Lucas | Antes de launch |
| 4 | ~~¿Quién firma el mandate AP2?~~ **CERRADA:** el usuario firma con clave hardware-backed de su dispositivo vía el cliente del agente. OpenTicket es el merchant: genera el Cart Mandate y verifica, no firma. | — | ✅ 2026-07-01 |
| 5 | ¿Reembolsos: política y ventana? | Lucas | Antes de launch |

---

## 11. Out of Scope / Future Considerations (parkeado, no descartado)

- **Mercado Pago** como pasarela para compradores humanos locales (LATAM).
- **Recordatorios por WhatsApp** (fuerte en LATAM) y push web.
- **MCP de calendario directo** (Google Calendar / Apple EventKit) además del `.ics`.
- App móvil, check-in con QR en puerta, mercado secundario, precios dinámicos.
- SaaS al organizador y micropagos M2M como líneas de ingreso adicionales.

---

## 12. Release Plan

**Modelo de negocio:** take-rate **plano ~5% agnóstico de canal**. Cobrar más por venta agéntica sabotea el canal que queremos volver dominante; el premium va en datos, distribución y hosting del adapter ("adapter as a service"), nunca en *permitir* la compra agéntica. *(Corregido — ver docs/ceo-vision.md.)*

> ⚠️ **Nota de scope (PM):** elegiste "multi-rail completo en v1". Es potente pero de varios meses y multiplica el riesgo. Recomendación: mantener el objetivo multi-rail **pero detrás del `AgentCommerceAdapter`**, liberando rails de forma incremental sin rehacer el core. El plan de abajo lo refleja.

| Fase | Contenido | Kill switch |
|---|---|---|
| **F0 — Fundaciones** | Modelo de datos (con fixes de seguridad: idempotency key scoped + `processed_stripe_event`), `AgentCommerceAdapter`, Stripe + webhooks idempotentes, emisión de ticket, `.ics` por email | Feature flag por rail |
| **F1 — MCP + show** *(demo mínima viable)* | US-001, US-003 (buy_ticket / set_reminder), US-004, US-005 + **ticker en vivo, landing CLI** (FR 13, 15) | MCP server on/off |
| **F1.5 — TestBuyerAgent** | Harness agente-comprador para CI + escena del pitch (3 agentes, último ticket) | — |
| **F2 — x402 (stretch) + ACP** | US-007 + US-002 como feed publicado + conformance contra mock oficial (compra real vía ChatGPT fuera de scope: allowlist OpenAI) | por-rail toggle |
| **F3 — AP2 overlay + dashboard** | US-006 (mandates como overlay de autorización) + US-008 + digest email (FR 14) | AP2 toggle |
| **F4 — MPP stub** | Adaptador MPP tras flag, sin implementación | por-rail toggle |

**Rollout:** beta cerrada con 3-5 organizadores + un agente propio de prueba (clonar/adaptar patrón `brightdata/ticket-hunter-agent` para el lado comprador) antes de abrir el feed público.

---

## Referencias (agentic commerce, del research)

- ACP — github.com/agentic-commerce-protocol/agentic-commerce-protocol (OpenAI/Stripe, Apache 2.0)
- Stripe Instant Checkout — stripe.com/newsroom/news/stripe-openai-instant-checkout
- AP2 — cloud.google.com (Google + Coinbase, Mandates como Verifiable Credentials)
- x402 — coinbase.com developer platform (HTTP 402, stablecoin M2M)
- Ticket Hunter Agent — github.com/brightdata/ticket-hunter-agent (patrón agente-comprador de tickets)
- Calendar/Reminder MCP — guinacio/mcp-google-calendar, FradSer/mcp-server-apple-events
