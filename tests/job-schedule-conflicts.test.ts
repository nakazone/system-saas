import { describe, it, expect } from "vitest";
import { findJobConflicts, jobScheduleWindows } from "../src/lib/schedule/conflicts.js";

const at = (day: number, hour = 8) => new Date(2026, 10, day, hour);
const base = { assignedUserId: "u1", crewId: null as string | null };

describe("job schedule windows", () => {
  it("covers the whole day when a job has no end", () => {
    const [w] = jobScheduleWindows({ scheduledStart: at(5), scheduledEnd: null });
    expect(w.start).toEqual(at(5));
    expect(w.end.getDate()).toBe(5);
    expect(w.end.getHours()).toBe(23);
  });

  it("includes the sand day of a two-phase job", () => {
    const windows = jobScheduleWindows({ scheduledStart: at(5), scheduledEnd: at(6, 17), sandScheduledStart: at(9) });
    expect(windows).toHaveLength(2);
    expect(windows[1].start.getDate()).toBe(9);
  });

  it("has nothing to compare without dates", () => {
    expect(jobScheduleWindows({ scheduledStart: null, scheduledEnd: null })).toEqual([]);
  });
});

describe("job conflicts", () => {
  const job = { ...base, id: "a", scheduledStart: at(5), scheduledEnd: at(8, 17) };

  it("finds another job with the same person on the same days", () => {
    const other = { ...base, id: "b", scheduledStart: at(7), scheduledEnd: at(9, 17) };
    expect(findJobConflicts(job, [other])).toEqual([{ withId: "b", reason: "assignee_overlap" }]);
  });

  it("finds a crew overlap", () => {
    const crewJob = { ...job, assignedUserId: null, crewId: "c1" };
    const other = { id: "b", assignedUserId: null, crewId: "c1", scheduledStart: at(6), scheduledEnd: at(6, 17) };
    expect(findJobConflicts(crewJob, [other])).toEqual([{ withId: "b", reason: "crew_overlap" }]);
  });

  it("ignores other people, other days and the job itself", () => {
    const otherPerson = { id: "b", assignedUserId: "u2", crewId: null, scheduledStart: at(6), scheduledEnd: at(6, 17) };
    const otherDays = { ...base, id: "c", scheduledStart: at(12), scheduledEnd: at(13, 17) };
    expect(findJobConflicts(job, [otherPerson, otherDays, job])).toEqual([]);
  });

  it("reports a job once even when both of its phases overlap", () => {
    const other = { ...base, id: "b", scheduledStart: at(5), scheduledEnd: at(5, 17), sandScheduledStart: at(8) };
    expect(findJobConflicts(job, [other])).toHaveLength(1);
  });

  it("catches the overlap on the sand day", () => {
    const twoPhase = { ...base, id: "a", scheduledStart: at(5), scheduledEnd: at(6, 17), sandScheduledStart: at(9) };
    const other = { ...base, id: "b", scheduledStart: at(9), scheduledEnd: at(10, 17) };
    expect(findJobConflicts(twoPhase, [other])).toHaveLength(1);
  });

  it("does not compare a job with nobody assigned", () => {
    const nobody = { id: "a", assignedUserId: null, crewId: null, scheduledStart: at(5), scheduledEnd: at(8, 17) };
    const other = { id: "b", assignedUserId: null, crewId: null, scheduledStart: at(6), scheduledEnd: at(6, 17) };
    expect(findJobConflicts(nobody, [other])).toEqual([]);
  });
});
