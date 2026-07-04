# Protocol Audit — Agentic Commerce Rails (OpenTicket v1)

**Autor:** Especialista en Protocolos de Agentic Commerce
**Fecha:** 2026-07-01
**Alcance:** Auditar madurez real vs vaporware de los 5 rails que exige el PRD (§6, §9): ACP, MCP, AP2, x402, MPP. Validar la interfaz del `AgentCommerceAdapter` (`docs/agent-commerce-adapter.md`). Responder Open Questions 2 y 4.
**Convención:** `[HECHO]` = verificado contra spec/SDK/doc oficial con link. `[SUPOSICIÓN]` = inferencia razonada, no confirmada al 100%.

---

## 0. Hallazgo que rompe el PRD (leer primero)

**El PRD llama al 5º rail "MPP = Merchant Payments Protocol". Ese protocolo no existe con ese nombre.**

`[HECHO]` El estándar real es **MPP = *Machine* Payments Protocol**, co-autorado por **Stripe + Tempo**, lanzado el **18 de marzo de 2026**, spec pública en `mpp.dev`, integrable vía la **PaymentIntents API de Stripe** ([Stripe blog](https://stripe.com/blog/machine-payments-protocol), [Openfort comparison](https://www.openfort.io/blog/agentic-payments-landscape)). Es un rail de pago máquina-a-máquina (flujo 402 challenge → credential → receipt, extendido a MCP), **funcionalmente solapado con x402**, NO una "capa de abstracción de merchant para ser agnóstico de protocolo".

Consecuencia directa: la §6.7 y §9 del PRD confunden dos cosas distintas:
1. La **capa de abstracción interna** que quieren → *ya es* el `AgentCommerceAdapter`. No hace falta un protocolo externo para eso.
2. **MPP-real** → es un rail de settlement más, redundante con x402 para un caso de ticketing.

Esto responde de entrada la Open Question 2 (ver §3). El PM tenía razón en sospechar.

---

## 1. Tabla veredicto por rail

| Rail | Madurez | Esfuerzo integración | Demo-able en hackathon | Gotchas concretos |
|---|---|---|---|---|
| **MCP** (propio) | `[HECHO]` **Spec estable + SDK maduro**. `@modelcontextprotocol/sdk` ≥1.26.0, Streamable HTTP es el transporte por defecto desde mar-2025; `vercel/mcp-handler` lo envuelve en un route handler de Next.js. | **S/M** | ✅ **SÍ, hoy, con Claude**. Es el rail más listo. | `[HECHO]` Usar `@modelcontextprotocol/sdk@1.26.0` mínimo (versiones <1.26.0 tienen CVE). Route dinámico `app/api/[transport]/route.ts` exportando GET/POST/DELETE. SSE deprecado. |
| **ACP** (OpenAI/Stripe) | `[HECHO]` **Spec estable, versionada** (`2026-04-17`), Apache 2.0, OpenAPI + JSON-Schema, **incluye conformance test suite + mock server** (Agentic Checkout y Delegate Payment). | **L/XL** | ⚠️ **Parcial**. Los 5 endpoints + feed se demo-ean contra el **mock/conformance server**. Aparecer en ChatGPT Instant Checkout **NO es demo-able sin allowlist de OpenAI**. | `[HECHO]` (1) Onboarding a Instant Checkout = **aplicación en `chatgpt.com/merchants`**, onboarding manual "rolling basis", conformance checks previos. (2) `[HECHO]` **OpenAI está reduciendo el Instant Checkout standalone** y empujando checkout merchant-owned → el "comprar dentro de ChatGPT" puede no estar disponible. (3) Pago vía **delegated Shared Payment Token inline en `/complete`**, NO redirect hospedado (choca con la decisión Q1 del doc, ver §2). |
| **x402** (Coinbase) | `[HECHO]` **Maduro y self-service**. Repo `coinbase/x402`, **x402 Foundation** bajo Linux Foundation (2-abr-2026), facilitador CDP de Coinbase gratis (free tier 1.000 tx/mes) en Base/Solana/Stellar, testnet **Base Sepolia** con USDC. | **M** | ✅ **SÍ**. Testnet abierta, sin allowlist. Buen demo "pago cripto del agente". | `[HECHO]` Settlement onchain (USDC), NO pasa por Stripe. Requiere wallet/facilitador. Para tickets fiat es un canal secundario, no el core. |
| **AP2** (Google/Coinbase) | `[HECHO]` **Spec pública, v0.2.0 (abr-2026)**, contribuida a **FIDO Alliance** (26-may-2026). Ref. impls: **Python (mayoritaria)**, TypeScript, Kotlin, Go. Mandates = **W3C Verifiable Credentials**. | **L** | ⚠️ **Stub/parcial recomendado**. Verificación de VC es real pero costosa; la TS ref impl es menos madura que Python. | `[HECHO]` **No mueve dinero por sí solo**: es una capa de *autorización* (mandates) sobre un rail de settlement (Stripe/x402). El **usuario firma** con clave hardware-backed de su dispositivo; OpenTicket **verifica**, no firma (ver Q4, §3). Implica implementar verificación de VC (aunque hay libs). |
| **MPP** (Stripe/Tempo) | `[HECHO]` **Spec pública y estable** (`mpp.dev`, lanzado 18-mar-2026), pero **mal nombrado en el PRD** ("Merchant" ≠ "Machine") y **redundante con x402** (mismo flujo 402). | **M** (si se hace) / **XL** (como se imaginó) | ⚠️ **Stub tras el adapter**. No aporta nada nuevo sobre x402 para ticketing. | `[HECHO]` No es una capa de abstracción de merchant (eso es tu adapter). Su ángulo útil: **fiat-sobre-402 vía Stripe PaymentIntents** — es la única razón para tocarlo, y aun así es fase tardía. |

**Resumen de madurez:** MCP y x402 = **verdes** (spec estable + SDK + sin allowlist). ACP = **spec verde pero canal amarillo** (allowlist + pivote de OpenAI). AP2 = **amarillo** (real pero pesado, mejor overlay que rail). MPP = **amarillo/rojo de scope** (existe, pero mal entendido y redundante → stub).

Ningún rail es *vaporware técnico*. El riesgo real no es "no existe", es **scope y dependencias externas** (allowlist de OpenAI, verificación VC, redundancia MPP/x402).

---

## 2. Validación de la interfaz del adapter

La interfaz propuesta (`docs/agent-commerce-adapter.md` §2-3): `resolveIntent → authorize(reserva cupo + valida pago) → capture(cobra) → fulfill(emite+ics)`, con `RailAdapter` cubriendo solo `resolveIntent / authorizePayment / capturePayment / formatResult`.

**Veredicto: la forma general aguanta, pero hay 3 mismatches concretos con los specs reales que hay que corregir.**

### Mismatch 1 — ACP no es one-shot; es una sesión con estado `[HECHO]`
El core asume un pipeline de una sola pasada: `run(rawRequest, adapter)`. Pero ACP define **5 endpoints stateful** que el agente (ChatGPT) maneja como servidor tuyo:

```
POST /checkout_sessions                     # crear (201 con cart autoritativo)
POST /checkout_sessions/{id}                # actualizar (items/fulfillment)
GET  /checkout_sessions/{id}                # estado autoritativo
POST /checkout_sessions/{id}/complete       # aplica pago + CREA orden
POST /checkout_sessions/{id}/cancel         # abandona
```
(verificado en `spec/2026-04-17/openapi/openapi.agentic_checkout.yaml`)

`resolveIntent` no mapea a una llamada: mapea a **crear/mutar una sesión que vive entre requests**. `fulfill` ocurre recién en `/complete`.

**Corrección:** el `RailAdapter` de ACP debe poder **mantener estado de sesión** y llamar al núcleo (`reserveInventory` en create, `authorize`+`capture`+`fulfill` en `/complete`). Añadir al contrato un modo "sesión" además del modo "one-shot" (MCP). No forzar ACP dentro de un único `run()`.

### Mismatch 2 — El "pago hospedado async" (decisión Q1 del doc) NO es ACP-compliant `[HECHO]`
El doc decide para v1: `authorize` reserva cupo + devuelve **checkout_url de Stripe hospedado**; cobro por webhook. Eso está bien **para MCP** (controlás el cliente). Pero **ACP/Instant Checkout NO redirige**: el comprador nunca sale de ChatGPT; el pago se completa **inline en `/complete` con un delegated Shared Payment Token** (Delegate Payment spec). Un `checkout_url` hospedado **rompe la conformance de ACP**.

**Corrección:** `capture` no puede ser uniformemente "hospedado-async". Definir **dos modos de capture** explícitos en el adapter:
- `hosted_async` → MCP (link Stripe + webhook). Válido y simple para el hackathon.
- `inline_delegated` → ACP (recibir Shared Payment Token en `/complete`, crear PaymentIntent y confirmar sincrónicamente antes de responder 200 con la orden).

Esto ya lo intuye el comentario ponytail del doc, pero el texto de la nota Q1 lo da por universal y no lo es.

### Mismatch 3 — AP2 no es un rail paralelo; es un *overlay de autorización* `[HECHO]`
En la tabla §4 del doc, AP2 aparece como columna hermana de ACP/x402 con su propio `capturePayment`. Pero AP2 **no liquida dinero**: produce mandates firmados (VCs) que *autorizan* un cobro que igual ocurre en **Stripe o x402**. Es decir, AP2 **compone** con un rail de settlement; no es uno.

**Corrección:** separar dos ejes en el modelo:
- **Eje autorización:** `none | spend_limit_local | ap2_mandate`. AP2 vive acá: se consume en `authorizePayment` (verificar VC + límites).
- **Eje settlement:** `stripe_hosted | stripe_inline | x402 | mpp`. El cobro real.

Así `authorize` puede ser `ap2_mandate` **y** `capture` ser `stripe_inline`, sin duplicar rails. Esto también deja MPP como un settlement backend alternativo (fiat-over-402 vía Stripe), no un 5º checkout.

### Lo que SÍ está bien
- `[HECHO]` La idea núcleo (idempotency key en todo el pipeline; `reserveInventory/issueTickets/sendEmailWithIcs/scheduleReminder` fuera de los rails) es correcta y aguanta los 5 protocolos.
- El modelo de error tipado (§5) mapea limpio a los códigos HTTP de ACP y a los `isError` de MCP.
- La regla "nunca cargo sin ticket" es correcta y compatible con el `/complete` de ACP (que crea la orden en la misma llamada del cobro).

**Interfaz corregida (resumen):**
```
RailAdapter {
  mode: "one_shot" | "session"           // NUEVO: ACP=session, MCP=one_shot
  authorization: "none" | "spend_limit" | "ap2_mandate"   // NUEVO eje
  settlement: "stripe_hosted" | "stripe_inline" | "x402" | "mpp" // NUEVO eje
  resolveIntent / authorizePayment / capturePayment / formatResult
}
```

---

## 3. Respuestas a Open Questions

### Q2 — ¿MPP tiene spec pública estable para v1, o stub tras el adapter?

**Respuesta: la spec existe y es estable, pero el PRD la malinterpreta. → Implementar como STUB tras el adapter en v1; opcionalmente reencuadrarlo como settlement backend fiat-over-402 en fase tardía.**

Evidencia:
- `[HECHO]` MPP = **Machine Payments Protocol** (no "Merchant"), Stripe + Tempo, **18-mar-2026**, spec pública en `mpp.dev`, ~100 proveedores integrados al lanzamiento (Browserbase, DoorDash, Nubank, Ramp, Revolut) ([Stripe](https://stripe.com/blog/machine-payments-protocol), [Openfort](https://www.openfort.io/blog/agentic-payments-landscape), [Crossmint](https://www.crossmint.com/learn/agentic-payments-protocols-compared)).
- `[HECHO]` Es un rail de pago M2M con flujo **402 challenge → credential → receipt** + modelo "sessions" (pre-autorización + micropagos en stablecoin y fiat). **Solapa fuertemente con x402.**
- `[SUPOSICIÓN]` Para un producto de **ticketing** (compras discretas de monto medio, no streaming de micropagos), MPP no aporta sobre x402 + Stripe. Su único ángulo diferencial útil sería fiat-sobre-402 vía Stripe PaymentIntents, y eso es optimización, no v1.
- **La "capa agnóstica de merchant" que el PRD §6.7/§9 pide de MPP ya la provee el `AgentCommerceAdapter`.** No se necesita un protocolo externo para cumplir ese objetivo.

**Acción:** corregir el PRD (renombrar y reencuadrar MPP), sacarlo de la definición de "4 rails must" de v1, dejarlo como toggle stub en F4.

### Q4 — ¿Quién firma/emite el mandate del usuario en AP2?

**Respuesta: lo firma el USUARIO, con una clave hardware-backed en su dispositivo, a través del cliente del agente (su wallet). OpenTicket es el MERCHANT: genera el Cart Mandate (propone carrito+precio) y VERIFICA las firmas — NO firma la autorización del usuario.**

Evidencia `[HECHO]` ([AP2 spec](https://ap2-protocol.org/specification/), [Google Cloud](https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol), [Arthur Chiao guide](https://arthurchiao.art/blog/ap2-illustrated-guide/)):
- **Human-present (Cart Mandate):** lo *genera el merchant*, lo *firma el usuario* con clave hardware-backed en su dispositivo → prueba no-repudiable de intención sobre items+precio exactos.
- **Human-not-present (Intent Mandate):** el *usuario firma por adelantado* con restricciones (price cap, ventana temporal, allowlist de merchants, spec de item). El agente opera sin aprobación adicional hasta cumplir condiciones.
- **Payment Mandate:** derivado, subconjunto mínimo (referencia hasheada del método de pago, monto, flag human-present/not-present) que ingiere el risk engine del emisor. No expone PII.
- Cada mandate es un **W3C Verifiable Credential** firmado; contribuido a FIDO Alliance (may-2026).

**Implicación para OpenTicket:**
1. OpenTicket **no** custodia claves ni firma en nombre del usuario. Genera el Cart Mandate y **verifica** VCs entrantes (firma + validez del mandate + límites) en `authorizePayment`.
2. `[SUPOSICIÓN]` No hace falta implementar verificación de VC a mano: apoyarse en las **ref. impls de AP2** (Python es la más madura; TS existe pero menos). Para un stack Next.js/Node, evaluar la ref. TS o exponer un microservicio Python de verificación. Coincide con "el `spend_limit` sale del mandate" (decisión Q2 del doc del adapter) — correcto.
3. Esto valida el diseño del doc: AP2 se consume en `authorize`, no en `capture`.

---

## 4. Recomendación de secuencia (para el hackathon)

**Orden recomendado: MCP → Stripe core → x402 → (ACP conformance) → AP2 overlay → MPP stub.**

1. **MCP primero (F2 antes que el ACP de F1).** `[HECHO]` Es el único rail **100% demo-able hoy con Claude**, sin allowlist, con SDK maduro (`vercel/mcp-handler` + `@modelcontextprotocol/sdk`) y un route handler de Next.js. El pago hospedado (link Stripe + webhook) del doc funciona tal cual acá. **Es tu demo ganador: "tu agente cierra la compra y agenda el .ics".**
2. **Stripe core + emisión + .ics** (F0). Base de todo; todos los rails terminan acá salvo x402.
3. **x402 en Base Sepolia.** `[HECHO]` Self-service, testnet abierta, facilitador CDP gratis → segundo demo fuerte ("pago cripto del agente") sin depender de nadie.
4. **ACP: construir los 5 endpoints + feed y validarlos contra el conformance/mock server.** `[HECHO]` Construí la conformance (es un estándar que querés cumplir), pero **no cuentes con "comprar dentro de ChatGPT" para la demo**: requiere aplicación/allowlist de OpenAI (rolling, manual) y `[HECHO]` OpenAI está de-priorizando el Instant Checkout standalone. Demo = "somos ACP-conformant" contra el mock, no una compra real en ChatGPT.
5. **AP2 como overlay de autorización** sobre Stripe/x402 (no como rail nuevo). Verificación de mandates; fase posterior.
6. **MPP: stub tras el adapter.** Redundante con x402 para v1 (ver Q2).

**Por qué este orden minimiza riesgo:** los dos primeros demos (MCP, x402) no dependen de aprobaciones externas y se ven espectaculares en vivo. ACP aporta el sello de estándar (feed + endpoints + conformance) sin bloquear la demo en la allowlist de OpenAI. AP2/MPP quedan detrás de feature flags sin tocar el core (como ya prevé el §12 del PRD).

---

## 5. Referencias (verificadas)

**ACP:**
- [github.com/agentic-commerce-protocol/agentic-commerce-protocol](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol) — spec `2026-04-17`, Apache 2.0, OpenAPI + JSON-Schema, conformance suite + mock server
- [Stripe — Build ACP checkout endpoints (specification)](https://docs.stripe.com/agentic-commerce/protocol/specification)
- [Stripe — Agentic Commerce Protocol overview](https://docs.stripe.com/agentic-commerce/acp)
- [OpenAI — Buy it in ChatGPT / Instant Checkout](https://openai.com/index/buy-it-in-chatgpt/) · [chatgpt.com/merchants](https://chatgpt.com/merchants/) (aplicación merchant)
- [Rye — OpenAI scales back ChatGPT Checkout](https://rye.com/blog/openai-chatgpt-checkout-agentic-commerce) (pivote a merchant-owned)

**MCP:**
- [github.com/modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) · [npm @modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
- [github.com/vercel/mcp-handler](https://github.com/vercel/mcp-handler) · [npm mcp-handler](https://www.npmjs.com/package/mcp-handler) (≥1.26.0 requerido)
- [Next.js — MCP guide](https://nextjs.org/docs/app/guides/mcp)

**AP2:**
- [ap2-protocol.org/specification](https://ap2-protocol.org/specification/) · [github.com/google-agentic-commerce/AP2](https://github.com/google-agentic-commerce/AP2)
- [Google Cloud — Announcing AP2](https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol)
- [An Illustrated Guide to AP2 (mandate signing)](https://arthurchiao.art/blog/ap2-illustrated-guide/)

**x402:**
- [github.com/coinbase/x402](https://github.com/coinbase/x402) · [Coinbase CDP x402 docs](https://docs.cdp.coinbase.com/x402/welcome)
- [Cloudflare — x402 Foundation (Linux Foundation)](https://blog.cloudflare.com/x402/)

**MPP:**
- [Stripe — Introducing the Machine Payments Protocol](https://stripe.com/blog/machine-payments-protocol) (`mpp.dev`)
- [Openfort — MPP, x402, ACP & AP2 compared](https://www.openfort.io/blog/agentic-payments-landscape) · [Crossmint — protocols compared](https://www.crossmint.com/learn/agentic-payments-protocols-compared)
