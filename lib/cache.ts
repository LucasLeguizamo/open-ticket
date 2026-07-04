/**
 * Cache Components tags (Next 16). Single convention for the whole repo:
 *  - `events`            → listings/feed (landing, ACP feed in F1)
 *  - `event:{slug}`      → an event's public page (includes availability)
 *
 * Invalidation:
 *  - Route handlers (Stripe webhook) → revalidateTag(...) when a purchase is
 *    confirmed (inventory changes → the event page must refresh availability).
 *  - Server actions (publish event, edit — F1) → updateTag(...) so the SAME
 *    request already sees fresh data. Pattern ready in app/actions/.
 */
export const EVENTS_TAG = "events";

export function eventTag(slug: string): string {
  return `event:${slug}`;
}
