/**
 * THE MOST IMPORTANT TEST IN THE PROJECT (test-strategy §2.2): overselling and
 * idempotency under real concurrency. REAL Postgres, never a mock — the bug
 * lives in the conditional UPDATE + CHECK constraint.
 *
 * Requires: local Postgres (brew services start postgresql@16) with the
 * `openticket_test` DB created (createdb openticket_test). No docker.
 * Run with: pnpm test:integration
 */
import { execSync } from "node:child_process";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { isAgentCommerceError } from "@/core/adapter/errors";
import { PurchaseCore } from "@/core/adapter/purchase-core";
import { mcpRail } from "@/core/adapter/rails/mcp";
import type { MailerPort, PaymentPort } from "@/core/ports";
import { createDb, type Db } from "@/db/client";
import {
  event,
  orders,
  organizer,
  reminder,
  tickerEvent,
  ticket,
  ticketType,
} from "@/db/schema";
import { DrizzleStore } from "@/db/store";

const DB_URL = process.env.DATABASE_URL ?? "";

async function isDbUp(): Promise<boolean> {
  const pool = new Pool({
    connectionString: DB_URL,
    connectionTimeoutMillis: 1500,
  });
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => {});
  }
}

const dbUp = await isDbUp();
if (!dbUp) {
  console.warn(
    "\n⚠ Test Postgres is not responding at " +
      DB_URL +
      "\n  Start it with: brew services start postgresql@16 && createdb openticket_test\n",
  );
}

const fakePayments: PaymentPort = {
  async createHostedCheckout(input) {
    return {
      checkoutUrl: `https://checkout.test/${input.orderId}`,
      sessionId: `cs_${input.orderId}`,
    };
  },
};
const silentMailer: MailerPort = { sendTicketEmail: async () => {} };

describe.skipIf(!dbUp)(
  "inventory and idempotency under concurrency (real Postgres)",
  () => {
    let db: Db;
    let store: DrizzleStore;
    let core: PurchaseCore;

    beforeAll(() => {
      execSync("npx drizzle-kit push --force", {
        env: { ...process.env, DATABASE_URL: DB_URL },
        stdio: "pipe",
      });
      db = createDb(DB_URL, 60); // big pool: 50 genuinely parallel purchases
      store = new DrizzleStore(db);
      core = new PurchaseCore({
        store,
        payments: fakePayments,
        mailer: silentMailer,
      });
    });

    afterAll(async () => {
      // the pool closes when the vitest process dies; tmpfs self-destructs
    });

    beforeEach(async () => {
      await db.delete(reminder);
      await db.delete(tickerEvent);
      await db.delete(ticket);
      await db.delete(orders);
      await db.delete(ticketType);
      await db.delete(event);
      await db.delete(organizer);
      await db
        .insert(organizer)
        .values({ id: "org_t", name: "t", email: "t@t.co" });
      await db.insert(event).values({
        id: "evt_t",
        organizerId: "org_t",
        title: "Last Ticket Show",
        slug: "last-ticket",
        startsAt: new Date(Date.now() + 86_400_000),
        currency: "USD",
        status: "published",
      });
    });

    function buy(i: number, quantity = 1) {
      return core.run(
        {
          event_id: "evt_t",
          ticket_type_id: "tt_t",
          quantity,
          buyer_email: `agent${i}@t.co`,
          idempotency_key: `key-${i}-abcdefgh`,
          spend_limit: { amount_minor: 100_000, currency: "USD" },
        },
        mcpRail,
      );
    }

    it("50 agents go for the last ticket → EXACTLY 1 reservation, 49 sold_out (R2)", async () => {
      await db.insert(ticketType).values({
        id: "tt_t",
        eventId: "evt_t",
        name: "Last",
        priceMinor: 1000,
        quota: 1,
      });

      const results = await Promise.allSettled(
        Array.from({ length: 50 }, (_, i) => buy(i)),
      );

      const reserved = results.filter(
        (r) => r.status === "fulfilled" && r.value.status === "pending_payment",
      );
      const soldOut = results.filter(
        (r) =>
          r.status === "rejected" &&
          isAgentCommerceError(r.reason) &&
          r.reason.code === "sold_out",
      );
      expect(reserved).toHaveLength(1);
      expect(soldOut).toHaveLength(49);

      const [row] = await db.select().from(ticketType);
      expect(row!.reserved).toBe(1);
      expect(row!.issued).toBe(0);
    });

    it("same agent retries 10 times IN PARALLEL with the same key → only 1 order (R1)", async () => {
      await db.insert(ticketType).values({
        id: "tt_t",
        eventId: "evt_t",
        name: "GA",
        priceMinor: 1000,
        quota: 100,
      });

      const results = await Promise.all(
        Array.from({ length: 10 }, () => buy(7, 2)), // same key-7
      );

      const orderIds = new Set(results.map((r) => r.order_id));
      expect(orderIds.size).toBe(1);
      expect(results.filter((r) => !r.duplicate)).toHaveLength(1);

      const [row] = await db.select().from(ticketType);
      expect(row!.reserved).toBe(2); // a single reservation of qty=2, not 20
      const allOrders = await db.select().from(orders);
      expect(allOrders).toHaveLength(1);
    });

    it("duplicate and concurrent payment webhook → only 1 ticket issuance (R1)", async () => {
      await db.insert(ticketType).values({
        id: "tt_t",
        eventId: "evt_t",
        name: "GA",
        priceMinor: 1000,
        quota: 10,
      });
      const res = await buy(1, 2);

      const outcomes = await Promise.all([
        core.handlePaymentSucceeded(res.order_id, "pi_dup"),
        core.handlePaymentSucceeded(res.order_id, "pi_dup"),
        core.handlePaymentSucceeded(res.order_id, "pi_dup"),
      ]);

      expect(outcomes.filter((o) => o === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter((o) => o === "already_processed")).toHaveLength(2);

      const issued = await db.select().from(ticket);
      expect(issued).toHaveLength(2); // qty, not qty×3
      const [row] = await db.select().from(ticketType);
      expect(row!.issued).toBe(2);
      expect(row!.reserved).toBe(0);
    });

    it("expired order releases inventory and the late payment does NOT issue (R5/R7)", async () => {
      await db.insert(ticketType).values({
        id: "tt_t",
        eventId: "evt_t",
        name: "GA",
        priceMinor: 1000,
        quota: 1,
      });
      const res = await buy(1);
      expect(await core.handleCheckoutExpired(res.order_id)).toBe(true);

      // the inventory came back: another agent can buy
      const second = await buy(2);
      expect(second.status).toBe("pending_payment");

      // late webhook from the first one: ignored, no tickets
      expect(await core.handlePaymentSucceeded(res.order_id, "pi_late")).toBe(
        "ignored",
      );
      const issued = await db.select().from(ticket);
      expect(issued).toHaveLength(0);
    });
  },
);
