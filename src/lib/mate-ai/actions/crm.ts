import { callInternalApi, internalError } from "../internal-api.js";
import { nameSimilarity } from "../match.js";
import { resolveLead, resolveStage } from "./resolve.js";
import { cleanTime, fmtDateTime, isIsoDay, zonedToUtc } from "./time.js";
import type { ActionDef } from "./types.js";
import { str } from "./types.js";

function leadLink(id: string) {
  return { label: "Abrir lead", href: "lead-detail.html?id=" + encodeURIComponent(id) };
}

function customerLink(id: string) {
  return { label: "Abrir cliente", href: "customers.html?id=" + encodeURIComponent(id) };
}

function cleanPhone(v: unknown): string {
  const raw = str(v, 40);
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith("1")) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return raw;
}

function cleanEmail(v: unknown): string {
  const e = str(v, 200).toLowerCase().replace(/\s+/g, "");
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : "";
}

/* ───────────────────────── new lead ───────────────────────── */

export const createLead: ActionDef = {
  name: "lead.create",
  description: "Create a new lead (a potential customer who asked for a service).",
  args: {
    name: "person's name",
    phone: "phone number digits",
    email: "e-mail",
    address: "address if said",
    notes: "what they want (e.g. 'trocar o carpete da sala')",
    source: "where the lead came from if said (google, indicação, facebook…)",
  },
  examples: ["Novo lead: Ana, 720 555 0101, quer trocar o carpete da sala", "New lead Mark Lee, mark@x.com, refinish 600 sqft"],
  permissions: ["leads.create"],
  async prepare(ctx, args) {
    const name = str(args.name, 120);
    if (!name) {
      return { kind: "clarify", args, clarify: { question: "Qual o nome do lead?", options: [], search: { placeholder: "Nome", path: "name" } } };
    }
    const phone = cleanPhone(args.phone);
    const email = cleanEmail(args.email);
    const digits = phone.replace(/\D/g, "");
    const dup = digits.length >= 7 || email
      ? await ctx.tx.lead.findFirst({
          where: {
            OR: [
              ...(digits.length >= 7 ? [{ phone: { contains: digits.slice(-7) } }] : []),
              ...(email ? [{ email: { equals: email, mode: "insensitive" as const } }] : []),
            ],
          },
          select: { id: true, name: true },
        })
      : null;
    const notes = str(args.notes, 2000);
    const address = str(args.address, 300);
    const source = str(args.source, 60);
    const exec = {
      label: name,
      body: { name, phone: phone || null, email: email || null, notes: notes || null, address: address || null, source: source || "mate_ai", check_duplicates: true },
    };
    return {
      kind: "card",
      args,
      card: {
        title: "Novo lead: " + name,
        sections: [
          {
            type: "fields",
            rows: [
              { label: "Nome", value: name, edit: { path: "name", input: "text", value: name } },
              { label: "Telefone", value: phone || "—", edit: { path: "phone", input: "text", value: phone } },
              { label: "E-mail", value: email || "—", edit: { path: "email", input: "text", value: email } },
              ...(address ? [{ label: "Endereço", value: address }] : []),
              { label: "Pedido", value: notes || "—", edit: { path: "notes", input: "text" as const, value: notes } },
              ...(source ? [{ label: "Origem", value: source }] : []),
            ],
          },
          ...(dup ? [{ type: "note" as const, tone: "warning" as const, text: `Já existe um lead com esse telefone/e-mail: ${dup.name}.` }] : []),
        ],
        confirm: { label: "Criar lead", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign(exec) } } },
        ...(dup ? { open: leadLink(dup.id) } : {}),
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi<{ data?: { id: string; name?: string }; duplicate?: { id: string; name?: string } }>(ctx.req, "POST", "/api/leads", exec.body);
    if (res.status === 409 && res.json.duplicate?.id) {
      return { ok: false, status: 409, error: `Já existe o lead ${res.json.duplicate.name || ""} com esse telefone ou e-mail.` };
    }
    if (!res.ok || !res.json.data?.id) return { ok: false, status: res.status, error: internalError(res, "Não foi possível criar o lead.") };
    const id = res.json.data.id;
    return {
      ok: true,
      title: "Lead " + exec.label + " criado",
      links: [leadLink(id)],
      next: { label: "Agendar visita", action: "lead.stage", args: { lead_id: id, stage: "assessment_scheduled" } },
      entity: { type: "lead", id },
      memory: `Created lead ${exec.label}`,
    };
  },
};

/* ───────────────────────── move lead / schedule visit ───────────────────────── */

export const moveLead: ActionDef = {
  name: "lead.stage",
  description:
    "Move a lead to another pipeline stage (contacted, visit scheduled, quote sent, won, lost…). With a date/time it also schedules the visit. For lost, a loss reason can be given.",
  args: {
    lead: "lead name or phone",
    stage: "target stage in the user's words or slug: new | contacted | assessment_scheduled | quote_sent | follow_up | stand_by | won | lost",
    date: "YYYY-MM-DD for a visit",
    time: "HH:MM for a visit",
    loss_reason: "for lost: price | timeline | competitor | no response, or the user's words",
  },
  examples: ["Move a Ana para visita agendada, quinta 10h", "Marca o lead do Paulo como perdido, preço", "Lead Mark contacted"],
  permissions: ["leads.edit"],
  async prepare(ctx, args) {
    const l = await resolveLead(ctx, args);
    if (l.status === "clarify") return { kind: "clarify", clarify: l.clarify, args };
    if (l.status === "missing") return { kind: "error", message: l.message, args };
    const lead = l.row;
    const date = str(args.date);
    let wanted = str(args.stage, 80);
    if (!wanted && isIsoDay(date)) wanted = "assessment_scheduled";
    const { stage, stages } = await resolveStage(ctx, wanted);
    if (!stage) {
      return {
        kind: "clarify",
        args: { ...args, lead_id: lead.id },
        clarify: { question: `Para qual etapa mover ${lead.name}?`, options: stages.map((s) => ({ label: s.name, patch: { stage: s.slug || s.name } })) },
      };
    }
    const slug = stage.slug || "";
    const current = stages.find((s) => s.slug === lead.status);
    const isVisit = slug.startsWith("assessment");
    const time = cleanTime(args.time);
    const visitAt = isVisit && isIsoDay(date) ? zonedToUtc(date, time || "09:00", ctx.timezone) : null;

    let lossReasonId: string | null = null;
    let lossName = "";
    if (slug === "lost") {
      const reasons = await ctx.tx.lossReason.findMany({ where: { isActive: true }, select: { id: true, name: true, slug: true }, orderBy: { sortOrder: "asc" } });
      const said = str(args.loss_reason, 120);
      const SYN: Record<string, RegExp> = {
        price: /pre[cç]o|caro|price|expensive|barato/i,
        timeline: /prazo|tempo|timeline|depois|later/i,
        chose_competitor: /concorr|outro|competitor|outra empresa/i,
        no_response: /respond|sumiu|no response|ghost|n[aã]o atende/i,
      };
      const hit = said
        ? reasons.find((r) => SYN[r.slug]?.test(said)) || reasons.find((r) => nameSimilarity(said, [r.name]) >= 70)
        : undefined;
      if (!hit && reasons.length) {
        return {
          kind: "clarify",
          args: { ...args, lead_id: lead.id, stage: slug },
          clarify: {
            question: `Por que ${lead.name} foi perdido?`,
            options: [...reasons.map((r) => ({ label: r.name, patch: { loss_reason: r.name } })), { label: "Sem motivo", patch: { loss_reason: "-" } }],
          },
        };
      }
      if (hit) {
        lossReasonId = hit.id;
        lossName = hit.name;
      }
    }

    if (slug === lead.status && !visitAt) return { kind: "error", message: `${lead.name} já está em “${stage.name}”.`, args };
    const exec = {
      lead_id: lead.id,
      label: lead.name,
      stage_name: stage.name,
      body: { status: slug, ...(slug === "lost" ? { loss_reason_id: lossReasonId } : {}) },
      visit: visitAt ? { lead_id: lead.id, scheduled_at: visitAt.toISOString(), all_day: !time } : null,
      prev_status: lead.status,
    };
    return {
      kind: "card",
      args: { ...args, lead_id: lead.id, stage: slug },
      card: {
        title: "Mover " + lead.name,
        subtitle: lead.phone || undefined,
        sections: [
          {
            type: "fields",
            rows: [
              { label: "De", value: current?.name || lead.status || "—" },
              { label: "Para", value: stage.name },
              ...(lossName ? [{ label: "Motivo", value: lossName }] : []),
              ...(isVisit
                ? [{ label: "Visita", value: visitAt ? fmtDateTime(visitAt, ctx.timezone, !time) : "sem data", edit: { path: "date", input: "date" as const, value: isIsoDay(date) ? date : "" } }]
                : []),
            ],
          },
          ...(isVisit && !visitAt ? [{ type: "note" as const, text: "Sem data, só muda a etapa. Diga o dia para já agendar a visita." }] : []),
        ],
        confirm: { label: visitAt ? "Mover e agendar visita" : "Mover", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign(exec) } } },
        open: leadLink(lead.id),
      },
    };
  },
  async execute(ctx, exec) {
    const id = encodeURIComponent(String(exec.lead_id));
    const res = await callInternalApi(ctx.req, "PUT", "/api/leads/" + id, exec.body);
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível mover o lead.") };
    let detail = "Etapa: " + exec.stage_name;
    if (exec.visit) {
      const v = await callInternalApi(ctx.req, "POST", "/api/visits", exec.visit);
      if (!v.ok) return { ok: false, status: v.status, error: "Etapa mudou, mas a visita não foi agendada: " + internalError(v, "erro") };
      detail += " · visita " + fmtDateTime(new Date(String((exec.visit as Record<string, unknown>).scheduled_at)), ctx.timezone, Boolean((exec.visit as Record<string, unknown>).all_day));
    }
    return {
      ok: true,
      title: exec.label + " movido",
      detail,
      links: [leadLink(String(exec.lead_id))],
      undo: exec.visit ? undefined : { lead_id: exec.lead_id, status: exec.prev_status },
      entity: { type: "lead", id: String(exec.lead_id) },
      memory: `Moved lead ${exec.label} to ${exec.stage_name}`,
    };
  },
  async undo(ctx, undo) {
    const res = await callInternalApi(ctx.req, "PUT", "/api/leads/" + encodeURIComponent(String(undo.lead_id)), { status: undo.status });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível desfazer.") };
    return { ok: true, title: "Etapa restaurada", entity: { type: "lead", id: String(undo.lead_id) } };
  },
};

/* ───────────────────────── new customer ───────────────────────── */

const TYPE_WORDS: Array<[RegExp, string]> = [
  [/builder|construtor|construtora/i, "builder"],
  [/contractor|empreiteir|contratante/i, "contractor"],
  [/loja|store|shop/i, "loja"],
];

export const createCustomer: ActionDef = {
  name: "customer.create",
  description: "Create a customer (homeowner, builder, contractor or store/loja).",
  args: {
    name: "customer name",
    company: "company name if any",
    customer_type: "particular | builder | contractor | loja",
    phone: "phone",
    email: "e-mail",
    address: "address",
  },
  examples: ["Cadastra o cliente Roberto Alves, builder, roberto@alves.com", "Add customer Jane Doe 303 555 0199"],
  permissions: ["customers.create"],
  async prepare(ctx, args) {
    const name = str(args.name, 120);
    if (!name) return { kind: "clarify", args, clarify: { question: "Qual o nome do cliente?", options: [], search: { placeholder: "Nome", path: "name" } } };
    const rawType = str(args.customer_type, 40).toLowerCase();
    const type = ["particular", "builder", "contractor", "loja"].includes(rawType) ? rawType : TYPE_WORDS.find(([re]) => re.test(rawType))?.[1] || "particular";
    const phone = cleanPhone(args.phone);
    const email = cleanEmail(args.email);
    const company = str(args.company, 120);
    const address = str(args.address, 300);
    const digits = phone.replace(/\D/g, "");
    const similar = await ctx.tx.customer.findMany({
      where: {
        OR: [
          { name: { contains: name.split(" ")[0] || name, mode: "insensitive" } },
          ...(digits.length >= 7 ? [{ phone: { contains: digits.slice(-7) } }] : []),
          ...(email ? [{ email: { equals: email, mode: "insensitive" as const } }] : []),
        ],
      },
      select: { id: true, name: true, phone: true, email: true },
      take: 50,
    });
    const dup = similar.find(
      (c) => nameSimilarity(name, [c.name]) >= 90 || (digits.length >= 7 && (c.phone || "").replace(/\D/g, "").endsWith(digits.slice(-7))) || (email && c.email?.toLowerCase() === email),
    );
    const TYPE_PT: Record<string, string> = { particular: "Particular", builder: "Builder", contractor: "Contractor", loja: "Loja" };
    const exec = { label: name, body: { name, company: company || null, customer_type: type, phone: phone || null, email: email || null, address: address || null } };
    return {
      kind: "card",
      args,
      card: {
        title: "Novo cliente: " + name,
        sections: [
          {
            type: "fields",
            rows: [
              { label: "Nome", value: name, edit: { path: "name", input: "text", value: name } },
              { label: "Tipo", value: TYPE_PT[type]!, edit: { path: "customer_type", input: "select", value: type, options: Object.entries(TYPE_PT).map(([value, label]) => ({ value, label })) } },
              ...(company ? [{ label: "Empresa", value: company }] : []),
              { label: "Telefone", value: phone || "—", edit: { path: "phone", input: "text" as const, value: phone } },
              { label: "E-mail", value: email || "—", edit: { path: "email", input: "text" as const, value: email } },
              ...(address ? [{ label: "Endereço", value: address }] : []),
            ],
          },
          { type: "note", text: "O tipo define a coluna de preços da Tabela de Valores usada nos Quotes." },
          ...(dup ? [{ type: "note" as const, tone: "warning" as const, text: `Já existe um cliente parecido: ${dup.name}${dup.phone ? " · " + dup.phone : ""}.` }] : []),
        ],
        confirm: { label: "Cadastrar cliente", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign(exec) } } },
        ...(dup ? { open: customerLink(dup.id) } : {}),
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi<{ data?: { id: string } }>(ctx.req, "POST", "/api/customers", exec.body);
    if (!res.ok || !res.json.data?.id) return { ok: false, status: res.status, error: internalError(res, "Não foi possível cadastrar o cliente.") };
    const id = res.json.data.id;
    return {
      ok: true,
      title: "Cliente " + exec.label + " cadastrado",
      links: [customerLink(id)],
      next: { label: "Criar Quote", action: "quote.create", args: { customer_id: id, customer_query: exec.label, items: [] } },
      entity: { type: "customer", id },
      memory: `Created customer ${exec.label}`,
    };
  },
};
