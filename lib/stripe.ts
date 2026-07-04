import Stripe from "stripe";
import type { PaymentPort } from "@/core/ports";

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
  };
}
