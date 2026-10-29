import { describe, it, expect } from "vitest";
import { checkActions, linkFlights, voiceActionSchema, type VoiceAction } from "../src/lib/builders/voice.js";

const step = (o: Record<string, number>) => ({ type: "set_steps" as const, stair: 0, from: 1, ...o });

describe("voice measurement checks", () => {
  it("fixes fractions the transcript glued together", () => {
    const { actions } = checkActions([step({ tread_w: 42, tread_d: 1114, riser_h: 712 }), step({ tread_w: 48, tread_d: 11.14, riser_h: 7.34 }), step({ tread_w: 36, tread_d: 1158 })]);
    expect(actions[0]).toMatchObject({ tread_w: 42, tread_d: 11.25, riser_h: 7.5 });
    expect(actions[1]).toMatchObject({ tread_w: 48, tread_d: 11.25, riser_h: 7.75 });
    expect(actions[2]).toMatchObject({ tread_d: 11.625 });
  });
  it("keeps good sizes and swaps width/depth said backwards", () => {
    const { actions, checks } = checkActions([step({ tread_w: 11.25, tread_d: 48, riser_h: 7.5 }), step({ tread_w: 42, tread_d: 11.375 })]);
    expect(actions[0]).toMatchObject({ tread_w: 48, tread_d: 11.25 });
    expect(actions[1]).toMatchObject({ tread_w: 42, tread_d: 11.375 });
    expect(checks).toEqual([]);
  });
  it("flags sizes that can't be right", () => {
    const { checks } = checkActions([step({ tread_w: 42, tread_d: 21, riser_h: 15 })]);
    expect(checks.join(" ")).toMatch(/Tread depth 21/);
    expect(checks.join(" ")).toMatch(/Riser height 15/);
  });
  it("links an upper flight to the lower flight's landing", () => {
    const acts = linkFlights([
      { type: "add_stair", name: "Lower flight" },
      { type: "add_steps", stair: 1, count: 8, tread_w: 42, tread_d: 11.25 },
      { type: "add_stair", name: "Upper flight", starts_on_landing_of: 1 },
      { type: "add_steps", stair: 2, count: 9, tread_w: 42, tread_d: 11.25 },
    ] as VoiceAction[], 1);
    expect(acts[0]).toMatchObject({ type: "add_stair", landing: true });
    expect(acts[2]).toMatchObject({ starts_on_landing_of: 1 });
  });
  it("drops a link to a flight that does not exist yet", () => {
    const acts = linkFlights([{ type: "add_stair", name: "Upper", starts_on_landing_of: 3 }] as VoiceAction[], 0);
    expect((acts[0] as { starts_on_landing_of?: number }).starts_on_landing_of).toBeUndefined();
  });
  it("accepts landing and flight links in the action schema", () => {
    expect(voiceActionSchema.safeParse({ type: "add_stair", name: "Upper flight", starts_on_landing_of: 0 }).success).toBe(true);
    expect(voiceActionSchema.safeParse({ type: "set_stair", stair: 0, landing: true }).success).toBe(true);
  });
});
