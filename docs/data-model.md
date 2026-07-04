# Design: Data Model — OpenTicket

**Status:** Draft para confirmar (sin código / sin migraciones todavía)
**Version:** 0.1
**Relacionado:** [PRD.md](../PRD.md), [agent-commerce-adapter.md](./agent-commerce-adapter.md)

> Alcance: entidades de negocio del v1. No incluye auth interna, logs, ni tablas de
> infra. Refleja las decisiones ya cerradas: moneda por evento (Q4), orden en dos
> tiempos con pago hospedado (Q1), `spend_limit` obligatorio salvo mandate (Q2),
> recordatorio solo de eventos de la plataforma (Q3).

---

## 1. Convenciones

- **IDs:** string con prefijo (`evt_`, `tkt_`, `ord_`, …). ULID/UUID por debajo.
- **Dinero:** entero en **unidades mínimas** de la moneda (`amount_minor`) + `currency` ISO 4217. Nunca floats. Ej: `45000` COP, `1500` = USD 15.00.
- **Timestamps:** `timestamptz` (UTC). Los eventos guardan además su `timezone` (IANA, ej. `America/Bogota`) para render y `.ics`.
- **Soft delete:** eventos con `status`, no borrado físico. Órdenes/tickets nunca se borran (auditoría).

---

## 2. Diagrama de relaciones

```
organizer 1───∞ event 1───∞ ticket_type
                  │              │
                  │              └──────────┐
                  │                         │
                  └───∞ order 1───∞ order_item ∞───1 ticket_type
                            │
                            ├───∞ ticket        (emitidos al confirmar pago)
                            └───1 reminder       (opcional; email + .ics)

event/order ───∞ ticker_event   (append-only, público, sin PII)
digest_subscriber                (independiente, opt-in por email)
```

Cardinalidad clave: una `order` puede tener varios `order_item` (carrito ACP con
distintos tipos de ticket) y genera N `ticket` al confirmarse.

<!-- ponytail: order_item existe porque ACP permite carrito multi-tipo. Si v1 real
     solo vende 1 tipo por compra (buy_ticket es single ticket_type_id), se puede
     colapsar order_item dentro de order. Lo dejo separado para no rehacer al meter ACP. -->

---

## 3. Entidades

### 3.1 `organizer`
| Campo | Tipo | Notas |
|---|---|---|
| id | `org_…` PK | |
| name | text | |
| email | text unique | login del organizador |
| stripe_account_id | text null | Stripe Connect account (PRD §10 Q1) |
| created_at | timestamptz | |

### 3.2 `event`
| Campo | Tipo | Notas |
|---|---|---|
| id | `evt_…` PK | |
| organizer_id | FK → organizer | |
| title | text | |
| description | text | |
| slug | text unique | URL corta / pública |
| venue | text | |
| starts_at | timestamptz | |
| ends_at | timestamptz null | |
| timezone | text | IANA; para `.ics` y render |
| currency | text | ISO 4217. **Fija la moneda de todos sus ticket_type (Q4)** |
| status | enum | `draft` \| `published` \| `sold_out` \| `cancelled` |
| image_url | text null | |
| created_at | timestamptz | |

- **Regla:** todos los `ticket_type` heredan `event.currency`. No se mezclan monedas dentro de un evento.

### 3.3 `ticket_type`
| Campo | Tipo | Notas |
|---|---|---|
| id | `tt_…` PK | |
| event_id | FK → event | |
| name | text | "General", "VIP"… |
| price_minor | integer ≥ 0 | en `event.currency` |
| quota | integer ≥ 0 | cupo total |
| issued | integer ≥ 0 | tickets confirmados/emitidos |
| reserved | integer ≥ 0 | cupo retenido por órdenes `pending_payment` vigentes |
| status | enum | `active` \| `hidden` \| `sold_out` |

- **Invariante de inventario (crítico, PRD §7):**
  `issued + reserved <= quota` — como **CHECK constraint en DB**, no lógica de app.
- Disponible = `quota - issued - reserved`. Ver §4 para reserva/liberación atómica.

<!-- ponytail: inventario con contadores (issued/reserved), no asientos individuales.
     Si algún día hay seating numerado, se agrega tabla `seat`; hoy sería over-engineering. -->

### 3.4 `order`
| Campo | Tipo | Notas |
|---|---|---|
| id | `ord_…` PK | |
| event_id | FK → event | denormalizado para queries del ticker/dashboard |
| buyer_email | text | destino del ticket + `.ics` |
| buyer_name | text null | |
| rail | enum | `web` \| `acp` \| `mcp` \| `ap2` \| `x402` \| `mpp` |
| bought_by_agent | boolean | `true` para todo rail ≠ `web`. Feeds el split humano/agente y el ticker |
| status | enum | `pending_payment` \| `confirmed` \| `expired` \| `cancelled` \| `refunded` |
| amount_minor | integer | total en `event.currency` |
| platform_fee_minor | integer | `application_fee` de la plataforma (Connect, Q1); snapshot para reporting/refunds |
| currency | text | = event.currency (snapshot) |
| spend_limit_minor | integer null | tope declarado (Q2). Null solo si vino de mandate AP2 |
| mandate_ref | text null | referencia al mandate AP2/VC si aplica |
| idempotency_key | text | **unique** — reintento del agente = misma orden (adapter §2) |
| checkout_url | text null | link Stripe hospedado (Q1); vive mientras `pending_payment` |
| stripe_payment_intent_id | text null | set al confirmar |
| expires_at | timestamptz null | fin de la reserva de cupo; tras esto → `expired` + libera `reserved` |
| created_at | timestamptz | |
| confirmed_at | timestamptz null | |

- **Máquina de estados:** ver §5.
- `idempotency_key` unique es lo que hace segura la compra bajo reintentos.

### 3.5 `order_item`
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| order_id | FK → order | |
| ticket_type_id | FK → ticket_type | |
| quantity | integer ≥ 1 | |
| unit_price_minor | integer | snapshot del precio al momento de la orden |

- Snapshot de precio: si el organizador cambia el precio luego, la orden mantiene el suyo.

### 3.6 `ticket`
| Campo | Tipo | Notas |
|---|---|---|
| id | `tkt_…` PK | |
| order_id | FK → order | |
| ticket_type_id | FK → ticket_type | |
| event_id | FK → event | denormalizado (check-in rápido) |
| code | text unique | QR / código de admisión |
| holder_email | text | por defecto = buyer_email |
| status | enum | `valid` \| `used` \| `void` (refund/cancel) |
| issued_at | timestamptz | |

- Se crean **solo** cuando la orden pasa a `confirmed` (webhook Stripe). Nunca antes.

### 3.7 `reminder`
| Campo | Tipo | Notas |
|---|---|---|
| id | `rem_…` PK | |
| order_id | FK → order null | uno de order_id/event_id presente (Q3) |
| event_id | FK → event | |
| email | text | destino |
| offsets_minutes | int[] | default `[1440, 60]` |
| ics_url | text | `.ics` generado (RFC 5545, con VALARM) |
| status | enum | `scheduled` \| `sent` \| `cancelled` |
| created_at | timestamptz | |

- v1: canal **email** únicamente (PRD §11 parkea WhatsApp/push/MCP-calendar). No hay columna `channel` todavía; se agrega cuando exista un segundo canal.

### 3.8 `ticker_event`  (append-only, público)
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| type | enum | `order_confirmed` \| `event_published` \| `sold_out` |
| event_id | FK → event | |
| event_title | text | snapshot (para render sin join) |
| bought_by_agent | boolean null | |
| rail | text null | |
| created_at | timestamptz | orden del feed |

- **Sin PII:** nunca email/nombre del comprador. Solo "alguien / un agente compró para {evento}". Alimenta el ticker en vivo (FR 13) vía SSE/websocket.

### 3.9 `digest_subscriber`
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| email | text unique | |
| status | enum | `active` \| `unsubscribed` |
| created_at | timestamptz | |

---

## 4. Inventario atómico (el punto delicado)

Cero overselling bajo concurrencia. Flujo:

1. **Reservar** al crear la orden (`authorize`):
   ```
   UPDATE ticket_type
      SET reserved = reserved + :qty
    WHERE id = :tt AND (issued + reserved + :qty) <= quota
   ```
   Si afecta 0 filas → **`sold_out`**, no se crea la orden. El CHECK constraint es la
   red de seguridad final.
2. **Confirmar** (webhook pago OK): mover de reservado a emitido, en una transacción:
   ```
   UPDATE ticket_type SET reserved = reserved - :qty, issued = issued + :qty WHERE …
   -- + INSERT de N tickets
   -- + order.status = 'confirmed'
   ```
3. **Liberar** (expira/cancela): `reserved = reserved - :qty`; order → `expired`/`cancelled`.
4. **Barrido de expirados:** job periódico marca órdenes `pending_payment` con
   `expires_at < now()` como `expired` y libera su `reserved`.

<!-- ponytail: contador + CHECK constraint + UPDATE condicional. Nada de locks de
     aplicación ni colas. Escala hasta bastante volumen; si algún drop masivo lo
     estresa, se pasa a reserva por fila/particionado — no antes. -->

---

## 5. Máquina de estados de `order`

```
                 authorize (reserva cupo + crea checkout link)
      [nueva] ─────────────────────────────► pending_payment
                                                  │
             webhook pago OK ─────────────────────┤─► confirmed ──► (refund) ──► refunded
                                                  │
             expires_at vencido ─────────────────┤─► expired
                                                  │
             cancelación explícita ──────────────┘─► cancelled
```

- `confirmed` es el único estado que emite `ticket`, manda email+`.ics` y crea `ticker_event`.
- `expired`/`cancelled`/`refunded` liberan `reserved` (si aún estaba reservado).
- Transiciones idempotentes: un webhook repetido sobre una orden ya `confirmed` no hace nada.

---

## 6. Índices / constraints que importan

| Tabla | Constraint / índice | Por qué |
|---|---|---|
| ticket_type | `CHECK (issued + reserved <= quota)` | Anti-oversell, red final |
| order | `UNIQUE (idempotency_key)` | Reintento agente = misma orden |
| ticket | `UNIQUE (code)` | Código de admisión único |
| event | `UNIQUE (slug)` | URL pública |
| order | index `(event_id, status)` | Dashboard + barrido de expirados |
| order | index `(status, expires_at)` | Job de expiración |
| ticker_event | index `(created_at desc)` | Feed en vivo |

---

## 7. Decisiones resueltas (2026-07-01)

| # | Decisión | Implicación en el modelo |
|---|---|---|
| Q1 | **Stripe Connect: cada organizador su cuenta.** El pago va a la cuenta del organizador; la plataforma toma `application_fee`. | `organizer.stripe_account_id` obligatorio para publicar. Destination/direct charge con application fee. La plataforma **no es custodia** del dinero (menos riesgo legal LATAM). Resuelve PRD §10 Q1. |
| Q2 | **Reserva de cupo = 15 min.** | `order.expires_at = created_at + 15min` (default global, no configurable en v1). El job de barrido (§4) usa este valor. |
| Q3 | **Solo refund total en v1.** | `order.status = refunded` reembolsa Stripe por el total, hace `void` a todos sus `ticket`. No hay refund por ticket individual (fase 2). Evento cancelado → refund total en lote. |
| Q4 | **Todos los tickets al comprador.** | `ticket.holder_email = order.buyer_email` para todos. Sin paso extra de asistentes en el checkout agéntico. Nombres por ticket = fase 2. |

<!-- ponytail: las 4 eligieron la opción simple. expires_at fijo (no columna de config
     por evento), refund total (no cálculo parcial), un solo holder. Cada "flexible"
     descartado es una tabla/estado que no escribimos hasta que haga falta. -->

## 8. Notas de integridad derivadas de las decisiones

- **Publicar evento** requiere `organizer.stripe_account_id` no nulo (Q1). Sin cuenta Connect, el evento queda en `draft`.
- **Snapshot de fee:** guardar el `application_fee` aplicado en la `order` (nueva columna `platform_fee_minor`) para reporting y refunds correctos.
- **Refund (Q3):** al reembolsar, `void` de tickets + `ticker_event` NO se emite (o se emite `refunded` si querés mostrarlo; por defecto no, para no ensuciar el feed positivo).
