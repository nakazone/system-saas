import { describe, expect, it } from "vitest";
import { isOfficeUser, quoteLabel, usd } from "../src/lib/notifications/publish.js";

describe("staff notification audience", () => {
  it("keeps office roles and users without a role", () => {
    expect(isOfficeUser("admin")).toBe(true);
    expect(isOfficeUser("office")).toBe(true);
    expect(isOfficeUser("sales")).toBe(true);
    expect(isOfficeUser("general_manager")).toBe(true);
    expect(isOfficeUser(null)).toBe(true);
    expect(isOfficeUser(undefined)).toBe(true);
  });

  it("skips field roles unless a job targets them explicitly", () => {
    expect(isOfficeUser("installer")).toBe(false);
    expect(isOfficeUser("crew_lead")).toBe(false);
    expect(isOfficeUser("subcontractor")).toBe(false);
  });

  it("formats quote labels and money", () => {
    expect(quoteLabel({ quoteNumber: "Q-12", number: 12, title: "Kitchen" })).toBe("Q-12 — Kitchen");
    expect(quoteLabel({ number: 4, title: "" })).toBe("#4");
    expect(usd(1200)).toBe("$1,200.00");
  });
});
