import { describe, it, expect } from "vitest";
import {
  defaultLeadMessageSettings,
  parseLeadMessageSettings,
  resolveCouponLine,
} from "../src/lib/settings/lead-messages.js";

describe("lead message coupon token", () => {
  it("returns empty string when coupon is disabled", () => {
    const settings = defaultLeadMessageSettings();
    settings.coupon_enabled = false;
    settings.coupon_code = "SAVE10";
    settings.coupon_label = "10% off";
    expect(resolveCouponLine(settings)).toBe("");
  });

  it("fills [code] and [label] in the coupon line", () => {
    const settings = defaultLeadMessageSettings();
    settings.coupon_enabled = true;
    settings.coupon_code = "FLOOR15";
    settings.coupon_label = "15% off installation";
    settings.coupon_sms_line = "Use [code] for [label].";
    expect(resolveCouponLine(settings)).toBe("Use FLOOR15 for 15% off installation.");
  });

  it("parses coupon fields from stored JSON", () => {
    const parsed = parseLeadMessageSettings({
      coupon_enabled: true,
      coupon_code: "SAVE20",
      coupon_label: "20% off",
      coupon_sms_line: "Code [code] — [label]",
      stages: {},
    });
    expect(parsed.coupon_enabled).toBe(true);
    expect(parsed.coupon_code).toBe("SAVE20");
    expect(resolveCouponLine(parsed)).toBe("Code SAVE20 — 20% off");
  });

  it("keeps on_send_action for follow_up_last_check by default", () => {
    const settings = defaultLeadMessageSettings();
    const tpl = settings.stages.follow_up_1.templates.find((t) => t.id === "follow_up_last_check");
    expect(tpl?.on_send_action).toEqual({ set_priority: "low" });
  });
});
