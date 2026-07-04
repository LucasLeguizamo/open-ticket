# Síntesis — Revisión de 4 especialistas (arquitecto, tester, CEO, protocolos)

**Fecha:** 2026-07-01
**Fuentes:** [architecture-review.md](./architecture-review.md) · [test-strategy.md](./test-strategy.md) · [ceo-vision.md](./ceo-vision.md) · [protocol-audit.md](./protocol-audit.md)

---

## 1. Convergencias (señal fuerte: llegaron solos a lo mismo)

1. **MCP primero.** Arquitecto (ruta crítica del demo) y protocolos (único rail verde, demo-able HOY con Claude, sin allowlist) coinciden: la demo del hackathon es MCP `buy_ticket`, no ACP.
2. **La jugada OSS es el adapter, no la plataforma.** Arquitecto (core framework-free en `core/` con `ports.ts`, extraíble con `git mv`) y CEO (librería standalone `@openticket/agent-commerce-adapter`, Apache 2.0, `npx create-agent-commerce`) diseñaron lo mismo sin verse.
3. **El test-harness es material de demo.** Tester (`TestBuyerAgent` con output CLI) y CEO (momento WOW = agente comprando en vivo) se complementan: el caso "3 agentes pelean el último ticket, 1 gana" es a la vez test de concurrencia y escena del pitch.
4. **Inventario atómico: aprobado por todos.** UPDATE condicional + CHECK constraint. Tester agrega el cómo probarlo (Postgres real, nunca mock, `Promise.all` de 50-100 compras → exactamente 1 venta).

## 2. Conflictos resueltos

| Conflicto | Posiciones | Resolución |
|---|---|---|
| **x402: ¿stub o rail?** | Arquitecto: stub tras flag. Protocolos: verde, testnet Base Sepolia, facilitador CDP gratis, esfuerzo M | **Stretch goal.** MCP + Stripe primero; x402 como segundo rail SI sobra tiempo (suma mucho al pitch: Linux Foundation, pago cripto en vivo) |
| **Checkout hosted vs inline** | Arquitecto detectó la contradicción Q1 (hosted link) vs §4 (PaymentIntent inline). Protocolos confirma: `checkout_url` hosted NO es ACP-compliant (ACP cobra inline con Shared Payment Token en `/complete`) | **Dos modos de capture en el adapter:** `hosted` (web + MCP, v1) e `inline_spt` (solo para conformance ACP, fase posterior). Aceptar que "Instant Checkout nativo" no existe en v1 y decirlo en el PRD |
| **ACP en F1** | PRD pone ACP en F1. Protocolos: canal amarillo — allowlist manual de OpenAI + OpenAI de-priorizando Instant Checkout standalone | **ACP baja a "conformance contra mock server"** (la suite oficial existe). El feed ACP se publica igual (es barato y da credibilidad de protocolo), pero la compra real vía ChatGPT no es meta del hackathon |
| **Take-rate premium agéntico** | PRD §12: cobrar más por venta agéntica. CEO: eso sabotea el canal que quieres volver dominante | **Take-rate plano ~5%.** El premium va en datos/distribución/hosting del adapter, nunca en permitir la compra |

## 3. Correcciones obligatorias antes de escribir código

1. **Seguridad (arquitecto):** `idempotency_key` no puede ser UNIQUE global — un agente podría leer la orden de otro comprador. Fix: `UNIQUE (rail, buyer_email, idempotency_key)`.
2. **Idempotencia de webhook (arquitecto):** falta tabla `processed_stripe_event` + UPDATE condicional como lock de emisión. Sin esto, doble emisión de tickets bajo reentrega de Stripe.
3. **Interfaz del adapter (protocolos):** 3 fixes — (a) ACP es stateful (create/update/complete), no cabe en `run()` one-shot; (b) dos modos de capture (ver arriba); (c) AP2 no es rail paralelo sino **overlay de autorización** → separar eje autorización (`ap2_mandate`) del eje settlement (`stripe`/`x402`).
4. **`spend_limit` autodeclarado (arquitecto):** sin mandate firmado no es control de seguridad. Documentarlo como tal hasta que AP2 entre.
5. **MPP mal nombrado (protocolos):** es *Machine* Payments Protocol (Stripe+Tempo), no "Merchant". Es un rail 402 redundante con x402, no la capa de abstracción del PRD §6.7 (esa ya es el adapter). → Stub. Responde Q2 del PRD.

## 4. Respuestas a preguntas abiertas del PRD (§10)

- **Q2 (¿MPP spec estable?):** existe y es estable, pero redundante con x402 → stub tras el adapter. Sale de los "4 rails must".
- **Q4 (¿quién firma el mandate AP2?):** el usuario, con clave hardware-backed de su dispositivo vía el cliente del agente. OpenTicket es el merchant: genera el Cart Mandate y verifica, no firma.

## 5. Secuencia consolidada (hackathon)

```
F0  Fundaciones: schema Drizzle (+fixes §3.1-3.2) → Stripe test + webhooks idempotentes → emisión + .ics
F1  MCP server (buy_ticket/set_reminder) + ticker Supabase Realtime + landing CLI   ← DEMO MÍNIMA VIABLE
F1.5 TestBuyerAgent (CI + escena del pitch: 3 agentes, último ticket)
F2  x402 (stretch: segundo rail en vivo) + feed ACP + conformance contra mock
F3  AP2 como overlay de autorización · MPP stub · dashboard organizador
```

Sacrificables si aprieta el tiempo: dashboard, digest, ACP conformance. No sacrificables: MCP, ticker, .ics, los 8 tests mínimos del tester.

## 6. Cambios pendientes al PRD (no aplicados aún)

- §6.7: renombrar MPP y degradarlo a stub.
- §12: take-rate plano; fases re-ordenadas (MCP antes que ACP).
- §10: cerrar Q2 y Q4 con las respuestas de arriba.
- §9: documentar los dos modos de capture y el AP2-como-overlay.
