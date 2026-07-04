/**
 * SSRF guards (design-import.md §3). Two layers:
 *  1. isBlockedIp — every blocked range, unit-checked directly.
 *  2. safeFetchHtml — end-to-end against a real localhost server, proving the
 *     socket-level lookup guard actually refuses to connect to a private IP,
 *     plus content-type / size / redirect / status handling.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { __test, isBlockedIp, safeFetchHtml } from "@/lib/import/fetch";

type RawResponse = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};
/** Build a fake transport from a per-URL response map (or function). */
function fakeGet(
  responder: (url: string) => RawResponse,
): (url: URL) => Promise<RawResponse> {
  return (url: URL) => Promise.resolve(responder(url.toString()));
}
const html200 = (body = "<html>ok</html>"): RawResponse => ({
  status: 200,
  headers: { "content-type": "text/html; charset=utf-8" },
  body: Buffer.from(body),
});

describe("isBlockedIp", () => {
  it.each([
    "127.0.0.1",
    "127.1.2.3",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "169.254.0.1",
    "0.0.0.0",
    "::1",
    "::",
    "fe80::1", // link-local
    "fc00::1", // unique-local
    "fd12:3456::1",
    "::ffff:127.0.0.1", // v4-mapped loopback
    "not-an-ip",
  ])("blocks %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "172.15.255.255", // just outside 172.16/12
    "172.32.0.1", // just outside 172.16/12
    "11.0.0.1",
    "2606:4700:4700::1111", // public v6
  ])("allows public %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });
});

describe("safeFetchHtml — URL validation", () => {
  it.each([
    ["file scheme", "file:///etc/passwd"],
    ["ftp scheme", "ftp://example.com/x"],
    ["garbage", "not a url"],
  ])("rejects %s", async (_n, url) => {
    await expect(safeFetchHtml(url)).rejects.toMatchObject({
      name: "FetchError",
    });
  });

  it("blocks localhost literal", async () => {
    await expect(safeFetchHtml("http://localhost/")).rejects.toMatchObject({
      code: "blocked_host",
    });
  });

  it("blocks 127.0.0.1 literal", async () => {
    await expect(safeFetchHtml("http://127.0.0.1/")).rejects.toMatchObject({
      code: "blocked_host",
    });
  });

  it("blocks metadata IP literal", async () => {
    await expect(
      safeFetchHtml("http://169.254.169.254/latest/meta-data/"),
    ).rejects.toMatchObject({ code: "blocked_host" });
  });
});

// A real server bound to loopback: any successful fetch here would mean the
// socket guard FAILED to block the private IP. We assert it always throws.
describe("safeFetchHtml — live loopback server", () => {
  let server: http.Server;
  let base: string;
  let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

  beforeAll(async () => {
    server = http.createServer((req, res) => handler(req, res));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("refuses to connect to a loopback host (SSRF via DNS-name would be same guard)", async () => {
    handler = (_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end("<html>should never be read</html>");
    };
    // Even though a server IS listening and would return 200, the guard blocks
    // the connection because the resolved IP is loopback.
    await expect(safeFetchHtml(`${base}/`)).rejects.toMatchObject({
      code: "blocked_host",
    });
  });
});

// Response-handling control flow (redirect revalidation, status/content-type
// gates), tested through the fake transport so no real socket is needed.
describe("followAndValidate — response handling", () => {
  const run = (url: string, get: (u: URL) => Promise<RawResponse>) =>
    __test.followAndValidate(url, get);

  it("returns HTML on 200 text/html", async () => {
    const r = await run(
      "https://example.com/",
      fakeGet(() => html200("<h1>hi</h1>")),
    );
    expect(r.html).toContain("<h1>hi</h1>");
    expect(r.finalUrl).toBe("https://example.com/");
  });

  it("rejects non-html content-type", async () => {
    await expect(
      run(
        "https://example.com/x.json",
        fakeGet(() => ({
          status: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from("{}"),
        })),
      ),
    ).rejects.toMatchObject({ code: "not_html" });
  });

  it("rejects 4xx/5xx", async () => {
    await expect(
      run(
        "https://example.com/",
        fakeGet(() => ({ status: 404, headers: {}, body: Buffer.alloc(0) })),
      ),
    ).rejects.toMatchObject({ code: "bad_status" });
  });

  it("follows a redirect and revalidates the target (blocks redirect to private IP)", async () => {
    await expect(
      run(
        "https://example.com/",
        fakeGet((u) =>
          u === "https://example.com/"
            ? {
                status: 302,
                headers: { location: "http://169.254.169.254/" },
                body: Buffer.alloc(0),
              }
            : html200(),
        ),
      ),
    ).rejects.toMatchObject({ code: "blocked_host" });
  });

  it("follows a redirect to a public host and returns its HTML", async () => {
    const r = await run(
      "https://example.com/",
      fakeGet((u) =>
        u === "https://example.com/"
          ? {
              status: 301,
              headers: { location: "https://elsewhere.com/e" },
              body: Buffer.alloc(0),
            }
          : html200("<title>moved</title>"),
      ),
    );
    expect(r.finalUrl).toBe("https://elsewhere.com/e");
    expect(r.html).toContain("moved");
  });

  it("gives up after too many redirects", async () => {
    let n = 0;
    await expect(
      run(
        "https://example.com/",
        fakeGet(() => ({
          status: 302,
          headers: { location: `https://example.com/${n++}` },
          body: Buffer.alloc(0),
        })),
      ),
    ).rejects.toMatchObject({ code: "bad_status" });
  });
});
