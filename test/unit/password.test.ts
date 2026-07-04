import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";

describe("password scrypt", () => {
  it("verifica la contraseña correcta y rechaza la incorrecta", () => {
    const stored = hashPassword("hunter2-segura");
    expect(verifyPassword("hunter2-segura", stored)).toBe(true);
    expect(verifyPassword("otra-cosa", stored)).toBe(false);
  });

  it("salt aleatoria: dos hashes de la misma contraseña difieren", () => {
    expect(hashPassword("misma")).not.toBe(hashPassword("misma"));
  });

  it("no explota con hash corrupto", () => {
    expect(verifyPassword("x", "sin-formato")).toBe(false);
    expect(verifyPassword("x", "")).toBe(false);
  });
});
