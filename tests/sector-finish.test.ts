import { describe, expect, it } from "vitest";
import { sectorFinishPatch } from "../src/lib/work-orders/sector-finish.js";

const now = new Date("2026-10-28T18:00:00Z");

describe("sectorFinishPatch", () => {
  it("closes installation first, then sand, on a two-sector job", () => {
    const first = sectorFinishPatch({ sector: "both", status: "in_progress" }, "completed", now);
    expect(first).toEqual({ status: "in_progress", installationDoneAt: now });
    const second = sectorFinishPatch(
      { sector: "both", status: "in_progress", installationDoneAt: now },
      "completed",
      now,
    );
    expect(second.status).toBe("completed");
    expect(second.sandDoneAt).toEqual(now);
    expect(second.installationDoneAt).toBeUndefined();
  });

  it("clears both closes when the job goes back to scheduled", () => {
    const back = sectorFinishPatch(
      { sector: "both", status: "completed", installationDoneAt: now, sandDoneAt: now },
      "scheduled",
      now,
    );
    expect(back).toEqual({ status: "scheduled", installationDoneAt: null, sandDoneAt: null });
  });

  it("keeps a single close for jobs that are not both sectors", () => {
    const done = sectorFinishPatch({ sector: "installation", status: "in_progress" }, "completed", now);
    expect(done).toEqual({ status: "completed" });
  });
});
