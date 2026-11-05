import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/sanitize";

describe("safeNextPath (R-063)", () => {
  it.each(["/dashboard", "/reports?from=2026-01-01&to=2026-01-31", "/tracker?edit=c123", "/team#requests"])("keeps %s", (p) => {
    expect(safeNextPath(p)).toBe(p);
  });
  it.each([
    "//evil.example",
    "/.//evil.example",
    "/%2e//evil.example",
    "/%2F%2Fevil.example",
    "/\\evil.example",
    "/a/../../etc",
    "/a/%2e%2e/b",
    "https://evil.example",
    "evil",
    "/%E0%A4%A",
    "/x\u0000y",
  ])("refuses %j", (p) => {
    expect(safeNextPath(p)).toBe("/dashboard");
  });
});
