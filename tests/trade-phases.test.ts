/**
 * Trade Packs, Phase 0 (delivery 2): job phases ("sectors") read from the pack.
 * `legacySectorFinishPatch` is a frozen copy of src/lib/work-orders/sector-finish.ts as it was on
 * main @ 4e33929. The live function must give the same answer for every combination.
 */
import { describe, it, expect } from "vitest";
import { sectorFinishPatch } from "../src/lib/work-orders/sector-finish.js";
import {
  COMBINED_PHASE,
  PHASE_KEYS,
  isPhaseKey,
  phaseLabel,
  phaseOrDefault,
  PHASES,
} from "../src/lib/trades/phases.js";
import { resolveJobCalendar, type ScheduleSettings } from "../src/lib/settings/schedule.js";

type In = { sector?: string | null; status: string; installationDoneAt?: Date | null; sandDoneAt?: Date | null };

function legacySectorFinishPatch(existing: In, nextStatus: string, now = new Date()) {
  const both = existing.sector === "both";
  if (!both) {
    if (nextStatus === "draft" || nextStatus === "scheduled" || nextStatus === "in_progress" || nextStatus === "canceled") {
      return { status: nextStatus, installationDoneAt: null, sandDoneAt: null };
    }
    return { status: nextStatus };
  }
  if (nextStatus === "completed") {
    if (!existing.installationDoneAt) return { status: "in_progress", installationDoneAt: now };
    if (!existing.sandDoneAt) return { status: "completed", sandDoneAt: now };
    return { status: "completed" };
  }
  if (nextStatus === "in_progress") return { status: "in_progress", sandDoneAt: null };
  if (nextStatus === "scheduled" || nextStatus === "draft" || nextStatus === "canceled") {
    return { status: nextStatus, installationDoneAt: null, sandDoneAt: null };
  }
  return { status: nextStatus };
}

const NOW = new Date("2026-10-30T18:00:00Z");
const EARLIER = new Date("2026-10-29T18:00:00Z");
const SECTORS = ["both", "installation", "sand_finish", null, undefined, "", "other"];
const STATUSES = ["draft", "scheduled", "in_progress", "completed", "invoiced", "paid", "canceled", "weird"];
const DONE = [null, undefined, EARLIER];

describe("sectorFinishPatch keeps the exact pre-pack behavior", () => {
  it("matches the frozen copy for every sector × status × done-state", () => {
    let cases = 0;
    for (const sector of SECTORS) {
      for (const status of STATUSES) {
        for (const inst of DONE) {
          for (const sand of DONE) {
            for (const next of STATUSES) {
              const existing: In = { sector, status, installationDoneAt: inst, sandDoneAt: sand };
              expect(sectorFinishPatch(existing, next, NOW), JSON.stringify({ existing, next })).toEqual(
                legacySectorFinishPatch(existing, next, NOW),
              );
              cases++;
            }
          }
        }
      }
    }
    expect(cases).toBe(SECTORS.length * STATUSES.length * DONE.length * DONE.length * STATUSES.length);
  });
});

describe("phase helpers reproduce the old literals", () => {
  it("keys, combined key and labels", () => {
    expect(PHASE_KEYS).toEqual(["installation", "sand_finish"]);
    expect(COMBINED_PHASE).toBe("both");
    expect(phaseLabel("installation")).toBe("Instalação");
    expect(phaseLabel("sand_finish")).toBe("Lixa");
    expect(phaseLabel("installation", "en-US")).toBe("Installation");
    expect(phaseLabel("sand_finish", "en-US")).toBe("Sand & Finish");
  });

  it("isPhaseKey == (s === 'installation' || s === 'sand_finish')", () => {
    for (const s of ["installation", "sand_finish", "both", "all", "", null, undefined, "Installation", "lixa"]) {
      expect(isPhaseKey(s)).toBe(s === "installation" || s === "sand_finish");
    }
  });

  it("phaseOrDefault == old sectorKey (sand_finish stays, anything else → installation)", () => {
    for (const s of ["installation", "sand_finish", "both", "", null, undefined, "x"]) {
      expect(phaseOrDefault(s)).toBe(s === "sand_finish" ? "sand_finish" : "installation");
    }
  });

  it("job calendar routing by sector is unchanged", () => {
    const settings = {
      calendars: [
        { id: "a", kind: "jobs", name: "All jobs", color: "#000", sector: "all" },
        { id: "i", kind: "jobs", name: "Install", color: "#111", sector: "installation" },
        { id: "s", kind: "jobs", name: "Sand", color: "#222", sector: "sand_finish" },
      ],
    } as unknown as ScheduleSettings;
    expect(resolveJobCalendar(settings, "installation").id).toBe("i");
    expect(resolveJobCalendar(settings, "sand_finish").id).toBe("s");
    expect(resolveJobCalendar(settings, "both").id).toBe("a");
    expect(resolveJobCalendar(settings, null).id).toBe("a");
  });
});

describe("phases reach the browser", () => {
  it("CRM pages get window.__OM_TRADE built from the company's pack", async () => {
    const { tradeInject } = await import("../src/crm/mount.js");
    const tag = tradeInject(["hardwood"]);
    const json = tag.replace(/^<script>window\.__OM_TRADE=/, "").replace(/<\/script>$/, "");
    const boot = JSON.parse(json);
    expect(boot).toEqual({
      id: "hardwood",
      phases: [
        { key: "installation", label: { "pt-BR": "Instalação", "en-US": "Installation" } },
        { key: "sand_finish", label: { "pt-BR": "Lixa", "en-US": "Sand & Finish" } },
      ],
      combined: "both",
      quote: {
        tagline: "Hardwood · LVP · Refinishing",
        sections: [
          { key: "supply", label: "SUPPLY" },
          { key: "installation", label: "INSTALLATION" },
          { key: "sand_finish", label: "SAND & FINISH" },
          { key: "add_on", label: "ADD ON" },
        ],
      },
    });
    // Unknown or missing trades fall back to hardwood.
    expect(tradeInject(undefined)).toBe(tag);
    expect(tradeInject(["nope"])).toBe(tag);
  });

  it("the payroll and field-app label maps built from it equal the old literals", () => {
    const boot = { phases: getPackPhases() };
    const fromPack = Object.fromEntries(boot.phases.map((p) => [p.key, p.label["pt-BR"]]));
    expect(fromPack).toEqual({ installation: "Instalação", sand_finish: "Lixa" });
    expect(Object.keys(fromPack)).toEqual(["installation", "sand_finish"]);
  });
});

function getPackPhases() {
  return PHASES.map((p) => ({ key: p.key, label: p.label }));
}
