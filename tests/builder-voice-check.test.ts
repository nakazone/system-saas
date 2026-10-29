import { describe, it, expect } from "vitest";
import { checkActions } from "../src/lib/builders/voice.js";

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
});
