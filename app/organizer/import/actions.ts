"use server";

/**
 * Import server action (design-import.md §6 F3): URL → importFromUrl → draft.
 *
 * Guarded with getSessionOrganizerId (same session guard the dashboard uses;
 * app/organizer/actions.ts keeps its requireOrganizer private). The draft is
 * returned to the client via useActionState so the preview form can render it
 * editable. Nothing is persisted here: the human confirms in the preview and
 * the "create draft" button reuses createEvent (US-001), the single write path.
 * FetchError.code maps to a plain-English UI message.
 */
import { FetchError, importFromUrl } from "@/lib/import";
import { getSessionOrganizerId } from "@/lib/session";
import type { ExtractResult } from "@/lib/zod/event";

// ponytail: in-memory rate limit per organizer (20/10min). importFromUrl makes
// an outbound fetch, so an authenticated organizer could still use it as a
// network-amplification vector; this throttles it. Best-effort: not shared
// across Vercel instances — move to KV if abuse justifies it. Mirrors the
// newsletter limiter (app/api/newsletter/subscribe/route.ts).
const HITS = new Map<string, { count: number; resetAt: number }>();
const LIMIT = 20;
const WINDOW_MS = 600_000;

function rateLimited(key: string, now: number): boolean {
  const cur = HITS.get(key);
  if (!cur || now > cur.resetAt) {
    HITS.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  cur.count++;
  return cur.count > LIMIT;
}

export type ImportState =
  | { status: "idle" }
  | { status: "error"; message: string; url: string }
  | { status: "ok"; result: ExtractResult; url: string };

const FETCH_ERRORS: Record<string, string> = {
  invalid_url: "that is not a valid http(s) URL — paste the full address",
  blocked_host: "that host is not reachable (private/blocked address)",
  too_large: "the page is too big to import (over 2 MB)",
  timeout: "the page took too long to respond (over 5s) — try again",
  bad_status: "the page returned an error or too many redirects",
  not_html: "that URL is not an HTML page",
};

export async function importUrl(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const organizerId = await getSessionOrganizerId();
  if (!organizerId) {
    return {
      status: "error",
      message: "session expired — log in again",
      url: "",
    };
  }

  if (rateLimited(organizerId, Date.now())) {
    return {
      status: "error",
      message: "too many imports — wait a few minutes and try again",
      url: String(formData.get("url") ?? "").trim(),
    };
  }

  const url = String(formData.get("url") ?? "").trim();
  if (!url) {
    return { status: "error", message: "paste a URL first", url };
  }

  try {
    const result = await importFromUrl(url);
    return { status: "ok", result, url };
  } catch (e) {
    if (e instanceof FetchError) {
      return {
        status: "error",
        message: FETCH_ERRORS[e.code] ?? "could not fetch that URL",
        url,
      };
    }
    return {
      status: "error",
      message: "unexpected error importing that URL",
      url,
    };
  }
}
