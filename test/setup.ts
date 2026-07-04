/**
 * Setup global de tests: carga .env.test y ABORTA si la clave de Stripe no es
 * de test mode (nadie corre la suite contra dinero real).
 */
import { config } from "dotenv";

config({ path: ".env.test", override: true });

const key = process.env.STRIPE_SECRET_KEY ?? "";
if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
  throw new Error(
    `test/setup.ts: STRIPE_SECRET_KEY debe ser de test mode (sk_test_...), llegó "${key.slice(0, 8)}..."`,
  );
}
