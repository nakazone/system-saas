/**
 * Leads beyond create/stage: calls and notes, follow-ups, stale and new leads, conversion to
 * customer, qualification and the referral coupon. Writes go through the lead routes.
 */
import { callInternalApi, internalError } from "../internal-api.js";
import { resolveLead } from "./resolve.js";
import { addDays, dayRange, fmtDate, isIsoDay } from "./time.js";
import type { ActionContext, ActionDef, ListItem } from "./types.js";
import { dayIn, num, plural, str } from "./types.js";

const enc = encodeURIComponent;

function leadLink(id: string) {
  return { label: "Abrir lead", href: "lead-detail.html?id=" + enc(id) };
}

const INTERACTION_PT: Record<string, string> = { call: "Ligação", whatsapp: "WhatsApp", sms: "SMS", email: "E-mail", visit: "Visita", meeting: "Reunião", note: "Nota" };

function interactionType(v: unknown): string {
  const t = str(v, 20).toLowerCase();
  if (/lig|call|phone|telefon/.test(t)) return "call";
  if (/whats|zap/.test(t)) return "whatsapp";
  if (/sms|texto|text/.test(t)) return "sms";
  if (/mail/.test(t)) return "email";
  if (/visit/.test(t)) return "visit";
  if (/reuni|meet/.test(t)) return "meeting";
  return t in INTERACTION_PT ? t : "note";
}

async function resolveLeadOr(ctx: ActionContext, args: Record<string, unknown>) {
  const r = await resolveLead(ctx, args);
  if (r.status === "clarify") return { done: { kind: "clarify" as const, clarify: r.clarify, args } };
  if (r.status === "missing") return { done: { kind: "error" as const, message: r.message, args } };
  return { lead: r.row };
}

/* ───────────────────────── log a contact (+ follow-up) ───────────────────────── */

export const logLeadContact: ActionDef = {
  name: "lead.log",
  description:
    "Record a contact with a lead (call, WhatsApp, e-mail, visit or a note) in its history, optionally with a follow-up date (\"ela pediu retorno sexta\").",
  args: {
    lead: "lead name",
    type: "call | whatsapp | sms | email | visit | meeting | note",
    notes: "what was said",
    followup_date: "YYYY-MM-DD if a next contact was agreed (optional)",
    followup_title: "what to do then (optional)",
  },
  examples: ["Liguei pra Ana, ela pediu orçamento até sexta", "Mandei WhatsApp pro Carlos com as fotos", "Called Mark, he wants to start in December"],
  permissions: ["leads.edit"],
  async prepare(ctx, args) {
    const got = await resolveLeadOr(ctx, args);
    if (got.done) return got.done;
    const lead = got.lead!;
    const type = interactionType(args.type);
    const notes = str(args.notes, 1000);
    const follow = isIsoDay(args.followup_date) ? String(args.followup_date) : null;
    const followTitle = str(args.followup_title, 120) || (type === "call" ? "Retornar a ligação" : "Retomar contato");
    const exec = { lead_id: lead.id, name: lead.name, type, notes, follow, followTitle };
    return {
      kind: "card",
      args: { ...args, lead_id: lead.id, type },
      card: {
        title: "Registrar contato com " + lead.name,
        sections: [
          {
            type: "fields",
            rows: [
              { label: "Tipo", value: INTERACTION_PT[type]!, edit: { path: "type", input: "select", value: type, options: Object.entries(INTERACTION_PT).map(([value, label]) => ({ value, label })) } },
              { label: "O que foi dito", value: notes || "—", edit: { path: "notes", input: "text", value: notes } },
              { label: "Retorno", value: follow ? fmtDate(follow) + " · " + followTitle : "sem retorno", edit: { path: "followup_date", input: "date", value: follow } },
            ],
          },
        ],
        confirm: { label: follow ? "Registrar e agendar retorno" : "Registrar contato", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign(exec) } } },
        open: leadLink(lead.id),
      },
    };
  },
  async execute(ctx, exec) {
    const id = enc(String(exec.lead_id));
    const res = await callInternalApi(ctx.req, "POST", `/api/leads/${id}/interactions`, { type: exec.type, notes: exec.notes || null, subject: INTERACTION_PT[String(exec.type)] || null });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível registrar o contato.") };
    if (exec.follow) {
      const f = await callInternalApi(ctx.req, "POST", `/api/leads/${id}/followups`, { title: exec.followTitle, due_date: exec.follow, description: exec.notes || null });
      if (!f.ok) return { ok: false, status: f.status, error: internalError(f, "Contato registrado, mas o retorno não foi agendado.") };
    }
    return {
      ok: true,
      title: `${INTERACTION_PT[String(exec.type)]} com ${exec.name} registrada` + (exec.follow ? ` · retorno ${fmtDate(String(exec.follow))}` : ""),
      links: [leadLink(String(exec.lead_id))],
      entity: { type: "lead", id: String(exec.lead_id) },
      memory: `Logged ${exec.type} with lead ${exec.name}` + (exec.follow ? `, follow-up ${exec.follow}` : ""),
    };
  },
};

/* ───────────────────────── follow-up reminder ───────────────────────── */

export const leadFollowup: ActionDef = {
  name: "lead.followup",
  description: "Create a follow-up reminder for a lead on a date (\"me lembra de ligar pro Carlos quinta\").",
  args: { lead: "lead name", due_date: "YYYY-MM-DD", title: "what to do (e.g. 'Ligar')", priority: "low | medium | high" },
  examples: ["Me lembra de ligar pro Carlos quinta", "Follow up with Mark next Monday"],
  permissions: ["leads.edit"],
  async prepare(ctx, args) {
    const got = await resolveLeadOr(ctx, args);
    if (got.done) return got.done;
    const lead = got.lead!;
    const a = { ...args, lead_id: lead.id };
    if (!isIsoDay(args.due_date)) {
      return {
        kind: "clarify",
        args: a,
        clarify: { question: `Quando lembrar de ${lead.name}?`, options: [1, 2, 7].map((d) => ({ label: d === 1 ? "Amanhã" : `Em ${d} dias`, detail: fmtDate(addDays(ctx.today, d)), patch: { due_date: addDays(ctx.today, d) } })) },
      };
    }
    const title = str(args.title, 120) || "Ligar para " + lead.name.split(" ")[0];
    const priority = ["low", "medium", "high"].includes(str(args.priority)) ? str(args.priority) : "medium";
    return {
      kind: "card",
      args: a,
      card: {
        title: "Lembrete: " + title,
        subtitle: lead.name,
        sections: [
          {
            type: "fields",
            rows: [
              { label: "Quando", value: fmtDate(String(args.due_date)), edit: { path: "due_date", input: "date", value: String(args.due_date) } },
              { label: "O quê", value: title, edit: { path: "title", input: "text", value: title } },
              { label: "Prioridade", value: { low: "Baixa", medium: "Média", high: "Alta" }[priority]!, edit: { path: "priority", input: "select", value: priority, options: [{ value: "low", label: "Baixa" }, { value: "medium", label: "Média" }, { value: "high", label: "Alta" }] } },
            ],
          },
        ],
        confirm: { label: "Criar lembrete", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ lead_id: lead.id, name: lead.name, title, due: args.due_date, priority }) } } },
        open: leadLink(lead.id),
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi(ctx.req, "POST", `/api/leads/${enc(String(exec.lead_id))}/followups`, { title: exec.title, due_date: exec.due, priority: exec.priority });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível criar o lembrete.") };
    return { ok: true, title: `Lembrete para ${fmtDate(String(exec.due))}: ${exec.title}`, links: [leadLink(String(exec.lead_id))], entity: { type: "lead", id: String(exec.lead_id) }, memory: `Follow-up for ${exec.name} on ${exec.due}` };
  },
};

/* ───────────────────────── stale and new leads (answers) ───────────────────────── */

const openLeadWhere = { lostAt: null, NOT: { pipelineStage: { isClosed: true } } } as const;

export const staleLeads: ActionDef = {
  name: "leads.stale",
  description: "List open leads with no contact for N days (default 7), oldest first, with a follow-up button.",
  args: { days: "days without contact (default 7)" },
  examples: ["Quais leads estão parados há mais de 7 dias?", "Leads sem contato", "Which leads went cold?"],
  permissions: ["leads.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const days = Math.max(1, Math.round(num(args.days) ?? 7));
    const cutoff = new Date(Date.now() - days * 864e5);
    const rows = await ctx.tx.lead.findMany({
      where: { ...openLeadWhere, OR: [{ lastContactedAt: { lt: cutoff } }, { lastContactedAt: null, createdAt: { lt: cutoff } }] },
      select: { id: true, name: true, phone: true, lastContactedAt: true, createdAt: true, pipelineStage: { select: { name: true } } },
      orderBy: [{ lastContactedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
      take: 30,
    });
    const items: ListItem[] = rows.map((l) => {
      const last = l.lastContactedAt || l.createdAt;
      const since = Math.round((Date.now() - last.getTime()) / 864e5);
      return {
        title: l.name,
        detail: [l.pipelineStage?.name, l.lastContactedAt ? `sem contato há ${since} dias` : `criado há ${since} dias, nunca contatado`].filter(Boolean).join(" · "),
        meta: l.phone || undefined,
        href: "lead-detail.html?id=" + enc(l.id),
        tone: since > days * 2 ? "critical" : "warning",
        run: { label: "Lembrete", action: "lead.followup", args: { lead_id: l.id, due_date: ctx.today } },
      };
    });
    return {
      kind: "answer",
      args,
      card: { title: rows.length ? `${plural(rows.length, "lead parado", "leads parados")} há mais de ${days} dias` : `Nenhum lead parado há mais de ${days} dias`, sections: [{ type: "list", items, empty: "Todos os leads abertos tiveram contato recente." }], open: { label: "Abrir Leads", href: "leads.html" } },
    };
  },
};

export const newLeads: ActionDef = {
  name: "leads.new",
  description: "List leads that came in today, this week or this month, with their source.",
  args: { period: "today | this_week | this_month (default today)" },
  examples: ["Quais leads entraram hoje e de onde vieram?", "Leads novos da semana", "New leads this month"],
  permissions: ["leads.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const period = ["today", "this_week", "this_month"].includes(str(args.period)) ? str(args.period) : "today";
    const from = period === "today" ? ctx.today : period === "this_week" ? addDays(ctx.today, -((new Date(ctx.today + "T12:00:00Z").getUTCDay() + 6) % 7)) : ctx.today.slice(0, 8) + "01";
    const { start } = dayRange(from, ctx.today, ctx.timezone);
    const rows = await ctx.tx.lead.findMany({
      where: { createdAt: { gte: start } },
      select: { id: true, name: true, source: true, phone: true, createdAt: true, notes: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const bySource = new Map<string, number>();
    for (const l of rows) bySource.set(l.source || "sem origem", (bySource.get(l.source || "sem origem") || 0) + 1);
    const label = { today: "hoje", this_week: "esta semana", this_month: "este mês" }[period]!;
    return {
      kind: "answer",
      args: { ...args, period },
      card: {
        title: rows.length ? `${plural(rows.length, "lead novo", "leads novos")} ${label}` : `Nenhum lead novo ${label}`,
        subtitle: [...bySource.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}: ${n}`).join(" · ") || undefined,
        sections: [
          {
            type: "list",
            items: rows.map((l) => ({ title: l.name, detail: [l.source || "sem origem", fmtDate(dayIn(l.createdAt, ctx.timezone)!)].join(" · "), meta: l.notes?.slice(0, 80) || l.phone || undefined, href: "lead-detail.html?id=" + enc(l.id) })),
            empty: "Nada por aqui.",
          },
        ],
        open: { label: "Abrir Leads", href: "leads.html" },
      },
    };
  },
};

/* ───────────────────────── convert to customer ───────────────────────── */

const TYPE_PT: Record<string, string> = { particular: "Particular", builder: "Builder / construtora", contractor: "Contractor", loja: "Loja" };

export const convertLead: ActionDef = {
  name: "lead.convert",
  description: "Turn a lead that closed into a customer, keeping its history.",
  args: { lead: "lead name", customer_type: "particular | builder | contractor | loja" },
  examples: ["A Ana fechou, transforma em cliente", "Convert Mark to a customer"],
  permissions: ["customers.create"],
  async prepare(ctx, args) {
    const got = await resolveLeadOr(ctx, args);
    if (got.done) return got.done;
    const lead = got.lead!;
    const existing = await ctx.tx.customer.findFirst({ where: { leadId: lead.id }, select: { id: true, name: true } });
    if (existing) {
      return { kind: "answer", args, card: { title: `${lead.name} já é cliente`, sections: [{ type: "note", text: "O cadastro de cliente já existe." }], open: { label: "Abrir cliente", href: "customers.html?id=" + enc(existing.id) } } };
    }
    const type = str(args.customer_type) in TYPE_PT ? str(args.customer_type) : "particular";
    return {
      kind: "card",
      args: { ...args, lead_id: lead.id, customer_type: type },
      card: {
        title: `Transformar ${lead.name} em cliente`,
        sections: [
          {
            type: "fields",
            rows: [
              { label: "Telefone", value: lead.phone || "—" },
              { label: "E-mail", value: lead.email || "—" },
              { label: "Tipo", value: TYPE_PT[type]!, edit: { path: "customer_type", input: "select", value: type, options: Object.entries(TYPE_PT).map(([value, label]) => ({ value, label })) } },
            ],
          },
          { type: "note", text: "O histórico do lead (contatos, visitas, quotes) fica ligado ao cliente." },
        ],
        confirm: { label: "Criar cliente", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ lead_id: lead.id, name: lead.name, type }) } } },
        open: leadLink(lead.id),
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi<{ data?: { id: string } }>(ctx.req, "POST", "/api/customers/from-lead", { lead_id: exec.lead_id, customer_type: exec.type });
    const id = res.json.data?.id;
    if (!res.ok || !id) return { ok: false, status: res.status, error: internalError(res, "Não foi possível criar o cliente.") };
    return {
      ok: true,
      title: `${exec.name} agora é cliente`,
      links: [{ label: "Abrir cliente", href: "customers.html?id=" + enc(id) }],
      next: { label: "Criar Quote", action: "quote.create", args: { customer_id: id } },
      entity: { type: "customer", id },
      memory: `Converted lead ${exec.name} to customer`,
    };
  },
};

/* ───────────────────────── qualification ───────────────────────── */

const QUAL_FIELDS: Record<string, string> = {
  service_type: "Serviço",
  property_type: "Imóvel",
  estimated_area: "Área (sq ft)",
  estimated_budget: "Orçamento ($)",
  decision_timeline: "Prazo",
  urgency: "Urgência",
  decision_maker: "Quem decide",
  payment_type: "Pagamento",
  qualification_notes: "Notas",
};

export const qualifyLead: ActionDef = {
  name: "lead.qualify",
  description: "Fill the lead's qualification: area, budget, timeline, service, property, urgency, decision maker. Keeps what was already filled.",
  args: {
    lead: "lead name",
    estimated_area: "sq ft number",
    estimated_budget: "dollars number",
    decision_timeline: "when they want it (e.g. 'dezembro')",
    service_type: "e.g. hardwood, carpet, LVP",
    property_type: "house | apartment | commercial",
    urgency: "low | medium | high",
    decision_maker: "who decides",
    payment_type: "cash | financing | insurance",
    qualification_notes: "anything else",
  },
  examples: ["Qualifica a Ana: 900 sqft, orçamento 8 mil, para dezembro", "Mark has a 1200 sqft house, budget 15k, wants it before Christmas"],
  permissions: ["leads.edit"],
  async prepare(ctx, args) {
    const got = await resolveLeadOr(ctx, args);
    if (got.done) return got.done;
    const lead = got.lead!;
    const row = await ctx.tx.lead.findFirst({ where: { id: lead.id }, select: { metadata: true } });
    const meta = row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? (row.metadata as Record<string, unknown>) : {};
    const before = (meta.qualification && typeof meta.qualification === "object" ? meta.qualification : {}) as Record<string, unknown>;
    const next: Record<string, unknown> = { ...before };
    const changed: string[] = [];
    for (const k of Object.keys(QUAL_FIELDS)) {
      if (args[k] === undefined || args[k] === null || args[k] === "") continue;
      const v = k === "estimated_area" || k === "estimated_budget" ? num(args[k]) : str(args[k], 300);
      if (v === null || v === "") continue;
      next[k] = v;
      changed.push(k);
    }
    if (!changed.length) return { kind: "error", message: "O que devo anotar na qualificação? Ex.: área, orçamento, prazo.", args: { ...args, lead_id: lead.id } };
    delete next.updated_at;
    const rows = Object.keys(QUAL_FIELDS)
      .filter((k) => next[k] !== undefined && next[k] !== null && next[k] !== "")
      .map((k) => ({
        label: QUAL_FIELDS[k]!,
        value: (k === "estimated_budget" ? "$" + Number(next[k]).toLocaleString("en-US") : String(next[k])) + (changed.includes(k) ? (before[k] != null && before[k] !== "" ? ` (era ${before[k]})` : " · novo") : ""),
      }));
    return {
      kind: "card",
      args: { ...args, lead_id: lead.id },
      card: {
        title: "Qualificação de " + lead.name,
        sections: [{ type: "fields", rows }],
        confirm: { label: "Salvar qualificação", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ lead_id: lead.id, name: lead.name, q: next }) } } },
        open: leadLink(lead.id),
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi(ctx.req, "POST", `/api/leads/${enc(String(exec.lead_id))}/qualification`, exec.q);
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível salvar a qualificação.") };
    return { ok: true, title: `Qualificação de ${exec.name} salva`, links: [leadLink(String(exec.lead_id))], entity: { type: "lead", id: String(exec.lead_id) }, memory: `Qualified lead ${exec.name}` };
  },
};

/* ───────────────────────── referral coupon ───────────────────────── */

export const leadCoupon: ActionDef = {
  name: "lead.coupon",
  description: "Apply the company's coupon discount to the lead's open quote: creates a discounted copy and marks it sent.",
  args: { lead: "lead name" },
  examples: ["Aplica o cupom de indicação na proposta da Ana", "Give Mark the coupon discount"],
  permissions: ["leads.edit"],
  async prepare(ctx, args) {
    const got = await resolveLeadOr(ctx, args);
    if (got.done) return got.done;
    const lead = got.lead!;
    const quote = await ctx.tx.quote.findFirst({ where: { leadId: lead.id, NOT: { status: { in: ["archived", "approved", "converted"] } } }, orderBy: { updatedAt: "desc" }, select: { quoteNumber: true, number: true, total: true } });
    if (!quote) return { kind: "error", message: `${lead.name} não tem Quote em aberto para aplicar o cupom.`, args };
    return {
      kind: "card",
      args: { ...args, lead_id: lead.id },
      card: {
        title: "Aplicar cupom no Quote de " + lead.name,
        badge: { text: "Vai para o cliente", tone: "warning" },
        sections: [
          { type: "fields", rows: [{ label: "Quote", value: (quote.quoteNumber || "#" + quote.number) + " · " + "$" + Number(quote.total).toLocaleString("en-US", { minimumFractionDigits: 2 }) }] },
          { type: "note", text: "Cria uma cópia com o desconto do cupom (definido em Configurações) e marca como enviada. O Quote original não muda." },
        ],
        confirm: { label: "Aplicar cupom", tone: "send", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ lead_id: lead.id, name: lead.name }) } } },
        open: leadLink(lead.id),
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi<{ quote_id?: string; quote_number?: string; discount_percent?: number; total?: number }>(ctx.req, "POST", `/api/leads/${enc(String(exec.lead_id))}/apply-coupon-discount`, {});
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível aplicar o cupom.") };
    const d = res.json;
    return {
      ok: true,
      title: `Cupom de ${d.discount_percent ?? ""}% aplicado · ${d.quote_number || "novo Quote"}`,
      detail: d.total != null ? "Novo total $" + Number(d.total).toLocaleString("en-US", { minimumFractionDigits: 2 }) : undefined,
      links: d.quote_id ? [{ label: "Abrir Quote", href: "quote-builder.html?id=" + enc(d.quote_id) }] : [],
      entity: d.quote_id ? { type: "quote", id: d.quote_id } : { type: "lead", id: String(exec.lead_id) },
      memory: `Applied coupon to ${exec.name}'s quote`,
    };
  },
};

export const LEAD_MORE_ACTIONS: ActionDef[] = [logLeadContact, leadFollowup, staleLeads, newLeads, convertLead, qualifyLead, leadCoupon];
