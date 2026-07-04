/**
 * Webhook de Stripe (fix P3) — el ÚNICO camino de confirmación de pago.
 *
 * Orden deliberado: procesar PRIMERO, marcar processed_stripe_event DESPUÉS.
 * confirmAndIssue/expireOrder ya son idempotentes (UPDATE condicional = lock),
 * así que reprocesar un evento es inocuo; lo contrario (marcar y fallar antes
 * de emitir) perdería el fulfillment porque el retry de Stripe se deduplicaría.
 */
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getPurchaseCore, getStore } from "@/lib/context";
import { getStripe } from "@/lib/stripe";

export async function POST(req: Request): Promise<NextResponse> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "STRIPE_WEBHOOK_SECRET no configurado" },
      { status: 500 },
    );
  }
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "falta stripe-signature" },
      { status: 400 },
    );
  }

  const payload = await req.text();
  let stripeEvent: Stripe.Event;
  try {
    stripeEvent = await getStripe().webhooks.constructEventAsync(
      payload,
      signature,
      secret,
    );
  } catch {
    return NextResponse.json({ error: "firma inválida" }, { status: 400 });
  }

  const core = getPurchaseCore();
  switch (stripeEvent.type) {
    case "checkout.session.completed": {
      const session = stripeEvent.data.object;
      const orderId = session.metadata?.order_id;
      if (!orderId) break; // sesión ajena a OpenTicket
      const paymentIntentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : (session.payment_intent?.id ?? null);
      await core.handlePaymentSucceeded(orderId, paymentIntentId);
      break;
    }
    case "checkout.session.expired": {
      const orderId = stripeEvent.data.object.metadata?.order_id;
      if (orderId) await core.handleCheckoutExpired(orderId);
      break;
    }
    default:
      break; // tipos no suscritos: ack y listo
  }

  const firstTime = await getStore().markStripeEventProcessed(stripeEvent.id);
  return NextResponse.json({ received: true, duplicate: !firstTime });
}
