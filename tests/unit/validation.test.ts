import { describe, expect, it } from "vitest";
import { clientCheck, emailField, loginSchema, passwordRule, resetCodeField } from "@/lib/validation";

describe("passwordRule", () => {
  it.each([
    ["abcdefg1", true],
    ["abcdefgh", false], // no digit
    ["12345678", false], // no letter
    ["abc1", false], // too short
    ["a1" + "x".repeat(200), false], // too long
  ])("%s → valid %s", (pw, ok) => {
    expect(passwordRule.safeParse(pw).success).toBe(ok);
  });
});

describe("emailField", () => {
  it("trims and lower-cases", () => {
    expect(emailField.parse("  Ali@Example.TEST ")).toBe("ali@example.test");
  });
  it("rejects malformed addresses", () => {
    for (const bad of ["no-at-sign", "a@b", "a@@b.test", "<a>@b.test"]) expect(emailField.safeParse(bad).success).toBe(false);
  });
});

describe("resetCodeField", () => {
  it("accepts 6 digits with spaces or dashes", () => {
    expect(resetCodeField.parse("123 456")).toBe("123456");
    expect(resetCodeField.parse("123-456")).toBe("123456");
  });
  it("rejects anything else", () => {
    for (const bad of ["12345", "1234567", "abcdef"]) expect(resetCodeField.safeParse(bad).success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("rejects unknown keys (strict)", () => {
    expect(clientCheck(loginSchema, { email: "a@b.test", password: "x", isAdmin: true })).not.toBeNull();
  });
});
