/**
 * Trust boundary (PRD §7): ALL agent/human input goes through these schemas
 * BEFORE touching the core. They live next to the adapter so the future
 * package is self-contained. `.strict()` = additionalProperties: false.
 */
import { z } from "zod";
import { AgentCommerceError } from "../errors";
import type { PurchaseIntent, Rail } from "../types";

export const moneySchema = z
  .object({
    // integers in minor units — never floats (data-model §1)
    amount_minor: z.number().int().min(0).max(100_000_000_000),
    currency: z.string().regex(/^[A-Z]{3}$/, "uppercase ISO 4217"),
  })
  .strict();

export const buyTicketInputSchema = z
  .object({
    event_id: z.string().min(1).max(64),
    ticket_type_id: z.string().min(1).max(64),
    quantity: z.number().int().min(1).max(10),
    // z.string().email() rejects \r\n → no header injection in the email
    buyer_email: z.string().email().max(254),
    buyer_name: z.string().max(200).optional(),
    idempotency_key: z.string().min(8).max(128),
    /**
     * REQUIRED on rails with authorization="spend_limit" (enforced by the core).
     * Self-declared: documents intent, not a security control (P5).
     */
    spend_limit: moneySchema.optional(),
    /** Opaque: AP2 mandate / 402 receipt / SPT. Empty = hosted payment. */
    payment_context: z.record(z.unknown()).optional(),
  })
  .strict();

export type BuyTicketInput = z.infer<typeof buyTicketInputSchema>;

/** Parses and normalizes into a PurchaseIntent, or throws invalid_intent with the issues. */
export function parseBuyTicketInput(raw: unknown, rail: Rail): PurchaseIntent {
  const parsed = buyTicketInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AgentCommerceError(
      "invalid_intent",
      "invalid input",
      parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    );
  }
  const d = parsed.data;
  return {
    idempotencyKey: d.idempotency_key,
    eventId: d.event_id,
    ticketTypeId: d.ticket_type_id,
    quantity: d.quantity,
    buyer: { email: d.buyer_email, name: d.buyer_name },
    rail,
    spendLimit: d.spend_limit
      ? {
          amountMinor: d.spend_limit.amount_minor,
          currency: d.spend_limit.currency,
        }
      : undefined,
    paymentContext: d.payment_context,
  };
}
