import { describe, it, expect } from "vitest";
import { addressKey, findJobMatch, normalizeIntake, parseWorkOrderDate } from "../src/lib/partner-intake/extract.js";

const TODAY = new Date("2026-10-25T18:00:00Z");

describe("parseWorkOrderDate", () => {
  it("reads dates without year as the nearest one", () => {
    expect(parseWorkOrderDate("Monday, October 12th", TODAY)).toBe("2026-10-12");
    expect(parseWorkOrderDate("Jan 4", TODAY)).toBe("2027-01-04");
    expect(parseWorkOrderDate("10/26", TODAY)).toBe("2026-10-26");
  });

  it("reads full dates", () => {
    expect(parseWorkOrderDate("2026-11-02", TODAY)).toBe("2026-11-02");
    expect(parseWorkOrderDate("11/02/2026", TODAY)).toBe("2026-11-02");
    expect(parseWorkOrderDate("12 de novembro de 2026", TODAY)).toBe("2026-11-12");
  });

  it("rejects impossible or empty dates", () => {
    expect(parseWorkOrderDate("13/40", TODAY)).toBeNull();
    expect(parseWorkOrderDate("ASAP", TODAY)).toBeNull();
    expect(parseWorkOrderDate("", TODAY)).toBeNull();
  });
});

describe("normalizeIntake", () => {
  it("cleans the fields of a builder work order", () => {
    const result = normalizeIntake({
      address: "109 EVERGREEN DR",
      community: "Evergreen",
      lot: "Lot #50",
      plan: "APPLE",
      external_ref: "Job# 172369",
      service_type: "Hardwood install",
      preferred_date: "Monday, October 26th",
      square_feet: "135 sq ft",
      material: "ENGINEERED",
      contact_name: "Peter Garcia",
      contact_email: "not an email",
      notes: "Shortage - 22 pc stair nosing",
      unsure: ["community", "bogus"],
      warnings: ["“Peter Garcia #50” parece contato + lote."],
    }, TODAY);
    expect(result.fields.lot).toBe("50");
    expect(result.fields.external_ref).toBe("172369");
    expect(result.fields.preferred_date).toBe("2026-10-26");
    expect(result.fields.square_feet).toBe("135");
    expect(result.fields.contact_email).toBe("");
    expect(result.fields.title).toBe("Hardwood install · 109 EVERGREEN DR");
    expect(result.check).toEqual(["community", "contact_email"]);
    expect(result.warnings).toHaveLength(1);
  });

  it("flags a missing address and an unreadable date", () => {
    const result = normalizeIntake({ service_type: "Carpet", preferred_date: "ASAP" }, TODAY);
    expect(result.fields.preferred_date).toBe("");
    expect(result.check).toContain("address");
    expect(result.check).toContain("preferred_date");
  });
});

describe("findJobMatch", () => {
  const jobs = [
    { id: "a", number: 12, title: "Hardwood · 109 Evergreen Dr", address: "109 Evergreen Drive, Denver CO", status: "scheduled" },
    { id: "b", number: 13, title: "Carpet 57 Cedar Hollow (PO 88412)", address: "57 Cedar Hollow", status: "completed" },
    { id: "c", number: 14, title: "Tile", address: "2210 Larkspur Ln", status: "draft", externalRefs: ["172411"] },
  ];

  it("normalizes street words", () => {
    expect(addressKey("109 Evergreen Drive, Denver CO 80202")).toBe("109 evergreen dr");
    expect(addressKey("109 EVERGREEN DR.")).toBe("109 evergreen dr");
  });

  it("matches by the builder's job number first", () => {
    expect(findJobMatch(jobs, { externalRef: "172411", address: "1 Other St" })?.id).toBe("c");
    expect(findJobMatch(jobs, { externalRef: "88412" })?.reason).toBe("ref");
  });

  it("matches by street address", () => {
    const match = findJobMatch(jobs, { address: "109 EVERGREEN DR" });
    expect(match).toMatchObject({ id: "a", reason: "address" });
  });

  it("does not match partial numbers or unknown addresses", () => {
    expect(findJobMatch(jobs, { externalRef: "8841" })).toBeNull();
    expect(findJobMatch(jobs, { address: "110 Evergreen Dr" })).toBeNull();
    expect(findJobMatch(jobs, { address: "Evergreen" })).toBeNull();
  });
});
