import { describe, it, expect } from "vitest";
import { formatPersonName, formatPersonNameNullable } from "../src/lib/name.js";

describe("formatPersonName", () => {
  it("title-cases each word", () => {
    expect(formatPersonName("douglas nakazone teotonio")).toBe("Douglas Nakazone Teotonio");
    expect(formatPersonName("DOUGLAS NAKAZONE TEOTONIO")).toBe("Douglas Nakazone Teotonio");
    expect(formatPersonName("  douglas   NAKAZONE ")).toBe("Douglas Nakazone");
  });

  it("handles hyphens and apostrophes", () => {
    expect(formatPersonName("jean-pierre")).toBe("Jean-Pierre");
    expect(formatPersonName("o'brien")).toBe("O'Brien");
  });

  it("keeps accents", () => {
    expect(formatPersonName("josé da silva")).toBe("José Da Silva");
    expect(formatPersonName("MARÍA")).toBe("María");
  });

  it("handles empty", () => {
    expect(formatPersonName("")).toBe("");
    expect(formatPersonName("   ")).toBe("");
    expect(formatPersonName(null)).toBe("");
    expect(formatPersonNameNullable("")).toBeNull();
    expect(formatPersonNameNullable("ana")).toBe("Ana");
  });
});
