/**
 * DrizzleStore — Postgres implementation of the core's StorePort.
 * ALL atomicity lives here: conditional UPDATEs + transactions.
 * The core decides policy; this layer guarantees consistency.
 */
import { and, eq, lt, sql } from "drizzle-orm";
import type { Order, Rail, TicketSeed } from "../core/adapter/types";
import { randomId } from "../core/ids";
import type {
  CatalogSnapshot,
  ConfirmOutcome,
  NewOrderInput,
  OrderDetail,
  StorePort,
} from "../core/ports";
import type { Db } from "./client";
import {
  event,
  orders,
  processedStripeEvent,
  reminder,
  tickerEvent,
  ticket,
  ticketType,
  wallet,
} from "./schema";

type OrderRow = typeof orders.$inferSelect;

/** Agent wallet row (design-wallet.md §1). One wallet per api_key. */
export type Wallet = typeof wallet.$inferSelect;

export interface UpsertWalletInput {
  id: string;
  apiKeyId: string;
  stripeCustomerId: string;
  stripePaymentMethodId: string;
}

function mapOrder(row: OrderRow): Order {
  return {
    id: row.id,
    eventId: row.eventId,
    ticketTypeId: row.ticketTypeId,
    quantity: row.quantity,
    buyerEmail: row.buyerEmail,
    buyerName: row.buyerName,
    rail: row.rail,
    boughtByAgent: row.boughtByAgent,
    status: row.status,
    amountMinor: row.amountMinor,
    platformFeeMinor: row.platformFeeMinor,
    currency: row.currency,
    spendLimitMinor: row.spendLimitMinor,
    mandateRef: row.mandateRef,
    idempotencyKey: row.idempotencyKey,
    checkoutUrl: row.checkoutUrl,
    stripeCheckoutSessionId: row.stripeCheckoutSessionId,
    stripePaymentIntentId: row.stripePaymentIntentId,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
  };
}

export class DrizzleStore implements StorePort {
  constructor(private readonly db: Db) {}

  async getCatalog(
    eventId: string,
    ticketTypeId: string,
  ): Promise<CatalogSnapshot | null> {
    const rows = await this.db
      .select({ ev: event, tt: ticketType })
      .from(ticketType)
      .innerJoin(event, eq(ticketType.eventId, event.id))
      .where(
        and(eq(ticketType.id, ticketTypeId), eq(ticketType.eventId, eventId)),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { event: row.ev, ticketType: row.tt };
  }

  async findOrderByIdempotency(
    rail: Rail,
    buyerEmail: string,
    idempotencyKey: string,
  ): Promise<Order | null> {
    const rows = await this.db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.rail, rail),
          eq(orders.buyerEmail, buyerEmail),
          eq(orders.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return rows[0] ? mapOrder(rows[0]) : null;
  }

  async reserveInventory(
    ticketTypeId: string,
    quantity: number,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      // LAZY expiration (A7): release expired reservations for this ticket_type
      // before evaluating availability. Correctness does not depend on any cron.
      const expired = await tx
        .update(orders)
        .set({ status: "expired" })
        .where(
          and(
            eq(orders.ticketTypeId, ticketTypeId),
            eq(orders.status, "pending_payment"),
            lt(orders.expiresAt, new Date()),
          ),
        )
        .returning({ quantity: orders.quantity });
      const freed = expired.reduce((s, r) => s + r.quantity, 0);
      if (freed > 0) {
        await tx
          .update(ticketType)
          .set({ reserved: sql`${ticketType.reserved} - ${freed}` })
          .where(eq(ticketType.id, ticketTypeId));
      }

      // THE atomic reservation (data-model §4): the WHERE re-evaluates on the
      // locked row — under concurrency only those that fit within the quota pass.
      const updated = await tx
        .update(ticketType)
        .set({ reserved: sql`${ticketType.reserved} + ${quantity}` })
        .where(
          and(
            eq(ticketType.id, ticketTypeId),
            eq(ticketType.status, "active"),
            sql`${ticketType.issued} + ${ticketType.reserved} + ${quantity} <= ${ticketType.quota}`,
          ),
        )
        .returning({ id: ticketType.id });
      return updated.length === 1;
    });
  }

  async releaseInventory(
    ticketTypeId: string,
    quantity: number,
  ): Promise<void> {
    await this.db
      .update(ticketType)
      .set({ reserved: sql`${ticketType.reserved} - ${quantity}` })
      .where(
        and(
          eq(ticketType.id, ticketTypeId),
          sql`${ticketType.reserved} >= ${quantity}`,
        ),
      );
  }

  async createPendingOrder(
    input: NewOrderInput,
  ): Promise<{ order: Order; created: boolean }> {
    const inserted = await this.db
      .insert(orders)
      .values({
        id: input.id,
        eventId: input.eventId,
        ticketTypeId: input.ticketTypeId,
        quantity: input.quantity,
        buyerEmail: input.buyerEmail,
        buyerName: input.buyerName,
        rail: input.rail,
        boughtByAgent: input.boughtByAgent,
        status: "pending_payment",
        amountMinor: input.amountMinor,
        platformFeeMinor: input.platformFeeMinor,
        currency: input.currency,
        spendLimitMinor: input.spendLimitMinor,
        mandateRef: input.mandateRef,
        idempotencyKey: input.idempotencyKey,
        expiresAt: input.expiresAt,
      })
      .onConflictDoNothing({
        target: [orders.rail, orders.buyerEmail, orders.idempotencyKey],
      })
      .returning();
    if (inserted[0]) return { order: mapOrder(inserted[0]), created: true };
    // Lost the parallel retry race: return the winning order.
    const existing = await this.findOrderByIdempotency(
      input.rail,
      input.buyerEmail,
      input.idempotencyKey,
    );
    if (!existing) {
      throw new Error(
        "idempotency conflict without an existing order (inconsistency)",
      );
    }
    return { order: existing, created: false };
  }

  async attachCheckout(
    orderId: string,
    checkout: { checkoutUrl: string; sessionId: string },
  ): Promise<void> {
    await this.db
      .update(orders)
      .set({
        checkoutUrl: checkout.checkoutUrl,
        stripeCheckoutSessionId: checkout.sessionId,
      })
      .where(eq(orders.id, orderId));
  }

  async expireOrder(
    orderId: string,
    to: "expired" | "cancelled",
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(orders)
        .set({ status: to })
        .where(
          and(eq(orders.id, orderId), eq(orders.status, "pending_payment")),
        )
        .returning({
          quantity: orders.quantity,
          ticketTypeId: orders.ticketTypeId,
        });
      const row = rows[0];
      if (!row) return false; // no longer pending: idempotent no-op
      await tx
        .update(ticketType)
        .set({ reserved: sql`${ticketType.reserved} - ${row.quantity}` })
        .where(eq(ticketType.id, row.ticketTypeId));
      return true;
    });
  }

  async confirmAndIssue(
    orderId: string,
    paymentIntentId: string | null,
    seeds: TicketSeed[],
  ): Promise<ConfirmOutcome> {
    return this.db.transaction(async (tx) => {
      // THE ISSUANCE LOCK (P3): conditional transition. Two concurrent
      // webhooks → one affects 1 row and issues; the other affects 0 and exits.
      const rows = await tx
        .update(orders)
        .set({
          status: "confirmed",
          confirmedAt: new Date(),
          ...(paymentIntentId
            ? { stripePaymentIntentId: paymentIntentId }
            : {}),
        })
        .where(
          and(eq(orders.id, orderId), eq(orders.status, "pending_payment")),
        )
        .returning();
      const row = rows[0];
      if (!row) {
        const current = await tx
          .select()
          .from(orders)
          .where(eq(orders.id, orderId))
          .limit(1);
        const cur = current[0];
        if (!cur) return { outcome: "not_found" };
        if (cur.status === "confirmed") {
          return { outcome: "already_confirmed", order: mapOrder(cur) };
        }
        return { outcome: "not_pending", status: cur.status };
      }

      // reserved → issued (same tx; CHECK constraints keep watch)
      await tx
        .update(ticketType)
        .set({
          reserved: sql`${ticketType.reserved} - ${row.quantity}`,
          issued: sql`${ticketType.issued} + ${row.quantity}`,
        })
        .where(eq(ticketType.id, row.ticketTypeId));

      await tx.insert(ticket).values(
        seeds.map((s) => ({
          id: s.id,
          orderId: row.id,
          ticketTypeId: row.ticketTypeId,
          eventId: row.eventId,
          code: s.code,
          holderEmail: row.buyerEmail,
          status: "valid" as const,
        })),
      );

      // public ticker without PII (FR 13)
      const evRows = await tx
        .select({ title: event.title })
        .from(event)
        .where(eq(event.id, row.eventId))
        .limit(1);
      await tx.insert(tickerEvent).values({
        id: randomId("tick"),
        type: "order_confirmed",
        eventId: row.eventId,
        eventTitle: evRows[0]?.title ?? "",
        boughtByAgent: row.boughtByAgent,
        rail: row.rail,
      });

      return { outcome: "confirmed", order: mapOrder(row) };
    });
  }

  async getOrder(orderId: string): Promise<Order | null> {
    const rows = await this.db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    return rows[0] ? mapOrder(rows[0]) : null;
  }

  async getOrderDetail(orderId: string): Promise<OrderDetail | null> {
    const rows = await this.db
      .select({ ord: orders, ev: event })
      .from(orders)
      .innerJoin(event, eq(orders.eventId, event.id))
      .where(eq(orders.id, orderId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const tickets = await this.db
      .select({ id: ticket.id, code: ticket.code, status: ticket.status })
      .from(ticket)
      .where(eq(ticket.orderId, orderId));
    return { order: mapOrder(row.ord), event: row.ev, tickets };
  }

  async createReminder(input: {
    id: string;
    orderId: string | null;
    eventId: string;
    email: string;
    offsetsMinutes: number[];
  }): Promise<void> {
    await this.db.insert(reminder).values({
      id: input.id,
      orderId: input.orderId,
      eventId: input.eventId,
      email: input.email,
      offsetsMinutes: input.offsetsMinutes,
    });
  }

  async markStripeEventProcessed(stripeEventId: string): Promise<boolean> {
    const inserted = await this.db
      .insert(processedStripeEvent)
      .values({ id: stripeEventId })
      .onConflictDoNothing({ target: processedStripeEvent.id })
      .returning({ id: processedStripeEvent.id });
    return inserted.length === 1;
  }

  /** Wallet lookup by the authenticated agent's api_key.id (design-wallet.md §4). */
  async getWalletByApiKeyId(apiKeyId: string): Promise<Wallet | null> {
    const rows = await this.db
      .select()
      .from(wallet)
      .where(eq(wallet.apiKeyId, apiKeyId))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Upsert the wallet for an api_key (design-wallet.md §5.1 load-wallet script):
   * re-running the loader must not break the api_key_id UNIQUE.
   */
  async upsertWallet(input: UpsertWalletInput): Promise<void> {
    await this.db
      .insert(wallet)
      .values({
        id: input.id,
        apiKeyId: input.apiKeyId,
        stripeCustomerId: input.stripeCustomerId,
        stripePaymentMethodId: input.stripePaymentMethodId,
      })
      .onConflictDoUpdate({
        target: wallet.apiKeyId,
        set: {
          stripeCustomerId: input.stripeCustomerId,
          stripePaymentMethodId: input.stripePaymentMethodId,
        },
      });
  }
}
