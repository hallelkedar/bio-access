import { describe, expect, it } from "vitest";

import { passwordStrength, validateLogin, validateRegister } from "./validation";

const register = { full_name: "Dana Levi", email: "dana@example.com", phone: "", password: "password123" };

describe("validateLogin", () => {
  it("accepts a filled form", () => {
    expect(validateLogin({ email: "dana@example.com", password: "x" })).toEqual({});
  });

  it("requires both fields and a real-looking email", () => {
    expect(validateLogin({ email: "", password: "" })).toEqual({ email: "validation.required", password: "validation.required" });
    expect(validateLogin({ email: "dana@localhost", password: "x" }).email).toBe("validation.email");
  });
});

describe("validateRegister", () => {
  it("accepts a valid form (phone is optional)", () => {
    expect(validateRegister(register)).toEqual({});
  });

  it.each([
    [{ full_name: "  " }, "full_name", "validation.required"],
    [{ email: "dana" }, "email", "validation.email"],
    [{ password: "short" }, "password", "validation.passwordShort"],
    [{ password: "ש".repeat(37) }, "password", "validation.passwordLong"], // 74 bytes in UTF-8
  ] as const)("flags %o", (change, field, key) => {
    expect(validateRegister({ ...register, ...change })[field]).toBe(key);
  });
});

describe("passwordStrength", () => {
  it.each([
    ["", 0],
    ["abc", 1],
    ["abcdefgh", 1],
    ["abcdefghijklmn", 2],
    ["password123", 2],
    ["Password123", 3],
    ["Password123!", 4],
  ] as const)("%s scores %i", (password, score) => {
    expect(passwordStrength(password)).toBe(score);
  });
});
