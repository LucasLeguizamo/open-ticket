/**
 * Server-side SSRF-safe HTML fetch (design-import.md §3).
 *
 * The one non-trivial control is TOCTOU: a host can resolve to a public IP for
 * the pre-flight check, then to a private one at connect time. We close it by
 * validating the IP at the socket's `lookup` hook — the request only ever opens
 * a connection to an IP we approved at connect time.
 *
 * Design §3 named undici's `Agent.connect.lookup`. undici is NOT a userland
 * package on Node 24 (it backs the global fetch but isn't importable without a
 * dep). node:http/https `request` exposes the SAME `lookup` hook from stdlib —
 * zero new dependency, identical TOCTOU guarantee. ponytail: stdlib over a dep.
 */

import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";

export type FetchErrorCode =
  | "invalid_url"
  | "blocked_host"
  | "too_large"
  | "timeout"
  | "bad_status"
  | "not_html";

export class FetchError extends Error {
  constructor(
    readonly code: FetchErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "FetchError";
  }
}

export interface FetchResult {
  html: string;
  finalUrl: string;
  contentType: string;
}

const TIMEOUT_MS = 5000;
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_REDIRECTS = 3;
const USER_AGENT = "OpenTicketImportBot/1.0";

/** Parse an IPv4 dotted string to a 32-bit int, or null if malformed. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const b = Number(p);
    if (b > 255) return null;
    n = n * 256 + b;
  }
  return n >>> 0;
}

function inV4Range(ipInt: number, netStr: string, bits: number): boolean {
  const net = ipv4ToInt(netStr);
  if (net === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (net & mask);
}

/**
 * True if the IP is loopback / private / link-local / metadata / unspecified.
 * Covers the ranges in design §3.1 table for both v4 and v6.
 */
export function isBlockedIp(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) {
    const n = ipv4ToInt(ip);
    if (n === null) return true; // unparseable → block
    return (
      inV4Range(n, "0.0.0.0", 8) || // "this" network (incl 0.0.0.0)
      inV4Range(n, "127.0.0.0", 8) || // loopback
      inV4Range(n, "10.0.0.0", 8) || // private
      inV4Range(n, "172.16.0.0", 12) || // private
      inV4Range(n, "192.168.0.0", 16) || // private
      inV4Range(n, "169.254.0.0", 16) // link-local + metadata 169.254.169.254
    );
  }
  if (fam === 6) {
    const s = ip.toLowerCase().split("%")[0] ?? ""; // strip zone id
    if (s === "::" || s === "::1") return true; // unspecified / loopback
    if (s.startsWith("fe8") || s.startsWith("fe9")) return true; // fe80::/10 link-local
    if (s.startsWith("fea") || s.startsWith("feb")) return true; // fe80::/10 link-local
    if (s.startsWith("fc") || s.startsWith("fd")) return true; // fc00::/7 unique-local
    // IPv4-mapped (::ffff:a.b.c.d) → validate the embedded v4
    const mapped = s.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return isBlockedIp(mapped[1]);
    return false;
  }
  return true; // not a valid IP literal → block
}

/**
 * DNS lookup wrapped so the socket only connects to an approved IP.
 * Passed as the request's `lookup` — fires at connect time, closing TOCTOU.
 */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  // biome-ignore lint/suspicious/noExplicitAny: node's overloaded lookup signature
  dnsLookup(hostname, options as any, (err, address, family) => {
    if (err) return callback(err, address as string, family);
    const addrs = Array.isArray(address)
      ? (address as { address: string }[]).map((a) => a.address)
      : [address as string];
    for (const a of addrs) {
      if (isBlockedIp(a)) {
        return callback(
          new FetchError("blocked_host", `blocked IP ${a} for ${hostname}`),
          "",
          0,
        );
      }
    }
    // biome-ignore lint/suspicious/noExplicitAny: pass node's result through untouched
    callback(err, address as any, family as any);
  });
};

/** Validate scheme + hostname shape; block obvious localhost literals early. */
function parseSafeUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new FetchError("invalid_url", "malformed URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new FetchError("invalid_url", `scheme ${u.protocol} not allowed`);
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  // Fast-path literals; the socket lookup guard is the real defense for DNS names.
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    (isIP(host) && isBlockedIp(host))
  ) {
    throw new FetchError("blocked_host", `blocked host ${host}`);
  }
  return u;
}

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}
type Getter = (url: URL) => Promise<RawResponse>;

/**
 * Minimal shapes of the node request/response objects that the byte-cap and
 * timeout logic actually touch. Declaring them structurally lets a test drive
 * `consumeCapped` with fakes — WITHOUT weakening any guard: the real caller
 * still hands it the SSRF-guarded `client.request` (see `guardedGet`), so this
 * is a pure injection seam, not a bypass of the security controls.
 */
interface CappableRequest {
  destroy(error?: Error): void;
  setTimeout(ms: number, cb: () => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  end(): void;
}
interface CappableResponse {
  statusCode?: number;
  headers: http.IncomingHttpHeaders;
  on(event: "data", cb: (chunk: Buffer) => void): void;
  on(event: "end", cb: () => void): void;
}

/**
 * Enforce the 2 MB byte cap and the 5 s timeout on a live request/response.
 * Aborts the read as soon as the cap is exceeded (does not buffer the rest).
 * Pure over the request/response it's handed, so the caps are unit-testable
 * with fakes — no socket, so no need to defeat the SSRF lookup guard.
 */
function consumeCapped(
  req: CappableRequest,
  attachResponse: (onResponse: (res: CappableResponse) => void) => void,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    attachResponse((res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BYTES) {
          req.destroy();
          reject(new FetchError("too_large", "> 2 MB"));
          return;
        }
        chunks.push(c);
      });
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
        }),
      );
    });
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy(new FetchError("timeout", `> ${TIMEOUT_MS}ms`));
    });
    req.on("error", (e) =>
      reject(
        e instanceof FetchError ? e : new FetchError("blocked_host", e.message),
      ),
    );
    req.end();
  });
}

/** One GET with the SSRF guard, no redirect following. */
function guardedGet(url: URL): Promise<RawResponse> {
  const client = url.protocol === "https:" ? https : http;
  let req!: http.ClientRequest;
  return consumeCapped(
    {
      destroy: (e) => req.destroy(e),
      setTimeout: (ms, cb) => req.setTimeout(ms, cb),
      on: (event, cb) => req.on(event, cb),
      end: () => req.end(),
    },
    (onResponse) => {
      req = client.request(
        url,
        {
          method: "GET",
          lookup: guardedLookup,
          headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
          // do NOT send cookies/creds; node adds none by default
        },
        (res) => onResponse(res),
      );
    },
  );
}

/**
 * Redirect + response validation loop. Pure over the `get` it's handed so the
 * control flow (redirect revalidation, status/content-type gates) is unit-testable
 * without a socket. The default `get` is the SSRF-guarded one.
 */
async function followAndValidate(
  rawUrl: string,
  get: Getter,
): Promise<FetchResult> {
  let url = parseSafeUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const { status, headers, body } = await get(url);

    if (status >= 300 && status < 400) {
      const loc = headers.location;
      if (!loc)
        throw new FetchError("bad_status", `${status} without Location`);
      if (hop === MAX_REDIRECTS)
        throw new FetchError("bad_status", "too many redirects");
      // resolve relative Location against current url, then re-run all guards
      url = parseSafeUrl(new URL(loc, url).toString());
      continue;
    }

    if (status < 200 || status >= 300) {
      throw new FetchError("bad_status", `status ${status}`);
    }

    const contentType = String(headers["content-type"] ?? "");
    if (!/^(text\/html|application\/xhtml\+xml)/i.test(contentType.trim())) {
      throw new FetchError("not_html", contentType || "no content-type");
    }
    return {
      html: body.toString("utf8"),
      finalUrl: url.toString(),
      contentType,
    };
  }
  // unreachable: loop returns or throws
  throw new FetchError("bad_status", "too many redirects");
}

/**
 * Fetch HTML from an organizer-supplied URL. Follows up to 3 redirects, each
 * revalidated. Returns text/html only, capped at 2 MB, 5 s timeout.
 */
export function safeFetchHtml(rawUrl: string): Promise<FetchResult> {
  return followAndValidate(rawUrl, guardedGet);
}

/** Test-only: exercise the redirect/validation loop with a fake transport,
 * and the byte-cap / timeout logic with a fake request/response. */
export const __test = {
  followAndValidate,
  consumeCapped,
  MAX_BYTES,
  TIMEOUT_MS,
};
