/**
 * MCP rail: pure adapter for the `buy_ticket` tool (adapter doc §6).
 * authorization "spend_limit" (required without a mandate, Q2); hosted settlement.
 *
 * The MCP SERVER (streamable HTTP route handler) is F1 — this adapter is
 * already ready to mount there without touching the core.
 */
import type { PurchaseResult, RailAdapter } from "../types";
import { parseBuyTicketInput } from "./schemas";
import { formatPublicResult, type WebPurchaseResponse } from "./web";

export interface McpBuyTicketResponse extends WebPurchaseResponse {
  /** how to find out whether the hosted payment was confirmed (adapter §6 v1 output) */
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
