import Stripe from "stripe";
import type { ChargeOffSessionResult, PaymentPort } from "@/core/ports";

let _stripe: Stripe | undefined;

/**
 * Lazy Stripe client. GUARD: test keys only (sk_test_/rk_test_) unless
 * explicitly overridden — nobody hits live Stripe by accident during the hackathon.
 */
export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set (see README step 4)");
  }
  const isTestKey = key.startsWith("sk_test_") || key.startsWith("rk_test_");
  if (!isTestKey && process.env.ALLOW_LIVE_STRIPE !== "true") {
    throw new Error(
      "STRIPE_SECRET_KEY is not a test-mode key. Use sk_test_... (or set ALLOW_LIVE_STRIPE=true at your own risk).",
    );
  }
  _stripe = new Stripe(key);
  return _stripe;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

/** PaymentPort implementation using hosted Stripe Checkout (Q1). */
export function createStripePaymentPort(): PaymentPort {
  return {
    async createHostedCheckout(input) {
      const stripe = getStripe();
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [
          {
            quantity: input.quantity,
            price_data: {
              currency: input.currency.toLowerCase(),
              unit_amount: input.unitAmountMinor,
              product_data: { name: input.description },
            },
          },
        ],
        customer_email: input.customerEmail,
        metadata: { order_id: input.orderId },
        payment_intent_data: { metadata: { order_id: input.orderId } },
        // Note: Stripe requires expires_at >= 30 min → the inventory hold was
        // aligned to 30 min (RESERVATION_MINUTES), not the 15 from data-model Q2.
        expires_at: Math.floor(input.expiresAt.getTime() / 1000),
        success_url: `${appUrl()}/orders/${input.orderId}?paid=1`,
        cancel_url: `${appUrl()}/orders/${input.orderId}?cancelled=1`,
      });
      if (!session.url) throw new Error("Stripe did not return a checkout URL");
      return { checkoutUrl: session.url, sessionId: session.id };
    },

    async chargeOffSession(input): Promise<ChargeOffSessionResult> {
      const stripe = getStripe(); // GUARD test-only intact
      try {
        const pi = await stripe.paymentIntents.create(
          {
            amount: input.amountMinor,
            currency: input.currency.toLowerCase(),
            customer: input.customerId,
            payment_method: input.paymentMethodId,
            off_session: true,
            confirm: true,
            description: input.description,
            metadata: { order_id: input.orderId },
          },
          // de-dup at Stripe level: same order → same PaymentIntent, no double charge
          { idempotencyKey: `pi_${input.idempotencyKey}` },
        );
        // confirm:true + off_session → normally "succeeded", or throws StripeCardError.
        if (pi.status === "succeeded") {
          return { status: "succeeded", paymentIntentId: pi.id };
        }
        // Defensive: if a status ever comes back without a throw, map it too.
        if (pi.status === "requires_action") {
          return { status: "requires_action", paymentIntentId: pi.id };
        }
        return {
          status: "failed",
          paymentIntentId: pi.id,
          failureReason: pi.status,
        };
      } catch (err) {
        // off_session 3DS does NOT return as status "requires_action": Stripe
        // THROWS a StripeCardError with the payment_intent attached.
        if (err instanceof Stripe.errors.StripeCardError) {
          const pi = err.payment_intent;
          if (err.code === "authentication_required") {
            return {
              status: "requires_action",
              paymentIntentId: pi?.id ?? null,
            };
          }
          // card_declined and any other card error → decline.
          return {
            status: "failed",
            paymentIntentId: pi?.id ?? null,
            failureReason: err.decline_code ?? err.code ?? "card_declined",
          };
        }
        // Non-card errors (network, config) bubble up; the core releases + payment_failed.
        throw err;
      }
    },
  };
}
