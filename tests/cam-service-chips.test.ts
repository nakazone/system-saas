import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

type Chip = { label: string; tone: string; mark: string; color: string | null };

function loadJobsInfo() {
  const window: { JobsInfo?: { camListChips: (wo: Record<string, unknown>) => Chip[] } } = {};
  const context = vm.createContext({ window, Date, Intl, Math, String, Boolean, Number, Array });
  vm.runInContext(fs.readFileSync("crm/public/jobs-info.js", "utf8"), context);
  if (!window.JobsInfo) throw new Error("JobsInfo missing");
  return window.JobsInfo;
}

const JobsInfo = loadJobsInfo();
const colors = { cal_install: "#112233", cal_sand: "#445566", cal_delivery: "#0f766e" };

function iso(daysFromToday: number) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString();
}

describe("ObraCam service chips", () => {
  it("shows Instalando in the installation calendar color", () => {
    const chips = JobsInfo.camListChips({ status: "in_progress", sector: "installation", ...colors });
    expect(chips.map((c) => c.label)).toEqual(["Instalando"]);
    expect(chips[0].color).toBe("#112233");
    expect(chips[0].mark).toBe("dot");
  });

  it("shows Lixando in the sand calendar color", () => {
    const chips = JobsInfo.camListChips({ status: "in_progress", sector: "sand_finish", ...colors });
    expect(chips.map((c) => c.label)).toEqual(["Lixando"]);
    expect(chips[0].color).toBe("#445566");
  });

  it("checks Instalação concluída when the job has both services and installation is done", () => {
    const chips = JobsInfo.camListChips({
      status: "in_progress",
      sector: "both",
      installation_done_at: iso(-1),
      ...colors,
    });
    expect(chips.map((c) => c.label)).toEqual(["Instalação concluída", "Lixando"]);
    expect(chips[0].mark).toBe("check");
    expect(chips[0].color).toBe("#112233");
    expect(chips[1].color).toBe("#445566");
  });

  it("keeps the sand day scheduled after installation is done", () => {
    const chips = JobsInfo.camListChips({
      status: "scheduled",
      sector: "both",
      installation_done_at: iso(-3),
      sand_scheduled_start: iso(4),
      scheduled_start: iso(-5),
      ...colors,
    });
    expect(chips.map((c) => c.label)).toEqual(["Instalação concluída", "Agendado"]);
    expect(chips[1].color).toBe("#445566");
  });

  it("checks Delivery the same way once the pickup day has passed and other work remains", () => {
    const chips = JobsInfo.camListChips({
      status: "in_progress",
      sector: "installation",
      needs_delivery: true,
      delivery_starts: [iso(-2)],
      ...colors,
    });
    expect(chips.map((c) => c.label)).toEqual(["Delivery concluída", "Instalando"]);
    expect(chips[0].mark).toBe("check");
    expect(chips[0].color).toBe("#0f766e");
  });

  it("shows Delivery in the delivery color on the pickup day", () => {
    const chips = JobsInfo.camListChips({
      status: "scheduled",
      sector: "installation",
      needs_delivery: true,
      delivery_starts: [iso(0)],
      scheduled_start: iso(3),
      ...colors,
    });
    expect(chips.map((c) => c.label)).toEqual(["Delivery"]);
    expect(chips[0].color).toBe("#0f766e");
    expect(chips[0].mark).toBe("dot");
  });

  it("keeps a calendar object out of the status text", () => {
    const chips = JobsInfo.camListChips({
      status: "in_progress",
      sector: "installation",
      cal_install: { color: "#112233", name: "Jobs" },
    });
    expect(chips.map((c) => c.label)).toEqual(["Instalando"]);
    expect(chips[0].color).toBe("#221e1a");
    expect(JSON.stringify(chips)).not.toContain("[object Object]");
  });

  it("closes the job as Concluído", () => {
    const chips = JobsInfo.camListChips({ status: "completed", sector: "both", ...colors });
    expect(chips).toEqual([{ label: "Concluído", tone: "ok", mark: "check", color: null }]);
  });
});
