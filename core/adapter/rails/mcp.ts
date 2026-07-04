/**
 * Rail MCP: adaptador puro para la tool `buy_ticket` (adapter doc §6).
 * authorization "spend_limit" (obligatorio sin mandate, Q2); settlement hosted.
 *
 * El SERVER MCP (route handler streamable HTTP) es F1 — este adaptador ya está
 * listo para montarse ahí sin tocar el core.
 */
import type { PurchaseResult, RailAdapter } from "../types";
import { parseBuyTicketInput } from "./schemas";
import { formatPublicResult, type WebPurchaseResponse } from "./web";

export interface McpBuyTicketResponse extends WebPurchaseResponse {
  /** cómo saber si el pago hospedado ya se confirmó (adapter §6 salida v1) */
  poll: string;
}

export const mcpRail: RailAdapter<unknown, McpBuyTicketResponse> = {
  rail: "mcp",
  mode: "one_shot",
  authorization: "spend_limit",
  settlement: "stripe_hosted",
  resolveIntent: (raw) => parseBuyTicketInput(raw, "mcp"),
  formatResult: (result: PurchaseResult) => ({
    ...formatPublicResult(result),
    poll: `get_order(${result.orderId})`,
  }),
};
