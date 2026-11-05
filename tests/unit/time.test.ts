import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fmtHM, hourLabel, parseTimeText, periodRange, startOfWeek, dayKey, dayLabel } from "@/lib/time";

// Node re-reads TZ when it changes, so the same assertions run in two zones (test plan 10).
const ZONES = ["UTC", "America/New_York"];
const original = process.env.TZ;
afterAll(() => {
  process.env.TZ = original;
});

for (const tz of ZONES) {
  describe(`time helpers in ${tz} (R-054)`, () => {
    beforeAll(() => {
      process.env.TZ = tz;
    });

    it("periodRange is driven by the clock and week start passed in", () => {
      // Wednesday 11 March 2026, the week after the US DST change.
      const now = new Date(2026, 2, 11, 15, 0);
      expect(periodRange("today", now)).toEqual({ from: "2026-03-11", to: "2026-03-11" });
      expect(periodRange("this_week", now, "monday")).toEqual({ from: "2026-03-09", to: "2026-03-11" });
      expect(periodRange("this_week", now, "sunday")).toEqual({ from: "2026-03-08", to: "2026-03-11" });
      expect(periodRange("last_week", now, "monday")).toEqual({ from: "2026-03-02", to: "2026-03-08" });
      expect(periodRange("last_month", now)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
      expect(periodRange("last_30", now)).toEqual({ from: "2026-02-10", to: "2026-03-11" });
    });

    it("startOfWeek lands on local midnight across the DST change", () => {
      const s = startOfWeek(new Date(2026, 2, 10, 1, 30), "monday");
      expect(dayKey(s)).toBe("2026-03-09");
      expect([s.getHours(), s.getMinutes()]).toEqual([0, 0]);
    });

    it("dayLabel uses the clock it's given", () => {
      expect(dayLabel("2026-03-11", new Date(2026, 2, 11, 9))).toMatch(/^Today · /);
      expect(dayLabel("2026-03-10", new Date(2026, 2, 11, 9))).toMatch(/^Yesterday · /);
    });
  });
}

describe("parseTimeText", () => {
  it.each([
    ["9", { h: 9, m: 0 }],
    ["9:30", { h: 9, m: 30 }],
    ["09.30", { h: 9, m: 30 }],
    ["930", { h: 9, m: 30 }],
    ["9:30pm", { h: 21, m: 30 }],
    ["12am", { h: 0, m: 0 }],
    ["12pm", { h: 12, m: 0 }],
    ["14:05", { h: 14, m: 5 }],
  ])("%s", (input, out) => {
    expect(parseTimeText(input)).toEqual(out);
  });
  it.each(["", "25:00", "9:75", "abc", "1:2:3"])("refuses %j", (input) => {
    expect(parseTimeText(input)).toBeNull();
  });
});

describe("formatting", () => {
  it("fmtHM never shows 60 minutes (R-052)", () => {
    expect(fmtHM(3599)).toBe("0:59");
    expect(fmtHM(3600)).toBe("1:00");
    expect(fmtHM(7199.6)).toBe("2:00");
  });
  it("hourLabel follows the format it's given", () => {
    expect(hourLabel(8, false)).toBe("08:00");
    expect(hourLabel(8, true)).toBe("8 AM");
    expect(hourLabel(0, true)).toBe("12 AM");
    expect(hourLabel(13, true)).toBe("1 PM");
  });
});
