import { describe, expect, it } from "vitest";
import { csvCell } from "@/lib/reports";

describe("csvCell (R-020, test plan 5)", () => {
  it.each([
    ["=HYPERLINK(\"http://evil\")", "\"'=HYPERLINK(\"\"http://evil\"\")\""],
    ["+1+1", "'+1+1"],
    ["-2+3", "'-2+3"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\tcmd", "'\tcmd"],
    ["\r=1", "\"'\r=1\""],
  ])("neutralises a formula: %j", (input, out) => {
    expect(csvCell(input)).toBe(out);
  });

  it("leaves ordinary text and numbers alone, and still quotes commas, quotes and newlines", () => {
    expect(csvCell("Fix login bug")).toBe("Fix login bug");
    expect(csvCell("a, b")).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell(-1.5)).toBe("-1.5");
    expect(csvCell(null)).toBe("");
  });
});
