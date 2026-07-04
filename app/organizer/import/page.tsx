/**
 * /organizer/import (design-import.md §6 F3): paste a URL → editable preview → draft.
 * Server component does the auth guard (same as the dashboard); the interactive
 * pieces (URL form via useActionState, editable preview) live in ImportClient.
 */
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSessionOrganizerId } from "@/lib/session";
import { ImportClient } from "./import-client";

// Auth guard reads cookies() → dynamic. With cacheComponents (PPR) on, it must
// live inside <Suspense> or it blocks the whole route from rendering (same
// pattern as the dashboard, app/organizer/page.tsx).
async function Import() {
  const organizerId = await getSessionOrganizerId();
  if (!organizerId) redirect("/organizer/login");

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-neutral-500">$ openticket import --from-url</p>
        <a className="text-neutral-500 underline" href="/organizer">
          ← dashboard
        </a>
      </div>
      <p className="text-neutral-600">
        # paste a Luma / Eventbrite / landing URL — we build the draft, you
        confirm dates, prices and quota
      </p>
      <ImportClient />
    </>
  );
}

export default function ImportPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-8 p-8 text-sm">
      <Suspense fallback={<p className="text-neutral-500">$ loading…</p>}>
        <Import />
      </Suspense>
    </main>
  );
}
