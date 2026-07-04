/**
 * Tags de Cache Components (Next 16). Convención única para todo el repo:
 *  - `events`            → listados/feed (landing, feed ACP en F1)
 *  - `event:{slug}`      → página pública de un evento (incluye disponibilidad)
 *
 * Invalidación:
 *  - Route handlers (webhook Stripe) → revalidateTag(...) al confirmar compra
 *    (cambia inventario → la página del evento debe refrescar disponibilidad).
 *  - Server actions (publicar evento, editar — F1) → updateTag(...) para que
 *    la MISMA request ya vea el dato fresco. Patrón listo en app/actions/.
 */
export const EVENTS_TAG = "events";

export function eventTag(slug: string): string {
  return `event:${slug}`;
}
