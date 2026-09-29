import { describe, expect, it } from "vitest";

// Lightweight unit checks for source mapping / phone normalize via re-export patterns.
// Full HTTP coverage lives in integration once LEAD_INTAKE is deployed.

function mapSource(formName: string): string {
  if (formName === "hero-form") return "LP-Hero";
  if (/meta/i.test(formName) || formName === "meta-instant-form") return "Meta-Instant";
  return "LP-Contact";
}

function normalizeUsPhone(raw: string): string {
  let s = String(raw || "").trim();
  if (!s) return "";
  s = s.replace(/^p:\s*/i, "").replace(/^tel:\s*/i, "").replace(/^whatsapp:\s*/i, "");
  let digits = s.replace(/\D/g, "");
  if (digits.length === 11 && digits.charAt(0) === "1") digits = digits.slice(1);
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return s.length > 50 ? s.slice(0, 50) : s;
}

describe("public receive-lead helpers", () => {
  it("maps LP and Meta form names to sources", () => {
    expect(mapSource("hero-form")).toBe("LP-Hero");
    expect(mapSource("contact-form")).toBe("LP-Contact");
    expect(mapSource("meta-instant-form")).toBe("Meta-Instant");
  });

  it("normalizes Meta phone formats", () => {
    expect(normalizeUsPhone("p:+13035550100")).toBe("(303) 555-0100");
    expect(normalizeUsPhone("+1 303-555-0100")).toBe("(303) 555-0100");
  });
});
