import { normalizeMateAiUnit, resolveCustomerUnitPrice } from "../command.js";
import { callInternalApi, internalError } from "../internal-api.js";
import { loadMateAiCatalog, pickService } from "./catalog.js";
import type { ActionDef } from "./types.js";
import { money, num, str, unitLabel, uuidOrNull } from "./types.js";

type Column = "particular" | "builder" | "loja";

const COLUMN_PT: Record<Column, string> = { particular: "Particular", builder: "Builder / Contractor", loja: "Loja" };

/** The Quote Builder prices contractors with the Builder column. */
function columnFor(customerType: string | null | undefined): Column {
  const t = String(customerType || "").toLowerCase();
  if (t === "builder" || t === "contractor") return "builder";
  if (t === "loja") return "loja";
  return "particular";
}

export const setPrice: ActionDef = {
  name: "pricing.set",
  description:
    "Save a service price in the company's price table (Tabela de Valores), for the particular, builder or loja column. Use when the user states what a service costs and wants it saved, or after a quote used a price that was not in the table.",
  args: {
    service: "service name as said (when not coming from a quote)",
    price: "price per unit in dollars",
    column: "particular | builder | loja (optional; defaults to the customer's type or particular)",
    customer: "customer name, to pick the column from the customer's type (optional)",
  },
  examples: ["Salva o preço da remoção de carpete como 1 dólar o pé", "Hardwood installation for builders is 4.25 per square foot"],
  permissions: ["builders.edit", "pricing.view"],
  async prepare(ctx, args) {
    const catalog = await loadMateAiCatalog(ctx.tx, ctx.organizationId);
    let column: Column | null = ["particular", "builder", "loja"].includes(str(args.column)) ? (str(args.column) as Column) : null;
    const customerId = uuidOrNull(args.customer_id);
    let customer: { customerType: string; pricingMode: string | null; customPricingRates: unknown; name: string } | null = null;
    if (customerId) {
      customer = await ctx.tx.customer.findFirst({ where: { id: customerId }, select: { customerType: true, pricingMode: true, customPricingRates: true, name: true } });
    }
    if (!column) column = columnFor(customer?.customerType);

    // Lines either come from a quote (items with catalog ids) or from one spoken service + price.
    let lines: Array<{ catalog_item_id?: unknown; catalog_source?: unknown; name?: unknown; unit_price?: unknown; service_text?: unknown }> = Array.isArray(args.items)
      ? (args.items as Array<Record<string, unknown>>).slice(0, 8)
      : [];
    if (!lines.length) {
      const price = num(args.price);
      if (!str(args.service)) return { kind: "error", message: "De qual serviço é o preço?", args };
      if (price == null || price <= 0) {
        return { kind: "clarify", args, clarify: { question: `Qual o preço de “${str(args.service)}”?`, options: [], search: { placeholder: "Preço em $", path: "price" } } };
      }
      lines = [{ service_text: args.service, unit_price: price }];
    }

    const rows: string[][] = [];
    const plan: Array<{ name: string; unit: string; category: string; pricing_item_id: string | null; price: number; before: number }> = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      const picked = pickService(catalog, { catalog_item_id: l.catalog_item_id, catalog_source: l.catalog_source, service_text: l.service_text || l.name });
      if (picked.status === "choose") {
        return {
          kind: "clarify",
          args,
          clarify: {
            question: `Qual serviço da tabela é “${str(l.service_text || l.name)}”?`,
            options: picked.options.map((o) => ({
              label: o.name,
              detail: normalizeMateAiUnit(o.unit) || o.unit,
              patch: lines === args.items ? { [`items.${i}.catalog_item_id`]: o.id, [`items.${i}.catalog_source`]: o.source } : { service: o.name },
            })),
          },
        };
      }
      const item = picked.item;
      const price = num(l.unit_price);
      if (price == null || price <= 0) return { kind: "error", message: `Qual o preço de “${item.name}”?`, args };
      const before =
        resolveCustomerUnitPrice(item, { customerType: column === "builder" ? "builder" : column, pricingMode: "table", customPricingRates: null }) || 0;
      plan.push({
        name: item.name,
        unit: normalizeMateAiUnit(item.unit) || item.unit || "sq_ft",
        category: item.category || "installation",
        pricing_item_id: item.pricingItemId,
        price: Math.round(price * 100) / 100,
        before,
      });
      rows.push([item.name, before > 0 ? money(before) : "sem preço", money(price) + "/" + unitLabel(normalizeMateAiUnit(item.unit) || item.unit)]);
    }
    const exec = { column, plan };
    return {
      kind: "card",
      args: { ...args, column },
      card: {
        title: "Salvar na Tabela de Valores",
        subtitle: "Coluna " + COLUMN_PT[column] + (customer ? " · tipo de " + customer.name : ""),
        sections: [
          { type: "table", columns: ["Serviço", "Antes", "Novo"], rows, align: ["left", "right", "right"] },
          {
            type: "fields",
            rows: [
              {
                label: "Coluna",
                value: COLUMN_PT[column],
                edit: { path: "column", input: "select", value: column, options: (Object.keys(COLUMN_PT) as Column[]).map((c) => ({ value: c, label: COLUMN_PT[c] })) },
              },
            ],
          },
          { type: "note", text: "Vale para os próximos Quotes e jobs. Quotes já criados não mudam." },
        ],
        confirm: { label: "Salvar preço", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign(exec) } } },
        open: { label: "Abrir Tabela de Valores", href: "builder-pricing-admin.html" },
      },
    };
  },
  async execute(ctx, exec) {
    const column = String(exec.column) as Column;
    const field = "price_" + column;
    const plan = (exec.plan || []) as Array<{ name: string; unit: string; category: string; pricing_item_id: string | null; price: number }>;
    for (const p of plan) {
      const res = p.pricing_item_id
        ? await callInternalApi(ctx.req, "PUT", "/api/pricing/" + encodeURIComponent(p.pricing_item_id), { [field]: p.price })
        : await callInternalApi(ctx.req, "POST", "/api/pricing", { name: p.name, unit: p.unit, category: p.category, [field]: p.price });
      if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível salvar o preço de " + p.name + ".") };
    }
    return {
      ok: true,
      title: plan.length === 1 ? `Preço de ${plan[0]!.name} salvo` : `${plan.length} preços salvos`,
      detail: plan.map((p) => `${p.name}: ${money(p.price)}`).join(" · ") + " · coluna " + COLUMN_PT[column],
      links: [{ label: "Abrir Tabela de Valores", href: "builder-pricing-admin.html" }],
      memory: "Saved prices in the price table: " + plan.map((p) => `${p.name} ${money(p.price)} (${column})`).join(", "),
    };
  },
};
