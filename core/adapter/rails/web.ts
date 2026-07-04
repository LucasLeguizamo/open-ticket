/**
 * Rail WEB: compra humana desde la página del evento.
 * authorization "none" (el humano confirma pagando el checkout hospedado);
 * settlement stripe_hosted.
 */
import type { PurchaseResult, RailAdapter } from "../types";
import { parseBuyTicketInput } from "./schemas";

export interface WebPurchaseResponse {
  status: string;
  duplicate: boolean;
  order_id: string;
  checkout_url: string | null;
  expires_at: string | null;
  amount: { amount_minor: number; currency: string };
  event: { id: string; title: string; starts_at: string; venue: string | null };
  tickets: { id: string; code: string; status: string }[];
  ics_path: string | null;
}

export function formatPublicResult(
  result: PurchaseResult,
): WebPurchaseResponse {
  return {
    status: result.status,
    duplicate: result.duplicate,
    order_id: result.orderId,
    checkout_url: result.checkoutUrl,
    expires_at: result.expiresAt?.toISOString() ?? null,
    amount: {
      amount_minor: result.amount.amountMinor,
      currency: result.amount.currency,
    },
    event: {
      id: result.event.id,
      title: result.event.title,
      starts_at: result.event.startsAt.toISOString(),
      venue: result.event.venue,
    },
    tickets: result.tickets.map((t) => ({
      id: t.id,
      code: t.code,
      status: t.status,
    })),
    ics_path: result.icsPath,
  };
}

export const webRail: RailAdapter<unknown, WebPurchaseResponse> = {
  rail: "web",
  mode: "one_shot",
  authorization: "none",
  settlement: "stripe_hosted",
  resolveIntent: (raw) => parseBuyTicketInput(raw, "web"),
  formatResult: formatPublicResult,
};
