import { describe, expect, it } from "vitest";
import type { MateAiCatalogItem } from "../src/lib/mate-ai/command.js";
import {
  buildInterpretSystemPrompt,
  catalogRefs,
  mateAiPlanSchema,
  planFromModelOutput,
  planFromRules,
  todayInTimezone,
  validDueDate,
} from "../src/lib/mate-ai/interpret.js";
import {
  editDistance,
  jobNumberFromQuery,
  nameSimilarity,
  pickBest,
  rankCustomers,
  rankJobs,
  similarCatalogItems,
} from "../src/lib/mate-ai/match.js";

function catalogItem(id: string, name: string, unit = "sq_ft", category = "Installation"): MateAiCatalogItem {
  return {
    id,
    name,
    unit,
    category,
    source: "quote-catalog",
    description: null,
    defaultRate: 5,
    rateParticular: 5,
    rateBuilder: 4,
    rateContractor: 4,
    rateLoja: 4,
    pricingItemId: null,
  };
}

const HARDWOOD = "11111111-1111-4111-8111-111111111111";
const CARPET = "22222222-2222-4222-8222-222222222222";
const STAIRS = "33333333-3333-4333-8333-333333333333";
const catalog = [
  catalogItem(HARDWOOD, "Hardwood Installation"),
  catalogItem(CARPET, "Carpet Removal", "sq_ft", "Removal"),
  catalogItem(STAIRS, "Stair Nosing", "each", "Stairs"),
];
const refs = catalogRefs(catalog);

describe("Mate AI interpreter output validation", () => {
  it("maps the model's catalog refs to tenant catalog items", () => {
    const result = planFromModelOutput(
      {
        action: "quote",
        customer: "cliente João Pereira",
        items: [
          { service_ref: "S1", service_text: "instalação de madeira", quantity: "1.350", unit: "pés" },
          { service_ref: "S3", service_text: "degraus", quantity: 12, unit: null },
        ],
        question: null,
      },
      refs,
      "2026-10-19",
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.plan.action !== "quote") throw new Error("expected quote");
    expect(result.plan.customer_query).toBe("João Pereira");
    expect(result.plan.items).toEqual([
      { service_text: "instalação de madeira", catalog_item_id: HARDWOOD, catalog_source: "quote-catalog", quantity: 1350, unit: "sq_ft" },
      { service_text: "degraus", catalog_item_id: STAIRS, catalog_source: "quote-catalog", quantity: 12, unit: "each" },
    ]);
    expect(mateAiPlanSchema.safeParse(result.plan).success).toBe(true);
  });

  it("drops refs that are not in the catalog instead of trusting the model", () => {
    const result = planFromModelOutput(
      { action: "quote", customer: "Ana", items: [{ service_ref: "S99", service_text: "tile", quantity: 200, unit: "sq_ft" }] },
      refs,
      "2026-10-19",
    );
    if (!result.ok || result.plan.action !== "quote") throw new Error("expected quote");
    expect(result.plan.items[0]?.catalog_item_id).toBeNull();
    expect(result.plan.items[0]?.service_text).toBe("tile");
  });

  it("reads invoice intents with type, deposit and a validated due date", () => {
    const result = planFromModelOutput(
      { action: "invoice", job: "1042", customer: "", invoice_type: "deposit", deposit_pct: 30, amount: null, due_date: "2026-10-30" },
      refs,
      "2026-10-19",
    );
    expect(result).toEqual({
      ok: true,
      plan: {
        action: "invoice",
        job_query: "1042",
        job_id: null,
        customer_query: "",
        invoice_type: "deposit",
        deposit_pct: 30,
        custom_amount: null,
        due_date: "2026-10-30",
      },
    });
  });

  it("rejects impossible dates and asks for the job when nothing identifies it", () => {
    expect(validDueDate("2026-02-30", "2026-10-19")).toBeNull();
    expect(validDueDate("2031-01-01", "2026-10-19")).toBeNull();
    expect(validDueDate("2026-11-06", "2026-10-19")).toBe("2026-11-06");
    const missing = planFromModelOutput({ action: "invoice", job: "", customer: "", question: "Qual job?" }, refs, "2026-10-19");
    expect(missing).toEqual({ ok: false, error: "Qual job?" });
  });

  it("returns a helpful message for unsupported actions", () => {
    const result = planFromModelOutput({ action: "unknown" }, refs, "2026-10-19");
    expect(result.ok).toBe(false);
  });

  it("gives the model today's date in the company timezone and the catalog", () => {
    const today = todayInTimezone("America/Denver", new Date("2026-10-20T03:00:00Z"));
    expect(today).toEqual({ date: "2026-10-19", weekday: "Monday" });
    const prompt = buildInterpretSystemPrompt({ today: today.date, weekday: today.weekday, timezone: "America/Denver", refs });
    expect(prompt).toContain("Monday, 2026-10-19");
    expect(prompt).toContain("S1 | Hardwood Installation | sq_ft");
    expect(prompt).toContain("S3 | Stair Nosing | each");
  });

  it("keeps the rule-based parser as fallback", () => {
    const result = planFromRules("Quote para Maria Silva com 1000 sqft de Hardwood Installation");
    expect(result.ok).toBe(true);
    if (!result.ok || result.plan.action !== "quote") throw new Error("expected quote");
    expect(result.plan.customer_query).toBe("Maria Silva");
    expect(result.plan.items[0]).toMatchObject({ quantity: 1000, unit: "sq_ft" });
  });
});

describe("Mate AI fuzzy matching", () => {
  const customers = [
    { id: "1", name: "John Smith", company: null },
    { id: "2", name: "João Pereira", company: "Pereira Homes" },
    { id: "3", name: "Mike Johnson", company: null },
    { id: "4", name: "Mike Torres", company: null },
  ];

  it("tolerates transcription typos and missing accents", () => {
    expect(editDistance("jhon", "john")).toBe(2);
    expect(nameSimilarity("Joao Pereira", ["João Pereira"])).toBe(100);
    const pick = pickBest(rankCustomers("Jon Smith", customers));
    expect(pick).toMatchObject({ status: "matched", item: { id: "1" } });
    expect(pickBest(rankCustomers("Pereira", customers))).toMatchObject({ status: "matched", item: { id: "2" } });
  });

  it("asks which one when a first name is shared", () => {
    const pick = pickBest(rankCustomers("Mike", customers));
    expect(pick.status).toBe("ambiguous");
    if (pick.status !== "ambiguous") return;
    expect(pick.candidates.map((c) => c.item.id).sort()).toEqual(["3", "4"]);
  });

  it("finds jobs by number, title or customer", () => {
    expect(jobNumberFromQuery("job #1042")).toBe(1042);
    expect(jobNumberFromQuery("trabalho número 77")).toBe(77);
    expect(jobNumberFromQuery("1042")).toBe(1042);
    expect(jobNumberFromQuery("123 Main St")).toBeNull();

    const jobs = [
      { id: "a", number: 1042, title: "Kitchen hardwood", address: "123 Main St", status: "completed", customerName: "John Smith" },
      { id: "b", number: 1043, title: "Basement carpet", address: "9 Oak Ave", status: "scheduled", customerName: "Mike Torres" },
    ];
    expect(pickBest(rankJobs("1042", null, jobs))).toMatchObject({ status: "matched", item: { id: "a" } });
    expect(pickBest(rankJobs("", "Mike Torres", jobs))).toMatchObject({ status: "matched", item: { id: "b" } });
    expect(pickBest(rankJobs("Main Street", null, jobs))).toMatchObject({ status: "matched", item: { id: "a" } });
  });

  it("suggests catalog items that share words with what was said", () => {
    expect(similarCatalogItems("carpet", catalog).map((c) => c.name)).toEqual(["Carpet Removal"]);
    expect(similarCatalogItems("granito", catalog)).toEqual([]);
  });
});
