/**
 * Fixture loader for the URL-import QA suite (design-import.md §6 F6).
 *
 * Frozen, representative HTML pages live next to this file. They mirror how the
 * real platforms emit structured data (Luma / Eventbrite JSON-LD, an og-only
 * landing, a no-data page) plus two adversarial pages (prompt injection, hostile
 * JSON-LD). Kept as real files (not inline strings) so the parser is exercised
 * against markup shaped like production, and so the corpus is reusable by F4.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));

export function fixture(name: string): string {
  return readFileSync(`${dir}${name}.html`, "utf8");
}
