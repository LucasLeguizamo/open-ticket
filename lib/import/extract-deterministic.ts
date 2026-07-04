/**
 * Deterministic extraction (design-import.md §2, §4.1): JSON-LD schema.org/Event
 * first, og:/twitter: meta tags as fallback. NO LLM, no network, no interpreter —
 * the page content is INERT DATA (design §4.1): we read known keys, nothing runs.
 *
 * Output is a RAW object (RawExtract), not yet validated. normalize.ts applies
 * the hard rules (risk → null) and crosses eventDraftSchema.
 *
 * ponytail: regex for <script type=ld+json> + meta tags. No parse5/cheerio dep —
 * a real parser only earns its place if broken-HTML robustness ever bites (design §6).
 */

export interface RawExtract {
  source: "jsonld" | "meta" | "none";
  title?: string;
  description?: string;
  imageUrl?: string;
  startsAt?: string;
  endsAt?: string;
  venue?: string;
  currency?: string;
  prices?: { label: string | null; amount: number; currency: string }[];
}

/** Pull every <script type="application/ld+json"> block's parsed JSON. */
function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    const raw = m[1]?.trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      // malformed JSON-LD is just skipped — inert data, never throws the pipeline
    }
  }
  return out;
}

/** Flatten @graph / arrays so we can scan every node for an Event. */
function flattenNodes(parsed: unknown[]): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
      return;
    }
    if (v && typeof v === "object") {
      const obj = v as Record<string, unknown>;
      nodes.push(obj);
      if (Array.isArray(obj["@graph"])) visit(obj["@graph"]);
    }
  };
  for (const p of parsed) visit(p);
  return nodes;
}

/** schema.org @type may be "Event", "MusicEvent", ["Event", ...], etc. */
function isEventType(t: unknown): boolean {
  const types = Array.isArray(t) ? t : [t];
  return types.some((x) => typeof x === "string" && /Event$/i.test(x));
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return undefined;
}

/** location can be a string, a Place object, or an array of them. */
function extractVenue(loc: unknown): string | undefined {
  if (!loc) return undefined;
  if (typeof loc === "string") return asString(loc);
  const first = Array.isArray(loc) ? loc[0] : loc;
  if (first && typeof first === "object") {
    const o = first as Record<string, unknown>;
    const name = asString(o.name);
    const addr = o.address;
    let addrStr: string | undefined;
    if (typeof addr === "string") addrStr = asString(addr);
    else if (addr && typeof addr === "object") {
      const a = addr as Record<string, unknown>;
      addrStr = [a.streetAddress, a.addressLocality, a.addressRegion]
        .map(asString)
        .filter(Boolean)
        .join(", ");
    }
    return [name, addrStr].filter(Boolean).join(" — ") || undefined;
  }
  return undefined;
}

function extractImage(img: unknown): string | undefined {
  if (typeof img === "string") return asString(img);
  if (Array.isArray(img)) return extractImage(img[0]);
  if (img && typeof img === "object") {
    return asString((img as Record<string, unknown>).url);
  }
  return undefined;
}

/** offers: object or array → { label, amount(number), currency } list. */
function extractPrices(
  offers: unknown,
): { label: string | null; amount: number; currency: string }[] {
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  const out: { label: string | null; amount: number; currency: string }[] = [];
  for (const o of list) {
    if (!o || typeof o !== "object") continue;
    const obj = o as Record<string, unknown>;
    const priceRaw = asString(obj.price);
    const currency = asString(obj.priceCurrency);
    if (priceRaw === undefined || !currency) continue;
    const amount = Number(priceRaw);
    if (!Number.isFinite(amount) || amount < 0) continue;
    out.push({ label: asString(obj.name) ?? null, amount, currency });
  }
  return out;
}

function fromJsonLd(html: string): RawExtract | null {
  const nodes = flattenNodes(jsonLdBlocks(html));
  const ev = nodes.find((n) => isEventType(n["@type"]));
  if (!ev) return null;
  const prices = extractPrices(ev.offers);
  return {
    source: "jsonld",
    title: asString(ev.name),
    description: asString(ev.description),
    imageUrl: extractImage(ev.image),
    startsAt: asString(ev.startDate),
    endsAt: asString(ev.endDate),
    venue: extractVenue(ev.location),
    currency: prices[0]?.currency,
    prices,
  };
}

/** Read <meta property/name="key" content="..."> (property before content or reverse). */
function metaTag(html: string, key: string): string | undefined {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${esc}["'][^>]+content=["']([^"']*)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${esc}["']`,
      "i",
    ),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return undefined;
}

function fromMeta(html: string): RawExtract | null {
  const title = metaTag(html, "og:title") ?? metaTag(html, "twitter:title");
  const description =
    metaTag(html, "og:description") ?? metaTag(html, "twitter:description");
  const imageUrl = metaTag(html, "og:image") ?? metaTag(html, "twitter:image");
  if (!title && !description && !imageUrl) return null;
  // og:/twitter: carry no reliable date/price/currency → left undefined on purpose.
  return { source: "meta", title, description, imageUrl };
}

/**
 * Deterministic extract. JSON-LD wins; meta fills anything JSON-LD missed.
 * Never throws — returns { source: "none" } when nothing structured exists.
 */
export function extractDeterministic(html: string): RawExtract {
  const jsonld = fromJsonLd(html);
  const meta = fromMeta(html);
  if (!jsonld) return meta ?? { source: "none" };
  if (!meta) return jsonld;
  // JSON-LD is authoritative; only backfill undefined fields from meta.
  return {
    ...jsonld,
    title: jsonld.title ?? meta.title,
    description: jsonld.description ?? meta.description,
    imageUrl: jsonld.imageUrl ?? meta.imageUrl,
  };
}
