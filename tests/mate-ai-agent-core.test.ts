import { describe, expect, it } from "vitest";
import type { MateAiCatalogItem } from "../src/lib/mate-ai/command.js";
import { applyPatch, buildAgentPrompt, canUse, normalizeArgs, pickLocally } from "../src/lib/mate-ai/agent.js";
import { periodFor } from "../src/lib/mate-ai/actions/insights.js";
import { zonedToUtc } from "../src/lib/mate-ai/actions/time.js";
import { signActionToken, verifyActionToken } from "../src/lib/mate-ai/token.js";
import type { ActionDef } from "../src/lib/mate-ai/actions/types.js";

const item = (id: string, name: string, unit = "sq ft"): MateAiCatalogItem => ({
  id, name, unit, category: "", source: "quote-catalog", description: null,
  defaultRate: 1, rateParticular: 1, rateBuilder: 1, rateContractor: 1, rateLoja: 1, pricingItemId: null,
});
const HW = "11111111-1111-4111-8111-111111111111";
const catalog = [item(HW, "Hardwood Installation"), item("22222222-2222-4222-8222-222222222222", "Stair Nosing", "each")];
const ctx = { today: "2026-10-19", catalog, customers: [{ id: "c1", name: "John Smith" }] };

describe("Mate AI agent core", () => {
  it("reads questions and actions without AI", () => {
    expect(pickLocally("o que tem amanhã?", ctx)).toMatchObject({ kind: "action", action: "agenda.list", args: { date: "2026-10-20" } });
    expect(pickLocally("quanto faturei semana passada", ctx)).toMatchObject({ action: "money.summary", args: { period: "last_week" } });
    expect(pickLocally("quem está me devendo?", ctx)).toMatchObject({ action: "invoices.overdue" });
    expect(pickLocally("quais jobs estão sem invoice", ctx)).toMatchObject({ action: "jobs.uninvoiced" });
    expect(pickLocally("quote para John Smith 1350 pés de madeira", ctx)).toMatchObject({ action: "quote.create", args: { customer_id: "c1" } });
    expect(pickLocally("invoice do job 1042 para sexta", ctx)).toMatchObject({ action: "invoice.job", args: { job_query: "job 1042", due_date: "2026-10-23" } });
    expect(pickLocally("bom dia", ctx).kind).toBe("reply");
  });

  it("maps catalog refs to ids and resolves spoken dates in model args", () => {
    const quote = normalizeArgs("quote.create", { customer: "John", items: [{ service_ref: "S1", service_text: "madeira", quantity: "1.350", unit: "pés" }] }, catalog, "2026-10-19");
    expect(quote).toEqual({
      customer_query: "John",
      customer_id: null,
      items: [{ service_text: "madeira", catalog_item_id: HW, catalog_source: "quote-catalog", quantity: 1350, unit: "sq_ft" }],
    });
    expect(normalizeArgs("job.schedule", { job: "1042", date: "sexta" }, catalog, "2026-10-19")).toMatchObject({ date: "2026-10-23" });
    expect(normalizeArgs("invoice.job", { job: "1042", invoice_type: "deposit", deposit_pct: "30", due_date: "2031-01-01" }, catalog, "2026-10-19")).toMatchObject({
      job_query: "1042", invoice_type: "deposit", deposit_pct: 30, due_date: null,
    });
  });

  it("applies choices and card edits by path, and ignores prototype keys", () => {
    const args = { items: [{ quantity: 10 }], customer_query: "Mike" };
    expect(applyPatch(args, { "items.0.quantity": 15, customer_id: "x" })).toEqual({ items: [{ quantity: 15 }], customer_query: "Mike", customer_id: "x" });
    expect(applyPatch(args, { "items.1.catalog_item_id": "y" }).items).toEqual([{ quantity: 10 }, { catalog_item_id: "y" }]);
    const polluted = applyPatch({}, { "__proto__.admin": true, "constructor.prototype.x": 1 });
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
    expect(polluted).toEqual({});
    expect(args.items[0]!.quantity).toBe(10);
  });

  it("only lists the actions a user can use, with screen and memory", () => {
    const a: ActionDef = { name: "invoice.send", description: "Send invoice", args: { invoice: "number" }, examples: ["Manda a invoice"], permissions: ["invoices.manage"], prepare: async () => ({ kind: "error", message: "" }) };
    expect(canUse(a, { roleKey: "sales", permissions: ["quotes.view"] })).toBe(false);
    expect(canUse(a, { roleKey: "admin", permissions: [] })).toBe(true);
    const prompt = buildAgentPrompt({
      actions: [a], catalog, today: "2026-10-19", weekday: "Monday", timezone: "America/Denver",
      screen: { type: "job", id: "j1", label: "Job #1042 · Kitchen" },
      memory: [{ role: "assistant", text: "Created quote Q-1001", entity: { type: "quote", id: "33333333-3333-4333-8333-333333333333" } }],
    });
    expect(prompt).toContain("- invoice.send: Send invoice");
    expect(prompt).toContain("The user is looking at: Job #1042 · Kitchen (job j1)");
    expect(prompt).toContain("Mate: Created quote Q-1001 [quote 33333333-3333-4333-8333-333333333333]");
    expect(prompt).toContain("S1 | Hardwood Installation | sq_ft");
  });

  it("signs confirmations and rejects other kinds or edits", () => {
    const { token } = signActionToken({ k: "exec", a: "job.note", o: "org", u: "user", e: { text: "x" }, ttlMs: 60_000 });
    expect(verifyActionToken(token, "exec")).toMatchObject({ a: "job.note", o: "org", u: "user", e: { text: "x" } });
    expect(verifyActionToken(token, "undo")).toBeNull();
    const [body, sig] = token.split(".");
    expect(verifyActionToken(body + "x." + sig, "exec")).toBeNull();
    const expired = signActionToken({ k: "undo", a: "a", o: "o", u: "u", e: {}, ttlMs: -1 });
    expect(verifyActionToken(expired.token, "undo")).toBeNull();
  });

  it("computes periods and local times in the company timezone", () => {
    expect(periodFor("this_month", "2026-10-19")).toMatchObject({ from: "2026-10-01", to: "2026-10-19" });
    expect(periodFor("last_month", "2026-01-10")).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
    expect(periodFor("this_week", "2026-10-19")).toMatchObject({ from: "2026-10-19", to: "2026-10-19" });
    expect(periodFor("last_week", "2026-10-21")).toMatchObject({ from: "2026-10-12", to: "2026-10-18" });
    expect(zonedToUtc("2026-10-26", "07:00", "America/Denver")?.toISOString()).toBe("2026-10-26T13:00:00.000Z");
    expect(zonedToUtc("2026-11-02", "07:00", "America/Denver")?.toISOString()).toBe("2026-11-02T14:00:00.000Z");
  });
});
