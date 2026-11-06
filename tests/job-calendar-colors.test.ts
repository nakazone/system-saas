import { describe, it, expect } from "vitest";
import { jobCalendarColors, parseScheduleSettings } from "../src/lib/settings/schedule.js";

const ORANGE = "#e7792c";
const GRAY = "#98a2b3";
const TEAL = "#14b8a6";

const company = parseScheduleSettings({
  calendars: [
    { id: "jobs", name: "Instalação", color: ORANGE, kind: "jobs", sector: "installation" },
    { id: "11111111-1111-4111-8111-111111111111", name: "Lixa", color: GRAY, kind: "jobs", sector: "sand_finish" },
    { id: "delivery", name: "Delivery", color: TEAL, kind: "delivery" },
  ],
});

describe("job calendar colors", () => {
  it("uses the colors registered for each phase", () => {
    expect(jobCalendarColors(company, "installation")).toEqual({ main: ORANGE, sand: GRAY, delivery: TEAL });
    expect(jobCalendarColors(company, "both")).toEqual({ main: ORANGE, sand: GRAY, delivery: TEAL });
  });

  it("paints a sand-only job's main day as sand", () => {
    expect(jobCalendarColors(company, "sand_finish").main).toBe(GRAY);
  });

  it("follows a company with one calendar for every job", () => {
    const one = parseScheduleSettings({
      calendars: [
        { id: "jobs", name: "Jobs", color: ORANGE, kind: "jobs", sector: "all" },
        { id: "delivery", name: "Delivery", color: TEAL, kind: "delivery" },
      ],
    });
    expect(jobCalendarColors(one, "both")).toEqual({ main: ORANGE, sand: ORANGE, delivery: TEAL });
  });
});
