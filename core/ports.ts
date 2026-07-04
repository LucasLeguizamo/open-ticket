/**
 * Core ports — ALL external dependencies (DB, Stripe, email) come in
 * through here, injected. The core never imports them (architecture-review A8):
 * that way `core/` extracts into a package with a single `git mv`.
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

  /** Composite scope (rail, buyer_email, key) — fix P4: never a global unique. */
  findOrderByIdempotency(
    rail: Rail,
    buyerEmail: string,
    idempotencyKey: string,
  ): Promise<Order | null>;

  /**
   * Atomic reservation: conditional UPDATE `issued + reserved + qty <= quota`.
   * Includes LAZY expiration (A7): before reserving, it releases reservations
   * of expired pending_payment orders for this ticket_type. false = sold_out.
   */
  reserveInventory(ticketTypeId: string, quantity: number): Promise<boolean>;

  /** Releases reserved inventory NOT tied to an order (e.g. lost the idempotency race). */
  releaseInventory(ticketTypeId: string, quantity: number): Promise<void>;

  /**
   * Inserts the pending_payment order. If the (rail,email,key) unique already
   * exists (parallel retry race) it returns the existing one with created=false.
   */
  createPendingOrder(
    input: NewOrderInput,
  ): Promise<{ order: Order; created: boolean }>;

  attachCheckout(
    orderId: string,
    checkout: { checkoutUrl: string; sessionId: string },
  ): Promise<void>;

  /**
   * Conditional transition pending_payment → expired|cancelled + releases reserved.
   * false if the order was not pending (idempotent no-op).
   */
  expireOrder(orderId: string, to: "expired" | "cancelled"): Promise<boolean>;

  /**
   * THE ISSUANCE LOCK (fix P3): in ONE transaction —
   *   UPDATE orders SET status='confirmed' WHERE id=:id AND status='pending_payment'
   * Only if 1 row was affected: moves reserved→issued, inserts tickets and ticker_event.
   * Two concurrent webhooks: one wins, the other gets already_confirmed.
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
   * Stripe webhook dedup (fix P3): INSERT ... ON CONFLICT DO NOTHING on
   * processed_stripe_event. true = first time (process it), false = already seen.
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
  /** v1 (settlement=stripe_hosted): creates the hosted Checkout link. */
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
  /** .ics content (RFC 5545) to attach */
  icsContent: string;
  /** absolute or relative link to the on-demand .ics */
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
