/**
 * PurchaseCore — el pipeline fijo que NINGÚN rail reimplementa:
 *   resolveIntent → (idempotencia) → validar catálogo → autorizar gasto
 *   → reservar cupo → crear orden → checkout hospedado  [request del agente]
 *   → [webhook Stripe] confirmar (lock de emisión) → emitir → email + .ics
 *
 * v1: settlement `stripe_hosted` únicamente (SYNTHESIS §2). `stripe_inline_spt`,
 * `x402` y `mpp` existen como tipos y devuelven not_implemented.
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
  /** minutos de reserva de cupo. Default 30 (mínimo de Stripe Checkout expires_at). */
  reservationMinutes?: number;
  /** fee de plataforma en basis points. Default 500 (5% plano, SYNTHESIS §2). */
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

  /** Pipeline one-shot (MCP, web). Los rails de sesión (ACP) compondrán los
   *  primitivos públicos de esta clase en F2. */
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
        `settlement "${adapter.settlement}" no implementado en v1 (solo stripe_hosted)`,
      );
    }
    if (adapter.authorization === "ap2_mandate") {
      throw new AgentCommerceError(
        "not_implemented",
        "verificación de mandates AP2 no implementada en v1",
      );
    }

    const intent = adapter.resolveIntent(raw); // valida (Zod) o tira invalid_intent
    this.assertBasicIntent(intent);

    // 1. Idempotencia con scope de comprador (fix P4): reintento = misma orden.
    const existing = await this.store.findOrderByIdempotency(
      intent.rail,
      intent.buyer.email,
      intent.idempotencyKey,
    );
    if (existing) return this.toResult(existing, true);

    // 2. Catálogo + disponibilidad del evento.
    const catalog = await this.store.getCatalog(
      intent.eventId,
      intent.ticketTypeId,
    );
    if (!catalog) {
      throw new AgentCommerceError(
        "invalid_intent",
        "event_id o ticket_type_id inexistentes",
      );
    }
    const { event, ticketType } = catalog;
    if (event.status !== "published" || ticketType.status === "hidden") {
      throw new AgentCommerceError(
        "event_unavailable",
        "el evento no está disponible para la venta",
      );
    }

    // 3. Autorización de gasto ANTES de reservar/cobrar (adapter §5).
    const amountMinor = ticketType.priceMinor * intent.quantity;
    this.enforceSpendLimit(
      adapter.authorization,
      intent,
      amountMinor,
      event.currency,
    );

    // 4. Reserva atómica (UPDATE condicional; CHECK constraint = red final).
    const reserved = await this.store.reserveInventory(
      intent.ticketTypeId,
      intent.quantity,
    );
    if (!reserved) {
      throw new AgentCommerceError("sold_out", "cupo agotado", {
        ticketTypeId: intent.ticketTypeId,
      });
    }

    // 5. Orden pending_payment. Si perdimos un race de idempotencia paralela,
    //    liberamos NUESTRA reserva y devolvemos la orden ganadora.
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

    // 6. Checkout hospedado (Q1). Si falla, liberar cupo — nunca cupo huérfano.
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
        "no se pudo crear el checkout de pago",
        { cause: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  /**
   * Confirmación por webhook (fix P3). Idempotente por diseño:
   * el UPDATE condicional dentro de confirmAndIssue es el lock de emisión.
   * Regla de oro: si el email falla POST-capture, NO se revierte nada.
   */
  async handlePaymentSucceeded(
    orderId: string,
    paymentIntentId: string | null,
  ): Promise<FulfillOutcome> {
    const order = await this.store.getOrder(orderId);
    if (!order) {
      this.log.warn("webhook para orden inexistente", { orderId });
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
      // p.ej. pago llegó sobre orden ya expirada: NO emitir; loguear para revisión
      // manual/refund (contrato de test-strategy §2.3 "webhook fuera de orden").
      this.log.error("webhook de pago sobre orden no-pending: revisar refund", {
        orderId,
        outcome: outcome.outcome,
      });
      return "ignored";
    }

    // fulfill: reminder + email .ics — fallos acá NUNCA revierten el cargo.
    try {
      await this.store.createReminder({
        id: randomId("rem"),
        orderId,
        eventId: order.eventId,
        email: order.buyerEmail,
        offsetsMinutes: DEFAULT_ALARM_OFFSETS_MINUTES,
      });
    } catch (err) {
      this.log.error("createReminder falló (no bloquea)", {
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
      this.log.error("email de ticket falló; reintento vía job (no revierte)", {
        orderId,
        err: String(err),
      });
    }
    return "fulfilled";
  }

  /** Checkout expirado/abandonado: libera la reserva (idempotente). */
  async handleCheckoutExpired(orderId: string): Promise<boolean> {
    return this.store.expireOrder(orderId, "expired");
  }

  /** Estado de una orden en forma de PurchaseResult (para get_order / página de orden). */
  async getOrderResult(orderId: string): Promise<PurchaseResult | null> {
    const order = await this.store.getOrder(orderId);
    if (!order) return null;
    return this.toResult(order, false);
  }

  // ── privados ────────────────────────────────────────────────────────────

  private assertBasicIntent(intent: PurchaseIntent): void {
    if (
      !Number.isInteger(intent.quantity) ||
      intent.quantity < 1 ||
      intent.quantity > 10
    ) {
      throw new AgentCommerceError(
        "invalid_intent",
        "quantity debe ser entero 1..10",
      );
    }
    if (!intent.buyer.email) {
      throw new AgentCommerceError(
        "invalid_intent",
        "buyer.email es requerido",
      );
    }
    if (!intent.idempotencyKey) {
      throw new AgentCommerceError(
        "invalid_intent",
        "idempotency_key es requerida",
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
        "spend_limit es obligatorio sin mandate AP2 (adapter Q2)",
      );
    }
    if (limit.currency !== eventCurrency) {
      // nunca comparar montos de monedas distintas como misma unidad
      throw new AgentCommerceError(
        "invalid_intent",
        `spend_limit.currency (${limit.currency}) no coincide con la moneda del evento (${eventCurrency})`,
      );
    }
    if (amountMinor > limit.amountMinor) {
      throw new AgentCommerceError(
        "mandate_exceeded",
        "el total excede el spend_limit autorizado",
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
