/**
 * End-to-end deterministic extraction against FROZEN, PRODUCTION-SHAPED fixtures
 * (design-import.md §6 F6 items 1-3). Complements test/unit/import-extract.test.ts
 * (which uses minimal inline HTML) by running the real Luma / Eventbrite / og-only
 * / no-data markup through extractDeterministic + toEventDraft and asserting the
 * HARD RULES on realistic input:
 *   - quota never appears on the draft (cupo is never imported);
 *   - date / venue / currency absent → null (never guessed);
 *   - detectedPrices are suggestions in minor units, currency-gated;
 *   - coverage / source / fieldConfidence are reported correctly.
 *
 * Adversarial fixtures (prompt injection, hostile JSON-LD) prove the parser keeps
 * hostile content INERT and never crashes (design §4.1).
 */
import { describe, expect, it } from "vitest";
import { extractDeterministic } from "@/lib/import/extract-deterministic";
import { toEventDraft } from "@/lib/import/normalize";
import { fixture } from "../fixtures/import";

const draftFrom = (name: string, src = `https://src.example/${name}`) =>
  toEventDraft(extractDeterministic(fixture(name)), src);

/** The cupo/quota field must never leak onto a draft, in any fixture. */
function assertNoQuota(draft: object) {
  expect("quota" in draft).toBe(false);
  expect("cupo" in draft).toBe(false);
  expect("capacity" in draft).toBe(false);
}

describe("fixture: Luma (JSON-LD schema.org/Event)", () => {
  it("extracts a full draft from real-shaped Luma markup", () => {
    const r = draftFrom("luma-event");
    expect(r.source).toBe("jsonld");
    expect(r.coverage).toBe("full");
    expect(r.draft.title).toBe("Agentic Payments Night");
    // -05:00 offset resolved to UTC — proves timezone math, not a naive copy.
    expect(r.draft.startsAt).toBe("2026-08-14T23:00:00.000Z");
    expect(r.draft.endsAt).toBe("2026-08-15T02:30:00.000Z");
    expect(r.draft.venue).toContain("Impact Hub Bogotá");
    expect(r.draft.imageUrl).toContain("agentic-payments-night.png");
    expect(r.draft.currency).toBe("COP");
  });

  it("keeps a free (price 0) offer as a valid suggestion, never a ticket_type", () => {
    const r = draftFrom("luma-event");
    // priceMinor 0 is legitimate (nonnegative) and must survive.
    expect(r.draft.detectedPrices).toEqual([
      { label: "General Admission", priceMinor: 0, currency: "COP" },
    ]);
    assertNoQuota(r.draft as object);
  });

  it("reports per-field confidence for the preview badges", () => {
    const r = draftFrom("luma-event");
    expect(r.fieldConfidence.startsAt).toBe("detected");
    expect(r.fieldConfidence.currency).toBe("detected");
    expect(r.fieldConfidence.venue).toBe("detected");
    // timezone is never emitted by JSON-LD → the human sets it.
    expect(r.fieldConfidence.timezone).toBe("missing");
  });
});

describe("fixture: Eventbrite (JSON-LD inside @graph)", () => {
  it("finds the Event buried in an @graph and normalizes it", () => {
    const r = draftFrom("eventbrite-event");
    expect(r.source).toBe("jsonld");
    expect(r.coverage).toBe("full");
    expect(r.draft.title).toBe("Bogotá Tech Conf 2026");
    expect(r.draft.startsAt).toBe("2026-10-03T14:00:00.000Z");
    expect(r.draft.currency).toBe("USD");
    expect(r.draft.venue).toContain("Ágora Bogotá Convention Center");
  });

  it("converts a major-unit price to minor units as a suggestion", () => {
    const r = draftFrom("eventbrite-event");
    expect(r.draft.detectedPrices).toEqual([
      { label: "Early Bird", priceMinor: 15000, currency: "USD" },
    ]);
    assertNoQuota(r.draft as object);
  });
});

describe("fixture: og-only landing (no JSON-LD)", () => {
  it("degrades to meta source with no date/currency/venue (all null)", () => {
    const r = draftFrom("og-only");
    expect(r.source).toBe("meta");
    expect(r.coverage).toBe("partial");
    expect(r.draft.title).toBe("Fiesta de Lanzamiento");
    expect(r.draft.imageUrl).toContain("portada-fiesta.jpg");
    // og: carries no reliable date/price/currency/venue → hard rule: null.
    expect(r.draft.startsAt).toBeNull();
    expect(r.draft.endsAt).toBeNull();
    expect(r.draft.currency).toBeNull();
    expect(r.draft.venue).toBeNull();
    expect(r.draft.detectedPrices).toEqual([]);
  });

  it("marks the risk fields missing so the preview forces human input", () => {
    const r = draftFrom("og-only");
    expect(r.fieldConfidence.startsAt).toBe("missing");
    expect(r.fieldConfidence.currency).toBe("missing");
    expect(r.fieldConfidence.venue).toBe("missing");
    expect(r.fieldConfidence.title).toBe("detected");
  });
});

describe("fixture: no structured data (plain HTML)", () => {
  it("reports coverage empty with a placeholder title and nothing guessed", () => {
    const r = draftFrom("no-data");
    expect(r.coverage).toBe("empty");
    expect(r.draft.title).toBe("(sin título)");
    expect(r.draft.startsAt).toBeNull();
    expect(r.draft.currency).toBeNull();
    expect(r.draft.venue).toBeNull();
    expect(r.draft.imageUrl).toBeNull();
    expect(r.draft.detectedPrices).toEqual([]);
    assertNoQuota(r.draft as object);
  });
});

describe("adversarial fixture: prompt injection (design §4.1)", () => {
  it("stores injection strings as inert field text — obeyed by nothing", () => {
    const r = draftFrom("injection-event");
    // This payload carries a raw control char that breaks its own JSON-LD, so it
    // degrades to og:/meta — exactly the graceful path we want. Either way the
    // injection text is a plain value, never an instruction.
    expect(r.source).toBe("meta");
    expect(r.draft.title).toContain("ignore previous instructions");
    expect(r.draft.description).toContain("developer mode");
    // The injection changed NOTHING structural: no quota field, no forced price,
    // no forced currency. Risk fields stay null.
    assertNoQuota(r.draft as object);
    expect(r.draft.currency).toBeNull();
    expect(r.draft.startsAt).toBeNull();
    expect(r.draft.detectedPrices).toEqual([]);
  });
});

describe("adversarial fixture: hostile / broken JSON-LD (design §2, §4.1)", () => {
  it("survives broken blocks, array-of-arrays and deep @graph without throwing", () => {
    const r = draftFrom("malicious-jsonld");
    // The real Event is nested two @graph levels deep behind junk + an
    // unterminated JSON block. The parser must still find it and never crash.
    expect(r.source).toBe("jsonld");
    expect(r.draft.title).toBe("Deeply Nested Fest");
    expect(r.draft.startsAt).toBe("2026-11-20T19:00:00.000Z");
    // location was an ARRAY of Places → first name taken, not a crash.
    expect(r.draft.venue).toContain("Main Stage");
    // image was an ImageObject → url extracted.
    expect(r.draft.imageUrl).toContain("nested.png");
  });

  it("drops junk offers (object price, null, string) and keeps only valid ones", () => {
    const r = draftFrom("malicious-jsonld");
    // Of four offers only the well-formed one survives; the object-valued price
    // and the null/string entries are filtered, never coerced to a bogus number.
    expect(r.draft.detectedPrices).toEqual([
      { label: "Valid Tier", priceMinor: 2500, currency: "USD" },
    ]);
    assertNoQuota(r.draft as object);
  });
});
