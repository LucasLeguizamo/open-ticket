/**
 * /organizer/guide — how to upload events. Public (no auth): people can read it
 * before signing up. Arcade-skinned, matches the landing. Two paths: import by
 * URL (F3) and manual create (US-001); quota/prices are always the human's.
 */
import { Suspense } from "react";
import { SiteFooter } from "../../site-footer";

export const metadata = {
  title: "OpenTicket · how to upload events",
  description: "Get your event live and buyable by agents in a few steps.",
};

type Step = {
  n: string;
  title: string;
  body: React.ReactNode;
  color: string;
};

const STEPS: Step[] = [
  {
    n: "1",
    title: "Sign in",
    color: "var(--pg-cyan)",
    body: (
      <>
        Create an organizer account or log in at{" "}
        <a className="underline hover:text-[var(--pg-green)]" href="/organizer">
          /organizer
        </a>
        . One account manages all your events.
      </>
    ),
  },
  {
    n: "2",
    title: "Add an event — two ways",
    color: "var(--pg-green)",
    body: (
      <>
        <p className="mb-2">
          <span className="text-[var(--pg-green)]">A · Import from a URL</span>{" "}
          (fastest). Paste a Luma / Eventbrite / landing URL in{" "}
          <a
            className="underline hover:text-[var(--pg-green)]"
            href="/organizer/import"
          >
            /organizer/import
          </a>
          . We read the page's structured data (JSON-LD / og: tags) and pre-fill
          title, description, date, venue and cover image. You review before
          anything is saved.
        </p>
        <p>
          <span className="text-[var(--pg-magenta)]">B · Create manually</span>.
          Fill the form on your dashboard: title, description, venue, date,
          currency, image URL.
        </p>
      </>
    ),
  },
  {
    n: "3",
    title: "Set prices, currency and quota",
    color: "var(--pg-yellow)",
    body: (
      <>
        Add one or more ticket types (name · price · quota). Import may{" "}
        <em>suggest</em> a price from the page, but{" "}
        <span className="text-[var(--pg-yellow)]">you always confirm it</span> —
        and{" "}
        <span className="text-[var(--pg-yellow)]">quota is never imported</span>
        , you set how many tickets exist. This is what prevents overselling.
      </>
    ),
  },
  {
    n: "4",
    title: "Publish",
    color: "var(--pg-magenta)",
    body: (
      <>
        A new event stays in <span className="text-[var(--pg-dim)]">draft</span>{" "}
        until you hit <span className="text-[var(--pg-green)]">publish →</span>.
        Draft events are private; published ones go live immediately.
      </>
    ),
  },
  {
    n: "5",
    title: "It's live everywhere",
    color: "var(--pg-cyan)",
    body: (
      <>
        Once published, your event shows on the landing, in the{" "}
        <a
          className="underline hover:text-[var(--pg-green)]"
          href="/api/events"
        >
          /api/events
        </a>{" "}
        feed, is buyable by any AI agent via{" "}
        <a className="underline hover:text-[var(--pg-green)]" href="/agents">
          MCP
        </a>
        , and findable from the terminal with{" "}
        <span className="text-[var(--pg-green)]">otick search</span>. Buyers pay
        with Stripe and get an .ics reminder automatically.
      </>
    ),
  },
];

export default function GuidePage() {
  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6 sm:p-8">
      <nav className="flex justify-between text-xs text-[var(--pg-dim)]">
        <a className="underline hover:text-[var(--pg-green)]" href="/">
          ← openticket
        </a>
        <span className="font-pixel text-[0.55rem]">/organizer/guide</span>
      </nav>

      <header className="space-y-3">
        <p className="text-xs text-[var(--pg-dim)]">
          $ openticket organizer --guide
        </p>
        <h1 className="font-pixel text-base leading-relaxed text-[var(--pg-ink)] sm:text-lg">
          Upload your events
        </h1>
        <p className="text-sm text-[var(--pg-dim)]">
          Get an event live and buyable by agents in five steps.
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          <a className="pixel-btn text-[0.6rem]" href="/organizer/import">
            ▶ Import from URL
          </a>
          <a
            className="pixel-btn pixel-btn--magenta text-[0.6rem]"
            href="/organizer"
          >
            ★ Create manually
          </a>
        </div>
      </header>

      <ol className="space-y-4">
        {STEPS.map((s) => (
          <li key={s.n} className="pixel-box flex gap-4 p-4">
            <span
              className="font-pixel text-lg"
              style={{ color: s.color }}
              aria-hidden
            >
              {s.n}
            </span>
            <div className="space-y-1">
              <p
                className="font-pixel text-[0.7rem]"
                style={{ color: s.color }}
              >
                {s.title}
              </p>
              <div className="text-sm leading-relaxed text-[var(--pg-dim)]">
                {s.body}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <Suspense fallback={<p className="text-[var(--pg-dim)]">$ loading…</p>}>
        <SiteFooter />
      </Suspense>
    </main>
  );
}
