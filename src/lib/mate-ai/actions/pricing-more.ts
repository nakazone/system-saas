/**
 * Price table beyond one price: a new service, raising prices in bulk, volume discounts and
 * suppliers. Writes go through /api/pricing and /api/erp.
 */
import { normalizeMateAiUnit } from "../command.js";
import { callInternalApi, internalError } from "../internal-api.js";
import { nameSimilarity } from "../match.js";
import type { ActionDef, PickItem } from "./types.js";
import { kept, money, num, plural, runEach, str, unitLabel } from "./types.js";

const enc = encodeURIComponent;
const TABLE = { label: "Abrir Tabela de Valores", href: "builder-pricing-admin.html" };
const CATS: Record<string, string> = { installation: "Instalação", sand_finish: "Lixa e acabamento", supply: "Material", custom: "Outro" };
const COLS: Record<string, string> = { particular: "Particular", builder: "Builder", contractor: "Contractor", loja: "Loja" };

function catOf(v: unknown): string {
  const t = str(v, 40).toLowerCase();
  if (/sand|lix|acaba|refin/.test(t)) return "sand_finish";
  if (/supply|material|forne/.test(t)) return "supply";
  if (/instal/.test(t)) return "installation";
  return t in CATS ? t : "installation";
}

/* ───────────────────────── new service ───────────────────────── */

export const createService: ActionDef = {
  name: "pricing.create",
  description: "Add a new service to the price table with its unit and price (for particular customers, or per column).",
  args: { name: "service name", unit: "sq_ft | linear_ft | each | step | hour | fixed", price: "price per unit for Particular", price_builder: "builder price (optional)", category: "installation | sand_finish | supply | custom" },
  examples: ["Cria o serviço Stair nosing, 45 por unidade", "Add 'Quarter round' at 1.50 per linear foot"],
  permissions: ["builders.edit"],
  async prepare(ctx, args) {
    const name = str(args.name, 120);
    if (!name) return { kind: "clarify", args, clarify: { question: "Qual o nome do serviço?", options: [], search: { placeholder: "Nome", path: "name" } } };
    const price = num(args.price);
    if (price == null || price < 0) return { kind: "clarify", args, clarify: { question: `Qual o preço de “${name}”?`, options: [], search: { placeholder: "Preço em $", path: "price" } } };
    const unit = normalizeMateAiUnit(str(args.unit)) || (/(cada|unid|each|un\b)/i.test(str(args.unit)) ? "each" : "sq_ft");
    const builder = num(args.price_builder);
    const category = catOf(args.category || name);
    const same = await ctx.tx.pricingItem.findMany({ where: { active: true }, select: { name: true } });
    const dup = same.find((s) => nameSimilarity(name, [s.name]) >= 90);
    return {
      kind: "card",
      args,
      card: {
        title: "Novo serviço: " + name,
        sections: [
          { type: "fields", rows: [{ label: "Unidade", value: unitLabel(unit) || unit, edit: { path: "unit", input: "select", value: unit, options: ["sq_ft", "linear_ft", "each", "step", "hour", "fixed"].map((u) => ({ value: u, label: unitLabel(u) || u })) } }, { label: "Particular", value: money(price), edit: { path: "price", input: "money", value: price } }, { label: "Builder", value: builder != null ? money(builder) : "mesmo de Particular", edit: { path: "price_builder", input: "money", value: builder } }, { label: "Categoria", value: CATS[category]!, edit: { path: "category", input: "select", value: category, options: Object.entries(CATS).map(([value, label]) => ({ value, label })) } }] },
          ...(dup ? [{ type: "note" as const, tone: "warning" as const, text: `Já existe “${dup.name}” na tabela.` }] : []),
        ],
        confirm: { label: "Adicionar à tabela", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ name, unit, category, price, builder: builder ?? price }) } } },
        open: TABLE,
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi<{ data?: { id: string } }>(ctx.req, "POST", "/api/pricing", { name: exec.name, unit: exec.unit, category: exec.category, price_particular: exec.price, price_builder: exec.builder, price_contractor: exec.builder, price_loja: exec.price });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não consegui adicionar o serviço.") };
    return { ok: true, title: `${exec.name} na tabela · ${money(Number(exec.price))}/${unitLabel(String(exec.unit))}`, links: [TABLE], memory: `Added service ${exec.name} to the price table` };
  },
};

/* ───────────────────────── raise / lower in bulk ───────────────────────── */

export const adjustPrices: ActionDef = {
  name: "pricing.adjust",
  description: "Raise or lower prices in the price table by a percent, for a category (installation, sand & finish, supply) or services matching a word, in one or all columns. Shows before/after to confirm.",
  args: { percent: "e.g. 5 for +5%, -3 for −3%", category: "installation | sand_finish | supply (optional)", match: "only services with this word (optional)", column: "particular | builder | contractor | loja | all (default all)" },
  examples: ["Aumenta 5% em todos os serviços de instalação", "Raise sanding prices 3% for builders"],
  permissions: ["builders.edit"],
  async prepare(ctx, args) {
    const pct = num(args.percent);
    if (!pct) return { kind: "clarify", args, clarify: { question: "Quanto por cento?", options: [3, 5, 10].map((p) => ({ label: "+" + p + "%", patch: { percent: p } })), search: { placeholder: "Ex.: 7 ou -5", path: "percent" } } };
    const cat = str(args.category) ? catOf(args.category) : null;
    const word = str(args.match, 60);
    const col = str(args.column) in COLS ? str(args.column) : "all";
    const rows = await ctx.tx.pricingItem.findMany({ where: { active: true, ...(cat ? { category: cat } : {}) }, select: { id: true, name: true, unit: true, priceParticular: true, priceBuilder: true, priceContractor: true, priceLoja: true }, orderBy: { name: "asc" } });
    const list = rows.filter((r) => !word || nameSimilarity(word, [r.name]) >= 55 || r.name.toLowerCase().includes(word.toLowerCase()));
    if (!list.length) return { kind: "error", message: "Nenhum serviço da tabela bate com isso.", args };
    const k = 1 + pct / 100;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const cols = col === "all" ? Object.keys(COLS) : [col];
    const field = (c: string) => ("price" + c[0]!.toUpperCase() + c.slice(1)) as "priceParticular" | "priceBuilder" | "priceContractor" | "priceLoja";
    const plan = list.map((r) => ({ id: r.id, name: r.name, body: Object.fromEntries(cols.map((c) => ["price_" + c, r2(Number(r[field(c)]) * k)])), before: Object.fromEntries(cols.map((c) => ["price_" + c, Number(r[field(c)])])) }));
    const shown = col === "all" ? "particular" : col;
    const items: PickItem[] = plan.map((p) => ({ id: p.id, title: p.name, detail: `${COLS[shown]}: ${money(p.before["price_" + shown] as number)} → ${money(p.body["price_" + shown] as number)}` }));
    return {
      kind: "card",
      args,
      card: {
        title: `${pct > 0 ? "+" : ""}${pct}% em ${plural(list.length, "serviço", "serviços")}`,
        subtitle: (cat ? CATS[cat] + " · " : "") + (col === "all" ? "todas as colunas" : "coluna " + COLS[col]),
        sections: [{ type: "pick", items }, { type: "note", text: "Vale para os próximos Quotes. Quotes já criados não mudam." }],
        confirm: { label: "Aplicar preços", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ plan, pct }) } } },
        open: TABLE,
      },
    };
  },
  async execute(ctx, exec) {
    const plan = kept(ctx, (exec.plan || []) as Array<{ id: string; name: string; body: Record<string, number>; before: Record<string, number> }>);
    if (!plan.length) return { ok: false, status: 400, error: "Nenhum serviço marcado." };
    const r = await runEach(plan, async (p) => {
      const res = await callInternalApi(ctx.req, "PUT", "/api/pricing/" + enc(p.id), p.body);
      return { ok: res.ok, error: internalError(res, "falhou") };
    });
    if (!r.done.length) return { ok: false, status: 502, error: r.failed[0]?.error || "Nada foi alterado." };
    return { ok: true, title: `${plural(r.done.length, "preço atualizado", "preços atualizados")} (${Number(exec.pct) > 0 ? "+" : ""}${exec.pct}%)`, detail: r.failed.length ? "Falharam: " + r.failed.map((f) => f.item.name).join(", ") : undefined, links: [TABLE], undo: { plan: r.done.map((d) => ({ id: d.id, body: d.before })) }, memory: `Adjusted ${r.done.length} prices by ${exec.pct}%` };
  },
  async undo(ctx, u) {
    const plan = (u.plan || []) as Array<{ id: string; body: Record<string, number> }>;
    const r = await runEach(plan, async (p) => {
      const res = await callInternalApi(ctx.req, "PUT", "/api/pricing/" + enc(p.id), p.body);
      return { ok: res.ok };
    });
    return { ok: true, title: `${plural(r.done.length, "preço voltou", "preços voltaram")} ao valor anterior` };
  },
};

/* ───────────────────────── volume discounts ───────────────────────── */

export const volumeDiscounts: ActionDef = {
  name: "pricing.volume",
  description: "The volume discount tiers by area (sq ft) used in quotes.",
  args: {},
  examples: ["Quais descontos por volume eu tenho?", "Volume discounts"],
  permissions: ["pricing.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const res = await callInternalApi<{ data?: Array<{ min_sqft: number; max_sqft: number | null; discount_pct: number }> }>(ctx.req, "GET", "/api/pricing/volume-discounts");
    const tiers = res.json.data || [];
    return {
      kind: "answer",
      args,
      card: { title: "Descontos por volume", sections: [{ type: "table", columns: ["Área", "Desconto"], align: ["left", "right"], rows: tiers.map((t) => [t.max_sqft != null ? `${t.min_sqft.toLocaleString("en-US")}–${t.max_sqft.toLocaleString("en-US")} sq ft` : `${t.min_sqft.toLocaleString("en-US")}+ sq ft`, t.discount_pct + "%"]) }], open: TABLE },
    };
  },
};

/* ───────────────────────── supplier ───────────────────────── */

export const createSupplier: ActionDef = {
  name: "supplier.create",
  description: "Register a supplier (material store or distributor) with contact data.",
  args: { name: "supplier name", contact_name: "contact person", phone: "phone", email: "e-mail", address: "address" },
  examples: ["Cadastra o fornecedor Floor & Decor", "Add supplier ABC Flooring, contact Joe, 303 555 0144"],
  permissions: ["quotes.edit"],
  async prepare(ctx, args) {
    const name = str(args.name, 120);
    if (!name) return { kind: "clarify", args, clarify: { question: "Qual o nome do fornecedor?", options: [], search: { placeholder: "Nome", path: "name" } } };
    const body = { name, contact_name: str(args.contact_name, 80) || null, phone: str(args.phone, 30) || null, email: str(args.email, 120) || null, address: str(args.address, 200) || null };
    const dup = await ctx.tx.supplier.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true } });
    return {
      kind: "card",
      args,
      card: {
        title: "Novo fornecedor: " + name,
        sections: [{ type: "fields", rows: [{ label: "Contato", value: body.contact_name || "—", edit: { path: "contact_name", input: "text", value: body.contact_name } }, { label: "Telefone", value: body.phone || "—", edit: { path: "phone", input: "text", value: body.phone } }, { label: "E-mail", value: body.email || "—", edit: { path: "email", input: "text", value: body.email } }] }, ...(dup ? [{ type: "note" as const, tone: "warning" as const, text: "Já existe um fornecedor com esse nome." }] : [])],
        confirm: { label: "Cadastrar", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ body }) } } },
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi(ctx.req, "POST", "/api/erp/suppliers", exec.body);
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não consegui cadastrar.") };
    return { ok: true, title: `Fornecedor ${(exec.body as { name: string }).name} cadastrado`, memory: `Added supplier ${(exec.body as { name: string }).name}` };
  },
};

export const PRICING_MORE_ACTIONS: ActionDef[] = [createService, adjustPrices, volumeDiscounts, createSupplier];
