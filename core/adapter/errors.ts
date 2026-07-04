/** Error model shared by all rails (agent-commerce-adapter §5). */

export type AgentCommerceErrorCode =
  | "sold_out"
  | "mandate_exceeded"
  | "payment_failed"
  | "payment_action_required"
  | "event_unavailable"
  | "invalid_intent"
  | "duplicate"
  | "not_implemented"
  | "internal";

const HTTP_STATUS: Record<AgentCommerceErrorCode, number> = {
  sold_out: 409,
  mandate_exceeded: 403,
  payment_failed: 402,
  // off_session charge needs 3DS; not supported for wallet in v1. Distinct from a
  // plain decline so QA/agents can tell the two apart (design-wallet.md §3.3).
  payment_action_required: 402,
  event_unavailable: 410,
  invalid_intent: 400,
  duplicate: 200, // returns the previous order; not a failure
  not_implemented: 501,
  internal: 500,
};

export class AgentCommerceError extends Error {
  constructor(
    readonly code: AgentCommerceErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AgentCommerceError";
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.code];
  }
}

export function isAgentCommerceError(e: unknown): e is AgentCommerceError {
  return e instanceof AgentCommerceError;
}
