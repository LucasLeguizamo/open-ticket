/**
 * Stubs de rails de fases posteriores, detrás de feature flag (PRD §12).
 * Existen para que los TIPOS y el registro queden cerrados desde F0:
 *  - acp:  sesión stateful + settlement inline SPT (F2, conformance vs mock)
 *  - ap2:  OVERLAY de autorización sobre un settlement — no un rail paralelo
 *          (protocol-audit mismatch 3); se modela como authorization="ap2_mandate"
 *  - x402: settlement onchain USDC (stretch goal, Base Sepolia)
 *  - mpp:  Machine Payments Protocol (Stripe/Tempo) — redundante con x402, stub
 */
import { AgentCommerceError } from "../errors";
import type { RailAdapter } from "../types";

function notImplemented(rail: string): never {
  throw new AgentCommerceError(
    "not_implemented",
    `rail "${rail}" no implementado en esta fase (feature flag off)`,
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
