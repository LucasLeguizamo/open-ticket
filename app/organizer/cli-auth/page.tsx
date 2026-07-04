/**
 * /organizer/cli-auth?port=&state= — the browser step of `otick login`.
 * Session-gated (redirects to login with returnTo). Shows an authorize button
 * that mints a key and hands it to the CLI's loopback listener (see actions.ts).
 */
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSessionOrganizerId } from "@/lib/session";
import { authorizeCli } from "./actions";

const ERRORS: Record<string, string> = {
  bad_port: "the CLI sent an invalid callback port — start `otick login` again",
  bad_state: "the request could not be verified — start `otick login` again",
};

async function Authorize({
  searchParams,
}: {
  searchParams: Promise<{ port?: string; state?: string; error?: string }>;
}) {
  const { port, state, error } = await searchParams;

  const organizerId = await getSessionOrganizerId();
  if (!organizerId) {
    const back = `/organizer/cli-auth?port=${encodeURIComponent(port ?? "")}&state=${encodeURIComponent(state ?? "")}`;
    redirect(`/organizer/login?returnTo=${encodeURIComponent(back)}`);
  }

  const valid =
    !!port &&
    /^\d+$/.test(port) &&
    !!state &&
    /^[A-Za-z0-9_-]{16,128}$/.test(state);

  return (
    <>
      {error && (
        <p className="rounded border border-red-900 bg-red-950 p-2 text-red-400">
          error: {ERRORS[error] ?? error}
        </p>
      )}

      {!valid ? (
        <p className="text-neutral-400">
          This page is opened by the <code>otick</code> CLI. Run{" "}
          <span className="text-green-500">otick login</span> in your terminal —
          it will open this page with the right parameters.
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-neutral-400">
            The <span className="text-green-500">otick</span> CLI on this
            machine wants to sign in as your organizer account. Approving
            creates an API key and sends it to the CLI (local machine only).
          </p>
          <p className="text-neutral-600">
            callback: 127.0.0.1:{port} · you can revoke keys later
          </p>
          <div className="flex gap-3">
            <form action={authorizeCli}>
              <input type="hidden" name="port" value={port} />
              <input type="hidden" name="state" value={state} />
              <button
                className="rounded bg-green-600 px-4 py-2 font-bold text-black"
                type="submit"
              >
                authorize otick →
              </button>
            </form>
            <a
              className="rounded border border-neutral-700 px-4 py-2 text-neutral-400"
              href="/organizer"
            >
              cancel
            </a>
          </div>
        </div>
      )}
    </>
  );
}

export default function CliAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ port?: string; state?: string; error?: string }>;
}) {
  return (
    <main className="mx-auto max-w-md space-y-6 p-8 text-sm">
      <p className="text-neutral-500">$ openticket organizer --authorize-cli</p>
      <Suspense fallback={<p className="text-neutral-600">$ loading…</p>}>
        <Authorize searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
