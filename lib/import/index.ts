/**
 * Import orchestrator (design-import.md §1, §6): fetch → extract → normalize.
 *
 * The LLM fallback (F4) is intentionally NOT wired here — it lands in M5 behind
 * IMPORT_LLM_ENABLED (off by default). The hook is a one-line insertion point
 * marked below; until then coverage<full just means the human fills the gaps.
 */
import type { ExtractResult } from "@/lib/zod/event";
import { extractDeterministic } from "./extract-deterministic";
import { safeFetchHtml } from "./fetch";
import { toEventDraft } from "./normalize";

export type { FetchResult } from "./fetch";
export { FetchError } from "./fetch";

/**
 * importFromUrl — the single entry point F3 (web) and F5 (agentic) call.
 * Throws FetchError on fetch/SSRF failures (caller maps to UI messages).
 * Returns a validated ExtractResult; the draft has crossed eventDraftSchema.
 */
export async function importFromUrl(rawUrl: string): Promise<ExtractResult> {
  const { html, finalUrl } = await safeFetchHtml(rawUrl);
  const raw = extractDeterministic(html);
  const result = toEventDraft(raw, finalUrl);

  // ponytail: F4 hook. When IMPORT_LLM_ENABLED lands (M5), if result.coverage
  // !== "full", call extractWithLlm(text, result.draft) and re-normalize. Off now.

  return result;
}
