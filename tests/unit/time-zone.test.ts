import { afterEach, describe, expect, it } from "vitest";
import { dayKey, fmtTimeText, fromZoned, setTimeZone, startOfDay, toISO, toZoned, zoneOffsetMs } from "@/lib/time";

afterEach(() => setTimeZone(null));

describe("workspace time zone helpers (D-012)", () => {
  it("PKT: an instant shows as Pakistan wall-clock time, and converts back exactly", () => {
    setTimeZone("Asia/Karachi");
    // 20:00 UTC on 1 March is 01:00 on 2 March in Karachi (+05:00).
    const wall = toZoned("2026-03-01T20:00:00.000Z");
    expect(dayKey(wall)).toBe("2026-03-02");
    expect(fmtTimeText(wall)).toBe("01:00");
    expect(fmtTimeText("2026-03-01T20:00:00.000Z")).toBe("01:00"); // strings are instants
    expect(fromZoned(wall).toISOString()).toBe("2026-03-01T20:00:00.000Z");
  });

  it("midnight of a day in the zone is the right instant (lock dates, report ranges)", () => {
    setTimeZone("Asia/Karachi");
    expect(toISO(new Date("2026-11-01T00:00:00"))).toBe("2026-10-31T19:00:00.000Z");
    expect(toISO(startOfDay(toZoned("2026-11-01T03:00:00.000Z")))).toBe("2026-10-31T19:00:00.000Z");
  });

  it("handles a DST zone on its change day", () => {
    setTimeZone("America/New_York");
    // 8 March 2026: clocks go from 02:00 to 03:00. 08:00 UTC = 04:00 EDT; 06:00 UTC = 01:00 EST.
    expect(fmtTimeText("2026-03-08T08:00:00.000Z")).toBe("04:00");
    expect(fmtTimeText("2026-03-08T06:00:00.000Z")).toBe("01:00");
    expect(toISO(new Date("2026-03-08T04:00:00"))).toBe("2026-03-08T08:00:00.000Z");
  });

  it("offsets", () => {
    expect(zoneOffsetMs(Date.parse("2026-06-01T00:00:00Z"), "Asia/Karachi")).toBe(5 * 3600_000);
    expect(zoneOffsetMs(Date.parse("2026-06-01T00:00:00Z"), "UTC")).toBe(0);
  });

  it("without a zone set, conversions are identity", () => {
    const d = new Date("2026-05-05T10:20:30.000Z");
    expect(toZoned(d).getTime()).toBe(d.getTime());
    expect(fromZoned(d).getTime()).toBe(d.getTime());
  });
});
