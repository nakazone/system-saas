import { describe, expect, it } from "vitest";
import { validateSlug } from "../src/modules/organizations/service.js";
import { isReservedTenantSlug } from "../src/lib/tenant/reserved-slugs.js";

describe("tenant slug validation", () => {
  it("rejects reserved platform hosts", () => {
    for (const slug of ["www", "admin", "cdn", "api", "app", "mail", "static", "status"]) {
      expect(isReservedTenantSlug(slug)).toBe(true);
      expect(validateSlug(slug)).toMatch(/reserved/i);
    }
  });

  it("accepts normal company slugs", () => {
    expect(validateSlug("acme-floors")).toBeNull();
    expect(validateSlug("seniorfloors")).toBeNull();
  });
});
