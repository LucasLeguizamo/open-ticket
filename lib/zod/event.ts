/**
 * Single source of truth for "what a valid event is" (design-import.md §2).
 *
 * `eventBase` — the shape createEvent persists (mirrors db/schema.ts: event).
 * `eventDraftSchema` — what the URL import produces BEFORE human review: every
 *   field that is dangerous to guess (date, currency, venue, prices) is nullable,
 *   and CUPO/quota is not even a field — it is NEVER imported (design §2.3, §3 rule).
 *
 * Glue of app (Zod over untrusted input), not core/ — core stays framework-free.
 */
import { z } from "zod";

/** A date string that Date.parse understands (ISO 8601 or looser). */
const dateString = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), "invalid date");

/** Fields of an event as createEvent persists them. */
export const eventBase = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(5000).default(""),
  venue: z.string().max(200).optional(),
  startsAt: dateString,
  endsAt: dateString.optional(),
  timezone: z.string().max(64).default("America/Bogota"),
  currency: z.enum(["USD", "COP"]),
  imageUrl: z.union([z.string().url().max(500), z.literal("")]).optional(),
});

export type EventBase = z.infer<typeof eventBase>;

/**
 * eventDraftSchema — import output, pre-human-review.
 * Hard rule (design §2.3): startsAt, currency, venue, detectedPrices are nullable;
 * quota is absent by design (a mis-imported cupo = overselling → the human always sets it).
 * Detected prices are SUGGESTIONS — they never create a ticket_type on their own.
 */
export const eventDraftSchema = z.object({
  title: z.string().min(1).max(200), // almost always present
  description: z.string().max(5000).default(""),
  venue: z.string().max(200).nullable(),
  startsAt: z.string().datetime().nullable(), // null if not detected with certainty
  endsAt: z.string().datetime().nullable(),
  timezone: z.string().max(64).nullable(),
  currency: z.enum(["USD", "COP"]).nullable(), // null if no offers detected
  imageUrl: z.string().url().max(500).nullable(),
  detectedPrices: z
    .array(
      z.object({
        label: z.string().max(100).nullable(),
        priceMinor: z.number().int().nonnegative(),
        currency: z.enum(["USD", "COP"]),
      }),
    )
    .max(10)
    .default([]),
  sourceUrl: z.string().url(),
});

export type EventDraft = z.infer<typeof eventDraftSchema>;

/** Per-field certainty, drives the preview badges (F3). Not persisted. */
export type FieldConfidence = Record<
  keyof EventDraft,
  "detected" | "guessed" | "missing"
>;

export interface ExtractResult {
  draft: Partial<EventDraft>;
  source: "jsonld" | "meta" | "llm";
  coverage: "full" | "partial" | "empty";
  fieldConfidence: FieldConfidence;
}
