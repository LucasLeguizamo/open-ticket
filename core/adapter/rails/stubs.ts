/**
 * Stubs for later-phase rails, behind a feature flag (PRD §12).
 * They exist so the TYPES and the registry are closed from F0:
 *  - acp:  stateful session + inline SPT settlement (F2, conformance vs mock)
 *  - ap2:  authorization OVERLAY on top of a settlement — not a parallel rail
 *          (protocol-audit mismatch 3); modeled as authorization="ap2_mandate"
 *  - x402: onchain USDC settlement (stretch goal, Base Sepolia)
 *  - mpp:  Machine Payments Protocol (Stripe/Tempo) — redundant with x402, stub
 */
import { AgentCommerceError } from "../errors";
import type { RailAdapter } from "../types";

function notImplemented(rail: string): never {
  throw new AgentCommerceError(
    "not_implemented",
    `rail "${rail}" not implemented in this phase (feature flag off)`,
  );
}

export const acpRailStub: RailAdapter = {
  rail: "acp",
  mode: "session",
  authorization: "none",
  settlement: "stripe_inline_spt",
  resolveIntent: () => notImplemented("acp"),
  formatResult: () => notImplemented("acp"),
};

export const ap2OverlayStub: RailAdapter = {
  rail: "ap2",
  mode: "one_shot",
  authorization: "ap2_mandate",
  settlement: "stripe_hosted",
  resolveIntent: () => notImplemented("ap2"),
  formatResult: () => notImplemented("ap2"),
};

export const x402RailStub: RailAdapter = {
  rail: "x402",
  mode: "one_shot",
  authorization: "spend_limit",
  settlement: "x402",
  resolveIntent: () => notImplemented("x402"),
  formatResult: () => notImplemented("x402"),
};

export const mppRailStub: RailAdapter = {
  rail: "mpp",
  mode: "one_shot",
  authorization: "spend_limit",
  settlement: "mpp",
  resolveIntent: () => notImplemented("mpp"),
  formatResult: () => notImplemented("mpp"),
};
