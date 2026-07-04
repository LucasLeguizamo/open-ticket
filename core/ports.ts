/**
 * Puertos del core — TODAS las dependencias externas (DB, Stripe, email)
 * entran por acá, inyectadas. El core nunca las importa (architecture-review A8):
 * así `core/` se extrae como paquete con un `git mv`.
 */
import type {
  EventRecord,
  Money,
  Order,
  OrderStatus,
  Rail,
  TicketRecord,
  TicketSeed,
  TicketTypeRecord,
} from "./adapter/types";

export interface CatalogSnapshot {
  event: EventRecord;
  ticketType: TicketTypeRecord;
}

export interface NewOrderInput {
  id: string;
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  buyerEmail: string;
  buyerName: string | null;
  rail: Rail;
  boughtByAgent: boolean;
  amountMinor: number;
  platformFeeMinor: number;
  currency: string;
  spendLimitMinor: number | null;
  mandateRef: string | null;
  idempotencyKey: string;
  expiresAt: Date;
}

export type ConfirmOutcome =
  | { outcome: "confirmed"; order: Order }
  | { outcome: "already_confirmed"; order: Order }
  | { outcome: "not_pending"; status: OrderStatus }
  | { outcome: "not_found" };

export interface OrderDetail {
  order: Order;
  event: EventRecord;
  tickets: TicketRecord[];
}

export interface StorePort {
  getCatalog(
    eventId: string,
    ticketTypeId: string,
  ): Promise<CatalogSnapshot | null>;

  /** Scope compuesto (rail, buyer_email, key) — fix P4: nunca unique global. */
  findOrderByIdempotency(
    rail: Rail,
    buyerEmail: string,
    idempotencyKey: string,
  ): Promise<Order | null>;

  /**
   * Reserva atómica: UPDATE condicional `issued + reserved + qty <= quota`.
   * Incluye expiración PEREZOSA (A7): antes de reservar libera reservas de
   * órdenes pending_payment vencidas de este ticket_type. false = sold_out.
   */
  reserveInventory(ticketTypeId: string, quantity: number): Promise<boolean>;

  /** Libera cupo reservado NO atado a orden (p.ej. perdió el race de idempotencia). */
  releaseInventory(ticketTypeId: string, quantity: number): Promise<void>;

  /**
   * Inserta la orden pending_payment. Si la unique (rail,email,key) ya existe
   * (race de reintentos paralelos) devuelve la existente con created=false.
   */
  createPendingOrder(
    input: NewOrderInput,
  ): Promise<{ order: Order; created: boolean }>;

  attachCheckout(
    orderId: string,
    checkout: { checkoutUrl: string; sessionId: string },
  ): Promise<void>;

  /**
   * Transición condicional pending_payment → expired|cancelled + libera reserved.
   * false si la orden no estaba pending (no-op idempotente).
   */
  expireOrder(orderId: string, to: "expired" | "cancelled"): Promise<boolean>;

  /**
   * EL LOCK DE EMISIÓN (fix P3): en UNA transacción —
   *   UPDATE orders SET status='confirmed' WHERE id=:id AND status='pending_payment'
   * Solo si afectó 1 fila: mueve reserved→issued, inserta tickets y ticker_event.
   * Dos webhooks concurrentes: uno gana, el otro recibe already_confirmed.
   */
  confirmAndIssue(
    orderId: string,
    paymentIntentId: string | null,
    seeds: TicketSeed[],
  ): Promise<ConfirmOutcome>;

  getOrder(orderId: string): Promise<Order | null>;
  getOrderDetail(orderId: string): Promise<OrderDetail | null>;

  createReminder(input: {
    id: string;
    orderId: string | null;
    eventId: string;
    email: string;
    offsetsMinutes: number[];
  }): Promise<void>;

  /**
   * Dedup de webhooks Stripe (fix P3): INSERT ... ON CONFLICT DO NOTHING sobre
   * processed_stripe_event. true = primera vez (procesar), false = ya visto.
   */
  markStripeEventProcessed(stripeEventId: string): Promise<boolean>;
}

export interface HostedCheckoutInput {
  orderId: string;
  currency: string;
  unitAmountMinor: number;
  quantity: number;
  description: string;
  customerEmail: string;
  expiresAt: Date;
}

export interface PaymentPort {
  /** v1 (settlement=stripe_hosted): crea el link de Checkout hospedado. */
  createHostedCheckout(
    input: HostedCheckoutInput,
  ): Promise<{ checkoutUrl: string; sessionId: string }>;
}

export interface TicketEmailInput {
  to: string;
  orderId: string;
  eventTitle: string;
  eventStartsAt: Date;
  venue: string | null;
  tickets: { code: string }[];
  amount: Money;
  /** contenido .ics (RFC 5545) para adjuntar */
  icsContent: string;
  /** link absoluto o relativo al .ics on-demand */
  icsPath: string;
}

export interface MailerPort {
  sendTicketEmail(input: TicketEmailInput): Promise<void>;
}

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}
