/**
 * Dependency composition — the ONLY place where the core knows its real
 * implementations (Drizzle, Stripe, Resend). Lazy: nothing connects at
 * build time.
 */
import { PurchaseCore } from "@/core/adapter/purchase-core";
import type { StorePort } from "@/core/ports";
import { getDb } from "@/db/client";
import { DrizzleStore } from "@/db/store";
import { createMailer } from "@/lib/email/mailer";
import { createStripePaymentPort } from "@/lib/stripe";

let _store: StorePort | undefined;
let _core: PurchaseCore | undefined;

export function getStore(): StorePort {
  if (!_store) _store = new DrizzleStore(getDb());
  return _store;
}

export function getPurchaseCore(): PurchaseCore {
  if (!_core) {
    _core = new PurchaseCore({
      store: getStore(),
      payments: createStripePaymentPort(),
      mailer: createMailer(),
      reservationMinutes: Number(process.env.RESERVATION_MINUTES ?? 30),
      platformFeeBps: Number(process.env.PLATFORM_FEE_BPS ?? 500),
      logger: console,
    });
  }
  return _core;
}
