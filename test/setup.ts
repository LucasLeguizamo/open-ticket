/**
 * Global test setup: loads .env.test and ABORTS if the Stripe key is not
 * test mode (nobody runs the suite against real money).
 */
import { config } from "dotenv";

config({ path: ".env.test", override: true });

const key = process.env.STRIPE_SECRET_KEY ?? "";
if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
  throw new Error(
    `test/setup.ts: STRIPE_SECRET_KEY must be test mode (sk_test_...), got "${key.slice(0, 8)}..."`,
  );
}
