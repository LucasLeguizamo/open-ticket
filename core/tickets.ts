import type { TicketSeed } from "./adapter/types";
import { randomId, ticketCode } from "./ids";

/** Genera las semillas de ticket (id + código único) que el store persiste
 *  dentro de la transacción de confirmación. Pura: no toca DB. */
export function generateTicketSeeds(quantity: number): TicketSeed[] {
  return Array.from({ length: quantity }, () => ({
    id: randomId("tkt"),
    code: ticketCode(),
  }));
}
