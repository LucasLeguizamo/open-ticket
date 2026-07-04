/**
 * Trust boundary (R6): el input del agente es NO confiable.
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
  it("acepta input mínimo válido", () => {
    expect(buyTicketInputSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["quantity negativa", { ...valid, quantity: -5 }],
    ["quantity 0", { ...valid, quantity: 0 }],
    ["quantity 11", { ...valid, quantity: 11 }],
    ["quantity float", { ...valid, quantity: 1.5 }],
    ["email inválido", { ...valid, buyer_email: "nope" }],
    [
      "email con CRLF (header injection)",
      { ...valid, buyer_email: "a@b.co\r\nBcc: x@y.z" },
    ],
    ["idempotency_key corta", { ...valid, idempotency_key: "abc" }],
    ["prop extra (strict)", { ...valid, admin: true }],
    ["event_id vacío", { ...valid, event_id: "" }],
  ])("rechaza %s", (_name, input) => {
    expect(buyTicketInputSchema.safeParse(input).success).toBe(false);
  });
});

describe("moneySchema", () => {
  it("acepta minor units enteras + ISO 4217", () => {
    expect(
      moneySchema.safeParse({ amount_minor: 4500, currency: "USD" }).success,
    ).toBe(true);
  });

  it.each([
    ["monto negativo", { amount_minor: -1, currency: "USD" }],
    ["float", { amount_minor: 45.5, currency: "USD" }],
    ["moneda minúscula", { amount_minor: 1, currency: "usd" }],
    ["moneda inventada", { amount_minor: 1, currency: "US" }],
  ])("rechaza %s", (_name, input) => {
    expect(moneySchema.safeParse(input).success).toBe(false);
  });
});
