import { describe, expect, it } from "vitest";
import {
  fieldAgendaAt,
  fieldJobDateWindowWhere,
  fieldSlotMatchesSector,
  jobSectorMatchWhere,
  myFieldJobsWhere,
} from "../src/crm/lib/field-sector.js";

describe("field-sector", () => {
  it("matches Folha sand staff to sand_finish + both only", () => {
    expect(jobSectorMatchWhere("sand_finish")).toEqual({ sector: { in: ["sand_finish", "both"] } });
    expect(jobSectorMatchWhere("installation")).toMatchObject({
      OR: expect.arrayContaining([{ sector: "installation" }, { sector: "both" }, { sector: null }]),
    });
    expect(jobSectorMatchWhere(null)).toEqual({});
  });

  it("places both-jobs on sand date for sand staff", () => {
    const install = new Date("2026-11-10T15:00:00.000Z");
    const sand = new Date("2026-11-14T15:00:00.000Z");
    const both = { sector: "both", scheduledStart: install, sandScheduledStart: sand };
    expect(fieldAgendaAt(both, "sand_finish")?.toISOString()).toBe(sand.toISOString());
    expect(fieldAgendaAt(both, "installation")?.toISOString()).toBe(install.toISOString());
    expect(fieldAgendaAt({ sector: "installation", scheduledStart: install }, "sand_finish")).toBeNull();
    expect(
      fieldAgendaAt({ sector: "sand_finish", scheduledStart: sand }, "sand_finish")?.toISOString(),
    ).toBe(sand.toISOString());
  });

  it("filters schedule slots by Folha sector", () => {
    expect(fieldSlotMatchesSector("sand", "both", "sand_finish")).toBe(true);
    expect(fieldSlotMatchesSector("main", "both", "sand_finish")).toBe(false);
    expect(fieldSlotMatchesSector("main", "sand_finish", "sand_finish")).toBe(true);
    expect(fieldSlotMatchesSector("sand", "both", "installation")).toBe(false);
    expect(fieldSlotMatchesSector("main", "both", "installation")).toBe(true);
    expect(fieldSlotMatchesSector("main", "installation", "sand_finish")).toBe(false);
    expect(fieldSlotMatchesSector("delivery", "both", "sand_finish")).toBe(true);
  });

  it("builds a sand date window that ignores install-only overlap", () => {
    const from = new Date("2026-11-12T00:00:00.000Z");
    const to = new Date("2026-11-18T00:00:00.000Z");
    const sand = fieldJobDateWindowWhere(from, to, "sand_finish");
    expect(sand).toEqual({
      OR: [
        {
          AND: [
            { sector: "sand_finish" },
            {
              scheduledStart: { not: null, lte: to },
              OR: [{ scheduledEnd: null }, { scheduledEnd: { gte: from } }],
            },
          ],
        },
        {
          AND: [{ sector: "both" }, { sandScheduledStart: { gte: from, lte: to } }],
        },
      ],
    });
  });

  it("ANDs assignment access with sector", () => {
    const where = myFieldJobsWhere("user-1", "sand_finish");
    expect(where).toMatchObject({
      AND: [
        { OR: expect.any(Array) },
        { sector: { in: ["sand_finish", "both"] } },
      ],
    });
  });
});
