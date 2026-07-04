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

/**
 * MCP wallet rail (design-wallet.md §4): same MCP channel, `wallet_off_session`
 * settlement. The charge is captured synchronously off_session and the tickets
 * are issued INLINE, so the response is already `confirmed` (+ tickets + ics_path)
 * with no checkout_url and no poll. `paid: true` is the semantic marker that the
 * charge was already captured. Reuses rail="mcp" so idempotency (rail,email,key)
 * stays consistent even if the wallet is loaded between two retries.
 */
export interface McpWalletBuyResponse extends WebPurchaseResponse {
  paid: true;
}

export const mcpWalletRail: RailAdapter<unknown, McpWalletBuyResponse> = {
  rail: "mcp",
  mode: "one_shot",
  authorization: "spend_limit",
  settlement: "wallet_off_session",
  resolveIntent: (raw) => parseBuyTicketInput(raw, "mcp"),
  formatResult: (result: PurchaseResult) => ({
    ...formatPublicResult(result),
    paid: true,
  }),
};
