import { randomBytes } from "node:crypto";

/** Alphabet without ambiguous characters (0/O, 1/I/L). */
const ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

function randomFrom(alphabet: string, size: number): string {
  const bytes = randomBytes(size);
  let out = "";
  for (let i = 0; i < size; i++) {
    out += alphabet[(bytes[i] as number) % alphabet.length];
  }
  return out;
}

/** Prefixed IDs (`evt_`, `ord_`, `tkt_`…), non-guessable (data-model §1). */
export function randomId(prefix: string, size = 20): string {
  return `${prefix}_${randomFrom(ID_ALPHABET, size)}`;
}

/** Human-readable admission code: OT-XXXX-XXXX. */
export function ticketCode(): string {
  return `OT-${randomFrom(CODE_ALPHABET, 4)}-${randomFrom(CODE_ALPHABET, 4)}`;
}
