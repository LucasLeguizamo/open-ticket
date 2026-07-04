/**
 * importFromUrl — the single entry point F3 (web) and F5 (agentic) call
 * (design-import.md §1, §6). test/unit/import-fetch.test.ts exercises
 * safeFetchHtml directly; this file proves the ORCHESTRATOR surfaces the same
 * FetchError.code end-to-end (fetch → extract → normalize), so a caller mapping
 * e.code to a UI message (app/organizer/import/actions.ts) can trust it.
 *
 * SSRF is the load-bearing guard here: a malicious organizer URL (or a redirect
 * target) pointing at localhost / a private IP / the cloud metadata endpoint must
 * bounce with code "blocked_host" BEFORE any HTML is read.
 */
import { describe, expect, it } from "vitest";
import { FetchError, importFromUrl } from "@/lib/import";

describe("importFromUrl — SSRF bounces through the orchestrator", () => {
  it.each([
    ["cloud metadata IP", "http://169.254.169.254/latest/meta-data/"],
    ["loopback literal", "http://127.0.0.1/"],
    ["loopback name", "http://localhost:8080/admin"],
    ["private 10/8", "http://10.0.0.5/"],
    ["private 192.168/16", "http://192.168.1.1/"],
    ["link-local", "http://169.254.0.1/"],
    ["ipv6 loopback", "http://[::1]/"],
    ["0.0.0.0", "http://0.0.0.0/"],
  ])("rejects %s with code blocked_host", async (_label, url) => {
    await expect(importFromUrl(url)).rejects.toMatchObject({
      name: "FetchError",
      code: "blocked_host",
    });
  });

  it.each([
    ["file scheme", "file:///etc/passwd"],
    ["ftp scheme", "ftp://example.com/x"],
    ["gopher scheme", "gopher://evil/"],
    ["garbage", "http://"],
    ["not a url at all", "just some text"],
  ])("rejects %s with code invalid_url", async (_label, url) => {
    await expect(importFromUrl(url)).rejects.toMatchObject({
      name: "FetchError",
      code: "invalid_url",
    });
  });

  it("throws a FetchError instance (so callers can instanceof-narrow the .code)", async () => {
    const err = await importFromUrl("http://127.0.0.1/").catch((e) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect(err.code).toBe("blocked_host");
  });
});
