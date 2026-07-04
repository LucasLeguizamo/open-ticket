/** Organizer login / signup — email + password (FR 11). */
import { Suspense } from "react";
import { login, signup } from "../actions";

const ERRORS: Record<string, string> = {
  credenciales: "wrong email or password",
  email_ya_registrado: "that email already has an account",
  datos_invalidos: "check email (valid) and password (minimum 8 characters)",
};

const inputCls =
  "w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-200";

async function LoginForms({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; returnTo?: string }>;
}) {
  const { error, returnTo } = await searchParams;
  // Only same-site organizer paths survive (mirrors safeReturnTo in the action).
  const rt = returnTo?.startsWith("/organizer/") ? returnTo : undefined;
  return (
    <>
      {error && (
        <p className="rounded border border-red-900 bg-red-950 p-2 text-red-400">
          error: {ERRORS[error] ?? error}
        </p>
      )}
      {rt && (
        <p className="rounded border border-neutral-700 bg-neutral-900 p-2 text-neutral-400">
          → log in to continue authorizing the CLI
        </p>
      )}
      <section className="space-y-2">
        <p className="text-neutral-500"># I already have an account</p>
        <form action={login} className="space-y-2">
          {rt && <input type="hidden" name="returnTo" value={rt} />}
          <input
            className={inputCls}
            name="email"
            type="email"
            placeholder="email"
            required
          />
          <input
            className={inputCls}
            name="password"
            type="password"
            placeholder="password"
            minLength={8}
            required
          />
          <button
            className="rounded bg-green-600 px-4 py-2 font-bold text-black"
            type="submit"
          >
            login →
          </button>
        </form>
      </section>
      <section className="space-y-2">
        <p className="text-neutral-500"># create an organizer account</p>
        <form action={signup} className="space-y-2">
          {rt && <input type="hidden" name="returnTo" value={rt} />}
          <input
            className={inputCls}
            name="name"
            placeholder="name / organization"
            minLength={2}
            required
          />
          <input
            className={inputCls}
            name="email"
            type="email"
            placeholder="email"
            required
          />
          <input
            className={inputCls}
            name="password"
            type="password"
            placeholder="password (min. 8)"
            minLength={8}
            required
          />
          <button
            className="rounded border border-green-600 px-4 py-2 text-green-500"
            type="submit"
          >
            signup →
          </button>
        </form>
      </section>
    </>
  );
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; returnTo?: string }>;
}) {
  return (
    <main className="mx-auto max-w-sm space-y-8 p-8 text-sm">
      <p className="text-neutral-500">$ openticket organizer --auth</p>
      <Suspense fallback={null}>
        <LoginForms searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
