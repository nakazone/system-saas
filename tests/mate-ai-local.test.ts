import { describe, expect, it } from "vitest";
import type { MateAiCatalogItem } from "../src/lib/mate-ai/command.js";
import { interpretLocally, parseSpokenDate, spotCustomers, wordsToDigits } from "../src/lib/mate-ai/local.js";

function item(id: string, name: string, unit = "sq ft", category = ""): MateAiCatalogItem {
  return {
    id, name, unit, category, source: "quote-catalog", description: null,
    defaultRate: 1, rateParticular: 1, rateBuilder: 1, rateContractor: 1, rateLoja: 1, pricingItemId: null,
  };
}

const catalog = [
  item("hw", "Hardwood Installation", "sq ft", "Installation"),
  item("lvp", "Vinyl Plank Installation", "sq ft", "Installation"),
  item("lam", "Laminate Installation", "sq ft", "Installation"),
  item("cr", "Carpet Removal", "sq ft", "Removal"),
  item("sf", "Sand & Finish", "sq ft", "Refinishing"),
  item("bb", "Baseboard Installation", "linear ft", "Trim"),
  item("st", "Stair Nosing", "each", "Stairs"),
];
const customers = [
  { id: "c1", name: "John Smith" },
  { id: "c2", name: "João Pereira", company: "Pereira Homes" },
  { id: "c3", name: "Mike Johnson", company: "Johnson Builders" },
  { id: "c4", name: "Mike Torres" },
  { id: "c5", name: "Maria Silva" },
];
const ctx = { today: "2026-10-19", catalog, customers };

function quote(command: string) {
  const r = interpretLocally(command, ctx);
  if (!r.ok || r.plan.action !== "quote") throw new Error("expected quote: " + JSON.stringify(r));
  return r.plan;
}
function invoice(command: string) {
  const r = interpretLocally(command, ctx);
  if (!r.ok || r.plan.action !== "invoice") throw new Error("expected invoice: " + JSON.stringify(r));
  return r.plan;
}

describe("Mate AI local reader — quotes from voice transcripts", () => {
  it("reads the user's own example: customer, 'pés de madeira' and quantity", () => {
    const plan = quote("Criar um quote para o cliente John Smith instalação de 1350 pés de madeira");
    expect(plan.customer_id).toBe("c1");
    expect(plan.items).toEqual([
      expect.objectContaining({ catalog_item_id: "hw", quantity: 1350, unit: "sq_ft" }),
    ]);
  });

  it("handles several services, thousands separators and spelled numbers", () => {
    const plan = quote("orçamento pro João Pereira: 1.350 pés de piso de madeira, tirar 400 pés de carpete e mil e duzentos pés de lixa e acabamento");
    expect(plan.customer_id).toBe("c2");
    expect(plan.items.map((i) => [i.catalog_item_id, i.quantity])).toEqual([
      ["hw", 1350],
      ["cr", 400],
      ["sf", 1200],
    ]);
  });

  it("reads English and units like linear feet and steps", () => {
    const plan = quote("create a quote for Maria Silva with 1,200 square feet of vinyl, 180 linear feet of baseboard and 14 steps");
    expect(plan.customer_id).toBe("c5");
    expect(plan.items.map((i) => [i.catalog_item_id, i.quantity, i.unit])).toEqual([
      ["lvp", 1200, "sq_ft"],
      ["bb", 180, "linear_ft"],
      ["st", 14, "step"],
    ]);
  });

  it("tolerates transcription errors in names and leaves ambiguous first names for the user", () => {
    expect(quote("quote para o jon smit, 500 pés de laminado").customer_id).toBe("c1");
    const mike = quote("quote para o Mike com 200 pés de madeira");
    expect(mike.customer_id).toBeNull();
    expect(mike.customer_query).toBe("mike");
  });

  it("survives a misheard 'quote' and mixed number formats", () => {
    const plan = quote("criar um coach para John Smith instalação de mil 350 pés de madeira");
    expect(plan.customer_id).toBe("c1");
    expect(plan.items[0]).toMatchObject({ catalog_item_id: "hw", quantity: 1350 });
  });

  it("keeps an unknown customer name and an unknown service for clarification", () => {
    const plan = quote("quote para o cliente Roberto Alves 300 pés de granito");
    expect(plan.customer_query).toBe("roberto alves");
    expect(plan.items[0]).toMatchObject({ catalog_item_id: null, quantity: 300 });
  });
});

describe("Mate AI local reader — real default catalog", () => {
  const big = [
    item("hw", "Hardwood Installation"),
    item("hw-add", "Additional Hardwood Installation"),
    item("hw-eng", "Engineered Hardwood Installation"),
    item("hw-nail", "Hardwood Installation - Nail Down"),
    item("hw-ch", "Chevron Hardwood Installation - Nail Down"),
    item("cr", "Carpet Removal"),
    item("cr-add", "Additional Carpet Removal"),
    item("sf", "Sand & Finish"),
    item("sf-add", "Add-On: Sand & Finish"),
  ];
  const bigCtx = { today: "2026-10-19", catalog: big, customers };

  it("picks the plain service over its variants", () => {
    const r = interpretLocally("quote para John Smith, 1350 pés de madeira, tirar 400 pés de carpete e 900 pés de lixa", bigCtx);
    if (!r.ok || r.plan.action !== "quote") throw new Error("expected quote");
    expect(r.plan.items.map((i) => i.catalog_item_id)).toEqual(["hw", "cr", "sf"]);
  });

  it("prefers an item named in Portuguese when that is what was said", () => {
    const withPt = [...big, item("pt", "Instalação de madeira")];
    const r = interpretLocally("quote para John Smith instalação de 1350 pés de madeira", { ...bigCtx, catalog: withPt });
    if (!r.ok || r.plan.action !== "quote") throw new Error("expected quote");
    expect(r.plan.items[0]?.catalog_item_id).toBe("pt");
  });

  it("asks when the spoken words fit two variants equally", () => {
    const r = interpretLocally("quote para John Smith 500 pés de hardwood nail down", bigCtx);
    if (!r.ok || r.plan.action !== "quote") throw new Error("expected quote");
    expect(r.plan.items[0]?.catalog_item_id).toBe("hw-nail");
  });
});

describe("Mate AI local reader — names from the default company catalog", () => {
  const names = [
    "Hardwood Installation", "Hardwood Removal", "Supply: Hardwood", "Engineered Hardwood Installation",
    "Additional Hardwood Installation", "Carpet Removal", "Additional Carpet Removal", "LVP Removal",
    "Luxury Vinyl Installation", "LVP - Laminate", "Sand & Finish", "Add-On: Sand & Finish", "Red Out",
    "Baseboards Installation", "R&R Baseboards", "Shoe Base", "Tile Removal",
  ];
  const real = names.map((n, i) => item("00000000-0000-4000-8000-" + String(i).padStart(12, "0"), n));
  const ctxReal = { today: "2026-10-19", catalog: real, customers };
  const pick = (phrase: string) => {
    const r = interpretLocally("quote para John Smith, 500 pés de " + phrase, ctxReal);
    if (!r.ok || r.plan.action !== "quote") throw new Error("expected quote");
    return real.find((x) => x.id === r.plan.items[0]?.catalog_item_id)?.name ?? null;
  };

  it.each([
    ["madeira", "Hardwood Installation"],
    ["instalação de madeira", "Hardwood Installation"],
    ["remoção de madeira", "Hardwood Removal"],
    ["carpete para tirar", "Carpet Removal"],
    ["vinil", "Luxury Vinyl Installation"],
    ["remoção de vinil", "LVP Removal"],
    ["lixa", "Sand & Finish"],
    ["rodapé", "Baseboards Installation"],
    ["troca de rodapé", "R&R Baseboards"],
  ])("“%s” → %s", (phrase, expected) => {
    expect(pick(phrase)).toBe(expected);
  });
});

describe("Mate AI local reader — invoices", () => {
  it("issues by job number with a weekday due date", () => {
    expect(invoice("emitir o invoice do job 1042 para sexta")).toMatchObject({
      job_query: "job 1042", invoice_type: "auto", due_date: "2026-10-23",
    });
  });

  it("reads deposit percentage, customer and day of month", () => {
    expect(invoice("fatura de depósito de 30% para o trabalho da Maria Silva com vencimento dia 30")).toMatchObject({
      customer_query: "Maria Silva", invoice_type: "deposit", deposit_pct: 30, due_date: "2026-10-30",
    });
  });

  it("reads balance, custom amounts and English dates", () => {
    expect(invoice("invoice the remaining balance for job #77 due November 5")).toMatchObject({
      job_query: "job 77", invoice_type: "final", due_date: "2026-11-05",
    });
    expect(invoice("fatura de $2.500 para o job 1042 em 15 dias")).toMatchObject({
      invoice_type: "custom", custom_amount: 2500, due_date: "2026-11-03",
    });
  });

  it("asks for the job when nothing identifies it", () => {
    const r = interpretLocally("emitir uma fatura", ctx);
    expect(r.ok).toBe(false);
  });
});

describe("Mate AI local reader — helpers", () => {
  it("converts spoken numbers without touching articles", () => {
    expect(wordsToDigits("mil trezentos e cinquenta pes")).toBe("1350 pes");
    expect(wordsToDigits("criar um quote com duzentos pes")).toBe("criar um quote com 200 pes");
    expect(wordsToDigits("two thousand five hundred feet")).toBe("2500 feet");
    expect(wordsToDigits("mil 350 pes")).toBe("1350 pes");
    expect(wordsToDigits("mil e 200 pes")).toBe("1200 pes");
  });

  it("resolves relative dates from today", () => {
    expect(parseSpokenDate("amanhã", "2026-10-19")).toBe("2026-10-20");
    expect(parseSpokenDate("sexta-feira que vem", "2026-10-19")).toBe("2026-10-23");
    expect(parseSpokenDate("fim do mês", "2026-10-19")).toBe("2026-10-31");
    expect(parseSpokenDate("dia 5", "2026-10-19")).toBe("2026-11-05");
    expect(parseSpokenDate("30/10", "2026-10-19")).toBe("2026-10-30");
    expect(parseSpokenDate("10/30", "2026-10-19", false)).toBe("2026-10-30");
    expect(parseSpokenDate("next week", "2026-10-19")).toBe("2026-10-26");
  });

  it("spots company names too", () => {
    expect(spotCustomers("quote para johnson builders", customers)[0]?.customer.id).toBe("c3");
  });
});
