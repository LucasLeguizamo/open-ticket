import { describe, expect, it } from "vitest";
import { apiKeyRateLimited, generateApiKey, hashApiKey } from "@/lib/api-key";

describe("api-key", () => {
  it("hash is deterministic and different per key", () => {
    expect(hashApiKey("ot_live_a")).toBe(hashApiKey("ot_live_a"));
    expect(hashApiKey("ot_live_a")).not.toBe(hashApiKey("ot_live_b"));
  });

  it("generateApiKey returns the prefixed raw key and its hash", () => {
    const { raw, row } = generateApiKey("test");
    expect(raw.startsWith("ot_live_")).toBe(true);
    expect(row.keyHash).toBe(hashApiKey(raw));
    expect(row.label).toBe("test");
  });

  it("rate-limit: lets through up to the limit (30) and blocks the 31st within the window", () => {
    const key = `key_${Math.random()}`;
    const t0 = 1_000;
    for (let i = 0; i < 30; i++) {
      expect(apiKeyRateLimited(key, t0)).toBe(false);
    }
    expect(apiKeyRateLimited(key, t0)).toBe(true); // 31st
    // new window → resets
    expect(apiKeyRateLimited(key, t0 + 61_000)).toBe(false);
  });
});
