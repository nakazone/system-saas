import { describe, expect, it } from "vitest";
import { legacyDashboardPageUrl } from "../src/crm/legacy-dashboard.js";

describe("legacyDashboardPageUrl", () => {
  it("sends each old dashboard section to its own page", () => {
    expect(legacyDashboardPageUrl({ page: "leads" })).toBe("/leads.html");
    expect(legacyDashboardPageUrl({ page: "customers" })).toBe("/customers.html");
    expect(legacyDashboardPageUrl({ page: "quotes" })).toBe("/quotes.html");
    expect(legacyDashboardPageUrl({ page: "invoices" })).toBe("/invoices.html");
    expect(legacyDashboardPageUrl({ page: "schedule" })).toBe("/schedule.html");
    expect(legacyDashboardPageUrl({ page: "users" })).toBe("/configuracoes.html#usuarios");
  });

  it("keeps the record a link pointed at", () => {
    expect(legacyDashboardPageUrl({ page: "leads", id: "a b" })).toBe("/lead-detail.html?id=a%20b");
    expect(legacyDashboardPageUrl({ page: "customers", edit: "c1" })).toBe("/customers.html?id=c1");
    expect(legacyDashboardPageUrl({ page: "customers", new: "1" })).toBe("/customers.html?new=1");
    expect(legacyDashboardPageUrl({ page: "quotes", id: "q1" })).toBe("/quote-builder.html?id=q1");
  });

  it("sends retired or unknown sections to Início", () => {
    for (const page of ["dashboard", "crm", "activities", "projects", "whatever"]) {
      expect(legacyDashboardPageUrl({ page })).toBe("/dashboard");
    }
  });
});
