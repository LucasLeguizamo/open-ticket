/**
 * Unit tests for the PurchaseCore pipeline (test-strategy §2.1) with FakeStore.
 * Each error verifies (a) the correct code and (b) inventory/order state.
 */
import { describe, expect, it, vi } from "vitest";
import {
  type AgentCommerceError,
  isAgentCommerceError,
} from "@/core/adapter/errors";
import { PurchaseCore } from "@/core/adapter/purchase-core";
import { mcpRail, mcpWalletRail } from "@/core/adapter/rails/mcp";
import { webRail } from "@/core/adapter/rails/web";
import type {
  ChargeOffSessionInput,
  ChargeOffSessionResult,
  MailerPort,
  PaymentPort,
} from "@/core/ports";
import { FakeStore, makeEvent, makeTicketType } from "../helpers/fake-store";

const okPayments: PaymentPort = {
  async createHostedCheckout(input) {
    return {
      checkoutUrl: `https://checkout.test/${input.orderId}`,
      sessionId: `cs_${input.orderId}`,
    };
  },
};
const okMailer: MailerPort = { sendTicketEmail: vi.fn(async () => {}) };

function makeCore(
  store: FakeStore,
  overrides: { payments?: PaymentPort; mailer?: MailerPort } = {},
) {
  return new PurchaseCore({
    store,
    payments: overrides.payments ?? okPayments,
    mailer: overrides.mailer ?? okMailer,
    reservationMinutes: 30,
    platformFeeBps: 500,
  });
}

function buyInput(overrides: Record<string, unknown> = {}) {
  return {
    event_id: "evt_1",
    ticket_type_id: "tt_1",
    quantity: 2,
    buyer_email: "aria@agent.ai",
    idempotency_key: "key-12345678",
    spend_limit: { amount_minor: 20_000, currency: "USD" },
    ...overrides,
  };
}

async function expectError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    expect.unreachable(`expected AgentCommerceError ${code}`);
  } catch (err) {
    if (!isAgentCommerceError(err)) throw err;
    expect(err.code).toBe(code);
    return err as AgentCommerceError;
  }
}

describe("PurchaseCore.run (MCP rail, hosted payment)", () => {
  it("happy path: pending_payment order, inventory reserved, checkout_url, 0 tickets", async () => {
    const store = new FakeStore();
    const res = await makeCore(store).run(buyInput(), mcpRail);
    expect(res.status).toBe("pending_payment");
    expect(res.duplicate).toBe(false);
    expect(res.checkout_url).toMatch(/^https:\/\/checkout\.test\//);
    expect(res.poll).toBe(`get_order(${res.order_id})`);
    expect(res.tickets).toHaveLength(0);
    expect(store.ticketType.reserved).toBe(2);
    expect(store.ticketType.issued).toBe(0);
    const order = store.orders.get(res.order_id)!;
    expect(order.amountMinor).toBe(10_000);
    expect(order.platformFeeMinor).toBe(500); // flat 5% (SYNTHESIS §2)
    expect(order.boughtByAgent).toBe(true);
  });

  it("retry with the same idempotency_key returns the SAME order without reserving again", async () => {
    const store = new FakeStore();
    const core = makeCore(store);
    const first = await core.run(buyInput(), mcpRail);
    const retry = await core.run(buyInput(), mcpRail);
    expect(retry.order_id).toBe(first.order_id);
    expect(retry.duplicate).toBe(true);
    expect(store.ticketType.reserved).toBe(2); // not 4
    expect(store.orders.size).toBe(1);
  });

  it("sold_out: inventory exhausted → error, no order, reserved untouched", async () => {
    const store = new FakeStore({ ticketType: makeTicketType({ quota: 1 }) });
    await expectError(makeCore(store).run(buyInput(), mcpRail), "sold_out");
    expect(store.orders.size).toBe(0);
    expect(store.ticketType.reserved).toBe(0);
  });

  it("mandate_exceeded: total > spend_limit, BEFORE reserving", async () => {
    const store = new FakeStore();
    await expectError(
      makeCore(store).run(
        buyInput({ spend_limit: { amount_minor: 9_999, currency: "USD" } }),
        mcpRail,
      ),
      "mandate_exceeded",
    );
    expect(store.ticketType.reserved).toBe(0);
    expect(store.orders.size).toBe(0);
  });

  it("spend_limit is REQUIRED on the MCP rail (Q2)", async () => {
    const store = new FakeStore();
    await expectError(
      makeCore(store).run(buyInput({ spend_limit: undefined }), mcpRail),
      "invalid_intent",
    );
  });

  it("spend_limit in a different currency than the event → invalid_intent (never compare FX)", async () => {
    const store = new FakeStore();
    await expectError(
      makeCore(store).run(
        buyInput({ spend_limit: { amount_minor: 1_000_000, currency: "COP" } }),
        mcpRail,
      ),
      "invalid_intent",
    );
  });

  it("adversarial input: quantity 0, invalid email, extra props → invalid_intent", async () => {
    const store = new FakeStore();
    const core = makeCore(store);
    await expectError(
      core.run(buyInput({ quantity: 0 }), mcpRail),
      "invalid_intent",
    );
    await expectError(
      core.run(buyInput({ buyer_email: "a@b\r\nBcc: spam@x.co" }), mcpRail),
      "invalid_intent",
    );
    await expectError(
      core.run(buyInput({ hack: true }), mcpRail),
      "invalid_intent",
    );
    expect(store.orders.size).toBe(0);
  });

  it("nonexistent ticket_type → invalid_intent", async () => {
    const store = new FakeStore();
    await expectError(
      makeCore(store).run(buyInput({ ticket_type_id: "tt_nope" }), mcpRail),
      "invalid_intent",
    );
  });

  it("draft event → event_unavailable, no reservation", async () => {
    const store = new FakeStore({ event: makeEvent({ status: "draft" }) });
    await expectError(
      makeCore(store).run(buyInput(), mcpRail),
      "event_unavailable",
    );
    expect(store.ticketType.reserved).toBe(0);
  });

  it("Stripe checkout fails → payment_failed, order cancelled, inventory released", async () => {
    const store = new FakeStore();
    const core = makeCore(store, {
      payments: {
        createHostedCheckout: async () => {
          throw new Error("stripe down");
        },
      },
    });
    await expectError(core.run(buyInput(), mcpRail), "payment_failed");
    expect(store.ticketType.reserved).toBe(0);
    const [order] = [...store.orders.values()];
    expect(order!.status).toBe("cancelled");
  });

  it("web rail: without spend_limit (authorization=none) passes; boughtByAgent=false", async () => {
    const store = new FakeStore();
    const res = await makeCore(store).run(
      buyInput({ spend_limit: undefined }),
      webRail,
    );
    expect(res.status).toBe("pending_payment");
    expect(store.orders.get(res.order_id)!.boughtByAgent).toBe(false);
  });
});

describe("PurchaseCore.handlePaymentSucceeded (webhook)", () => {
  async function pendingOrder(core: PurchaseCore) {
    const res = await core.run(buyInput(), mcpRail);
    return res.order_id;
  }

  it("confirms: reserved→issued, N valid tickets, reminder + email fired", async () => {
    const store = new FakeStore();
    const mailer: MailerPort = { sendTicketEmail: vi.fn(async () => {}) };
    const core = makeCore(store, { mailer });
    const orderId = await pendingOrder(core);

    const outcome = await core.handlePaymentSucceeded(orderId, "pi_123");
    expect(outcome).toBe("fulfilled");
    expect(store.ticketType.reserved).toBe(0);
    expect(store.ticketType.issued).toBe(2);
    expect(store.ticketsByOrder.get(orderId)).toHaveLength(2);
    expect(store.reminders).toHaveLength(1);
    expect(mailer.sendTicketEmail).toHaveBeenCalledOnce();
    const detail = await store.getOrderDetail(orderId);
    expect(detail!.order.status).toBe("confirmed");
  });

  it("duplicate webhook → already_processed, NO double issuance (R1)", async () => {
    const store = new FakeStore();
    const core = makeCore(store);
    const orderId = await pendingOrder(core);
    await core.handlePaymentSucceeded(orderId, "pi_123");
    const second = await core.handlePaymentSucceeded(orderId, "pi_123");
    expect(second).toBe("already_processed");
    expect(store.ticketType.issued).toBe(2); // not 4
    expect(store.ticketsByOrder.get(orderId)).toHaveLength(2);
  });

  it("email fails POST-capture → charge is NOT rolled back: order confirmed, tickets issued (R4)", async () => {
    const store = new FakeStore();
    const core = makeCore(store, {
      mailer: {
        sendTicketEmail: async () => {
          throw new Error("resend down");
        },
      },
    });
    const orderId = await pendingOrder(core);
    const outcome = await core.handlePaymentSucceeded(orderId, "pi_123");
    expect(outcome).toBe("fulfilled");
    expect((await store.getOrder(orderId))!.status).toBe("confirmed");
    expect(store.ticketType.issued).toBe(2);
  });

  it("webhook for a nonexistent order → ignored, nothing blows up", async () => {
    const store = new FakeStore();
    expect(
      await makeCore(store).handlePaymentSucceeded("ord_ghost", null),
    ).toBe("ignored");
  });

  it("payment for an already-expired order → ignored, does NOT issue (out-of-order webhook, R7)", async () => {
    const store = new FakeStore();
    const core = makeCore(store);
    const orderId = await pendingOrder(core);
    await core.handleCheckoutExpired(orderId);
    const outcome = await core.handlePaymentSucceeded(orderId, "pi_late");
    expect(outcome).toBe("ignored");
    expect(store.ticketType.issued).toBe(0);
    expect(store.ticketsByOrder.has(orderId)).toBe(false);
  });
});

describe("PurchaseCore.handleCheckoutExpired", () => {
  it("releases the reservation and is idempotent", async () => {
    const store = new FakeStore();
    const core = makeCore(store);
    const res = await core.run(buyInput(), mcpRail);
    expect(await core.handleCheckoutExpired(res.order_id)).toBe(true);
    expect(store.ticketType.reserved).toBe(0);
    expect(await core.handleCheckoutExpired(res.order_id)).toBe(false); // no-op
    expect(store.ticketType.reserved).toBe(0);
  });
});

/**
 * Wallet off_session rail (design-wallet.md §3.2/§3.3, matrix §6 F).
 * `chargeOffSession` is an OPTIONAL PaymentPort method — mocked here, ZERO real
 * Stripe. Steps 1–5 (idempotency → catalog → spend_limit → reserve → order) are
 * shared with hosted; only capture (step 6b) diverges. Assertions cover both the
 * result shape AND inventory state (reserved→issued on success, released on any
 * non-success).
 */
describe("PurchaseCore.run (MCP wallet rail, off_session settlement)", () => {
  const WALLET = {
    wallet: { customerId: "cus_test123", paymentMethodId: "pm_card_visa" },
  } as const;

  /** PaymentPort whose chargeOffSession is a spy returning a canned result. */
  function walletPayments(
    result: ChargeOffSessionResult | (() => Promise<ChargeOffSessionResult>),
  ) {
    const chargeOffSession = vi.fn(
      async (_input: ChargeOffSessionInput): Promise<ChargeOffSessionResult> =>
        typeof result === "function" ? await result() : result,
    );
    const payments: PaymentPort = {
      // hosted must NEVER be called on the wallet path; blow up if it is.
      createHostedCheckout: vi.fn(async () => {
        throw new Error("hosted checkout must not run on the wallet rail");
      }),
      chargeOffSession,
    };
    return { payments, chargeOffSession };
  }

  it("succeeded: confirmed order, tickets issued INLINE, checkout_url null, ics_path set, paid:true, reserved→issued", async () => {
    const store = new FakeStore();
    const mailer: MailerPort = { sendTicketEmail: vi.fn(async () => {}) };
    const { payments, chargeOffSession } = walletPayments({
      status: "succeeded",
      paymentIntentId: "pi_x",
    });
    const res = await makeCore(store, { payments, mailer }).run(
      buyInput(),
      mcpWalletRail,
      WALLET,
    );

    expect(res.status).toBe("confirmed");
    expect(res.paid).toBe(true);
    expect(res.duplicate).toBe(false);
    expect(res.checkout_url).toBeNull();
    expect(res.expires_at).toBeNull();
    expect(res.ics_path).toBe(`/r/${res.order_id}`);
    expect(res.tickets).toHaveLength(2);
    expect(res.tickets.every((t) => t.status === "valid")).toBe(true);

    // inventory: reserved fully converted to issued (no dangling reservation).
    expect(store.ticketType.reserved).toBe(0);
    expect(store.ticketType.issued).toBe(2);
    expect(store.orders.get(res.order_id)!.status).toBe("confirmed");
    expect(store.orders.get(res.order_id)!.stripePaymentIntentId).toBe("pi_x");

    // INLINE issuance reused the webhook path → reminder + email fired once.
    expect(store.reminders).toHaveLength(1);
    expect(mailer.sendTicketEmail).toHaveBeenCalledOnce();

    expect(chargeOffSession).toHaveBeenCalledOnce();
  });

  it("declined: payment_failed with the reason, order cancelled, reserved released to 0, NO ticket issued", async () => {
    const store = new FakeStore();
    const { payments, chargeOffSession } = walletPayments({
      status: "failed",
      paymentIntentId: "pi_declined",
      failureReason: "card_declined",
    });
    const err = await expectError(
      makeCore(store, { payments }).run(buyInput(), mcpWalletRail, WALLET),
      "payment_failed",
    );
    expect((err.details as { reason?: string }).reason).toBe("card_declined");

    expect(chargeOffSession).toHaveBeenCalledOnce();
    expect(store.ticketType.reserved).toBe(0); // released
    expect(store.ticketType.issued).toBe(0); // never issued
    const [order] = [...store.orders.values()];
    expect(order!.status).toBe("cancelled");
    expect(store.ticketsByOrder.size).toBe(0);
  });

  it("requires_action (3DS): payment_action_required (NOT payment_failed), order cancelled, inventory released", async () => {
    const store = new FakeStore();
    const { payments } = walletPayments({
      status: "requires_action",
      paymentIntentId: "pi_3ds",
    });
    const err = await expectError(
      makeCore(store, { payments }).run(buyInput(), mcpWalletRail, WALLET),
      "payment_action_required",
    );
    // distinct code from a plain decline so QA/agents can tell them apart.
    expect(err.code).not.toBe("payment_failed");
    expect((err.details as { paymentIntentId?: string }).paymentIntentId).toBe(
      "pi_3ds",
    );

    expect(store.ticketType.reserved).toBe(0);
    expect(store.ticketType.issued).toBe(0);
    expect([...store.orders.values()][0]!.status).toBe("cancelled");
  });

  it("idempotency / double charge: retry with same key → same confirmed order, duplicate:true, chargeOffSession called ONCE with idempotencyKey = order.id", async () => {
    const store = new FakeStore();
    const { payments, chargeOffSession } = walletPayments({
      status: "succeeded",
      paymentIntentId: "pi_x",
    });
    const core = makeCore(store, { payments });

    const first = await core.run(buyInput(), mcpWalletRail, WALLET);
    const retry = await core.run(buyInput(), mcpWalletRail, WALLET);

    // 2nd run short-circuits at findOrderByIdempotency → returns confirmed order.
    expect(retry.order_id).toBe(first.order_id);
    expect(retry.duplicate).toBe(true);
    expect(retry.status).toBe("confirmed");
    expect(store.orders.size).toBe(1);
    expect(store.ticketType.issued).toBe(2); // not 4 — no second issuance

    // ONE charge only, and its Stripe idempotency key is the stable order.id.
    expect(chargeOffSession).toHaveBeenCalledOnce();
    expect(chargeOffSession.mock.calls[0]![0].idempotencyKey).toBe(
      first.order_id,
    );
    expect(chargeOffSession.mock.calls[0]![0].orderId).toBe(first.order_id);
  });

  it("spend_limit: total > limit → mandate_exceeded BEFORE reserving and BEFORE any charge", async () => {
    const store = new FakeStore();
    const { payments, chargeOffSession } = walletPayments({
      status: "succeeded",
      paymentIntentId: "pi_x",
    });
    await expectError(
      makeCore(store, { payments }).run(
        buyInput({ spend_limit: { amount_minor: 9_999, currency: "USD" } }),
        mcpWalletRail,
        WALLET,
      ),
      "mandate_exceeded",
    );
    // step 3 rejects before reserve (step 4) and before charge (step 6b).
    expect(chargeOffSession).not.toHaveBeenCalled();
    expect(store.ticketType.reserved).toBe(0);
    expect(store.ticketType.issued).toBe(0);
    expect(store.orders.size).toBe(0);
  });

  it("regression hosted: without ctx.wallet the DEFAULT hosted path runs (pending_payment + checkout_url), chargeOffSession NEVER invoked", async () => {
    const store = new FakeStore();
    const chargeOffSession = vi.fn(
      async (): Promise<ChargeOffSessionResult> => ({
        status: "succeeded",
        paymentIntentId: "pi_x",
      }),
    );
    const payments: PaymentPort = {
      async createHostedCheckout(input) {
        return {
          checkoutUrl: `https://checkout.test/${input.orderId}`,
          sessionId: `cs_${input.orderId}`,
        };
      },
      chargeOffSession,
    };
    const res = await makeCore(store, { payments }).run(buyInput(), mcpRail);

    expect(res.status).toBe("pending_payment");
    expect(res.checkout_url).toMatch(/^https:\/\/checkout\.test\//);
    expect(res.tickets).toHaveLength(0);
    expect(chargeOffSession).not.toHaveBeenCalled();
  });

  it("rail selection: with ctx.wallet present, the wallet fields flow into chargeOffSession (customerId/paymentMethodId from the wallet ctx)", async () => {
    const store = new FakeStore();
    const { payments, chargeOffSession } = walletPayments({
      status: "succeeded",
      paymentIntentId: "pi_x",
    });
    await makeCore(store, { payments }).run(buyInput(), mcpWalletRail, {
      wallet: { customerId: "cus_A", paymentMethodId: "pm_B" },
    });

    const charged = chargeOffSession.mock.calls[0]![0];
    expect(charged.customerId).toBe("cus_A");
    expect(charged.paymentMethodId).toBe("pm_B");
    expect(charged.amountMinor).toBe(10_000);
    expect(charged.currency).toBe("USD");
  });

  it("wallet settlement selected but ctx.wallet missing → not_implemented, inventory released, no charge attempt", async () => {
    const store = new FakeStore();
    const { payments, chargeOffSession } = walletPayments({
      status: "succeeded",
      paymentIntentId: "pi_x",
    });
    // wallet rail chosen but no ctx passed (edge failed to resolve the wallet).
    await expectError(
      makeCore(store, { payments }).run(buyInput(), mcpWalletRail),
      "not_implemented",
    );
    expect(chargeOffSession).not.toHaveBeenCalled();
    expect(store.ticketType.reserved).toBe(0); // released, never orphaned
    expect([...store.orders.values()][0]!.status).toBe("cancelled");
  });

  it("non-card error (network/config) thrown by chargeOffSession → payment_failed, order cancelled, inventory released", async () => {
    const store = new FakeStore();
    const { payments } = walletPayments(async () => {
      throw new Error("stripe network down");
    });
    await expectError(
      makeCore(store, { payments }).run(buyInput(), mcpWalletRail, WALLET),
      "payment_failed",
    );
    expect(store.ticketType.reserved).toBe(0);
    expect(store.ticketType.issued).toBe(0);
    expect([...store.orders.values()][0]!.status).toBe("cancelled");
  });
});
