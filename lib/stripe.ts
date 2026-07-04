import Stripe from "stripe";
import type { PaymentPort } from "@/core/ports";

let _stripe: Stripe | undefined;

/**
 * Cliente Stripe lazy. GUARD: solo claves de test (sk_test_/rk_test_) salvo
 * override explícito — nadie dispara Stripe live por accidente en el hackathon.
 */
export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY no está configurada (ver README paso 4)",
    );
  }
  const isTestKey = key.startsWith("sk_test_") || key.startsWith("rk_test_");
  if (!isTestKey && process.env.ALLOW_LIVE_STRIPE !== "true") {
    throw new Error(
      "STRIPE_SECRET_KEY no es de test mode. Usa sk_test_... (o ALLOW_LIVE_STRIPE=true bajo tu responsabilidad).",
    );
  }
  _stripe = new Stripe(key);
  return _stripe;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

/** Implementación del PaymentPort con Stripe Checkout hospedado (Q1). */
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
        // Nota: Stripe exige expires_at >= 30 min → la reserva de cupo se
        // alineó a 30 min (RESERVATION_MINUTES), no a los 15 del data-model Q2.
        expires_at: Math.floor(input.expiresAt.getTime() / 1000),
        success_url: `${appUrl()}/orders/${input.orderId}?paid=1`,
        cancel_url: `${appUrl()}/orders/${input.orderId}?cancelled=1`,
      });
      if (!session.url) throw new Error("Stripe no devolvió checkout URL");
      return { checkoutUrl: session.url, sessionId: session.id };
    },
  };
}
