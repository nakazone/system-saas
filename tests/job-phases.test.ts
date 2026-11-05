import { describe, it, expect } from "vitest";
import { autoPhase, phaseContext, photoPhaseFields } from "../src/lib/job-media/phases.js";

const TZ = "America/Phoenix";
const at = (d: string) => `${d}T17:00:00.000Z`; // 10:00 in Phoenix

describe("job phases", () => {
  const both = phaseContext(
    {
      status: "completed",
      sector: "both",
      needsDelivery: true,
      deliveryScheduledStart: at("2026-10-20"),
      deliveries: [{ scheduled_start: at("2026-10-21") }],
      scheduledStart: at("2026-10-23"),
      sandScheduledStart: at("2026-10-27"),
      installationDoneAt: at("2026-10-25"),
      sandDoneAt: at("2026-10-29"),
    },
    TZ,
  );

  it("lists only the phases the job has, in work order", () => {
    expect(both.phases).toEqual(["delivery", "scan", "installation", "sand_finish", "walkthrough"]);
    const sandOnly = phaseContext({ sector: "sand_finish", scheduledStart: at("2026-10-23") }, TZ);
    expect(sandOnly.phases).toEqual(["scan", "sand_finish", "walkthrough"]);
    const fromServices = phaseContext({ serviceCategories: ["installation", "sand_finish"], scheduledStart: at("2026-10-23") }, TZ);
    expect(fromServices.phases).toEqual(["scan", "installation", "sand_finish", "walkthrough"]);
  });

  it("places a photo by the day it was taken", () => {
    expect(autoPhase(both, at("2026-10-20"))).toBe("delivery");
    expect(autoPhase(both, at("2026-10-21"))).toBe("delivery");
    expect(autoPhase(both, at("2026-10-22"))).toBe("scan");
    expect(autoPhase(both, at("2026-10-23"))).toBe("installation");
    expect(autoPhase(both, at("2026-10-26"))).toBe("installation");
    expect(autoPhase(both, at("2026-10-27"))).toBe("sand_finish");
    expect(autoPhase(both, at("2026-10-29"))).toBe("sand_finish");
    expect(autoPhase(both, at("2026-10-30"))).toBe("walkthrough");
  });

  it("uses the company's timezone for the day", () => {
    // 2026-10-23 05:00 UTC is still 22 Oct in Phoenix: before installation starts
    expect(autoPhase(both, "2026-10-23T05:00:00.000Z")).toBe("scan");
  });

  it("has no walk-through until the job is completed, and no phase without dates", () => {
    const open = phaseContext({ sector: "installation", scheduledStart: at("2026-10-23") }, TZ);
    expect(autoPhase(open, at("2026-11-30"))).toBe("installation");
    expect(autoPhase(phaseContext({}, TZ), at("2026-10-23"))).toBeNull();
  });

  it("keeps a manual correction over the automatic phase", () => {
    const row = { phase: "walkthrough", takenAtDevice: new Date(at("2026-10-23")), createdAt: new Date() };
    expect(photoPhaseFields(both, row)).toEqual({ phase: "walkthrough", phase_source: "manual" });
    expect(photoPhaseFields(both, { ...row, phase: null })).toEqual({ phase: "installation", phase_source: "auto" });
  });
});
