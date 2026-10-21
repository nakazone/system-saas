/**
 * Customers beyond create/balance/prices: edit contact data, full overview, addresses, referral
 * link, duplicates and merge. Writes go through the customer routes.
 */
import { computeInvoiceMoney } from "../../invoices/core.js";
import { normalizeQuoteStatus } from "../../quotes/transitions.js";
import { callInternalApi, internalError } from "../internal-api.js";
import { jobLabel, quoteStatusPt, resolveCustomer } from "./resolve.js";
import { fmtDate } from "./time.js";
import type { ActionContext, ActionDef, ListItem } from "./types.js";
import { dayIn, isEmail, money, plural, str, uuidOrNull } from "./types.js";

const enc = encodeURIComponent;

function customerLink(id: string) {
  return { label: "Abrir cliente", href: "customers.html?id=" + enc(id) };
}

async function customerOr(ctx: ActionContext, args: Record<string, unknown>) {
  const r = await resolveCustomer(ctx, args);
  if (r.status === "clarify") return { done: { kind: "clarify" as const, clarify: r.clarify, args } };
  if (r.status === "missing") return { done: { kind: "error" as const, message: r.message, args } };
  return { customer: r.row };
}

function cleanPhone(v: unknown): string {
  const d = str(v, 40).replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return str(v, 40);
}

/* ───────────────────────── edit ───────────────────────── */

const EDITABLE: Record<string, string> = { name: "Nome", phone: "Telefone", email: "E-mail", address: "Endereço", company: "Empresa", notes: "Notas", customer_type: "Tipo" };
const TYPE_PT: Record<string, string> = { particular: "Particular", builder: "Builder / construtora", contractor: "Contractor", loja: "Loja" };

export const updateCustomer: ActionDef = {
  name: "customer.update",
  description: "Change a customer's contact data: phone, e-mail, address, name, company, notes or type.",
  args: { customer: "customer name", name: "new name", phone: "new phone", email: "new e-mail", address: "new address", company: "company", notes: "notes to set", customer_type: "particular | builder | contractor | loja" },
  examples: ["Muda o telefone do John para 303 555 0199", "O e-mail do Mike agora é mike@torres.com", "Update Ana's address to 45 Oak St"],
  permissions: ["customers.edit"],
  async prepare(ctx, args) {
    const got = await customerOr(ctx, args);
    if (got.done) return got.done;
    const c = got.customer!;
    const row = await ctx.tx.customer.findFirst({ where: { id: c.id }, select: { name: true, phone: true, email: true, address: true, company: true, notes: true, customerType: true } });
    if (!row) return { kind: "error", message: "Cliente não encontrado.", args };
    const before: Record<string, string> = { name: row.name, phone: row.phone || "", email: row.email || "", address: row.address || "", company: row.company || "", notes: row.notes || "", customer_type: row.customerType };
    const body: Record<string, string> = {};
    for (const k of Object.keys(EDITABLE)) {
      // "name" is the new name only when "customer" says who; the model sends both then.
      if (k === "name" && !str(args.customer) && !uuidOrNull(args.customer_id)) continue;
      if (args[k] === undefined || args[k] === null || str(args[k]) === "") continue;
      let v = str(args[k], k === "notes" ? 2000 : 300);
      if (k === "phone") v = cleanPhone(v);
      if (k === "email") {
        v = v.toLowerCase().replace(/\s+/g, "");
        if (!isEmail(v)) return { kind: "error", message: `“${v}” não parece um e-mail.`, args };
      }
      if (k === "customer_type" && !(v in TYPE_PT)) continue;
      if (v !== before[k]) body[k] = v;
    }
    if (!Object.keys(body).length) return { kind: "error", message: "O que devo mudar no cadastro? Ex.: telefone, e-mail ou endereço.", args: { ...args, customer_id: c.id } };
    return {
      kind: "card",
      args: { ...args, customer_id: c.id },
      card: {
        title: "Atualizar " + c.name,
        sections: [
          {
            type: "table",
            columns: ["Campo", "Antes", "Novo"],
            rows: Object.keys(body).map((k) => [EDITABLE[k]!, (k === "customer_type" ? TYPE_PT[before[k]!] : before[k]) || "—", k === "customer_type" ? TYPE_PT[body[k]!]! : body[k]!]),
          },
        ],
        confirm: { label: "Salvar", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ customer_id: c.id, name: c.name, body, prev: Object.fromEntries(Object.keys(body).map((k) => [k, before[k]])) }) } } },
        open: customerLink(c.id),
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi(ctx.req, "PUT", "/api/customers/" + enc(String(exec.customer_id)), exec.body);
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível salvar.") };
    const fields = Object.keys(exec.body as Record<string, string>).map((k) => EDITABLE[k]!.toLowerCase());
    return { ok: true, title: `${exec.name}: ${fields.join(", ")} atualizado`, links: [customerLink(String(exec.customer_id))], undo: { customer_id: exec.customer_id, body: exec.prev }, entity: { type: "customer", id: String(exec.customer_id) }, memory: `Updated ${fields.join(", ")} of ${exec.name}` };
  },
  async undo(ctx, u) {
    const res = await callInternalApi(ctx.req, "PUT", "/api/customers/" + enc(String(u.customer_id)), u.body);
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível desfazer.") };
    return { ok: true, title: "Cadastro restaurado" };
  },
};

/* ───────────────────────── overview ───────────────────────── */

export const customerOverview: ActionDef = {
  name: "customer.overview",
  description: "Everything about one customer at a glance: contact, jobs, open quotes, invoices and balance, last activity.",
  args: { customer: "customer name" },
  examples: ["Me fala tudo do John", "Resumo do cliente Mike Torres", "What's going on with the Smiths?"],
  permissions: ["customers.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const got = await customerOr(ctx, args);
    if (got.done) return got.done;
    const c = got.customer!;
    const [row, jobs, quotes, invoices] = await Promise.all([
      ctx.tx.customer.findFirst({ where: { id: c.id }, select: { phone: true, email: true, address: true, customerType: true, createdAt: true } }),
      ctx.tx.workOrder.findMany({ where: { customerId: c.id }, select: { id: true, number: true, title: true, status: true, scheduledStart: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 20 }),
      ctx.tx.quote.findMany({ where: { customerId: c.id, NOT: { status: "archived" } }, select: { id: true, number: true, quoteNumber: true, title: true, status: true, total: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 20 }),
      ctx.tx.quoteInvoice.findMany({ where: { customerId: c.id, status: { not: "void" } }, select: { id: true, invoiceNumber: true, status: true, amount: true, dueDate: true, receipts: { select: { amount: true } } }, orderBy: { createdAt: "desc" }, take: 30 }),
    ]);
    const money2 = invoices.map((i) => ({ i, m: computeInvoiceMoney(i) }));
    const billed = money2.reduce((s, x) => s + x.m.amount, 0);
    const owed = money2.reduce((s, x) => s + x.m.balance, 0);
    const openQuotes = quotes.filter((q) => ["draft", "sent", "changes_requested"].includes(normalizeQuoteStatus(q.status)));
    const activeJobs = jobs.filter((j) => !["completed", "canceled"].includes(j.status));
    const items: ListItem[] = [
      ...activeJobs.slice(0, 4).map((j) => ({ title: "Job " + jobLabel(j), detail: j.status + (j.scheduledStart ? " · " + fmtDate(dayIn(j.scheduledStart, ctx.timezone)!) : ""), href: "job-detail.html?id=" + enc(j.id) })),
      ...openQuotes.slice(0, 4).map((q) => ({ title: "Quote " + (q.quoteNumber || "#" + q.number), detail: quoteStatusPt(q.status) + " · " + money(Number(q.total)), href: "quote-builder.html?id=" + enc(q.id) })),
      ...money2.filter((x) => x.m.balance > 0.004).slice(0, 4).map((x) => ({ title: "Invoice " + (x.i.invoiceNumber || ""), detail: "saldo " + money(x.m.balance) + (x.i.dueDate ? " · vence " + fmtDate(dayIn(x.i.dueDate, ctx.timezone)!) : ""), href: "invoice.html?id=" + enc(x.i.id), tone: x.m.displayStatus === "overdue" ? ("critical" as const) : ("warning" as const) })),
    ];
    return {
      kind: "answer",
      args: { ...args, customer_id: c.id },
      card: {
        title: c.name,
        subtitle: [TYPE_PT[row?.customerType || ""] || row?.customerType, row?.phone, row?.email].filter(Boolean).join(" · "),
        sections: [
          { type: "fields", rows: [{ label: "Endereço", value: row?.address || "—" }, { label: "Cliente desde", value: row ? fmtDate(dayIn(row.createdAt, ctx.timezone)!) : "—" }] },
          { type: "totals", rows: [{ label: "Jobs", value: `${jobs.length} (${activeJobs.length} em andamento)` }, { label: "Quotes em aberto", value: `${openQuotes.length} · ${money(openQuotes.reduce((s, q) => s + Number(q.total), 0))}` }, { label: "Faturado", value: money(billed) }, { label: "Deve", value: money(owed), strong: true }] },
          { type: "list", items, empty: "Nada em aberto." },
        ],
        open: customerLink(c.id),
      },
    };
  },
};

/* ───────────────────────── address ───────────────────────── */

export const addCustomerAddress: ActionDef = {
  name: "customer.address",
  description: "Add an address (property) to a customer, e.g. a second house.",
  args: { customer: "customer name", line1: "street and number", city: "city", state: "state (2 letters)", postal_code: "ZIP", label: "e.g. 'Casa da praia'" },
  examples: ["Adiciona o endereço 45 Oak St na ficha do John", "Add 12 Pine Rd, Denver CO 80202 to Mike as the rental"],
  permissions: ["customers.edit"],
  async prepare(ctx, args) {
    const got = await customerOr(ctx, args);
    if (got.done) return got.done;
    const c = got.customer!;
    const line1 = str(args.line1 || args.address, 200);
    if (!line1) return { kind: "clarify", args: { ...args, customer_id: c.id }, clarify: { question: "Qual o endereço?", options: [], search: { placeholder: "Rua e número", path: "line1" } } };
    const body = { line1, city: str(args.city, 80), state: str(args.state, 20).toUpperCase(), postal_code: str(args.postal_code, 12), label: str(args.label, 60) || null };
    return {
      kind: "card",
      args: { ...args, customer_id: c.id },
      card: {
        title: "Novo endereço de " + c.name,
        sections: [{ type: "fields", rows: [{ label: "Endereço", value: line1, edit: { path: "line1", input: "text", value: line1 } }, { label: "Cidade", value: [body.city, body.state, body.postal_code].filter(Boolean).join(", ") || "—", edit: { path: "city", input: "text", value: body.city } }, { label: "Nome", value: body.label || "—", edit: { path: "label", input: "text", value: body.label } }] }],
        confirm: { label: "Adicionar endereço", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ customer_id: c.id, name: c.name, body }) } } },
        open: customerLink(c.id),
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi(ctx.req, "POST", `/api/customers/${enc(String(exec.customer_id))}/properties`, exec.body);
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível adicionar o endereço.") };
    return { ok: true, title: `Endereço adicionado a ${exec.name}`, detail: String((exec.body as { line1: string }).line1), links: [customerLink(String(exec.customer_id))], entity: { type: "customer", id: String(exec.customer_id) }, memory: `Added address to ${exec.name}` };
  },
};

/* ───────────────────────── referral link ───────────────────────── */

export const referralLink: ActionDef = {
  name: "customer.referral",
  description: "Get a customer's referral link with the message ready to send by WhatsApp or SMS (Particular customers only).",
  args: { customer: "customer name" },
  examples: ["Manda o link de indicação para o John", "Referral link for Ana"],
  permissions: ["customers.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const got = await customerOr(ctx, args);
    if (got.done) return got.done;
    const c = got.customer!;
    const res = await callInternalApi<{ data?: { url: string; message: string; whatsapp_url: string } }>(ctx.req, "GET", `/api/customers/${enc(c.id)}/referral-link`);
    const d = res.json.data;
    if (!res.ok || !d) return { kind: "error", message: internalError(res, "Não foi possível gerar o link."), args };
    const digits = (c.phone || "").replace(/\D/g, "");
    const e164 = digits.length === 10 ? "1" + digits : digits;
    return {
      kind: "answer",
      args: { ...args, customer_id: c.id },
      card: {
        title: "Link de indicação · " + c.name,
        sections: [{ type: "note", text: d.message }],
        links: [
          ...(digits ? [{ label: "Abrir SMS", href: `sms:${digits}?&body=${enc(d.message)}` }, { label: "WhatsApp", href: `https://wa.me/${e164}?text=${enc(d.message)}` }] : [{ label: "WhatsApp", href: d.whatsapp_url }]),
          ...(c.email ? [{ label: "E-mail", href: `mailto:${c.email}?body=${enc(d.message)}` }] : []),
          { label: "Abrir link", href: d.url },
        ],
        open: customerLink(c.id),
      },
    };
  },
};

/* ───────────────────────── duplicates + merge ───────────────────────── */

export const customerDuplicates: ActionDef = {
  name: "customers.duplicates",
  description: "Find customers that look duplicated (same name, e-mail or phone), with a merge button per pair.",
  args: {},
  examples: ["Tem cliente duplicado?", "Find duplicate customers"],
  permissions: ["customers.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const res = await callInternalApi<{ data?: Array<{ reason: string; key: string; customers: Array<{ id: string; name: string; email?: string | null; phone?: string | null; created_at?: string }> }> }>(ctx.req, "GET", "/api/customers/duplicates");
    const groups = res.json.data || [];
    if (!res.ok) return { kind: "error", message: internalError(res, "Não foi possível procurar duplicados."), args };
    const reasonPt: Record<string, string> = { name: "mesmo nome", email: "mesmo e-mail", phone: "mesmo telefone" };
    const items: ListItem[] = groups.slice(0, 15).map((g) => {
      const [keep, dup] = g.customers;
      return {
        title: g.customers.map((c) => c.name).join(" + "),
        detail: (reasonPt[g.reason] || g.reason) + " · " + g.key,
        tone: "warning",
        run: keep && dup ? { label: "Mesclar", action: "customer.merge", args: { keep_id: keep.id, merge_id: dup.id } } : undefined,
      };
    });
    return { kind: "answer", args, card: { title: groups.length ? `${plural(groups.length, "possível duplicado", "possíveis duplicados")}` : "Nenhum cliente duplicado", sections: [{ type: "list", items, empty: "Tudo certo." }], open: { label: "Abrir Clientes", href: "customers.html" } } };
  },
};

export const mergeCustomers: ActionDef = {
  name: "customer.merge",
  description: "Merge two customer records: quotes, jobs, invoices, visits and addresses of the second move to the first, and the second is removed.",
  args: { keep: "customer to keep", merge: "customer to merge into it" },
  examples: ["Mescla o John Smith duplicado", "Merge Jon Smith into John Smith"],
  permissions: ["customers.edit"],
  async prepare(ctx, args) {
    const keepR = await resolveCustomer(ctx, { customer_id: args.keep_id, customer: args.keep });
    if (keepR.status === "clarify") return { kind: "clarify", clarify: { ...keepR.clarify, options: keepR.clarify.options.map((o) => ({ ...o, patch: { keep_id: o.patch.customer_id } })) }, args };
    if (keepR.status === "missing") return { kind: "error", message: "Qual cliente fica?", args };
    const mergeR = await resolveCustomer(ctx, { customer_id: args.merge_id, customer: args.merge });
    if (mergeR.status === "clarify") return { kind: "clarify", clarify: { ...mergeR.clarify, options: mergeR.clarify.options.map((o) => ({ ...o, patch: { merge_id: o.patch.customer_id } })) }, args: { ...args, keep_id: keepR.row.id } };
    if (mergeR.status === "missing") return { kind: "error", message: "Qual cliente deve ser mesclado?", args };
    const keep = keepR.row;
    const dup = mergeR.row;
    if (keep.id === dup.id) return { kind: "error", message: "São o mesmo cadastro.", args };
    const [q, j, i] = await Promise.all([
      ctx.tx.quote.count({ where: { customerId: dup.id } }),
      ctx.tx.workOrder.count({ where: { customerId: dup.id } }),
      ctx.tx.quoteInvoice.count({ where: { customerId: dup.id } }),
    ]);
    return {
      kind: "card",
      args: { ...args, keep_id: keep.id, merge_id: dup.id },
      card: {
        title: `Mesclar ${dup.name} em ${keep.name}`,
        badge: { text: "Não dá para desfazer", tone: "critical" },
        sections: [
          { type: "table", columns: ["", "Fica", "Sai"], rows: [["Nome", keep.name, dup.name], ["E-mail", keep.email || "—", dup.email || "—"], ["Telefone", keep.phone || "—", dup.phone || "—"]] },
          { type: "note", text: `Passam para ${keep.name}: ${plural(q, "quote", "quotes")}, ${plural(j, "job", "jobs")}, ${plural(i, "invoice", "invoices")}, visitas e endereços. Dados vazios de quem fica são completados com os de quem sai.` },
        ],
        confirm: { label: "Mesclar clientes", tone: "normal", checkbox: `Apagar ${dup.name} depois de mesclar`, exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ keep_id: keep.id, merge_id: dup.id, keep: keep.name, dup: dup.name }) } } },
        open: customerLink(keep.id),
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi(ctx.req, "POST", "/api/customers/merge", { keep_id: exec.keep_id, merge_id: exec.merge_id });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível mesclar.") };
    return { ok: true, title: `${exec.dup} mesclado em ${exec.keep}`, links: [customerLink(String(exec.keep_id))], entity: { type: "customer", id: String(exec.keep_id) }, memory: `Merged customer ${exec.dup} into ${exec.keep}` };
  },
};

export const CUSTOMER_MORE_ACTIONS: ActionDef[] = [updateCustomer, customerOverview, addCustomerAddress, referralLink, customerDuplicates, mergeCustomers];
