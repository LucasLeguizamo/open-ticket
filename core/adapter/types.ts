/**
 * Tipos del AgentCommerceAdapter.
 *
 * ⚠️ Este directorio (core/) es FRAMEWORK-FREE: nada de Next/Drizzle/Stripe.
 * Es el candidato a extraerse como paquete `@openticket/agent-commerce-adapter`
 * (architecture-review §2). Las dependencias entran por core/ports.ts.
 *
 * Incorpora los 3 fixes del protocol-audit §2:
 *  - `mode`: ACP es una sesión stateful (create/update/complete), MCP es one-shot.
 *  - Eje AUTORIZACIÓN separado del eje SETTLEMENT (AP2 es overlay, no rail paralelo).
 *  - Dos modos de capture: `stripe_hosted` (v1) e `stripe_inline_spt`
 *    (previsto para conformance ACP, NO implementado en F0/F1).
 */

export type Rail = "web" | "acp" | "mcp" | "ap2" | "x402" | "mpp";

export type AdapterMode = "one_shot" | "session";

/** Eje de autorización: cómo se valida que el gasto está permitido. */
export type AuthorizationScheme = "none" | "spend_limit" | "ap2_mandate";

/** Eje de settlement: cómo se mueve el dinero. */
export type SettlementScheme =
  | "stripe_hosted" // v1: link de Checkout hospedado + webhook (async)
  | "stripe_inline_spt" // ACP: Shared Payment Token inline en /complete (F2, no implementado)
  | "x402" // stablecoin onchain (fase posterior)
  | "mpp"; // fiat-over-402 vía Stripe (stub, redundante con x402)

/** Dinero SIEMPRE en unidades mínimas (centavos) + ISO 4217. Nunca floats. */
export interface Money {
  amountMinor: number;
  currency: string;
}

export interface Buyer {
  email: string;
  name?: string;
  /** id del usuario en el cliente del agente */
  externalRef?: string;
}

/** Intención de compra normalizada — lo que produce resolveIntent de cualquier rail. */
export interface PurchaseIntent {
  idempotencyKey: string;
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  buyer: Buyer;
  rail: Rail;
  /**
   * Tope de gasto declarado. Con authorization="spend_limit" es OBLIGATORIO.
   * NOTA de honestidad (architecture-review P5): sin mandate AP2 firmado esto es
   * autodeclarado por el agente — documenta intención, no es control de seguridad.
   */
  spendLimit?: Money;
  /** Opaco al core; lo entiende el RailAdapter (mandate AP2, receipt 402, SPT…). */
  paymentContext?: unknown;
}

export type OrderStatus =
  | "pending_payment"
  | "confirmed"
  | "expired"
  | "cancelled"
  | "refunded";

export type EventStatus = "draft" | "published" | "sold_out" | "cancelled";
export type TicketTypeStatus = "active" | "hidden" | "sold_out";
export type TicketStatus = "valid" | "used" | "void";

export interface Order {
  id: string;
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  buyerEmail: string;
  buyerName: string | null;
  rail: Rail;
  boughtByAgent: boolean;
  status: OrderStatus;
  amountMinor: number;
  platformFeeMinor: number;
  currency: string;
  spendLimitMinor: number | null;
  mandateRef: string | null;
  idempotencyKey: string;
  checkoutUrl: string | null;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  confirmedAt: Date | null;
}

export interface EventRecord {
  id: string;
  organizerId: string;
  title: string;
  description: string;
  slug: string;
  venue: string | null;
  startsAt: Date;
  endsAt: Date | null;
  timezone: string;
  currency: string;
  status: EventStatus;
}

export interface TicketTypeRecord {
  id: string;
  eventId: string;
  name: string;
  priceMinor: number;
  quota: number;
  issued: number;
  reserved: number;
  status: TicketTypeStatus;
}

export interface TicketRecord {
  id: string;
  code: string;
  status: TicketStatus;
}

/** Semilla de ticket generada por el core; el store la persiste atómicamente. */
export interface TicketSeed {
  id: string;
  code: string;
}

/** Resultado normalizado del pipeline; cada rail lo re-formatea en formatResult. */
export interface PurchaseResult {
  status: OrderStatus;
  /** true si esta respuesta proviene de una idempotency key ya procesada */
  duplicate: boolean;
  orderId: string;
  checkoutUrl: string | null;
  expiresAt: Date | null;
  amount: Money;
  platformFee: Money;
  event: { id: string; title: string; startsAt: Date; venue: string | null };
  tickets: TicketRecord[];
  /** path relativo al .ics on-demand (solo cuando status=confirmed) */
  icsPath: string | null;
}

/**
 * Adaptador one-shot (MCP, web): una request → un resultado.
 * Solo cubre lo que varía por rail; el pipeline es del PurchaseCore.
 */
export interface RailAdapter<Raw = unknown, Result = unknown> {
  readonly rail: Rail;
  readonly mode: AdapterMode;
  readonly authorization: AuthorizationScheme;
  readonly settlement: SettlementScheme;
  /** Traduce el request crudo del protocolo a un PurchaseIntent normalizado.
   *  DEBE validar con Zod (trust boundary) y tirar invalid_intent si no cumple. */
  resolveIntent(raw: Raw): PurchaseIntent;
  /** Formatea la confirmación en la forma que ESE rail espera devolver. */
  formatResult(result: PurchaseResult): Result;
}

/**
 * Contrato para rails con sesión stateful (ACP: create/update/complete).
 * Declarado en F0 para que el core no se rompa cuando ACP aterrice (F2);
 * el adaptador de sesión compone los mismos primitivos del PurchaseCore
 * (reservar → autorizar → capturar → fulfill) repartidos entre requests.
 * NO implementado en F0/F1.
 */
export interface SessionRailAdapter<Raw = unknown, Result = unknown> {
  readonly rail: Rail;
  readonly mode: "session";
  readonly authorization: AuthorizationScheme;
  readonly settlement: SettlementScheme;
  createSession(raw: Raw): Promise<Result>;
  updateSession(sessionId: string, raw: Raw): Promise<Result>;
  getSession(sessionId: string): Promise<Result>;
  completeSession(sessionId: string, raw: Raw): Promise<Result>;
  cancelSession(sessionId: string): Promise<Result>;
}
