/**
 * Trust boundary (PRD §7): TODO input de agente/humano pasa por estos schemas
 * ANTES de tocar el core. Viven junto al adapter para que el futuro paquete
 * sea autocontenido. `.strict()` = additionalProperties: false.
 */
import { z } from "zod";
import { AgentCommerceError } from "../errors";
import type { PurchaseIntent, Rail } from "../types";

export const moneySchema = z
  .object({
    // enteros en unidades mínimas — nunca floats (data-model §1)
    amount_minor: z.number().int().min(0).max(100_000_000_000),
    currency: z.string().regex(/^[A-Z]{3}$/, "ISO 4217 en mayúsculas"),
  })
  .strict();

export const buyTicketInputSchema = z
  .object({
    event_id: z.string().min(1).max(64),
    ticket_type_id: z.string().min(1).max(64),
    quantity: z.number().int().min(1).max(10),
    // z.string().email() rechaza \r\n → sin header injection en el email
    buyer_email: z.string().email().max(254),
    buyer_name: z.string().max(200).optional(),
    idempotency_key: z.string().min(8).max(128),
    /**
     * OBLIGATORIO en rails con authorization="spend_limit" (lo exige el core).
     * Autodeclarado: documenta intención, no es control de seguridad (P5).
     */
    spend_limit: moneySchema.optional(),
    /** Opaco: mandate AP2 / receipt 402 / SPT. Vacío = pago hospedado. */
    payment_context: z.record(z.unknown()).optional(),
  })
  .strict();

export type BuyTicketInput = z.infer<typeof buyTicketInputSchema>;

/** Parsea y normaliza a PurchaseIntent, o tira invalid_intent con los issues. */
export function parseBuyTicketInput(raw: unknown, rail: Rail): PurchaseIntent {
  const parsed = buyTicketInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AgentCommerceError(
      "invalid_intent",
      "input inválido",
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
