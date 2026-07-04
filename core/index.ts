/**
 * Superficie pública del core — lo que exportaría el paquete
 * `@openticket/agent-commerce-adapter` al extraerse.
 */

export * from "./adapter/errors";
export {
  type FulfillOutcome,
  PurchaseCore,
  type PurchaseCoreDeps,
} from "./adapter/purchase-core";
export { type McpBuyTicketResponse, mcpRail } from "./adapter/rails/mcp";
export {
  buyTicketInputSchema,
  moneySchema,
  parseBuyTicketInput,
} from "./adapter/rails/schemas";
export {
  acpRailStub,
  ap2OverlayStub,
  mppRailStub,
  x402RailStub,
} from "./adapter/rails/stubs";
export {
  formatPublicResult,
  type WebPurchaseResponse,
  webRail,
} from "./adapter/rails/web";
export * from "./adapter/types";
export {
  DEFAULT_ALARM_OFFSETS_MINUTES,
  generateIcs,
  type IcsInput,
} from "./ics";
export { randomId, ticketCode } from "./ids";
export * from "./ports";
export { generateTicketSeeds } from "./tickets";
