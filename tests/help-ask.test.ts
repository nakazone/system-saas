import { describe, expect, it } from "vitest";
import { parseHelpJson, sanitizeHelpAnswer } from "../src/crm/routes/help.js";

const catalog = [
  { kind: "tour" as const, id: "invoices" },
  { kind: "problem" as const, id: "invoice-job" },
  { kind: "module" as const, id: "jobs" },
];

describe("help AI answer", () => {
  it("reads JSON even when the model wraps it in a code fence", () => {
    const obj = parseHelpJson('```json\n{"answer":"Fature o job.","steps":["Abra Jobs"],"matches":[]}\n```');
    expect(obj).toEqual({ answer: "Fature o job.", steps: ["Abra Jobs"], matches: [] });
  });

  it("returns null for text with no JSON object", () => {
    expect(parseHelpJson("desculpe, não sei")).toBeNull();
    expect(parseHelpJson("[1,2]")).toBeNull();
  });

  it("keeps only catalog ids, drops duplicates, caps the lists", () => {
    const out = sanitizeHelpAnswer(
      {
        answer: "  Gere a fatura a partir do job.  ",
        steps: ["Abra Jobs", "", 3, "Toque em Faturar", "a", "b", "c", "d", "e"],
        matches: [
          { kind: "problem", id: "invoice-job" },
          { kind: "problem", id: "invoice-job" },
          { kind: "tour", id: "made-up" },
          { kind: "module", id: "jobs" },
          { kind: "tour", id: "invoices" },
          "junk",
        ],
      },
      catalog,
    );
    expect(out.answer).toBe("Gere a fatura a partir do job.");
    expect(out.steps).toHaveLength(6);
    expect(out.steps[0]).toBe("Abra Jobs");
    expect(out.matches).toEqual([
      { kind: "problem", id: "invoice-job" },
      { kind: "module", id: "jobs" },
      { kind: "tour", id: "invoices" },
    ]);
  });

  it("is empty-safe", () => {
    expect(sanitizeHelpAnswer(null, catalog)).toEqual({ answer: "", steps: [], matches: [] });
  });
});
