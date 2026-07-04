# Design: AgentCommerceAdapter + MCP tools (buy_ticket / set_reminder)

**Status:** Draft para confirmar (sin código todavía)
**Version:** 0.1
**Relacionado:** [PRD.md](../PRD.md) §9, US-002/003/004/006/007

> Objetivo: una sola abstracción interna para que ACP, MCP propio, AP2/x402 y MPP
> compartan el mismo núcleo de compra. Cada protocolo es un adaptador delgado;
> el flujo de negocio (validar cupo → cobrar Stripe → emitir → recordar) se
> escribe UNA vez.

---

## 1. Por qué un adapter (y no 4 checkouts)

Los 4 rails difieren solo en **cómo entra la intención y cómo se autoriza el pago**.
El resto es idéntico:

| Etapa | ¿Varía por rail? |
|---|---|
| Resolver qué se compra (evento + tipo de ticket + cantidad) | No |
| Validar cupo | No |
| Autorizar pago | **Sí** (tarjeta Stripe / mandate AP2 / 402 x402 / MPP) |
| Capturar/cobrar | Parcial (todos terminan en Stripe fiat salvo x402=stablecoin) |
| Emitir ticket + email/.ics | No |

Por eso el core es un **pipeline fijo de 4 pasos** y los rails solo implementan
los 2 pasos que cambian.

---

## 2. Lifecycle (contrato común)

```
resolveIntent(rawRequest)  ->  PurchaseIntent      # normaliza input de cualquier rail
        │
authorize(intent)          ->  AuthorizedOrder     # valida cupo + valida medio/límite de pago
        │
capture(order)             ->  Payment             # cobra (Stripe fiat | x402 stablecoin)
        │
fulfill(order, payment)    ->  Fulfillment         # emite ticket, manda email+.ics, agenda reminder
```

- **Idempotente por `idempotency_key`** en todo el pipeline (PRD §7). Reintento del
  agente = misma orden, sin doble cargo.
- Cualquier paso puede fallar con un `AgentCommerceError` tipado (ver §5). El core
  no continúa; libera el cupo reservado si ya se reservó.

**Nota v1 (Q1 — pago hospedado):** en v1 el `capture` es **asíncrono**. `buy_ticket`/ACP
no cobran inline: `authorize` reserva el cupo y crea un **checkout link de Stripe**;
la orden queda `pending_payment` con `checkout_url`. El cobro se confirma por
**webhook de Stripe**, que dispara `fulfill` (emitir + email/.ics + reminder). El
agente descubre el resultado por el email o consultando `get_order` (§8). Esto
evita manejar datos de tarjeta (PCI trivial). Un capture 100% headless con token
queda para fase posterior.

---

## 3. Interfaz del adapter (spec, no implementación)

Un solo core (`PurchaseCore`) orquesta el pipeline. Cada rail implementa
`RailAdapter`, que solo cubre lo que varía.

```ts
// SPEC — tipos conceptuales, no es el código final.

interface PurchaseIntent {
  idempotency_key: string
  event_id: string
  ticket_type_id: string
  quantity: number
  buyer: {
    email: string            // requerido para emitir + email .ics
    name?: string
    external_ref?: string    // id del usuario en el cliente del agente
  }
  rail: "acp" | "mcp" | "ap2" | "x402" | "mpp"
  payment_context: unknown   // opaco al core; lo entiende el RailAdapter (mandate, PI, 402 receipt…)
                             // v1: vacío en MCP/ACP (pago hospedado); AP2/x402 lo usan
  spend_limit?: Money        // tope declarado por el usuario. Obligatorio si NO hay mandate AP2 (Q2)
}

interface RailAdapter {
  rail: string
  // 1. Traduce el request crudo del protocolo a un PurchaseIntent normalizado.
  resolveIntent(raw: unknown): PurchaseIntent
  // 2. Valida el medio de pago del rail (mandate/límite/402) SIN cobrar todavía.
  //    Devuelve un handle que capture() usará.
  authorizePayment(intent: PurchaseIntent): PaymentAuthorization
  // 3. Cobra usando el handle. Todos menos x402 delegan a Stripe.
  capturePayment(auth: PaymentAuthorization): Payment
  // 4. Formatea la confirmación en la forma que ESE rail espera devolver.
  formatResult(fulfillment: Fulfillment): unknown
}

interface PurchaseCore {
  // El pipeline fijo. No lo tocan los rails.
  run(rawRequest: unknown, adapter: RailAdapter): Promise<unknown>
  //   internamente: resolveIntent → reserveInventory → authorizePayment
  //                 → capturePayment → issueTickets → sendEmailWithIcs
  //                 → scheduleReminder → formatResult
}
```

**Lo que el core hace y los rails NO reimplementan:**
`reserveInventory`, `issueTickets`, `sendEmailWithIcs`, `scheduleReminder`.

<!-- ponytail: x402 es el único capture no-Stripe. Si en la práctica termina
     liquidándose también vía Stripe, colapsar capturePayment al core y dejar
     al adapter solo resolveIntent+authorizePayment. -->

---

## 4. Mapa por rail (qué implementa cada adaptador)

| Rail | resolveIntent (input) | authorizePayment | capturePayment |
|---|---|---|---|
| **ACP** | Sesión de checkout ACP (feed → cart → complete) | Crea Stripe PaymentIntent desde el token ACP | Confirma el PaymentIntent |
| **MCP** | Args de la tool `buy_ticket` | Stripe PI + valida `spend_limit` local | Confirma el PaymentIntent |
| **AP2** | Mandates Intent/Cart/Payment (VCs) | Verifica firma del mandate + límites → PI | Confirma el PaymentIntent |
| **x402** | Request con header/receipt HTTP 402 | Verifica pago stablecoin vía facilitador x402 | Settlement onchain (no Stripe) |
| **MPP** | Payload Merchant Payments Protocol | Adaptador merchant → PI | Confirma el PaymentIntent |

Feature flag por rail (PRD §12 kill switch). ACP + MCP primero; AP2/x402/MPP se
enchufan sin tocar el core.

---

## 5. Modelo de error (común a todos los rails)

Cada rail traduce ESTO a su formato nativo en `formatResult`.

| Código | Cuándo | HTTP equiv | ¿Cargo? |
|---|---|---|---|
| `sold_out` | Cupo agotado entre descubrimiento y pago | 409 | No |
| `mandate_exceeded` | Monto > spend_limit / fuera de merchant o vigencia | 403 | No |
| `payment_failed` | Rechazo del medio de pago | 402 | No |
| `event_unavailable` | Evento cancelado/despublicado | 410 | No |
| `invalid_intent` | Falta email, cantidad ≤ 0, ticket_type inexistente | 400 | No |
| `duplicate` | idempotency_key ya procesada | 200 (devuelve orden previa) | — |
| `internal` | Fallo inesperado | 500 | Rollback |

Regla: **nunca** dejar un cargo sin ticket. Si `fulfill` falla tras `capture`,
el ticket queda emitido y se reintenta el email (no se revierte el cobro).

---

## 6. MCP tool schema — `buy_ticket`

```json
{
  "name": "buy_ticket",
  "description": "Compra uno o más tickets para un evento y devuelve la confirmación con el .ics. Respeta el límite de gasto del usuario.",
  "inputSchema": {
    "type": "object",
    "required": ["event_id", "ticket_type_id", "quantity", "buyer_email", "idempotency_key"],
    "properties": {
      "event_id":       { "type": "string", "description": "ID del evento (de search_events/get_ticket)." },
      "ticket_type_id": { "type": "string", "description": "ID del tipo de ticket a comprar." },
      "quantity":       { "type": "integer", "minimum": 1, "maximum": 10 },
      "buyer_email":    { "type": "string", "format": "email", "description": "Email donde llega el ticket + .ics." },
      "buyer_name":     { "type": "string" },
      "spend_limit":    {
        "type": "object",
        "description": "Tope de gasto autorizado. OBLIGATORIO salvo que payment_context traiga un mandate AP2 firmado (de ahí sale el límite).",
        "properties": {
          "amount":   { "type": "number", "minimum": 0 },
          "currency": { "type": "string", "description": "ISO 4217, ej. USD, COP." }
        },
        "required": ["amount", "currency"]
      },
      "idempotency_key": { "type": "string", "description": "Clave única del agente para evitar doble compra en reintentos." },
      "payment_context": {
        "type": "object",
        "description": "Opaco. Datos del medio de pago según el cliente (token Stripe, mandate ref). Vacío = flujo de pago hospedado.",
        "additionalProperties": true
      }
    },
    "additionalProperties": false
  }
}
```

**Salida v1 (conceptual — pago hospedado, asíncrono):**

```json
{
  "status": "pending_payment",        // pending_payment | sold_out | mandate_exceeded | invalid_intent | ...
  "order_id": "ord_123",
  "checkout_url": "https://checkout.stripe.com/…",   // el agente/usuario abre esto para pagar
  "expires_at": "2026-07-01T20:15:00-05:00",         // cupo reservado hasta acá
  "amount": { "amount": 45000, "currency": "COP" },   // moneda del evento (Q4)
  "event": { "title": "…", "starts_at": "2026-08-01T20:00:00-05:00", "venue": "…" },
  "poll": "get_order(ord_123)"        // cómo saber si ya se confirmó
}
```

Al confirmarse el pago (webhook Stripe), el usuario recibe email con ticket + `.ics`,
y `get_order` pasa a `confirmed` con `tickets[]`, `ics_url` y `reminder`. En AP2/x402
(fase posterior) el capture puede ser inline y devolver `confirmed` directo.

---

## 7. MCP tool schema — `set_reminder`

Separada de `buy_ticket` a propósito: el usuario puede querer recordatorio sin
comprar (evento gratis / ya tenía ticket), y `buy_ticket` ya dispara el email
por defecto. Esta tool es para agendar/re-agendar explícito.

```json
{
  "name": "set_reminder",
  "description": "Agenda un recordatorio para un evento y devuelve un .ics. Por defecto envía email con alarmas 24h y 1h antes.",
  "inputSchema": {
    "type": "object",
    "description": "Requiere un evento de OpenTicket: al menos uno de event_id u order_id (Q3). title/starts_at se toman del evento; no se aceptan eventos arbitrarios en v1.",
    "anyOf": [
      { "required": ["event_id", "buyer_email"] },
      { "required": ["order_id", "buyer_email"] }
    ],
    "properties": {
      "event_id":   { "type": "string", "description": "ID de evento de OpenTicket." },
      "order_id":   { "type": "string", "description": "ID de compra; deriva el evento y el email." },
      "buyer_email":{ "type": "string", "format": "email", "description": "Destino del recordatorio." },
      "offsets_minutes": {
        "type": "array",
        "description": "Minutos antes del evento para cada alarma. Default [1440, 60].",
        "items": { "type": "integer", "minimum": 0 },
        "default": [1440, 60]
      }
    },
    "additionalProperties": false
  }
}
```

**Salida (conceptual):**

```json
{
  "status": "scheduled",
  "ics_url": "https://openticket…/r/rem_456.ics",
  "channel": "email",
  "alarms_minutes": [1440, 60]
}
```

<!-- ponytail: v1 solo canal email + .ics (PRD §11 parkea WhatsApp/push/MCP-calendar).
     `channel` en la salida existe ya para no romper el schema cuando se agreguen. -->

---

## 8. Tools MCP restantes (solo firma, se detallan luego)

| Tool | Para qué |
|---|---|
| `search_events` | Descubrir eventos por texto/fecha/ciudad → lista con event_id + ticket types |
| `get_ticket` | Detalle de un tipo de ticket (precio, cupo, moneda) antes de comprar |
| `get_order` | Estado de una orden (`pending_payment`→`confirmed`); el agente lo consulta tras `buy_ticket` para saber si el pago hospedado se completó y obtener `tickets[]` + `ics_url` |

---

## 9. Decisiones resueltas (2026-07-01)

| # | Decisión | Implicación |
|---|---|---|
| Q1 | **Pago hospedado (link Stripe) en v1.** `buy_ticket`/ACP devuelven `pending_payment` + `checkout_url`; cobro por webhook; `fulfill` asíncrono. | Capture async (§2 nota), salida de `buy_ticket` cambia (§6), nueva tool `get_order` (§8). Capture headless con token = fase posterior. |
| Q2 | **`spend_limit` obligatorio salvo mandate AP2.** Sin mandate firmado, es requerido; con mandate, el límite sale del mandate. | Validado en `authorize`; descripción del schema (§6). Error `mandate_exceeded` si se excede. |
| Q3 | **`set_reminder` solo eventos de la plataforma.** Requiere `event_id` u `order_id`; nada de eventos arbitrarios. | `anyOf` en el schema (§7). Evita ser API genérica de recordatorios / spam. |
| Q4 | **Moneda del evento; conversión solo en reporting.** El core cobra en la moneda del evento (COP, USD…); el dashboard convierte para reportes. | Sin riesgo de FX en el cobro. `Money.currency` = ISO 4217 del evento. |
```

