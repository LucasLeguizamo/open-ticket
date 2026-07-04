# Tarjeta de diseño — Wallet del agente (Stripe TEST off_session)

> Estado: propuesta de arquitectura. **NO** hay código de producción todavía.
> Decisión tomada por Lucas: opción **"Wallet Stripe test off_session"**. No se re-discute el modelo.
> Escalera ponytail aplicada: se reusa `confirmAndIssue` (emisión atómica ya existente), se
> reusa la idempotencia por `(rail, email, key)`, se reusa el pipeline `reserve → … `. Un solo
> método nuevo en `PaymentPort`. Cero abstracciones especulativas.

## 0. Qué es y por qué

El agente tiene una **wallet**: un `Customer` de Stripe (modo TEST) con un `PaymentMethod`
guardado (`pm_card_visa`). Compra **sin browser, sin checkout hosted**: cobramos `off_session`
por API con `paymentIntents.create({ confirm: true, off_session: true })` y, si el cobro sale
`succeeded`, **emitimos los tickets sincrónicamente** en la misma respuesta del tool. El agente
recibe la orden `confirmed` + tickets + `ics_path` en una sola llamada. Es el stand-in TEST del
riel `x402` (settlement por API, no async por webhook).

El flujo **hosted actual queda intacto y sigue siendo el default** para humanos y para agentes
sin wallet. La wallet es un branch, no un reemplazo.

**Regla dura respetada:** `core/` NO importa Stripe. Todo lo Stripe vive en `lib/stripe.ts` y
entra por `PaymentPort`. El guard test-only (`sk_test_`/`rk_test_`) queda intacto y ahora también
protege el cobro off_session.

---

## 1. Modelo de datos — tabla `wallet` (recomendado: tabla nueva, NO columna)

**Recomendación: tabla nueva `wallet`**, no columnas extra en `api_key`.

Razones:
- Separación de concerns: `api_key` es identidad/auth; `wallet` es medio de pago. Meter
  `stripe_customer_id`/`payment_method_id` en `api_key` mezcla dos dominios y contamina la tabla
  de auth con datos de Stripe.
- Una wallet **puede no existir** (mayoría de las keys no tendrán wallet → columnas nullable
  sueltas en `api_key`). La tabla nueva modela mejor "0..1 wallet por key".
- Extensible sin tocar auth: si mañana hay `spend_limit` persistido por wallet, o multiples PMs,
  crece la tabla `wallet`, no `api_key`.

Cardinalidad: **una wallet por agente** → `apiKeyId` es `UNIQUE` (y clave natural de lookup).

```ts
// db/schema.ts (append)
export const wallet = pgTable("wallet", {
  id: text("id").primaryKey(), // wal_...
  apiKeyId: text("api_key_id")
    .notNull()
    .unique() // una wallet por agente
    .references(() => apiKey.id),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  stripePaymentMethodId: text("stripe_payment_method_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

Nota: NO guardamos `spend_limit` en la wallet en v1. El `spend_limit` sigue siendo el declarado
por request (`spend_limit` en `buy_ticket`), igual que hoy — no cambiamos ese eje.

---

## 2. Extensión de `PaymentPort` — `chargeOffSession`

El core define la **firma** (framework-free); `lib/stripe.ts` la **implementa** con el SDK.

```ts
// core/ports.ts (append al PaymentPort)
export interface OffSessionChargeInput {
  orderId: string;
  amountMinor: number;
  currency: string;
  stripeCustomerId: string;
  stripePaymentMethodId: string;
  /** para de-dup en Stripe: reusar orderId como idempotency key del PaymentIntent */
  idempotencyKey: string;
}

export interface OffSessionChargeResult {
  status: "succeeded" | "requires_action" | "failed";
  paymentIntentId: string;
  /** solo presente en requires_action (3DS) */
  clientSecret?: string;
  /** solo en failed: decline_code / mensaje corto para el log/respuesta */
  failureReason?: string;
}

export interface PaymentPort {
  createHostedCheckout(
    input: HostedCheckoutInput,
  ): Promise<{ checkoutUrl: string; sessionId: string }>;

  /** wallet del agente (settlement=wallet_off_session): cobro por API, TEST. Opcional:
   *  solo lo implementa quien soporte wallet. El core verifica su presencia. */
  chargeOffSession?(
    input: OffSessionChargeInput,
  ): Promise<OffSessionChargeResult>;
}
```

`chargeOffSession` es **opcional** en la interfaz para no romper implementaciones existentes de
`PaymentPort` (ponytail: no forzamos a nadie a implementar lo que no usa). El branch wallet del
core valida `if (!this.payments.chargeOffSession) throw not_implemented`.

Implementación en `lib/stripe.ts` (mapeo de estados de Stripe):

```ts
async chargeOffSession(input) {
  const stripe = getStripe(); // GUARD test-only intacto
  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount: input.amountMinor,
        currency: input.currency.toLowerCase(),
        customer: input.stripeCustomerId,
        payment_method: input.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        metadata: { order_id: input.orderId },
      },
      { idempotencyKey: `pi_${input.idempotencyKey}` }, // de-dup a nivel Stripe
    );
    // confirm:true + off_session → normalmente "succeeded" o lanza StripeCardError
    if (pi.status === "succeeded") {
      return { status: "succeeded", paymentIntentId: pi.id };
    }
    if (pi.status === "requires_action") {
      return { status: "requires_action", paymentIntentId: pi.id, clientSecret: pi.client_secret ?? undefined };
    }
    return { status: "failed", paymentIntentId: pi.id, failureReason: pi.status };
  } catch (err) {
    // pm_card_authenticationRequired → StripeCardError con code "authentication_required"
    if (err instanceof Stripe.errors.StripeCardError) {
      const pi = err.payment_intent;
      if (err.code === "authentication_required" && pi) {
        return { status: "requires_action", paymentIntentId: pi.id, clientSecret: pi.client_secret ?? undefined };
      }
      // pm_card_chargeDeclined → declined
      return {
        status: "failed",
        paymentIntentId: pi?.id ?? "",
        failureReason: err.decline_code ?? err.code ?? "card_declined",
      };
    }
    throw err; // errores no-card (red, config) suben; el core hace release + payment_failed
  }
}
```

Detalle Stripe importante: con `off_session:true` un requerimiento de 3DS **NO** vuelve como
`pi.status==="requires_action"` en el happy path — Stripe lanza un `StripeCardError` con
`code: "authentication_required"` que trae el `payment_intent` adjunto. Por eso el mapeo cubre
las dos vías (status directo y excepción). `pm_card_authenticationRequired` cae acá.

---

## 3. Pipeline de compra con wallet en `purchase-core.ts`

### 3.1 Cómo entra la wallet al core sin romper framework-free

El core NO conoce ni Stripe ni la DB, así que **no puede resolver la wallet**. La resuelve `lib/`
(por `apiKeyId`) ANTES de invocar el pipeline y la pasa como **contexto de settlement** ya
resuelto. Dos piezas:

1. Un `RailAdapter` nuevo con `settlement: "wallet_off_session"` (ver §4).
2. Un objeto `walletContext` opaco que el core recibe y reenvía a `chargeOffSession`. El core no
   lo interpreta, solo lo pasa. Se inyecta vía un parámetro extra de `run()`:

```ts
// core/adapter/types.ts
export interface WalletContext {
  stripeCustomerId: string;
  stripePaymentMethodId: string;
}

// core/adapter/purchase-core.ts — run() gana un 2º arg opcional
async run<Raw, Result>(
  raw: Raw,
  adapter: RailAdapter<Raw, Result>,
  ctx?: { wallet?: WalletContext }, // ← nuevo, opcional; hosted no lo usa
): Promise<Result>
```

Esto mantiene `resolveIntent(raw)` puro (no necesita la identidad del agente) y no ensucia el
`PurchaseIntent` con datos de Stripe. La identidad→wallet se resuelve en el borde (`lib`/tool),
que es donde vive la DB.

### 3.2 El branch en `execute()`

Se agrega una rama ANTES del bloque hosted, guardada por el settlement del adapter. El bloque
`reserve → createPendingOrder` (pasos 1–5) se **comparte** con hosted; solo diverge el paso 6.

```
1. idempotencia   findOrderByIdempotency(rail, email, key)   ← reusado
2. catalog + disponibilidad                                   ← reusado
3. spend_limit    enforceSpendLimit(...) → mandate_exceeded    ← reusado (igual que hoy)
4. reserveInventory                                            ← reusado
5. createPendingOrder (rail="mcp", boughtByAgent=true)         ← reusado
6a. HOSTED   → createHostedCheckout → attachCheckout → pending_payment   [DEFAULT actual, intacto]
6b. WALLET   → chargeOffSession → según status:
      succeeded        → handlePaymentSucceeded(order.id, pi.id) INLINE  → confirmed + tickets + ics_path
      requires_action  → expireOrder(order.id,"cancelled") [libera stock] → error payment_action_required
      failed/declined  → expireOrder(order.id,"cancelled") [libera stock] → error payment_failed
```

Puntos clave de la rama 6b:

- **Reusa la emisión atómica.** En `succeeded` NO se escribe una segunda ruta de emisión: se
  llama al **mismo** `handlePaymentSucceeded(orderId, paymentIntentId)` que usa el webhook. Ese
  método hace `confirmAndIssue` (issuance lock: UPDATE condicional `status='pending_payment'` →
  mueve reserved→issued, inserta tickets + ticker + reminder + email). Una sola implementación de
  emisión para hosted y wallet. Cero riesgo de doble emisión (lo cubre el lock).

- **`requires_action` no deja stock colgado.** Antes de devolver el error, `expireOrder(id,
  "cancelled")` transiciona la orden y **libera el reservado** (es idempotente y condicional). En
  TEST v1 NO implementamos el challenge 3DS off_session (no hay UI de agente para completarlo):
  se cancela la orden y se devuelve un error accionable. El `pm_card_authenticationRequired` es un
  caso de test de QA, no un happy path a soportar en v1.

- **`failed`/declined** (`pm_card_chargeDeclined`): `expireOrder(id, "cancelled")` + error
  `payment_failed` con el `failureReason`. Nunca queda inventario reservado.

- **Idempotencia doble capa:**
  - App: `findOrderByIdempotency(rail, email, key)` — un retry con la misma key devuelve la orden
    existente (si ya está `confirmed`, `toResult` la retorna confirmada). Reusado sin cambios.
  - Stripe: `idempotencyKey: pi_<order.id>` en `paymentIntents.create` — dos intentos de cobro de
    la MISMA orden no generan dos PaymentIntents ni dos cargos. Como la clave es el `order.id`
    (único por orden), es estable entre reintentos.

- **`spend_limit`** se respeta EXACTAMENTE como hoy: `enforceSpendLimit` corre en el paso 3, antes
  de reservar y de cobrar. Excede → `mandate_exceeded`. Sin cambios.

### 3.3 Manejo de error post-reserva (paridad con hosted)

Igual que el `catch` del bloque hosted actual (que hace `expireOrder(id,"cancelled")` si falla
`createHostedCheckout`), la rama wallet envuelve `chargeOffSession` y, ante cualquier salida que
no sea `succeeded`, libera el stock vía `expireOrder`. Un error de red/config (no-card) que suba
como excepción también cae en el `catch` → `expireOrder` + `payment_failed`. **Nunca** se orfana
una reserva.

Boceto:

```ts
// dentro de execute(), reemplazando el bloque 6 por un switch de settlement
if (adapter.settlement === "wallet_off_session") {
  if (!this.payments.chargeOffSession || !ctx?.wallet) {
    await this.store.expireOrder(order.id, "cancelled");
    throw new AgentCommerceError("not_implemented", "wallet settlement not available");
  }
  let charge: OffSessionChargeResult;
  try {
    charge = await this.payments.chargeOffSession({
      orderId: order.id,
      amountMinor,
      currency: event.currency,
      stripeCustomerId: ctx.wallet.stripeCustomerId,
      stripePaymentMethodId: ctx.wallet.stripePaymentMethodId,
      idempotencyKey: order.id,
    });
  } catch (err) {
    await this.store.expireOrder(order.id, "cancelled");
    throw new AgentCommerceError("payment_failed", "off_session charge failed", {
      cause: err instanceof Error ? err.message : String(err),
    });
  }

  if (charge.status === "succeeded") {
    // MISMA emisión atómica que el webhook — cero doble emisión (issuance lock)
    await this.handlePaymentSucceeded(order.id, charge.paymentIntentId);
    const confirmed = await this.store.getOrder(order.id);
    return this.toResult(confirmed ?? order, false); // status=confirmed, ics_path set, sin checkout_url
  }
  if (charge.status === "requires_action") {
    await this.store.expireOrder(order.id, "cancelled"); // no dejar stock colgado
    throw new AgentCommerceError("payment_action_required",
      "off_session payment requires 3DS; not supported for wallet in v1",
      { paymentIntentId: charge.paymentIntentId });
  }
  // failed / declined
  await this.store.expireOrder(order.id, "cancelled");
  throw new AgentCommerceError("payment_failed", "card declined off_session",
    { reason: charge.failureReason });
}
// … else: bloque hosted actual, INTACTO
```

Nota sobre `toResult`: cuando `status==="confirmed"` ya devuelve `icsPath = /r/<id>` y
`checkoutUrl = null` (mirar el mapeo actual). No hay que tocar `toResult`. `handlePaymentSucceeded`
además dispara el email + reminder (reusado; sus fallos no hacen rollback, golden rule intacta).

Se necesita un nuevo código de error `payment_action_required` en `AgentCommerceError` (o reusar
`payment_failed` con un flag). Recomiendo **código nuevo** para que QA lo distinga del decline.

---

## 4. Cómo decide `buy_ticket` entre wallet y hosted

**Regla:** el borde (tool MCP / `lib`) resuelve la identidad → wallet ANTES de elegir el adapter.

- El agente se identifica por API key → `verifyApiKeyToken` da `clientId = api_key.id`.
- `lib` hace `getWalletByApiKeyId(clientId)`:
  - **Tiene wallet** → usa `mcpWalletRail` (`settlement: "wallet_off_session"`) y pasa
    `ctx.wallet`. Respuesta **confirmada sincrónica**.
  - **No tiene wallet** → usa `mcpRail` actual (`stripe_hosted`). Respuesta con `checkout_url`
    (comportamiento actual, sin cambios).

### 4.1 El `Rail` a usar — reusar `mcp`, settlement nuevo

**No** se agrega un valor nuevo al enum `Rail`. La wallet **reusa `rail: "mcp"`** — sigue siendo
el canal MCP, solo cambia el **settlement** (que es un eje separado por diseño). Esto respeta el
invariante "un rail se abstrae cuando existe el segundo consumidor": la wallet no es un rail nuevo,
es un settlement nuevo sobre el rail MCP existente.

- `Rail` enum: **sin cambios** (`web|acp|mcp|ap2|x402|mpp`). No se toca `db/schema.ts` railEnum.
- `SettlementScheme`: se agrega `"wallet_off_session"` (nuevo valor del eje settlement). Es el
  stand-in TEST de `x402` — cuando exista x402 real, comparten forma (cobro directo + emisión
  sincrónica), y ahí recién se evaluará unificar.

```ts
// core/adapter/types.ts
export type SettlementScheme =
  | "stripe_hosted"
  | "stripe_inline_spt"
  | "wallet_off_session" // ← nuevo: cobro off_session por API (TEST), emisión sincrónica
  | "x402"
  | "mpp";

// core/adapter/rails/mcp.ts (nuevo adapter, junto al mcpRail actual)
export interface McpWalletBuyResponse extends WebPurchaseResponse {
  paid: true; // marca semántica: pago ya capturado
}

export const mcpWalletRail: RailAdapter<unknown, McpWalletBuyResponse> = {
  rail: "mcp",
  mode: "one_shot",
  authorization: "spend_limit",
  settlement: "wallet_off_session",
  resolveIntent: (raw) => parseBuyTicketInput(raw, "mcp"),
  formatResult: (result) => ({ ...formatPublicResult(result), paid: true }),
};
```

Importante: como ambos adapters usan `rail: "mcp"`, la idempotencia `(rail, email, key)` es
**consistente** aunque el agente cargue la wallet entre dos intentos: el retry encuentra la misma
orden. (No dividimos el espacio de idempotencia por settlement.)

### 4.2 Shape exacto de la respuesta MCP en cada caso

**Con wallet (confirmada sincrónica):**
```json
{
  "status": "confirmed",
  "duplicate": false,
  "order_id": "ord_...",
  "checkout_url": null,
  "expires_at": null,
  "amount": { "amount_minor": 5000, "currency": "USD" },
  "event": { "id": "evt_...", "title": "...", "starts_at": "...", "venue": "..." },
  "tickets": [{ "id": "tkt_...", "code": "ABCD-1234", "status": "valid" }],
  "ics_path": "/r/ord_...",
  "paid": true
}
```

**Sin wallet (hosted actual, sin cambios):**
```json
{
  "status": "pending_payment",
  "duplicate": false,
  "order_id": "ord_...",
  "checkout_url": "https://checkout.stripe.com/...",
  "expires_at": "2026-07-04T18:30:00.000Z",
  "amount": { "amount_minor": 5000, "currency": "USD" },
  "event": { "...": "..." },
  "tickets": [],
  "ics_path": null,
  "poll": "get_order(ord_...)"
}
```

El agente distingue trivialmente: `status === "confirmed"` (+ `tickets` no vacío, `paid: true`)
vs `pending_payment` (+ `checkout_url` + `poll`).

---

## 5. Cargar la wallet ("load wallet")

### 5.1 Recomendado para v1: script operador `scripts/load-wallet.ts`

Es lo más lazy que funciona (ponytail). No necesita UI ni tool nuevo para el demo TEST.

Qué hace:
1. Resuelve la `api_key` demo (por `--key <raw>` o `--label demo`; hashea y busca el `id`).
2. `stripe.customers.create({ metadata: { api_key_id } })` → `customerId`.
3. Adjunta el PaymentMethod de test. Dos formas, elegir la simple:
   - Directo: `stripe.paymentMethods.attach(pm, { customer })` con un PM de test (`pm_card_visa`)
     y luego `customers.update(customer, { invoice_settings: { default_payment_method: pm } })`.
   - Alternativa robusta: `SetupIntent` con `confirm:true, usage:"off_session"` para dejar el PM
     listo para off_session. Para TEST, `attach` alcanza; el `off_session:true` del PaymentIntent
     no exige un SetupIntent previo en modo test con `pm_card_visa`.
4. `INSERT INTO wallet (id, api_key_id, stripe_customer_id, stripe_payment_method_id)`
   (upsert por `api_key_id` para re-ejecutar sin romper el UNIQUE).

Flag `--pm <token>` para probar declines/3DS:
- `--pm pm_card_visa` (default) → succeeded.
- `--pm pm_card_chargeDeclined` → decline en el cobro (QA path `failed`).
- `--pm pm_card_authenticationRequired` → 3DS off_session (QA path `requires_action`).

Guard test-only: el script usa `getStripe()` (mismo guard `sk_test_`). Un `pm_card_*` solo existe
en modo test, así que también protege por construcción.

Firma:
```
pnpm tsx scripts/load-wallet.ts --label demo [--pm pm_card_visa]
# o --key ot_live_xx…  para una key puntual
```

### 5.2 Tool MCP `load_wallet` / CLI `otick wallet load` — DIFERIR

Recomiendo **NO** implementarlo en v1. Justificación:
- Cargar la wallet es una operación de **setup/operador**, no una acción de compra del agente en
  runtime. En TEST la hace Lucas una vez.
- Exponer un tool que crea Customers + adjunta PMs desde el canal MCP agrega superficie de
  seguridad (un agente creando medios de pago) sin payoff para el demo.
- Es agent-native "de verdad" recién cuando haya onboarding self-service de agentes con fondeo
  real — ahí sí un `wallet load` / `wallet fund` tiene sentido. Segundo consumidor inexistente →
  no se abstrae todavía.

Queda anotado como follow-up post-demo. El script cubre el 100% de la necesidad TEST.

---

## 6. Seguridad / consistencia

| Riesgo | Mitigación | Dónde |
|---|---|---|
| **Doble emisión** (dos requests confirman la misma orden) | Issuance lock: `confirmAndIssue` hace UPDATE condicional `status='pending_payment'`; solo 1 gana, el otro es `already_confirmed`. Ya existe. | `StorePort.confirmAndIssue` (reusado vía `handlePaymentSucceeded`) |
| **Doble cobro** (retry del tool) | (a) App: `findOrderByIdempotency(rail,email,key)` corta antes de reservar/cobrar. (b) Stripe: `idempotencyKey: pi_<order.id>` en `paymentIntents.create`. | `purchase-core.execute` + `lib/stripe.chargeOffSession` |
| **Inventario colgado en `requires_action`/`failed`** | Ambos ramos hacen `expireOrder(id,"cancelled")` (libera reserved, idempotente) antes de tirar el error. | `purchase-core.execute` rama 6b |
| **Guard test-only** | Intacto: `chargeOffSession` usa `getStripe()`, que exige `sk_test_`/`rk_test_` salvo `ALLOW_LIVE_STRIPE`. Sin cambios. | `lib/stripe.getStripe` |
| **core importa Stripe** | NO. Firma en `core/ports.ts`, impl en `lib/stripe.ts`, wallet resuelta en el borde y pasada como `ctx.wallet` opaco. `resolveIntent` sigue puro. | invariante respetado |
| **spend_limit bypass** | `enforceSpendLimit` corre en paso 3, antes de cobrar, igual que hoy. Excede → `mandate_exceeded`, sin reserva ni cargo. | `purchase-core.enforceSpendLimit` (reusado) |
| **Wallet de otro agente** | `getWalletByApiKeyId(clientId)` liga a la key autenticada; `apiKeyId` es UNIQUE. Un agente nunca ve la wallet de otro. | `db/store` + tabla `wallet` |
| **Race de idempotencia (perdedor)** | Si `createPendingOrder` devuelve `created=false`, se libera la reserva propia y se retorna la orden ganadora — ANTES de cobrar. Reusado del flujo actual. | `purchase-core.execute` paso 5 |

Golden rule intacta: en `succeeded`, si falla el email/reminder DESPUÉS de capturar, no se hace
rollback (lo cubre `handlePaymentSucceeded`). El cargo ya ocurrió; el ticket ya está emitido.

---

## 7. Breakdown de ejecución (archivos + orden, listo para asignar)

Orden por dependencias: DB → Payments/core firma → core branch → protocols → QA.

### A. `ot-db` — schema `wallet`
- **Crear/tocar:** `db/schema.ts` (append tabla `wallet`), `db/store.ts` (nuevo método
  `getWalletByApiKeyId(apiKeyId): Promise<WalletRow | null>` + `upsertWallet(...)` para el script).
- `pnpm db:generate && pnpm db:push`.
- NO se toca `railEnum` (wallet reusa `rail="mcp"`).
- Entregable: migración aplicada + `getWalletByApiKeyId` disponible.

### B. `ot-payments` — `PaymentPort.chargeOffSession` + `lib/stripe`
- **Tocar:** `core/ports.ts` (agregar `OffSessionChargeInput`, `OffSessionChargeResult`,
  `chargeOffSession?` opcional al `PaymentPort`).
- **Tocar:** `lib/stripe.ts` (implementar `chargeOffSession` en `createStripePaymentPort`, con el
  mapeo succeeded/requires_action/failed y el manejo de `StripeCardError`).
- Guard test-only sin cambios.
- Entregable: `chargeOffSession` implementado y unit-testeable con Stripe test.

### C. core branch — `purchase-core` + adapter + tipos  (dueño: **ot-architect**, o ot-payments con review de ot-architect)
- **Tocar:** `core/adapter/types.ts` (`SettlementScheme += "wallet_off_session"`, `WalletContext`,
  response type del adapter).
- **Tocar:** `core/adapter/purchase-core.ts` (`run(raw, adapter, ctx?)`; branch 6b en `execute`).
- **Tocar:** `core/adapter/errors.ts` (código `payment_action_required`).
- **Tocar:** `core/adapter/rails/mcp.ts` (exportar `mcpWalletRail`).
- Entregable: pipeline wallet completo, hosted intacto (regresión = suite hosted verde).
- Cruza core/ ↔ lib/: **ot-architect valida el borde** (que la wallet entre por `ctx`, no por el
  intent; que `resolveIntent` siga puro).

### D. `ot-protocols` — selección wallet-vs-hosted en el tool
- **Tocar:** el handler del tool `buy_ticket` (donde se monta `mcpRail` en el MCP server / `lib`):
  resolver `getWalletByApiKeyId(clientId)`; si hay wallet → `mcpWalletRail` + `ctx.wallet`, si no →
  `mcpRail`. Pasar `ctx` al `run()`.
- Tool `load_wallet` / CLI: **DIFERIDO** (ver §5.2). No se implementa en v1.
- Entregable: `buy_ticket` ramifica por presencia de wallet; respuestas §4.2.

### E. `scripts/load-wallet.ts` — operador  (dueño: ot-payments o ot-devops)
- **Crear:** `scripts/load-wallet.ts` (Customer + attach PM + upsert wallet; flags `--label`/
  `--key`/`--pm`). Reusa `getStripe()`, `hashApiKey`, `upsertWallet`.
- Entregable: `pnpm tsx scripts/load-wallet.ts --label demo` deja la key demo con wallet.

### F. `ot-qa` — tests
Casos mínimos (Vitest):
1. **succeeded**: wallet + `pm_card_visa` → orden `confirmed`, tickets emitidos, `checkout_url:null`,
   `ics_path` set, `paid:true`. Verifica que reserved→issued.
2. **declined**: `pm_card_chargeDeclined` → `payment_failed`, orden `cancelled`, **inventario
   liberado** (reserved vuelve a 0).
3. **requires_action**: `pm_card_authenticationRequired` → `payment_action_required`, orden
   `cancelled`, inventario liberado (no colgado).
4. **doble cobro**: dos `run()` con la misma `idempotency_key` → una sola orden, **un solo**
   PaymentIntent (mock de `chargeOffSession` afirma idempotencyKey estable), segunda respuesta
   `duplicate`/misma orden confirmada.
5. **spend_limit**: total > `spend_limit` → `mandate_exceeded`, sin reserva ni cargo.
6. **regresión hosted**: sin wallet → sigue devolviendo `checkout_url` + `pending_payment` (no roto).
7. (opcional) **doble emisión**: dos `handlePaymentSucceeded` sobre la misma orden → segundo
   `already_processed`, un solo set de tickets.

---

## Resumen de invariantes respetados
- `core/` sigue framework-free: Stripe solo en `lib/`, wallet entra por `ctx` opaco, `resolveIntent` puro.
- AP2 no tocado (sigue siendo overlay de autorización, ortogonal a este settlement).
- MPP no tocado (stub).
- Inventario atómico en DB (UPDATE condicional + CHECK) — no lo tocamos; reusamos reserve/expire/confirmAndIssue.
- Wallet NO es rail nuevo: es settlement nuevo sobre `rail="mcp"`. No se abstrae de más.
