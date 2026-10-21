import { describe, expect, it } from "vitest";
import { pinSpokenDay } from "../src/lib/mate-ai/agent.js";
import { todayInTimezone } from "../src/lib/mate-ai/interpret.js";
import type { ActionDef } from "../src/lib/mate-ai/actions/types.js";

const defs = [
  { name: "folha.day", args: { employee: "", date: "" } },
  { name: "chat.summary", args: { job: "", day: "" } },
  { name: "lead.create", args: { name: "" } },
] as unknown as ActionDef[];

describe("Mate AI: hoje/ontem/amanhã come from the company calendar, not the model", () => {
  const today = "2026-10-20";
  it("fixes a UTC 'tomorrow' the model wrote for 'hoje'", () => {
    expect(pinSpokenDay("Lance uma diaria e duas horas extras pro Douglas hoje", "folha.day", { employee: "Douglas", date: "2026-10-21", overtime_hours: 2 }, today, defs)).toMatchObject({ date: "2026-10-20", overtime_hours: 2 });
  });
  it("ontem, anteontem, amanhã and the `day` arg", () => {
    expect(pinSpokenDay("lança o dia do Carlos ontem", "folha.day", {}, today, defs).date).toBe("2026-10-19");
    expect(pinSpokenDay("Pedro trabalhou anteontem", "folha.day", {}, today, defs).date).toBe("2026-10-18");
    expect(pinSpokenDay("o que aconteceu hoje no job 1042?", "chat.summary", { day: "2026-10-21" }, today, defs).day).toBe("2026-10-20");
    expect(pinSpokenDay("remarca para amanhã", "folha.day", {}, "2026-10-31", defs).date).toBe("2026-11-01");
  });
  it("leaves explicit or mixed dates and actions without a date arg alone", () => {
    expect(pinSpokenDay("lança hoje e ontem", "folha.day", { date: "2026-10-19" }, today, defs).date).toBe("2026-10-19");
    expect(pinSpokenDay("lança dia 15, hoje esqueci", "folha.day", { date: "2026-10-15" }, today, defs).date).toBe("2026-10-15");
    expect(pinSpokenDay("hoje de manhã ligou um lead", "lead.create", { name: "Ana" }, today, defs)).toEqual({ name: "Ana" });
    expect(pinSpokenDay("lança o dia de hoje de manhã", "folha.day", {}, today, defs).date).toBe("2026-10-20");
  });
  it("19:43 in Denver is still the 20th for the company even though UTC is the 21st", () => {
    expect(todayInTimezone("America/Denver", new Date("2026-10-21T01:43:00Z")).date).toBe("2026-10-20");
  });
});
