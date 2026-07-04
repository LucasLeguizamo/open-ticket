"use client";

/**
 * F3 client surface (design-import.md §2, §6). Two states:
 *  1. URL form → importUrl action (useActionState). FetchError → inline message.
 *  2. Editable preview → posts to createEvent (the single write path, US-001).
 *
 * Hard UI rules (design §2, non-negotiable):
 *  - every null/missing field renders as an EMPTY required input (nothing
 *    guessed gets published): date, currency, venue.
 *  - quota is ALWAYS typed by the human — it is not in the draft, no import
 *    field for it. Each ticket-type row asks for quota with an empty required input.
 *  - detectedPrices are SUGGESTIONS: the human confirms each one (a checkbox)
 *    before it becomes a ticket_type; unconfirmed prices are dropped.
 *  - fieldConfidence is shown per-field so "guessed" values get a review nudge.
 */
import { useActionState } from "react";
import type { EventDraft, FieldConfidence } from "@/lib/zod/event";
import { createEvent } from "../actions";
import { type ImportState, importUrl } from "./actions";

const inputCls =
  "w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-200";

/** JSON-LD startsAt is a UTC ISO string; datetime-local wants local "YYYY-MM-DDTHH:mm". */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ConfidenceBadge({
  level,
}: {
  level: "detected" | "guessed" | "missing";
}) {
  if (level === "detected") {
    return <span className="text-green-600">[detected]</span>;
  }
  if (level === "guessed") {
    return <span className="text-yellow-500">[guessed · review]</span>;
  }
  return <span className="text-neutral-600">[you fill]</span>;
}

function Preview({
  draft,
  conf,
}: {
  draft: Partial<EventDraft>;
  conf: FieldConfidence;
}) {
  const prices = draft.detectedPrices ?? [];
  return (
    <section className="space-y-4">
      <p className="text-neutral-500">
        # draft — review & create (stays in draft)
      </p>
      <form action={createEvent} className="space-y-3">
        <label className="block space-y-1">
          <span className="text-neutral-500">
            title <ConfidenceBadge level={conf.title} />
          </span>
          <input
            className={inputCls}
            name="title"
            defaultValue={draft.title ?? ""}
            minLength={3}
            required
          />
        </label>

        <label className="block space-y-1">
          <span className="text-neutral-500">
            description <ConfidenceBadge level={conf.description} />
          </span>
          <textarea
            className={inputCls}
            name="description"
            defaultValue={draft.description ?? ""}
            rows={3}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-neutral-500">
            venue <ConfidenceBadge level={conf.venue} />
          </span>
          <input
            className={inputCls}
            name="venue"
            defaultValue={draft.venue ?? ""}
            placeholder="venue"
          />
        </label>

        <div className="flex gap-2">
          <label className="block flex-1 space-y-1">
            <span className="text-neutral-500">
              starts at <ConfidenceBadge level={conf.startsAt} />
            </span>
            <input
              className={inputCls}
              name="starts_at"
              type="datetime-local"
              defaultValue={toLocalInput(draft.startsAt)}
              required
            />
          </label>
          <label className="block space-y-1">
            <span className="text-neutral-500">
              currency <ConfidenceBadge level={conf.currency} />
            </span>
            <select
              className={inputCls}
              name="currency"
              defaultValue={draft.currency ?? ""}
              required
            >
              <option value="" disabled>
                pick…
              </option>
              <option value="USD">USD</option>
              <option value="COP">COP</option>
            </select>
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-neutral-500">
            image URL <ConfidenceBadge level={conf.imageUrl} />
          </span>
          <input
            className={inputCls}
            name="image_url"
            type="url"
            defaultValue={draft.imageUrl ?? ""}
            placeholder="https://…"
          />
        </label>

        <div className="space-y-2 rounded border border-neutral-800 p-3">
          <p className="text-neutral-500">
            # ticket types — quota is always yours to set
          </p>
          {prices.length > 0 && (
            <p className="text-neutral-600">
              detected prices below are <em>suggestions</em>: confirm the ones
              you want, then set quota for each.
            </p>
          )}
          {prices.map((p, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: static list, form index alignment relies on order
              key={`${p.label ?? "price"}-${p.priceMinor}-${i}`}
              className="flex items-center gap-2 rounded border border-neutral-800/60 p-2"
            >
              {/*
                createEvent zips tt_name/tt_price/tt_quota by index and ignores
                rows with an empty name. So "unconfirm" = blank the name input
                (keeps index alignment, needs no change to createEvent).
              */}
              <input
                type="checkbox"
                defaultChecked
                aria-label={`confirm ticket type ${p.label ?? "General"}`}
                onChange={(e) => {
                  const nameInput =
                    e.currentTarget.parentElement?.querySelector<HTMLInputElement>(
                      'input[name="tt_name"]',
                    );
                  if (!nameInput) return;
                  // blank (not disable) → row ignored by createEvent, index stays aligned
                  nameInput.value = e.currentTarget.checked
                    ? (nameInput.dataset.label ?? "General")
                    : "";
                  nameInput.readOnly = !e.currentTarget.checked;
                  nameInput.classList.toggle(
                    "opacity-40",
                    !e.currentTarget.checked,
                  );
                }}
              />
              <input
                className={inputCls}
                name="tt_name"
                data-label={p.label ?? "General"}
                defaultValue={p.label ?? "General"}
                placeholder="name"
              />
              <input
                className={inputCls}
                name="tt_price"
                type="number"
                step="0.01"
                min="0"
                defaultValue={(p.priceMinor / 100).toFixed(2)}
              />
              <input
                className={inputCls}
                name="tt_quota"
                type="number"
                min="1"
                placeholder="quota"
                required
              />
            </div>
          ))}
          {/* At least one manual row — quota is never imported (design §2.3). */}
          <div className="flex items-center gap-2 rounded border border-neutral-800/60 p-2">
            <span className="w-4 text-center text-neutral-600">+</span>
            <input
              className={inputCls}
              name="tt_name"
              placeholder={prices.length ? "(add another)" : "General"}
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
              placeholder="quota"
            />
          </div>
          <p className="text-neutral-600">
            rows with an empty name are ignored. an imported price only becomes
            a ticket type if its checkbox stays checked.
          </p>
        </div>

        <button
          className="rounded bg-green-600 px-4 py-2 font-bold text-black"
          type="submit"
        >
          create draft →
        </button>
      </form>
    </section>
  );
}

export function ImportClient() {
  const [state, action, pending] = useActionState<ImportState, FormData>(
    importUrl,
    { status: "idle" },
  );

  return (
    <div className="space-y-6">
      <form action={action} className="space-y-2">
        <div className="flex gap-2">
          <input
            className={inputCls}
            name="url"
            type="url"
            required
            placeholder="https://lu.ma/your-event"
            defaultValue={state.status !== "idle" ? state.url : ""}
            aria-label="event URL to import"
          />
          <button
            className="rounded bg-green-600 px-4 py-2 font-bold text-black disabled:opacity-50"
            type="submit"
            disabled={pending}
          >
            {pending ? "importing…" : "import →"}
          </button>
        </div>
      </form>

      {state.status === "error" && (
        <p
          role="alert"
          className="rounded border border-red-900 bg-red-950 p-2 text-red-400"
        >
          error: {state.message}
        </p>
      )}

      {state.status === "ok" && (
        <>
          <p className="text-neutral-600">
            source: {state.result.source} · coverage: {state.result.coverage}.
            {state.result.coverage !== "full" &&
              " some fields need you — they are marked below."}
          </p>
          <Preview
            draft={state.result.draft}
            conf={state.result.fieldConfidence}
          />
        </>
      )}
    </div>
  );
}
