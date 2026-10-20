import { normalizeMateAiUnit, resolveCustomerUnitPrice } from "../command.js";
import { callInternalApi, internalError } from "../internal-api.js";
import { loadMateAiCatalog, pickService } from "./catalog.js";
import { resolveCustomer } from "./resolve.js";
import type { ActionDef } from "./types.js";
import { money, num, str, unitLabel, uuidOrNull } from "./types.js";

type Column = "particular" | "builder" | "loja" | "customer";

const COLUMN_PT: Record<Column, string> = { particular: "Particular", builder: "Builder / Contractor", loja: "Loja", customer: "Só este cliente" };

function canEdit(req: { user?: { roleKey?: string | null; permissions: string[] } }, key: string) {
  return req.user?.roleKey === "admin" || Boolean(req.user?.permissions.includes(key));
}

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
    "Save a service price. Either in the company's price table (Tabela de Valores: particular, builder or loja column — valid for every customer of that type) or as a special price for ONE customer (column customer). Use when the user states what a service costs for a customer or customer type (\"o preço da remoção para esse cliente é 80 cents\" → column customer + customer), or after a quote used a price that was not in the table.",
  args: {
    service: "service name as said (when not coming from a quote)",
    price: "price per unit in dollars",
    column: "particular | builder | loja | customer (customer = special price only for that customer; use it when the user says 'para esse cliente' / 'pro Naka'). Optional; defaults to the customer's type",
    customer: "customer name (required for column customer; otherwise picks the column from the customer's type)",
  },
  examples: [
    "Salva o preço da remoção de carpete como 1 dólar o pé",
    "Hardwood installation for builders is 4.25 per square foot",
    "O preço da remoção de carpete para o Naka é 80 cents",
  ],
  permissions: ["pricing.view"],
  async prepare(ctx, args) {
    const catalog = await loadMateAiCatalog(ctx.tx, ctx.organizationId);
    let column: Column | null = ["particular", "builder", "loja", "customer"].includes(str(args.column)) ? (str(args.column) as Column) : null;
    let customer: { id: string; customerType: string; pricingMode: string | null; customPricingRates: unknown; name: string } | null = null;
    if (uuidOrNull(args.customer_id) || str(args.customer) || column === "customer") {
      const r = await resolveCustomer(ctx, args);
      if (r.status === "clarify") return { kind: "clarify", clarify: r.clarify, args };
      if (r.status === "missing") return { kind: "error", message: r.message, args };
      customer = await ctx.tx.customer.findFirst({ where: { id: r.row.id }, select: { id: true, customerType: true, pricingMode: true, customPricingRates: true, name: true } });
      if (customer) args = { ...args, customer_id: customer.id };
    }
    if (!column) column = columnFor(customer?.customerType);
    if (column === "customer" && !customer) return { kind: "error", message: "Para qual cliente é esse preço?", args };
    if (column === "customer" ? !canEdit(ctx.req, "customers.edit") : !canEdit(ctx.req, "builders.edit")) {
      return { kind: "error", message: "Você não tem permissão para mudar preços. Peça a um administrador.", args };
    }
    const customRates =
      customer?.customPricingRates && typeof customer.customPricingRates === "object" && !Array.isArray(customer.customPricingRates)
        ? (customer.customPricingRates as Record<string, unknown>)
        : {};

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
    const plan: Array<{ name: string; unit: string; category: string; pricing_item_id: string | null; rate_key: string; price: number; before: number }> = [];
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
        column === "customer"
          ? resolveCustomerUnitPrice(item, customer!) || 0
          : resolveCustomerUnitPrice(item, { customerType: column, pricingMode: "table", customPricingRates: null }) || 0;
      plan.push({
        name: item.name,
        unit: normalizeMateAiUnit(item.unit) || item.unit || "sq_ft",
        category: item.category || "installation",
        pricing_item_id: item.pricingItemId,
        rate_key: item.pricingItemId || item.id,
        price: Math.round(price * 100) / 100,
        before,
      });
      rows.push([item.name, before > 0 ? money(before) : "sem preço", money(price) + "/" + unitLabel(normalizeMateAiUnit(item.unit) || item.unit)]);
    }
    const exec = { column, plan, customer_id: customer?.id ?? null, customer_name: customer?.name ?? null, rates: column === "customer" ? customRates : null };
    const columns = (Object.keys(COLUMN_PT) as Column[]).filter((c) => c !== "customer" || customer);
    return {
      kind: "card",
      args: { ...args, column },
      card: {
        title: "Salvar na Tabela de Valores",
        subtitle: column === "customer" ? "Preço especial de " + customer!.name : "Coluna " + COLUMN_PT[column] + (customer ? " · tipo de " + customer.name : ""),
        sections: [
          { type: "table", columns: ["Serviço", "Antes", "Novo"], rows, align: ["left", "right", "right"] },
          {
            type: "fields",
            rows: [
              {
                label: "Vale para",
                value: column === "customer" ? customer!.name : COLUMN_PT[column],
                edit: { path: "column", input: "select", value: column, options: columns.map((c) => ({ value: c, label: c === "customer" ? "Só " + customer!.name : "Tabela · " + COLUMN_PT[c] })) },
              },
            ],
          },
          {
            type: "note",
            text:
              column === "customer"
                ? `Só para ${customer!.name}: os outros clientes continuam com a Tabela de Valores. Quotes já criados não mudam.`
                : "Vale para os próximos Quotes e jobs. Quotes já criados não mudam.",
          },
        ],
        confirm: { label: "Salvar preço", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign(exec) } } },
        open: column === "customer" ? { label: "Abrir cliente", href: "customers.html?id=" + encodeURIComponent(customer!.id) } : { label: "Abrir Tabela de Valores", href: "builder-pricing-admin.html" },
      },
    };
  },
  async execute(ctx, exec) {
    const column = String(exec.column) as Column;
    const field = "price_" + column;
    const plan = (exec.plan || []) as Array<{ name: string; unit: string; category: string; pricing_item_id: string | null; rate_key: string; price: number }>;
    if (column === "customer") {
      // Re-read the customer's rates so a change made meanwhile on the screen is kept.
      const cur = await callInternalApi<{ data?: { custom_pricing_rates?: Record<string, number> } }>(ctx.req, "GET", "/api/customers/" + encodeURIComponent(String(exec.customer_id)));
      const rates: Record<string, number> = { ...((cur.ok && cur.json.data?.custom_pricing_rates) || (exec.rates as Record<string, number>) || {}) };
      for (const p of plan) rates[p.rate_key] = p.price;
      const res = await callInternalApi(ctx.req, "PUT", "/api/customers/" + encodeURIComponent(String(exec.customer_id)), { pricing_mode: "custom", custom_pricing_rates: rates });
      if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível salvar o preço do cliente.") };
      return {
        ok: true,
        title: plan.length === 1 ? `Preço de ${plan[0]!.name} salvo para ${exec.customer_name}` : `${plan.length} preços salvos para ${exec.customer_name}`,
        detail: plan.map((p) => `${p.name}: ${money(p.price)}`).join(" · "),
        links: [{ label: "Abrir cliente", href: "customers.html?id=" + encodeURIComponent(String(exec.customer_id)) }],
        entity: { type: "customer", id: String(exec.customer_id) },
        memory: `Saved special prices for customer ${exec.customer_name}: ` + plan.map((p) => `${p.name} ${money(p.price)}`).join(", "),
      };
    }
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
