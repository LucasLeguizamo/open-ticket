/** Organizer dashboard: their events + creation form (US-001). */
import { desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/db/client";
import { event, ticketType } from "@/db/schema";
import { getSessionOrganizerId } from "@/lib/session";
import { createEvent, logout, publishEvent } from "./actions";

const inputCls =
  "w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-200";

const ERRORS: Record<string, string> = {
  evento_invalido: "check title (min. 3), date and image URL",
  tickets_invalidos: "each ticket type needs a name, price ≥ 0 and quota ≥ 1",
};

async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const organizerId = await getSessionOrganizerId();
  if (!organizerId) redirect("/organizer/login");
  const { error } = await searchParams;

  const db = getDb();
  const events = await db
    .select()
    .from(event)
    .where(eq(event.organizerId, organizerId))
    .orderBy(desc(event.createdAt));
  const types = events.length
    ? await db
        .select()
        .from(ticketType)
        .where(
          inArray(
            ticketType.eventId,
            events.map((e) => e.id),
          ),
        )
    : [];

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-neutral-500">$ openticket organizer --dashboard</p>
        <form action={logout}>
          <button className="text-neutral-500 underline" type="submit">
            logout
          </button>
        </form>
      </div>

      {error && (
        <p className="rounded border border-red-900 bg-red-950 p-2 text-red-400">
          error: {ERRORS[error] ?? error}
        </p>
      )}

      <section className="space-y-2">
        <p className="text-neutral-500"># my events</p>
        {events.length === 0 && (
          <p className="text-neutral-600">
            → (empty) create your first event below
          </p>
        )}
        <ul className="space-y-2">
          {events.map((e) => {
            const tts = types.filter((t) => t.eventId === e.id);
            return (
              <li key={e.id} className="rounded border border-neutral-800 p-3">
                <p>
                  <strong>{e.title}</strong>{" "}
                  <span
                    className={
                      e.status === "published"
                        ? "text-green-500"
                        : "text-yellow-500"
                    }
                  >
                    [{e.status}]
                  </span>
                </p>
                <p className="text-neutral-500">
                  {e.startsAt.toISOString().slice(0, 16).replace("T", " ")}
                  {e.venue ? ` · ${e.venue}` : ""} ·{" "}
                  <a className="underline" href={`/e/${e.slug}`}>
                    /e/{e.slug}
                  </a>
                </p>
                <p className="text-neutral-600">
                  {tts
                    .map(
                      (t) =>
                        `${t.name} ${(t.priceMinor / 100).toFixed(2)} ${e.currency} · ${t.issued}/${t.quota} sold`,
                    )
                    .join(" — ")}
                </p>
                {e.status === "draft" && (
                  <form action={publishEvent} className="mt-2">
                    <input type="hidden" name="event_id" value={e.id} />
                    <button
                      className="rounded bg-green-600 px-3 py-1 font-bold text-black"
                      type="submit"
                    >
                      publish →
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-2">
        <p className="text-neutral-500"># create event (stays in draft)</p>
        <form action={createEvent} className="space-y-2">
          <input
            className={inputCls}
            name="title"
            placeholder="title"
            minLength={3}
            required
          />
          <textarea
            className={inputCls}
            name="description"
            placeholder="description"
            rows={3}
          />
          <input
            className={inputCls}
            name="venue"
            placeholder="venue (optional)"
          />
          <div className="flex gap-2">
            <input
              className={inputCls}
              name="starts_at"
              type="datetime-local"
              required
            />
            <select className={inputCls} name="currency" defaultValue="USD">
              <option value="USD">USD</option>
              <option value="COP">COP</option>
            </select>
          </div>
          <input
            className={inputCls}
            name="image_url"
            type="url"
            placeholder="image URL (optional)"
          />
          <p className="text-neutral-600">
            # ticket types (name · price · quota)
          </p>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-2">
              <input
                className={inputCls}
                name="tt_name"
                placeholder={i === 0 ? "General" : "(optional)"}
              />
              <input
                className={inputCls}
                name="tt_price"
                type="number"
                step="0.01"
                min="0"
                placeholder="45.00"
              />
              <input
                className={inputCls}
                name="tt_quota"
                type="number"
                min="1"
                placeholder="100"
              />
            </div>
          ))}
          <button
            className="rounded bg-green-600 px-4 py-2 font-bold text-black"
            type="submit"
          >
            create event →
          </button>
        </form>
      </section>
    </>
  );
}

export default function OrganizerPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <main className="mx-auto max-w-2xl space-y-8 p-8 text-sm">
      <Suspense fallback={<p className="text-neutral-500">$ loading…</p>}>
        <Dashboard searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
