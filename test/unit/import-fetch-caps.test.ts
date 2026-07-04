/**
 * Security-cap coverage for the URL importer (F6 gap #2).
 *
 * The 2 MB `too_large` cap and the 5 s `timeout` live inside `consumeCapped`
 * (extracted from `guardedGet`). In production they only run behind a real
 * socket, which the SSRF lookup guard always refuses for loopback — so they
 * had NO test coverage. Here we drive `consumeCapped` with a fake
 * request/response (no socket, no SSRF bypass) to exercise exactly those caps.
 */
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { __test } from "@/lib/import/fetch";

const { consumeCapped, MAX_BYTES, TIMEOUT_MS } = __test;

/** A fake response stream: an EventEmitter with node's IncomingMessage-ish shape. */
function fakeResponse(headers: Record<string, string> = {}) {
  const res = new EventEmitter() as EventEmitter & {
    statusCode?: number;
    headers: Record<string, string>;
  };
  res.statusCode = 200;
  res.headers = headers;
  return res;
}

/**
 * A fake request that records the timeout callback and destroy calls, and lets
 * the test hand a response to the consumer. No socket is ever opened.
 */
function fakeRequest() {
  const emitter = new EventEmitter();
  const calls = {
    destroyed: false,
    destroyErr: undefined as Error | undefined,
    timeoutMs: undefined as number | undefined,
    timeoutCb: undefined as (() => void) | undefined,
  };
  const req = {
    destroy(err?: Error) {
      calls.destroyed = true;
      calls.destroyErr = err;
      // Mirror node: destroying a request with an error re-emits it as 'error'.
      if (err) emitter.emit("error", err);
    },
    setTimeout(ms: number, cb: () => void) {
      calls.timeoutMs = ms;
      calls.timeoutCb = cb;
    },
    on(event: "error", cb: (err: Error) => void) {
      emitter.on(event, cb);
    },
    end() {},
  };
  return { req, calls, emitError: (e: Error) => emitter.emit("error", e) };
}

describe("consumeCapped — 2 MB cap (too_large)", () => {
  it("aborts with too_large and stops reading once the body exceeds 2 MB", async () => {
    const res = fakeResponse({ "content-type": "text/html" });
    const { req, calls } = fakeRequest();

    const promise = consumeCapped(req, (onResponse) => onResponse(res));

    // Emit chunks just over the cap. The 3rd chunk crosses 2 MB.
    const oneMb = Buffer.alloc(1024 * 1024, 0x61);
    res.emit("data", oneMb);
    res.emit("data", oneMb);
    res.emit("data", oneMb); // now > 2 MB → must abort here

    await expect(promise).rejects.toMatchObject({
      name: "FetchError",
      code: "too_large",
    });
    // Proves the read was cut off (req.destroy called), not buffered to the end.
    expect(calls.destroyed).toBe(true);
  });

  it("does NOT abort a body exactly at the cap", async () => {
    const res = fakeResponse({ "content-type": "text/html" });
    const { req } = fakeRequest();
    const promise = consumeCapped(req, (onResponse) => onResponse(res));

    res.emit("data", Buffer.alloc(MAX_BYTES, 0x61)); // exactly 2 MB, allowed
    res.emit("end");

    const out = await promise;
    expect(out.body.length).toBe(MAX_BYTES);
    expect(out.status).toBe(200);
  });
});

describe("consumeCapped — 5 s cap (timeout)", () => {
  it("aborts with timeout when the transport never responds within 5 s", async () => {
    vi.useFakeTimers();
    try {
      const { req, calls } = fakeRequest();
      // Never call onResponse and never emit end → the request hangs.
      const promise = consumeCapped(req, () => {});
      const assertion = expect(promise).rejects.toMatchObject({
        name: "FetchError",
        code: "timeout",
      });

      // The consumer registered a 5 s timeout; simulate node firing it (no 5 s
      // real wait — fake timers advance the clock).
      expect(calls.timeoutMs).toBe(TIMEOUT_MS);
      vi.advanceTimersByTime(TIMEOUT_MS);
      calls.timeoutCb?.(); // node's setTimeout callback fires after 5 s

      // Firing destroys the request with FetchError('timeout'); the fake
      // re-emits it as 'error' (like node), so the promise rejects with it.
      await assertion;
      expect(calls.destroyErr).toMatchObject({ code: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });
});
