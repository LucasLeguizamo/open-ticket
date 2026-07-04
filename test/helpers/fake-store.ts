/**
 * In-memory StorePort for PurchaseCore UNIT tests (pipeline logic,
 * errors, spend_limit). Mocking rule (test-strategy §2):
 * inventory/idempotency UNDER CONCURRENCY are tested against real Postgres
 * in test/integration — this fake is sequential on purpose.
 */

import type {
  EventRecord,
  Order,
  Rail,
  TicketSeed,
  TicketTypeRecord,
} from "@/core/adapter/types";
import type {
  CatalogSnapshot,
  ConfirmOutcome,
  NewOrderInput,
  OrderDetail,
  StorePort,
} from "@/core/ports";

export interface FakeStoreSeed {
  event: EventRecord;
  ticketType: TicketTypeRecord;
}

export function makeEvent(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "evt_1",
    organizerId: "org_1",
    title: "Demo Conf",
    description: "",
    slug: "demo-conf",
    venue: "Ágora",
    startsAt: new Date("2026-12-01T20:00:00Z"),
    endsAt: null,
    timezone: "America/Bogota",
    currency: "USD",
    status: "published",
    ...overrides,
  };
}

export function makeTicketType(
  overrides: Partial<TicketTypeRecord> = {},
): TicketTypeRecord {
  return {
    id: "tt_1",
    eventId: "evt_1",
    name: "General",
    priceMinor: 5000,
    quota: 10,
    issued: 0,
    reserved: 0,
    status: "active",
    ...overrides,
  };
}

export class FakeStore implements StorePort {
  event: EventRecord;
  ticketType: TicketTypeRecord;
  orders = new Map<string, Order>();
  ticketsByOrder = new Map<string, TicketSeed[]>();
  reminders: {
    id: string;
    orderId: string | null;
    eventId: string;
    email: string;
  }[] = [];
  processedStripeEvents = new Set<string>();

  constructor(seed?: Partial<FakeStoreSeed>) {
    this.event = seed?.event ?? makeEvent();
    this.ticketType = seed?.ticketType ?? makeTicketType();
  }

  async getCatalog(
    eventId: string,
    ticketTypeId: string,
  ): Promise<CatalogSnapshot | null> {
    if (eventId !== this.event.id || ticketTypeId !== this.ticketType.id)
      return null;
    return { event: this.event, ticketType: this.ticketType };
  }

  async findOrderByIdempotency(
    rail: Rail,
    buyerEmail: string,
    key: string,
  ): Promise<Order | null> {
    for (const o of this.orders.values()) {
      if (
        o.rail === rail &&
        o.buyerEmail === buyerEmail &&
        o.idempotencyKey === key
      )
        return o;
    }
    return null;
  }

  async reserveInventory(
    ticketTypeId: string,
    quantity: number,
  ): Promise<boolean> {
    const tt = this.ticketType;
    if (ticketTypeId !== tt.id || tt.status !== "active") return false;
    if (tt.issued + tt.reserved + quantity > tt.quota) return false;
    tt.reserved += quantity;
    return true;
  }

  async releaseInventory(
    _ticketTypeId: string,
    quantity: number,
  ): Promise<void> {
    this.ticketType.reserved = Math.max(0, this.ticketType.reserved - quantity);
  }

  async createPendingOrder(
    input: NewOrderInput,
  ): Promise<{ order: Order; created: boolean }> {
    const existing = await this.findOrderByIdempotency(
      input.rail,
      input.buyerEmail,
      input.idempotencyKey,
    );
    if (existing) return { order: existing, created: false };
    const order: Order = {
      ...input,
      status: "pending_payment",
      checkoutUrl: null,
      stripeCheckoutSessionId: null,
      stripePaymentIntentId: null,
      createdAt: new Date(),
      confirmedAt: null,
    };
    this.orders.set(order.id, order);
    return { order, created: true };
  }

  async attachCheckout(
    orderId: string,
    checkout: { checkoutUrl: string; sessionId: string },
  ): Promise<void> {
    const o = this.orders.get(orderId);
    if (!o) return;
    o.checkoutUrl = checkout.checkoutUrl;
    o.stripeCheckoutSessionId = checkout.sessionId;
  }

  async expireOrder(
    orderId: string,
    to: "expired" | "cancelled",
  ): Promise<boolean> {
    const o = this.orders.get(orderId);
    if (o?.status !== "pending_payment") return false;
    o.status = to;
    this.ticketType.reserved -= o.quantity;
    return true;
  }

  async confirmAndIssue(
    orderId: string,
    paymentIntentId: string | null,
    seeds: TicketSeed[],
  ): Promise<ConfirmOutcome> {
    const o = this.orders.get(orderId);
    if (!o) return { outcome: "not_found" };
    if (o.status === "confirmed")
      return { outcome: "already_confirmed", order: o };
    if (o.status !== "pending_payment")
      return { outcome: "not_pending", status: o.status };
    o.status = "confirmed";
    o.confirmedAt = new Date();
    o.stripePaymentIntentId = paymentIntentId;
    this.ticketType.reserved -= o.quantity;
    this.ticketType.issued += o.quantity;
    this.ticketsByOrder.set(orderId, seeds);
    return { outcome: "confirmed", order: o };
  }

  async getOrder(orderId: string): Promise<Order | null> {
    return this.orders.get(orderId) ?? null;
  }

  async getOrderDetail(orderId: string): Promise<OrderDetail | null> {
    const order = this.orders.get(orderId);
    if (!order) return null;
    return {
      order,
      event: this.event,
      tickets: (this.ticketsByOrder.get(orderId) ?? []).map((s) => ({
        id: s.id,
        code: s.code,
        status: "valid" as const,
      })),
    };
  }

  async createReminder(input: {
    id: string;
    orderId: string | null;
    eventId: string;
    email: string;
    offsetsMinutes: number[];
  }): Promise<void> {
    this.reminders.push(input);
  }

  async markStripeEventProcessed(stripeEventId: string): Promise<boolean> {
    if (this.processedStripeEvents.has(stripeEventId)) return false;
    this.processedStripeEvents.add(stripeEventId);
    return true;
  }
}
