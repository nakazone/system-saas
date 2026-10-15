import { describe, it, expect } from "vitest";
import {
  defaultLeadMessageSettings,
  parseLeadMessageSettings,
  resolveCouponLine,
  isCouponApplyStage,
  COUPON_APPLY_STAGES,
} from "../src/lib/settings/lead-messages.js";

describe("lead message coupon token", () => {
  it("returns empty string when coupon is disabled", () => {
    const settings = defaultLeadMessageSettings();
    settings.coupon_enabled = false;
    settings.coupon_code = "SAVE10";
    settings.coupon_label = "10% off";
    expect(resolveCouponLine(settings, "quote_sent")).toBe("");
  });

  it("fills [code] and [label] in the coupon line for apply stages", () => {
    const settings = defaultLeadMessageSettings();
    settings.coupon_enabled = true;
    settings.coupon_code = "FLOOR15";
    settings.coupon_label = "15% off installation";
    settings.coupon_sms_line = "Use [code] for [label].";
    expect(resolveCouponLine(settings, "quote_sent")).toBe("Use FLOOR15 for 15% off installation.");
    expect(resolveCouponLine(settings, "follow_up_1")).toBe("Use FLOOR15 for 15% off installation.");
    expect(resolveCouponLine(settings, "stand_by")).toBe("Use FLOOR15 for 15% off installation.");
  });

  it("hides coupon line outside Quote Sent / Follow-Up / StandBy", () => {
    const settings = defaultLeadMessageSettings();
    settings.coupon_enabled = true;
    settings.coupon_code = "FLOOR15";
    settings.coupon_label = "15% off";
    settings.coupon_sms_line = "Use [code] for [label].";
    expect(resolveCouponLine(settings, "new_lead")).toBe("");
    expect(resolveCouponLine(settings, "contacted")).toBe("");
    expect(resolveCouponLine(settings, "won")).toBe("");
  });

  it("parses coupon fields including percent from stored JSON", () => {
    const parsed = parseLeadMessageSettings({
      coupon_enabled: true,
      coupon_code: "SAVE20",
      coupon_label: "20% off",
      coupon_percent: 20,
      coupon_sms_line: "Code [code] — [label]",
      stages: {},
    });
    expect(parsed.coupon_enabled).toBe(true);
    expect(parsed.coupon_code).toBe("SAVE20");
    expect(parsed.coupon_percent).toBe(20);
    expect(resolveCouponLine(parsed, "follow_up_1")).toBe("Code SAVE20 — 20% off");
  });

  it("exposes COUPON_APPLY_STAGES and isCouponApplyStage", () => {
    expect(COUPON_APPLY_STAGES).toEqual(["quote_sent", "follow_up_1", "stand_by"]);
    expect(isCouponApplyStage("quote_sent")).toBe(true);
    expect(isCouponApplyStage("new_lead")).toBe(false);
  });

  it("keeps on_send_action for follow_up_last_check by default", () => {
    const settings = defaultLeadMessageSettings();
    const tpl = settings.stages.follow_up_1.templates.find((t) => t.id === "follow_up_last_check");
    expect(tpl?.on_send_action).toEqual({ set_priority: "low" });
  });

  it("includes [coupon] templates for quote_sent and stand_by defaults", () => {
    const settings = defaultLeadMessageSettings();
    const quoteOffer = settings.stages.quote_sent.templates.find((t) => t.id === "quote_sent_offer");
    const standOffer = settings.stages.stand_by.templates.find((t) => t.id === "stand_by_offer");
    expect(quoteOffer?.body).toContain("[coupon]");
    expect(standOffer?.body).toContain("[coupon]");
  });
});
