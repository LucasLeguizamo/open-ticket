/**
 * Trust boundary (R6): agent input is UNTRUSTED.
 */
import { describe, expect, it } from "vitest";
import {
  buyTicketInputSchema,
  moneySchema,
} from "@/core/adapter/rails/schemas";

const valid = {
  event_id: "evt_1",
  ticket_type_id: "tt_1",
  quantity: 1,
  buyer_email: "a@b.co",
  idempotency_key: "key-12345678",
};

describe("buyTicketInputSchema", () => {
  it("accepts minimal valid input", () => {
    expect(buyTicketInputSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["negative quantity", { ...valid, quantity: -5 }],
    ["quantity 0", { ...valid, quantity: 0 }],
    ["quantity 11", { ...valid, quantity: 11 }],
    ["float quantity", { ...valid, quantity: 1.5 }],
    ["invalid email", { ...valid, buyer_email: "nope" }],
    [
      "email with CRLF (header injection)",
      { ...valid, buyer_email: "a@b.co\r\nBcc: x@y.z" },
    ],
    ["short idempotency_key", { ...valid, idempotency_key: "abc" }],
    ["extra prop (strict)", { ...valid, admin: true }],
    ["empty event_id", { ...valid, event_id: "" }],
  ])("rejects %s", (_name, input) => {
    expect(buyTicketInputSchema.safeParse(input).success).toBe(false);
  });
});

describe("moneySchema", () => {
  it("accepts integer minor units + ISO 4217", () => {
    expect(
      moneySchema.safeParse({ amount_minor: 4500, currency: "USD" }).success,
    ).toBe(true);
  });

  it.each([
    ["negative amount", { amount_minor: -1, currency: "USD" }],
    ["float", { amount_minor: 45.5, currency: "USD" }],
    ["lowercase currency", { amount_minor: 1, currency: "usd" }],
    ["made-up currency", { amount_minor: 1, currency: "US" }],
  ])("rejects %s", (_name, input) => {
    expect(moneySchema.safeParse(input).success).toBe(false);
  });
});
