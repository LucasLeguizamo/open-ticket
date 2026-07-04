/**
 * Normalize a RawExtract into an eventDraftSchema-validated EventDraft
 * (design-import.md §2, §4). This is the trust boundary between untrusted page
 * content and the rest of the app: nothing reaches createEvent without crossing
 * eventDraftSchema here.
 *
 * Hard rules (design §2.3):
 *  - startsAt / endsAt only survive if they are a valid ISO 8601 datetime.
 *  - currency only if it maps to an allowed enum (USD/COP); else null.
 *  - venue nullable; detectedPrices are SUGGESTIONS, never a ticket_type.
 *  - quota is not a field — never imported.
 */
import {
  type EventDraft,
  type ExtractResult,
  eventDraftSchema,
  type FieldConfidence,
} from "@/lib/zod/event";
import type { RawExtract } from "./extract-deterministic";

const ALLOWED_CURRENCIES = new Set(["USD", "COP"]);

/** Only accept a strict ISO 8601 datetime (what eventDraftSchema demands). */
function isoOrNull(v: string | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  // require an explicit time component — a bare "2026-07-04" is a date, not a
  // datetime; the human sets the time (design §2.3: dudoso → humano).
  if (!/\d{2}:\d{2}/.test(v)) return null;
  return d.toISOString();
}

function currencyOrNull(v: string | undefined): "USD" | "COP" | null {
  if (!v) return null;
  const up = v.toUpperCase();
  return ALLOWED_CURRENCIES.has(up) ? (up as "USD" | "COP") : null;
}

function httpUrlOrNull(v: string | undefined): string | null {
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? v : null;
  } catch {
    return null;
  }
}

/**
 * toEventDraft — RawExtract + source URL → validated ExtractResult.
 * Degrades gracefully: if the strict parse ever fails, returns coverage:"empty"
 * rather than throwing (design §1 table: ZodError → partial draft, no crash).
 */
export function toEventDraft(
  raw: RawExtract,
  sourceUrl: string,
): ExtractResult {
  const source: ExtractResult["source"] =
    raw.source === "none" ? "meta" : raw.source;

  const currency = currencyOrNull(raw.currency);
  // Prices are suggestions. Keep only those whose currency is an allowed enum.
  const detectedPrices = (raw.prices ?? [])
    .map((p) => {
      const cur = currencyOrNull(p.currency);
      if (!cur) return null;
      return {
        label: p.label,
        priceMinor: Math.round(p.amount * 100), // major → minor (2 decimals)
        currency: cur,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .slice(0, 10);

  const candidate = {
    title: raw.title ?? "",
    description: raw.description ?? "",
    venue: raw.venue ?? null,
    startsAt: isoOrNull(raw.startsAt),
    endsAt: isoOrNull(raw.endsAt),
    timezone: null,
    currency,
    imageUrl: httpUrlOrNull(raw.imageUrl),
    detectedPrices,
    sourceUrl,
  };

  const parsed = eventDraftSchema.safeParse(candidate);
  if (!parsed.success) {
    // Only real reason to fail: title too short / sourceUrl invalid. Degrade.
    const empty: EventDraft = {
      title: candidate.title.slice(0, 200) || "(sin título)",
      description: "",
      venue: null,
      startsAt: null,
      endsAt: null,
      timezone: null,
      currency: null,
      imageUrl: null,
      detectedPrices: [],
      sourceUrl,
    };
    return {
      draft: empty,
      source,
      coverage: "empty",
      fieldConfidence: confidence(empty, raw),
    };
  }

  const draft = parsed.data;
  return {
    draft,
    source,
    coverage: coverageOf(draft),
    fieldConfidence: confidence(draft, raw),
  };
}

/** full = title + startsAt + currency all present (enough to skip the LLM). */
function coverageOf(d: EventDraft): ExtractResult["coverage"] {
  if (!d.title) return "empty";
  if (d.startsAt && d.currency) return "full";
  if (d.startsAt || d.currency || d.venue || d.imageUrl) return "partial";
  return "empty";
}

function confidence(d: EventDraft, raw: RawExtract): FieldConfidence {
  // "detected" = came structured; "missing" = null/empty; "guessed" reserved for LLM (F4).
  const mark = (present: boolean) => (present ? "detected" : "missing");
  return {
    title: mark(!!d.title),
    description: mark(!!d.description),
    venue: mark(d.venue !== null),
    startsAt: mark(d.startsAt !== null),
    endsAt: mark(d.endsAt !== null),
    timezone: mark(d.timezone !== null),
    currency: mark(d.currency !== null),
    imageUrl: mark(d.imageUrl !== null),
    detectedPrices: mark(d.detectedPrices.length > 0),
    sourceUrl: raw.source === "none" ? "missing" : "detected",
  };
}
