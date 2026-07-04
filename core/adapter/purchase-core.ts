/**
 * PurchaseCore — the fixed pipeline that NO rail reimplements:
 *   resolveIntent → (idempotency) → validate catalog → authorize spend
 *   → reserve inventory → create order → hosted checkout  [agent request]
 *   → [Stripe webhook] confirm (issuance lock) → issue → email + .ics
 *
 * v1: settlement `stripe_hosted` only (SYNTHESIS §2). `stripe_inline_spt`,
 * `x402` and `mpp` exist as types and return not_implemented.
 */

import { DEFAULT_ALARM_OFFSETS_MINUTES, generateIcs } from "../ics";
import { randomId } from "../ids";
import type { Logger, MailerPort, PaymentPort, StorePort } from "../ports";
import { generateTicketSeeds } from "../tickets";
import { AgentCommerceError } from "./errors";
import type {
  Money,
  Order,
  PurchaseIntent,
  PurchaseResult,
  RailAdapter,
} from "./types";

export interface PurchaseCoreDeps {
  store: StorePort;
  payments: PaymentPort;
  mailer: MailerPort;
  /** inventory reservation window in minutes. Default 30 (Stripe Checkout expires_at minimum). */
  reservationMinutes?: number;
  /** platform fee in basis points. Default 500 (flat 5%, SYNTHESIS §2). */
  platformFeeBps?: number;
  now?: () => Date;
  logger?: Logger;
}

const noopLogger: Logger = { info() {}, warn() {}, error() {} };

export type FulfillOutcome = "fulfilled" | "already_processed" | "ignored";

export class PurchaseCore {
  private readonly store: StorePort;
  private readonly payments: PaymentPort;
  private readonly mailer: MailerPort;
  private readonly reservationMinutes: number;
  private readonly platformFeeBps: number;
  private readonly now: () => Date;
  private readonly log: Logger;

  constructor(deps: PurchaseCoreDeps) {
    this.store = deps.store;
    this.payments = deps.payments;
    this.mailer = deps.mailer;
    this.reservationMinutes = deps.reservationMinutes ?? 30;
    this.platformFeeBps = deps.platformFeeBps ?? 500;
    this.now = deps.now ?? (() => new Date());
    this.log = deps.logger ?? noopLogger;
  }

  /** One-shot pipeline (MCP, web). Session rails (ACP) will compose the
   *  public primitives of this class in F2. */
  async run<Raw, Result>(
    raw: Raw,
    adapter: RailAdapter<Raw, Result>,
  ): Promise<Result> {
    const result = await this.execute(raw, adapter);
    return adapter.formatResult(result);
  }

  private async execute<Raw, Result>(
    raw: Raw,
    adapter: RailAdapter<Raw, Result>,
  ): Promise<PurchaseResult> {
    if (adapter.settlement !== "stripe_hosted") {
      throw new AgentCommerceError(
        "not_implemented",
        `settlement "${adapter.settlement}" not implemented in v1 (stripe_hosted only)`,
      );
    }
    if (adapter.authorization === "ap2_mandate") {
      throw new AgentCommerceError(
        "not_implemented",
        "AP2 mandate verification not implemented in v1",
      );
    }

    const intent = adapter.resolveIntent(raw); // validates (Zod) or throws invalid_intent
    this.assertBasicIntent(intent);

    // 1. Buyer-scoped idempotency (fix P4): retry = same order.
    const existing = await this.store.findOrderByIdempotency(
      intent.rail,
      intent.buyer.email,
      intent.idempotencyKey,
    );
    if (existing) return this.toResult(existing, true);

    // 2. Catalog + event availability.
    const catalog = await this.store.getCatalog(
      intent.eventId,
      intent.ticketTypeId,
    );
    if (!catalog) {
      throw new AgentCommerceError(
        "invalid_intent",
        "event_id or ticket_type_id does not exist",
      );
    }
    const { event, ticketType } = catalog;
    if (event.status !== "published" || ticketType.status === "hidden") {
      throw new AgentCommerceError(
        "event_unavailable",
        "the event is not available for sale",
      );
    }

    // 3. Spend authorization BEFORE reserving/charging (adapter §5).
    const amountMinor = ticketType.priceMinor * intent.quantity;
    this.enforceSpendLimit(
      adapter.authorization,
      intent,
      amountMinor,
      event.currency,
    );

    // 4. Atomic reservation (conditional UPDATE; CHECK constraint = final safety net).
    const reserved = await this.store.reserveInventory(
      intent.ticketTypeId,
      intent.quantity,
    );
    if (!reserved) {
      throw new AgentCommerceError("sold_out", "inventory sold out", {
        ticketTypeId: intent.ticketTypeId,
      });
    }

    // 5. pending_payment order. If we lost a parallel idempotency race,
    //    release OUR reservation and return the winning order.
    const expiresAt = new Date(
      this.now().getTime() + this.reservationMinutes * 60_000,
    );
    const { order, created } = await this.store.createPendingOrder({
      id: randomId("ord"),
      eventId: intent.eventId,
      ticketTypeId: intent.ticketTypeId,
      quantity: intent.quantity,
      buyerEmail: intent.buyer.email,
      buyerName: intent.buyer.name ?? null,
      rail: intent.rail,
      boughtByAgent: intent.rail !== "web",
      amountMinor,
      platformFeeMinor: Math.round(
        (amountMinor * this.platformFeeBps) / 10_000,
      ),
      currency: event.currency,
      spendLimitMinor: intent.spendLimit?.amountMinor ?? null,
      mandateRef: null,
      idempotencyKey: intent.idempotencyKey,
      expiresAt,
    });
    if (!created) {
      await this.store.releaseInventory(intent.ticketTypeId, intent.quantity);
      return this.toResult(order, true);
    }

    // 6. Hosted checkout (Q1). On failure, release inventory — never orphan a reservation.
    try {
      const checkout = await this.payments.createHostedCheckout({
        orderId: order.id,
        currency: event.currency,
        unitAmountMinor: ticketType.priceMinor,
        quantity: intent.quantity,
        description: `${event.title} — ${ticketType.name}`,
        customerEmail: intent.buyer.email,
        expiresAt,
      });
      await this.store.attachCheckout(order.id, checkout);
      return this.toResult(
        { ...order, checkoutUrl: checkout.checkoutUrl },
        false,
      );
    } catch (err) {
      await this.store.expireOrder(order.id, "cancelled");
      throw new AgentCommerceError(
        "payment_failed",
        "could not create the payment checkout",
        { cause: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  /**
   * Webhook confirmation (fix P3). Idempotent by design:
   * the conditional UPDATE inside confirmAndIssue is the issuance lock.
   * Golden rule: if the email fails POST-capture, NOTHING is rolled back.
   */
  async handlePaymentSucceeded(
    orderId: string,
    paymentIntentId: string | null,
  ): Promise<FulfillOutcome> {
    const order = await this.store.getOrder(orderId);
    if (!order) {
      this.log.warn("webhook for nonexistent order", { orderId });
      return "ignored";
    }
    const seeds = generateTicketSeeds(order.quantity);
    const outcome = await this.store.confirmAndIssue(
      orderId,
      paymentIntentId,
      seeds,
    );
    if (outcome.outcome === "already_confirmed") return "already_processed";
    if (outcome.outcome !== "confirmed") {
      // e.g. payment arrived for an already-expired order: do NOT issue; log for
      // manual review/refund (test-strategy §2.3 "out-of-order webhook" contract).
      this.log.error(
        "payment webhook on non-pending order: review for refund",
        {
          orderId,
          outcome: outcome.outcome,
        },
      );
      return "ignored";
    }

    // fulfill: reminder + .ics email — failures here NEVER roll back the charge.
    try {
      await this.store.createReminder({
        id: randomId("rem"),
        orderId,
        eventId: order.eventId,
        email: order.buyerEmail,
        offsetsMinutes: DEFAULT_ALARM_OFFSETS_MINUTES,
      });
    } catch (err) {
      this.log.error("createReminder failed (non-blocking)", {
        orderId,
        err: String(err),
      });
    }
    try {
      const detail = await this.store.getOrderDetail(orderId);
      if (detail) {
        const ics = generateIcs({
          uid: `${orderId}@openticket`,
          title: detail.event.title,
          location: detail.event.venue ?? undefined,
          startsAt: detail.event.startsAt,
          endsAt: detail.event.endsAt,
          description: `Tickets: ${detail.tickets.map((t) => t.code).join(", ")}`,
        });
        await this.mailer.sendTicketEmail({
          to: order.buyerEmail,
          orderId,
          eventTitle: detail.event.title,
          eventStartsAt: detail.event.startsAt,
          venue: detail.event.venue,
          tickets: detail.tickets.map((t) => ({ code: t.code })),
          amount: { amountMinor: order.amountMinor, currency: order.currency },
          icsContent: ics,
          icsPath: `/r/${orderId}`,
        });
      }
    } catch (err) {
      this.log.error("ticket email failed; retried via job (no rollback)", {
        orderId,
        err: String(err),
      });
    }
    return "fulfilled";
  }

  /** Expired/abandoned checkout: releases the reservation (idempotent). */
  async handleCheckoutExpired(orderId: string): Promise<boolean> {
    return this.store.expireOrder(orderId, "expired");
  }

  /** Order state as a PurchaseResult (for get_order / order page). */
  async getOrderResult(orderId: string): Promise<PurchaseResult | null> {
    const order = await this.store.getOrder(orderId);
    if (!order) return null;
    return this.toResult(order, false);
  }

  // ── private ─────────────────────────────────────────────────────────────

  private assertBasicIntent(intent: PurchaseIntent): void {
    if (
      !Number.isInteger(intent.quantity) ||
      intent.quantity < 1 ||
      intent.quantity > 10
    ) {
      throw new AgentCommerceError(
        "invalid_intent",
        "quantity must be an integer 1..10",
      );
    }
    if (!intent.buyer.email) {
      throw new AgentCommerceError("invalid_intent", "buyer.email is required");
    }
    if (!intent.idempotencyKey) {
      throw new AgentCommerceError(
        "invalid_intent",
        "idempotency_key is required",
      );
    }
  }

  private enforceSpendLimit(
    authorization: RailAdapter["authorization"],
    intent: PurchaseIntent,
    amountMinor: number,
    eventCurrency: string,
  ): void {
    if (authorization !== "spend_limit") return;
    const limit = intent.spendLimit;
    if (!limit) {
      throw new AgentCommerceError(
        "invalid_intent",
        "spend_limit is required without an AP2 mandate (adapter Q2)",
      );
    }
    if (limit.currency !== eventCurrency) {
      // never compare amounts in different currencies as the same unit
      throw new AgentCommerceError(
        "invalid_intent",
        `spend_limit.currency (${limit.currency}) does not match the event currency (${eventCurrency})`,
      );
    }
    if (amountMinor > limit.amountMinor) {
      throw new AgentCommerceError(
        "mandate_exceeded",
        "the total exceeds the authorized spend_limit",
        { amountMinor, limitMinor: limit.amountMinor },
      );
    }
  }

  private async toResult(
    order: Order,
    duplicate: boolean,
  ): Promise<PurchaseResult> {
    const detail = await this.store.getOrderDetail(order.id);
    const money: Money = {
      amountMinor: order.amountMinor,
      currency: order.currency,
    };
    return {
      status: order.status,
      duplicate,
      orderId: order.id,
      checkoutUrl:
        order.status === "pending_payment" ? order.checkoutUrl : null,
      expiresAt: order.status === "pending_payment" ? order.expiresAt : null,
      amount: money,
      platformFee: {
        amountMinor: order.platformFeeMinor,
        currency: order.currency,
      },
      event: detail
        ? {
            id: detail.event.id,
            title: detail.event.title,
            startsAt: detail.event.startsAt,
            venue: detail.event.venue,
          }
        : {
            id: order.eventId,
            title: "",
            startsAt: order.createdAt,
            venue: null,
          },
      tickets: detail?.tickets ?? [],
      icsPath: order.status === "confirmed" ? `/r/${order.id}` : null,
    };
  }
}
