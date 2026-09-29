import { describe, it, expect } from "vitest";
import {
  safeTimeZone,
  startOfZonedDay,
  startOfZonedMonth,
  zonedDateKey,
  zonedDayDiff,
  zonedWallTimeToUtc,
} from "../src/lib/time/zoned.js";

describe("zoned time helpers", () => {
  it("falls back to the default zone for empty or invalid values", () => {
    expect(safeTimeZone(null)).toBe("America/New_York");
    expect(safeTimeZone("Mars/Olympus")).toBe("America/New_York");
    expect(safeTimeZone("America/Denver")).toBe("America/Denver");
  });

  it("computes local midnight in the org timezone, not the server's (UTC)", () => {
    // 2026-09-29 03:00 UTC is still Sep 28 in Denver (UTC-6).
    const now = new Date("2026-09-29T03:00:00Z");
    expect(zonedDateKey(now, "America/Denver")).toBe("2026-09-28");
    expect(startOfZonedDay(now, "America/Denver").toISOString()).toBe("2026-09-28T06:00:00.000Z");
    expect(startOfZonedDay(now, "America/Denver", 1).toISOString()).toBe("2026-09-29T06:00:00.000Z");
    expect(startOfZonedDay(now, "UTC").toISOString()).toBe("2026-09-29T00:00:00.000Z");
  });

  it("handles DST transitions (Denver springs forward on 2026-03-08)", () => {
    const day = new Date("2026-03-08T18:00:00Z");
    expect(startOfZonedDay(day, "America/Denver").toISOString()).toBe("2026-03-08T07:00:00.000Z"); // MST
    expect(startOfZonedDay(day, "America/Denver", 1).toISOString()).toBe("2026-03-09T06:00:00.000Z"); // MDT
    expect(zonedWallTimeToUtc("America/Denver", 2026, 11, 1, 0, 0).toISOString()).toBe("2026-11-01T06:00:00.000Z");
  });

  it("finds month boundaries, including the previous month across a year", () => {
    const now = new Date("2026-01-15T12:00:00Z");
    expect(startOfZonedMonth(now, "America/Denver").toISOString()).toBe("2026-01-01T07:00:00.000Z");
    expect(startOfZonedMonth(now, "America/Denver", -1).toISOString()).toBe("2025-12-01T07:00:00.000Z");
    // Late on Aug 31 in Denver is already September in UTC — month is still August.
    const late = new Date("2026-09-01T03:00:00Z");
    expect(startOfZonedMonth(late, "America/Denver").toISOString()).toBe("2026-08-01T06:00:00.000Z");
  });

  it("counts calendar days in the org timezone", () => {
    const a = new Date("2026-09-28T23:30:00-06:00");
    const b = new Date("2026-09-29T00:30:00-06:00");
    expect(zonedDayDiff(a, b, "America/Denver")).toBe(1);
    expect(zonedDayDiff(b, a, "America/Denver")).toBe(-1);
  });
});
