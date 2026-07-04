import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";

describe("password scrypt", () => {
  it("verifies the correct password and rejects the wrong one", () => {
    const stored = hashPassword("hunter2-secure");
    expect(verifyPassword("hunter2-secure", stored)).toBe(true);
    expect(verifyPassword("something-else", stored)).toBe(false);
  });

  it("random salt: two hashes of the same password differ", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  it("does not blow up on a corrupt hash", () => {
    expect(verifyPassword("x", "not-a-valid-format")).toBe(false);
    expect(verifyPassword("x", "")).toBe(false);
  });
});
