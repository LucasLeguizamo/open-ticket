/**
 * Stripe webhook (fix P3) — the ONLY path for payment confirmation.
 *
 * Deliberate ordering: process FIRST, mark processed_stripe_event AFTER.
 * confirmAndIssue/expireOrder are already idempotent (conditional UPDATE =
 * lock), so reprocessing an event is harmless; the opposite (mark then fail
 * before issuing) would lose the fulfillment because Stripe's retry would be
 * deduplicated.
 */
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getPurchaseCore, getStore } from "@/lib/context";
import { getStripe } from "@/lib/stripe";

export async function POST(req: Request): Promise<NextResponse> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "STRIPE_WEBHOOK_SECRET not configured" },
      { status: 500 },
    );
  }
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "missing stripe-signature" },
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
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const core = getPurchaseCore();
  switch (stripeEvent.type) {
    case "checkout.session.completed": {
      const session = stripeEvent.data.object;
      const orderId = session.metadata?.order_id;
      if (!orderId) break; // session not from OpenTicket
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
      break; // unsubscribed types: ack and done
  }

  const firstTime = await getStore().markStripeEventProcessed(stripeEvent.id);
  return NextResponse.json({ received: true, duplicate: !firstTime });
}
