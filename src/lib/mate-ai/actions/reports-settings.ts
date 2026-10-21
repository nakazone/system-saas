/**
 * Reports on demand (sales period, referrals, funnel losses, crew earnings) and day-to-day
 * settings (invoice due days, quote validity, the automatic message for new leads, inviting a
 * user — a shortcut, access stays on the screen).
 */
import { callInternalApi, internalError } from "../internal-api.js";
import { addDays, fmtDate, isIsoDay } from "./time.js";
import type { ActionContext, ActionDef } from "./types.js";
import { money, num, plural, str } from "./types.js";

const REPORTS = (tab: string) => ({ label: "Abrir Relatórios", href: "relatorios.html#" + tab });
const SETTINGS = (section: string) => ({ label: "Abrir Configurações", href: "configuracoes.html#" + section });

/** A period said as words: this month, last month, this quarter, this year, or dates. */
function period(ctx: ActionContext, args: Record<string, unknown>): { from: string; to: string; label: string } {
  if (isIsoDay(args.from) && isIsoDay(args.to)) return { from: String(args.from), to: String(args.to), label: `${fmtDate(String(args.from))} a ${fmtDate(String(args.to))}` };
  const p = str(args.period).toLowerCase();
  const y = Number(ctx.today.slice(0, 4));
  const m = Number(ctx.today.slice(5, 7));
  const iso = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10);
  if (/last_month|m[eê]s passado/.test(p)) return { from: iso(y, m - 1, 1), to: iso(y, m, 0), label: "mês passado" };
  if (/quarter|trimestre/.test(p)) {
    const q0 = Math.floor((m - 1) / 3) * 3 + 1;
    return { from: iso(y, q0, 1), to: ctx.today, label: "este trimestre" };
  }
  if (/year|ano/.test(p)) return { from: iso(y, 1, 1), to: ctx.today, label: "este ano" };
  if (/30|last_30/.test(p)) return { from: addDays(ctx.today, -29), to: ctx.today, label: "últimos 30 dias" };
  return { from: iso(y, m, 1), to: ctx.today, label: "este mês" };
}

const PERIOD_ARG = { period: "this_month | last_month | this_quarter | this_year | last_30 (default this_month)", from: "YYYY-MM-DD", to: "YYYY-MM-DD" };

async function report<T>(ctx: ActionContext, kind: string, p: { from: string; to: string }) {
  // The route answers { data: { kind, title, period, result } }; hand back the result as `data`.
  const res = await callInternalApi<{ data?: { result?: T; title?: string } }>(ctx.req, "GET", `/api/reports/${kind}?from=${p.from}&to=${p.to}`);
  return { ...res, json: { ...res.json, data: res.json.data?.result, title: res.json.data?.title } } as typeof res & { json: { data?: T; title?: string } };
}

/* ───────────────────────── sales period ───────────────────────── */

export const salesReport: ActionDef = {
  name: "report.sales",
  description: "Sales summary for a period: new leads, quotes won (count and value), open receivables; opens the report.",
  args: PERIOD_ARG,
  examples: ["Relatório de vendas do trimestre", "Como foram as vendas do mês passado?", "Sales this year"],
  permissions: ["reports.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const p = period(ctx, args);
    const res = await report<{ leads_created: number; quotes_won_count: number; quotes_won_revenue: number; receivables_open: number }>(ctx, "executive", p);
    const d = res.json.data;
    if (!res.ok || !d) return { kind: "error", message: internalError(res, "Não consegui abrir o relatório."), args };
    return {
      kind: "answer",
      args,
      card: {
        title: `Vendas · ${p.label}`,
        subtitle: `${fmtDate(p.from)} a ${fmtDate(p.to)}`,
        sections: [{ type: "totals", rows: [{ label: "Leads novos", value: String(d.leads_created) }, { label: "Quotes fechados", value: String(d.quotes_won_count) }, { label: "Valor fechado", value: money(d.quotes_won_revenue), strong: true }, { label: "Ticket médio", value: d.quotes_won_count ? money(d.quotes_won_revenue / d.quotes_won_count) : "—" }, { label: "A receber hoje", value: money(d.receivables_open) }] }],
        open: REPORTS("vendas"),
      },
    };
  },
};

/* ───────────────────────── referrals ───────────────────────── */

export const referralsRanking: ActionDef = {
  name: "report.referrals",
  description: "Who referred the most customers and how much business their referrals brought.",
  args: {},
  examples: ["Quem mais me indicou clientes?", "Top referrers"],
  permissions: ["customers.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const [byReferrer, rewards] = await Promise.all([
      ctx.tx.customer.groupBy({ by: ["referredByCustomerId"], where: { referredByCustomerId: { not: null } }, _count: { _all: true } }),
      ctx.tx.referralReward.groupBy({ by: ["referrerCustomerId"], _sum: { projectAmount: true, rewardAmount: true } }),
    ]);
    const ids = [...new Set([...byReferrer.map((r) => r.referredByCustomerId!), ...rewards.map((r) => r.referrerCustomerId)])];
    const names = new Map((await ctx.tx.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    const rows = ids
      .map((id) => {
        const n = byReferrer.find((r) => r.referredByCustomerId === id)?._count._all || 0;
        const rw = rewards.find((r) => r.referrerCustomerId === id)?._sum;
        return { id, name: names.get(id) || "Cliente", n, sold: Number(rw?.projectAmount || 0), reward: Number(rw?.rewardAmount || 0) };
      })
      .sort((a, b) => b.n - a.n || b.sold - a.sold)
      .slice(0, 10);
    return {
      kind: "answer",
      args,
      card: {
        title: rows.length ? `${rows[0]!.name} é quem mais indica` : "Ainda não há indicações",
        sections: rows.length ? [{ type: "table", columns: ["Cliente", "Indicados", "Negócio gerado", "Prêmio"], align: ["left", "right", "right", "right"], rows: rows.map((r) => [r.name, String(r.n), money(r.sold), money(r.reward)]) }] : [{ type: "note", text: "Quando um cliente indicado fechar, aparece aqui." }],
        open: { label: "Abrir Indicações", href: "referrals.html" },
      },
    };
  },
};

/* ───────────────────────── funnel losses ───────────────────────── */

export const funnelReport: ActionDef = {
  name: "report.funnel",
  description: "Where leads are lost: conversion by source and the main loss reasons for a period.",
  args: PERIOD_ARG,
  examples: ["Qual etapa do funil mais perde lead?", "Por que estou perdendo clientes?", "Lead conversion by source"],
  permissions: ["reports.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const p = period(ctx, { period: "this_year", ...args });
    const [src, loss] = await Promise.all([
      report<Array<{ source: string; total: number; won: number; lost: number; conversionRate: number }>>(ctx, "conversion-source", p),
      report<Array<{ reason: string; count: number }>>(ctx, "loss-reasons", p),
    ]);
    const sources = (src.json.data || []).sort((a, b) => b.total - a.total).slice(0, 8);
    const reasons = (loss.json.data || []).sort((a, b) => b.count - a.count).slice(0, 6);
    const lost = reasons.reduce((s, r) => s + r.count, 0);
    const top = reasons[0];
    return {
      kind: "answer",
      args,
      card: {
        title: top ? `Maior motivo de perda: ${top.reason} (${Math.round((top.count / Math.max(1, lost)) * 100)}%)` : "Sem leads perdidos no período",
        subtitle: `${p.label} · ${plural(lost, "lead perdido", "leads perdidos")}`,
        sections: [
          ...(reasons.length ? [{ type: "table" as const, columns: ["Motivo", "Leads"], align: ["left", "right"] as Array<"left" | "right">, rows: reasons.map((r) => [r.reason, String(r.count)]) }] : []),
          ...(sources.length ? [{ type: "table" as const, columns: ["Origem", "Leads", "Fechados", "Conversão"], align: ["left", "right", "right", "right"] as Array<"left" | "right">, rows: sources.map((s) => [s.source || "sem origem", String(s.total), String(s.won), Math.round(Number(s.conversionRate) * (Number(s.conversionRate) <= 1 ? 100 : 1)) + "%"]) }] : []),
        ],
        open: REPORTS("vendas"),
      },
    };
  },
};

/* ───────────────────────── crew earnings ───────────────────────── */

export const earningsReport: ActionDef = {
  name: "report.earnings",
  description: "How much each crew member earned in a period (days, earned, paid).",
  args: PERIOD_ARG,
  examples: ["Quanto cada funcionário ganhou no mês?", "Crew earnings last month"],
  permissions: ["payroll.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const p = period(ctx, args);
    const res = await report<{ employees: Array<{ name: string; days: number; earned: number; net: number; paid: number }> }>(ctx, "folha", p);
    const list = (res.json.data?.employees || []).filter((e) => e.days || e.net).sort((a, b) => b.net - a.net);
    if (!res.ok) return { kind: "error", message: internalError(res, "Não consegui abrir o relatório da folha."), args };
    return {
      kind: "answer",
      args,
      card: {
        title: `Equipe · ${p.label}: ${money(list.reduce((s, e) => s + e.net, 0))}`,
        sections: list.length ? [{ type: "table", columns: ["Funcionário", "Dias", "Ganhou", "Pago"], align: ["left", "right", "right", "right"], rows: list.map((e) => [e.name, String(e.days), money(e.net), money(e.paid)]) }] : [{ type: "note", text: "Nenhum dia de trabalho no período." }],
        open: REPORTS("folha"),
      },
    };
  },
};

/* ───────────────────────── settings ───────────────────────── */

export const invoiceDueDefault: ActionDef = {
  name: "settings.invoice_due",
  description: "Set how many days after issue new invoices are due by default (when no due date is given).",
  args: { days: "number of days (0–120)" },
  examples: ["Invoices vencem em 15 dias por padrão", "Default invoice terms net 30"],
  permissions: ["settings.manage"],
  async prepare(ctx, args) {
    const days = num(args.days);
    const cur = await callInternalApi<{ data?: { default_due_days?: number } }>(ctx.req, "GET", "/api/settings/invoices");
    const before = cur.json.data?.default_due_days ?? 1;
    if (days == null || days < 0 || days > 120) return { kind: "clarify", args, clarify: { question: `Hoje vencem em ${plural(before, "dia", "dias")}. Quantos dias de prazo?`, options: [7, 15, 30].map((d) => ({ label: d + " dias", patch: { days: d } })) } };
    return {
      kind: "card",
      args,
      card: { title: `Prazo padrão das invoices: ${plural(Math.round(days), "dia", "dias")}`, sections: [{ type: "fields", rows: [{ label: "Antes", value: plural(before, "dia", "dias") }, { label: "Novo", value: plural(Math.round(days), "dia", "dias") }] }, { type: "note", text: "Vale para as próximas invoices sem vencimento escolhido. As já emitidas não mudam." }], confirm: { label: "Salvar", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ days: Math.round(days), before }) } } }, open: SETTINGS("faturas-baixa") },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi(ctx.req, "PATCH", "/api/settings/invoices", { default_due_days: exec.days });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não consegui salvar.") };
    return { ok: true, title: `Invoices agora vencem em ${plural(Number(exec.days), "dia", "dias")}`, undo: { days: exec.before }, memory: `Default invoice due days set to ${exec.days}` };
  },
  async undo(ctx, u) {
    const res = await callInternalApi(ctx.req, "PATCH", "/api/settings/invoices", { default_due_days: u.days });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não consegui desfazer.") };
    return { ok: true, title: "Prazo anterior restaurado" };
  },
};

export const quoteValidity: ActionDef = {
  name: "settings.quote_validity",
  description: "Set how many days new quotes stay valid.",
  args: { days: "number of days" },
  examples: ["Muda a validade dos quotes para 30 dias", "Quotes valid for 15 days"],
  permissions: ["settings.manage"],
  async prepare(ctx, args) {
    const days = num(args.days);
    const cur = await callInternalApi<{ data?: { validity_days?: number } }>(ctx.req, "GET", "/api/settings/quotes");
    const before = cur.json.data?.validity_days ?? null;
    if (!days || days < 1 || days > 365) return { kind: "clarify", args, clarify: { question: `Hoje ${before ? "valem " + before + " dias" : "sem padrão"}. Quantos dias de validade?`, options: [15, 30, 60].map((d) => ({ label: d + " dias", patch: { days: d } })) } };
    return {
      kind: "card",
      args,
      card: { title: `Validade dos quotes: ${Math.round(days)} dias`, sections: [{ type: "fields", rows: [{ label: "Antes", value: before ? before + " dias" : "—" }, { label: "Novo", value: Math.round(days) + " dias" }] }, { type: "note", text: "Vale para os próximos quotes." }], confirm: { label: "Salvar", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ days: Math.round(days), before }) } } }, open: SETTINGS("orcamentos") },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi(ctx.req, "PATCH", "/api/settings/quotes", { validity_days: exec.days });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não consegui salvar.") };
    return { ok: true, title: `Quotes valem ${exec.days} dias`, undo: exec.before ? { days: exec.before } : undefined, memory: `Quote validity set to ${exec.days} days` };
  },
  async undo(ctx, u) {
    const res = await callInternalApi(ctx.req, "PATCH", "/api/settings/quotes", { validity_days: u.days });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não consegui desfazer.") };
    return { ok: true, title: "Validade anterior restaurada" };
  },
};

type LeadMsgs = { company_name: string | null; default_email_subject: string | null; coupon_enabled: boolean; coupon_code: string | null; coupon_label: string | null; coupon_percent: number; coupon_sms_line: string | null; stages: Array<{ slug: string; label: string; email_subject: string | null; templates: Array<{ id: string; label: string; body: string; on_send_action: unknown }> }> };

const STAGE_WORDS: Array<[RegExp, string]> = [
  [/novo|new/i, "new_lead"],
  [/contat/i, "contacted"],
  [/visita|reuni|meeting/i, "meeting_scheduled"],
  [/quote|orçamento|proposta/i, "quote_sent"],
  [/follow|retorno/i, "follow_up_1"],
  [/stand|espera|pausa/i, "stand_by"],
  [/fech|won|ganh/i, "won"],
  [/perd|lost/i, "lost"],
];

export const leadMessage: ActionDef = {
  name: "settings.lead_message",
  description: "Change the ready message (SMS/WhatsApp/e-mail template) used for leads at a stage of the funnel (default: new lead). Placeholders like [name] stay as they are.",
  args: { stage: "new lead | contacted | visit | quote sent | follow up | stand by | won | lost (default new lead)", text: "the new message" },
  examples: ["Muda a mensagem automática para lead novo: Oi [name], obrigado pelo contato!", "Change the quote-sent message"],
  permissions: ["settings.manage"],
  async prepare(ctx, args) {
    const res = await callInternalApi<{ data?: LeadMsgs }>(ctx.req, "GET", "/api/settings/lead-messages");
    const d = res.json.data;
    if (!res.ok || !d) return { kind: "error", message: internalError(res, "Não consegui abrir as mensagens."), args };
    const slug = STAGE_WORDS.find(([rx]) => rx.test(str(args.stage)))?.[1] || "new_lead";
    const stage = d.stages.find((s) => s.slug === slug);
    if (!stage) return { kind: "error", message: "Etapa não encontrada.", args };
    const before = stage.templates[0]?.body || "";
    const text = str(args.text, 2000);
    if (!text) return { kind: "clarify", args: { ...args, stage: slug }, clarify: { question: `Mensagem atual (${stage.label}): “${before.slice(0, 200)}”. Qual o novo texto?`, options: [], search: { placeholder: "Novo texto (use [name] para o nome)", path: "text" } } };
    return {
      kind: "card",
      args: { ...args, stage: slug },
      card: {
        title: "Mensagem de " + stage.label,
        sections: [{ type: "fields", rows: [{ label: "Antes", value: before || "—" }, { label: "Nova", value: text, edit: { path: "text", input: "text", value: text } }] }, { type: "note", text: "Os códigos entre colchetes ([name], [company]…) são trocados pelos dados do lead." }],
        confirm: { label: "Salvar mensagem", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ slug, text, label: stage.label }) } } },
        open: SETTINGS("mensagens-fase"),
      },
    };
  },
  async execute(ctx, exec) {
    // Re-read, change only this stage's first template, send the whole settings back.
    const cur = await callInternalApi<{ data?: LeadMsgs }>(ctx.req, "GET", "/api/settings/lead-messages");
    const d = cur.json.data;
    if (!cur.ok || !d) return { ok: false, status: cur.status, error: internalError(cur, "Não consegui abrir as mensagens.") };
    const stages: Record<string, unknown> = {};
    let before = "";
    for (const s of d.stages) {
      const templates = s.templates.map((t, i) => {
        if (s.slug === exec.slug && i === 0) before = t.body;
        return { id: t.id, label: t.label, body: s.slug === exec.slug && i === 0 ? String(exec.text) : t.body, ...(t.on_send_action ? { on_send_action: t.on_send_action } : {}) };
      });
      if (s.slug === exec.slug && !templates.length) templates.push({ id: "mate-" + Date.now().toString(36), label: "Mensagem", body: String(exec.text) });
      stages[s.slug] = { email_subject: s.email_subject, templates };
    }
    const body = { company_name: d.company_name, default_email_subject: d.default_email_subject, coupon_enabled: d.coupon_enabled, coupon_code: d.coupon_code, coupon_label: d.coupon_label, coupon_percent: d.coupon_percent, coupon_sms_line: d.coupon_sms_line, stages };
    const res = await callInternalApi(ctx.req, "PUT", "/api/settings/lead-messages", body);
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não consegui salvar a mensagem.") };
    return { ok: true, title: "Mensagem de " + exec.label + " atualizada", undo: { slug: exec.slug, text: before, label: exec.label }, memory: `Changed lead message for ${exec.label}` };
  },
  async undo(ctx, u) {
    const r = await leadMessage.execute!(ctx, u);
    return r.ok ? { ok: true, title: "Mensagem anterior restaurada" } : r;
  },
};

export const inviteUser: ActionDef = {
  name: "users.invite",
  description: "Shortcut to invite a team member (office or field): opens the team screen, where access and permissions are chosen. The Mate does not grant access by itself.",
  args: { name: "person's name", email: "e-mail", role: "office | field (optional)" },
  examples: ["Convida o Pedro como funcionário de campo", "Add a user for my office manager"],
  permissions: ["users.create"],
  readOnly: true,
  async prepare(_ctx, args) {
    const name = str(args.name, 80);
    const email = str(args.email, 120);
    return {
      kind: "answer",
      args,
      card: {
        title: "Convidar " + (name || "alguém para a equipe"),
        sections: [{ type: "note", text: "Acesso e permissões são escolhidos na tela de Equipe, por segurança. Abra, toque em Convidar" + (email ? ` e use ${email}` : "") + "." }],
        links: [{ label: "Abrir Equipe", href: "equipe.html" }],
      },
    };
  },
};

export const REPORT_SETTINGS_ACTIONS: ActionDef[] = [salesReport, referralsRanking, funnelReport, earningsReport, invoiceDueDefault, quoteValidity, leadMessage, inviteUser];
