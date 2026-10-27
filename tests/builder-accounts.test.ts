import { describe, it, expect } from "vitest";
import { can, permissionsFor, isBuilderRole, BUILDER_ROLES } from "../src/lib/builders/roles.js";
import { notesWithLockbox, jobEditSchema } from "../src/lib/builders/job-edit.js";

describe("builder roles", () => {
  it("gives admins every permission and field only viewing", () => {
    expect(permissionsFor("admin")).toEqual(expect.arrayContaining(["jobs.view", "jobs.send", "jobs.edit", "money.view", "companies.manage", "team.manage"]));
    expect(permissionsFor("field")).toEqual(["jobs.view"]);
  });
  it("keeps team management with admins only", () => {
    expect(can("manager", "team.manage")).toBe(false);
    expect(can("manager", "companies.manage")).toBe(true);
    expect(can("office", "companies.manage")).toBe(false);
    expect(can("office", "jobs.edit")).toBe(true);
  });
  it("lets old company-made portal users send but not edit", () => {
    expect(can("legacy", "jobs.send")).toBe(true);
    expect(can("legacy", "jobs.edit")).toBe(false);
  });
  it("only accepts real roles", () => {
    for (const r of BUILDER_ROLES) expect(isBuilderRole(r)).toBe(true);
    expect(isBuilderRole("legacy")).toBe(false);
    expect(isBuilderRole("owner")).toBe(false);
  });
});

describe("notesWithLockbox", () => {
  it("puts the code on the first line", () => {
    expect(notesWithLockbox("Use side door", "1234")).toBe("/lockbox 1234\nUse side door");
  });
  it("replaces an old code instead of stacking", () => {
    expect(notesWithLockbox("/lockbox 1111\nUse side door", "2222")).toBe("/lockbox 2222\nUse side door");
  });
  it("removes the code when empty", () => {
    expect(notesWithLockbox("/lockbox 1111\nUse side door", "")).toBe("Use side door");
    expect(notesWithLockbox("", "")).toBe("");
  });
});

describe("jobEditSchema", () => {
  it("accepts clearing the date and an all-day time", () => {
    expect(jobEditSchema.safeParse({ start_date: "", start_time: "" }).success).toBe(true);
  });
  it("rejects bad dates and negative quantities", () => {
    expect(jobEditSchema.safeParse({ start_date: "10/26/2026" }).success).toBe(false);
    expect(jobEditSchema.safeParse({ services: [{ quantity: -1 }] }).success).toBe(false);
  });
});
