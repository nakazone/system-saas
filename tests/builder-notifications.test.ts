import { describe, it, expect } from "vitest";
import { diffJob } from "../src/lib/builders/notifications.js";

const d = (s: string) => new Date(s);
const base = { status: "scheduled", scheduledStart: d("2026-11-02T15:00:00Z"), photos: 0, reports: 0 };

describe("builder job watcher", () => {
  it("says nothing the first time it sees a job", () => {
    expect(diffJob(null, base)).toEqual([]);
  });
  it("notices a new date, a change of date, the crew on site and photos", () => {
    expect(diffJob({ ...base, scheduledStart: null, status: "draft" }, base)).toEqual(["scheduled"]);
    expect(diffJob(base, { ...base, scheduledStart: d("2026-11-03T15:00:00Z") })).toEqual(["rescheduled"]);
    expect(diffJob(base, { ...base, status: "in_progress" })).toEqual(["started"]);
    expect(diffJob(base, { ...base, photos: 3 })).toEqual(["photos"]);
  });
  it("reports completion once, not a reschedule after it", () => {
    expect(diffJob({ ...base, status: "in_progress" }, { ...base, status: "completed", photos: 2 })).toEqual(["completed", "photos"]);
    expect(diffJob({ ...base, status: "completed" }, { ...base, status: "needs_invoicing" })).toEqual([]);
  });
});
