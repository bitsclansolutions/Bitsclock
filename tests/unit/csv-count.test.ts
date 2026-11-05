import { describe, expect, it } from "vitest";
import { countCsvRows } from "@/lib/client";
import { entriesToCsv } from "@/lib/reports";
import type { EntryDTO } from "@/lib/entries";

const entry = (description: string): EntryDTO => ({
  id: "c1",
  userId: "u1",
  user: { id: "u1", name: "Ana" },
  projectId: null,
  project: null,
  description,
  startTime: "2026-05-01T09:00:00.000Z",
  endTime: "2026-05-01T10:00:00.000Z",
  durationSeconds: 3600,
  billable: true,
  autoStopped: false,
  running: false,
  createdAt: "2026-05-01T10:00:00.000Z",
  updatedAt: "2026-05-01T10:00:00.000Z",
});

describe("countCsvRows (D-002 client-side completeness check)", () => {
  it("counts records, not line breaks inside quoted cells", () => {
    const csv = entriesToCsv([entry("one"), entry("two\r\nlines"), entry("three\nlines"), entry('quote "x", comma')], "UTC");
    expect(countCsvRows("﻿" + csv)).toBe(4);
  });
  it("handles a header-only file and a trailing newline", () => {
    expect(countCsvRows("a,b")).toBe(0);
    expect(countCsvRows("a,b\r\n1,2\r\n")).toBe(1);
  });
});
