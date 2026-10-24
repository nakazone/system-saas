import { describe, expect, it } from "vitest";
import { FOLLOW_UP_CADENCE, followUpStyle, nudgeText, shouldNudge } from "../src/lib/virtual-office/reminders.js";
import { buildAgentPrompt } from "../src/lib/mate-ai/agent.js";

const tz = "America/Denver";
// 2026-10-26 10:00 in Denver (UTC-6).
const tenAm = new Date("2026-10-26T16:00:00Z");
const hours = { followUpStyle: "normal", workStartHour: 8, workEndHour: 18 };

describe("office reminders cadence", () => {
  it("nudges at the due time, never before", () => {
    const due = { status: "open", dueAt: new Date(tenAm.getTime() + 60_000), nudgeCount: 0, lastNudgedAt: null };
    expect(shouldNudge(due, hours, tenAm, tz)).toBe(false);
    expect(shouldNudge({ ...due, dueAt: tenAm }, hours, tenAm, tz)).toBe(true);
    expect(shouldNudge({ ...due, dueAt: tenAm, status: "done" }, hours, tenAm, tz)).toBe(false);
  });

  it("the first nudge goes out even outside working hours", () => {
    const night = new Date("2026-10-27T04:00:00Z"); // 22:00 in Denver
    expect(shouldNudge({ status: "open", dueAt: night, nudgeCount: 0, lastNudgedAt: null }, hours, night, tz)).toBe(true);
    expect(shouldNudge({ status: "open", dueAt: new Date(night.getTime() - 4 * 3600_000), nudgeCount: 1, lastNudgedAt: new Date(night.getTime() - 4 * 3600_000) }, hours, night, tz)).toBe(false);
  });

  it("repeats by style, within hours, up to the limit", () => {
    const base = { status: "open", dueAt: new Date(tenAm.getTime() - 5 * 3600_000), nudgeCount: 1 };
    const twoHoursAgo = new Date(tenAm.getTime() - 2 * 3600_000);
    expect(shouldNudge({ ...base, lastNudgedAt: twoHoursAgo }, hours, tenAm, tz)).toBe(false);
    expect(shouldNudge({ ...base, lastNudgedAt: twoHoursAgo }, { ...hours, followUpStyle: "firm" }, tenAm, tz)).toBe(true);
    expect(shouldNudge({ ...base, lastNudgedAt: new Date(tenAm.getTime() - 3 * 3600_000) }, hours, tenAm, tz)).toBe(true);
    expect(shouldNudge({ ...base, nudgeCount: FOLLOW_UP_CADENCE.normal.max, lastNudgedAt: twoHoursAgo }, { ...hours, followUpStyle: "firm" }, tenAm, tz)).toBe(true);
    expect(shouldNudge({ ...base, nudgeCount: FOLLOW_UP_CADENCE.firm.max, lastNudgedAt: twoHoursAgo }, { ...hours, followUpStyle: "firm" }, tenAm, tz)).toBe(false);
    expect(followUpStyle("loud")).toBe("normal");
  });

  it("talks like the employee and insists after the first time", () => {
    expect(nudgeText("Marina", "ligar pro Ortiz", 0, "Naka Nakazone")).toEqual({ title: "Marina: lembrete", body: "Naka, você pediu para eu lembrar: ligar pro Ortiz." });
    expect(nudgeText("Marina", "ligar pro Ortiz", 1).body).toContain("Já deu para fazer?");
    expect(nudgeText("Marina", "ligar pro Ortiz", 3).title).toBe("Marina: não esqueci");
  });
});

describe("persona with reminders and style", () => {
  it("tells the employee what to bring up and how hard to insist", () => {
    const prompt = buildAgentPrompt({
      actions: [], catalog: [], today: "2026-10-26", weekday: "Monday", timezone: tz, screen: null, memory: [], userName: "Naka",
      persona: {
        name: "Marina", title: "Assistente financeira", department: "Financeiro", description: "Cobranças.", manager: false, colleagues: [], desk: [],
        personality: "Direta e bem-humorada", followUpStyle: "firm", reminders: ["ligar pro Ortiz — seg., 26 de out. · 09:00 (já passou da hora)"],
      },
    });
    expect(prompt).toContain("Your way of talking (set by your manager): Direta e bem-humorada");
    expect(prompt).toContain("ligar pro Ortiz");
    expect(prompt).toContain("insist until they are done");
    expect(prompt).toContain("reminder.create");
  });
});
