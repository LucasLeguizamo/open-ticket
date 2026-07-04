import type { TicketSeed } from "./adapter/types";
import { randomId, ticketCode } from "./ids";

/** Generates the ticket seeds (id + unique code) that the store persists
 *  inside the confirmation transaction. Pure: never touches the DB. */
export function generateTicketSeeds(quantity: number): TicketSeed[] {
  return Array.from({ length: quantity }, () => ({
    id: randomId("tkt"),
    code: ticketCode(),
  }));
}
