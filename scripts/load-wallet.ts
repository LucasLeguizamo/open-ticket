/**
 * Load an agent's wallet (design-wallet.md §5.1 — Stripe TEST off_session).
 *
 * Creates a Stripe TEST Customer, attaches a test PaymentMethod as default, and
 * upserts the `wallet` row bound to an api_key. After this, that agent can buy
 * off_session (no browser, no hosted checkout).
 *
 * Usage:
 *   pnpm tsx scripts/load-wallet.ts [--key key_demo] [--label demo]
 *                                   [--pm pm_card_visa] [--email agent-wallet@test.com]
 *
 * --pm accepts the Stripe test tokens: pm_card_visa (default, succeeds),
 * pm_card_chargeDeclined, pm_card_authenticationRequired (QA paths).
 * Re-runnable: upsert keyed on api_key_id.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { randomId } from "@/core";
import { createDb } from "../db/client";
import { apiKey as apiKeyTable } from "../db/schema";
import { DrizzleStore } from "../db/store";
import { getStripe } from "../lib/stripe";

const ALLOWED_PM = new Set([
  "pm_card_visa",
  "pm_card_chargeDeclined",
  "pm_card_authenticationRequired",
]);

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const val = i !== -1 ? process.argv[i + 1] : undefined;
  return val ?? fallback;
}

async function main() {
  const apiKeyId = flag("key", "key_demo");
  const label = flag("label", "demo");
  const pm = flag("pm", "pm_card_visa");
  const email = flag("email", "agent-wallet@test.com");

  if (!ALLOWED_PM.has(pm)) {
    throw new Error(
      `--pm must be one of: ${[...ALLOWED_PM].join(", ")} (got "${pm}")`,
    );
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = createDb(url, 2);
  const store = new DrizzleStore(db);

  // Validate the api_key exists before touching Stripe.
  const keyRow = await db
    .select({ id: apiKeyTable.id })
    .from(apiKeyTable)
    .where(eq(apiKeyTable.id, apiKeyId))
    .limit(1);
  if (keyRow.length === 0) {
    throw new Error(
      `api_key "${apiKeyId}" not found — run \`pnpm db:seed\` first (seeds key_demo).`,
    );
  }

  // getStripe() enforces the test-only guard (sk_test_/rk_test_).
  const stripe = getStripe();

  const customer = await stripe.customers.create({
    email,
    description: `OpenTicket agent wallet (${label}) for api_key ${apiKeyId}`,
    metadata: { api_key_id: apiKeyId, label },
  });

  // Test pm_card_* tokens attach directly (no PaymentMethod creation needed).
  // Stripe resolves the token to a concrete pm_... id — use THAT everywhere after.
  const attached = await stripe.paymentMethods.attach(pm, {
    customer: customer.id,
  });
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: attached.id },
  });

  await store.upsertWallet({
    id: randomId("wal"),
    apiKeyId,
    stripeCustomerId: customer.id,
    stripePaymentMethodId: attached.id,
  });

  console.log(
    "wallet loaded — this agent can now buy off_session (no browser)",
  );
  console.log(`  api_key_id:  ${apiKeyId}`);
  console.log(`  customer:    ${customer.id}`);
  console.log(`  payment_method: ${attached.id} (${pm})`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
