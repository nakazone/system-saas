import { describe, it, expect } from "vitest";
import { offlineStartAt } from "../src/crm/routes/campo-dia.js";

const now = new Date("2026-11-05T15:00:00.000Z");
const at = (ms: number) => new Date(now.getTime() + ms).toISOString();
const H = 60 * 60 * 1000;

describe("offline clock-in time", () => {
  it("keeps the tap time when the start was replayed from the offline queue", () => {
    expect(offlineStartAt({ offline_queued: true, device_at: at(-2 * H) }, now)?.toISOString()).toBe(at(-2 * H));
  });

  it("uses the server clock for a normal online start", () => {
    expect(offlineStartAt({ device_at: at(-2 * H) }, now)).toBeNull();
    expect(offlineStartAt({ offline_queued: false, device_at: at(-2 * H) }, now)).toBeNull();
  });

  it("rejects device times in the future or older than 18h", () => {
    expect(offlineStartAt({ offline_queued: true, device_at: at(10 * 60 * 1000) }, now)).toBeNull();
    expect(offlineStartAt({ offline_queued: true, device_at: at(-19 * H) }, now)).toBeNull();
    expect(offlineStartAt({ offline_queued: true, device_at: "not a date" }, now)).toBeNull();
  });

  it("clamps a slightly fast phone clock to the server time", () => {
    expect(offlineStartAt({ offline_queued: true, device_at: at(60 * 1000) }, now)?.toISOString()).toBe(now.toISOString());
  });
});
