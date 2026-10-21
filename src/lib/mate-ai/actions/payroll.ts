/**
 * Folha (crew pay) from the office: log a worked day, what is waiting, approve days in bulk,
 * approve or reject expenses, the week's totals, pay, and send the conference PDF.
 * Writes go through /api/folha.
 */
import { DEFAULT_PAYROLL_PAYMENT_METHODS } from "../../settings/payroll-payment-methods.js";
import { callInternalApi, internalError } from "../internal-api.js";
import { nameSimilarity } from "../match.js";
import { addDays, fmtDate, isIsoDay } from "./time.js";
import type { ActionContext, ActionDef, Clarify, ListItem, PickItem } from "./types.js";
import { dayIn, kept, money, num, plural, str, uuidOrNull } from "./types.js";

const enc = encodeURIComponent;
const FOLHA = { label: "Abrir Folha", href: "folha.html" };

type Emp = { id: string; name: string; email: string | null; paymentMethod: string | null };

async function resolveEmployee(ctx: ActionContext, args: Record<string, unknown>): Promise<{ emp: Emp } | { clarify: Clarify } | { error: string }> {
  const id = uuidOrNull(args.employee_id);
  const rows = await ctx.tx.payrollEmployee.findMany({ where: { status: { not: "inactive" } }, select: { id: true, name: true, email: true, paymentMethod: true }, orderBy: { name: "asc" }, take: 300 });
  if (id) {
    const hit = rows.find((r) => r.id === id);
    if (hit) return { emp: hit };
  }
  const q = str(args.employee, 80);
  if (!q) return { clarify: { question: "Qual funcionário?", options: rows.slice(0, 8).map((r) => ({ label: r.name, patch: { employee_id: r.id } })) } };
  const scored = rows.map((r) => ({ r, s: nameSimilarity(q, [r.name]) })).filter((x) => x.s >= 55).sort((a, b) => b.s - a.s);
  if (!scored.length) return { error: `Não achei “${q}” na folha.` };
  if (scored.length === 1 || scored[0]!.s - scored[1]!.s >= 10) return { emp: scored[0]!.r };
  return { clarify: { question: "Qual deles?", options: scored.slice(0, 6).map((x) => ({ label: x.r.name, patch: { employee_id: x.r.id } })) } };
}

type WeekEmp = { id: string; name: string; email: string | null; payment_method: string | null; totals: { days: number; net: number; gross: number; pending_days: number; sqft: number }; payment: { amount: number; paid_on: string } | null };
type Week = { week: { start: string; end: string; label: string }; period: { id: string; label: string; status: string }; totals: { all: { net: number; to_pay: number; paid: number; pending_days: number; employees: number } }; employees: WeekEmp[] };

async function loadWeek(ctx: ActionContext, ref?: string | null): Promise<Week | { error: string }> {
  const res = await callInternalApi<{ data?: Week }>(ctx.req, "GET", "/api/folha/semana" + (ref ? "?week=" + ref : ""));
  if (!res.ok || !res.json.data) return { error: internalError(res, "Não consegui abrir a semana da folha.") };
  return res.json.data;
}

/** "semana passada" → a day inside last week. */
function weekRef(ctx: ActionContext, args: Record<string, unknown>): string | null {
  if (isIsoDay(args.week)) return String(args.week);
  if (/passad|last|anterior/i.test(str(args.week))) return addDays(ctx.today, -7);
  return null;
}

const METHOD_KEYS: string[] = DEFAULT_PAYROLL_PAYMENT_METHODS.map((m) => m.key);
function methodKey(v: unknown): string | null {
  const t = str(v, 30).toLowerCase();
  if (!t) return null;
  if (/zelle/.test(t)) return "zelle";
  if (/dinheiro|cash|esp[eé]cie/.test(t)) return "cash";
  if (/cheque|check/.test(t)) return "check";
  if (/ach|dep[oó]sito/.test(t)) return "ach";
  if (/transf|wire/.test(t)) return "transfer";
  return METHOD_KEYS.includes(t) ? t : "other";
}
const methodLabel = (k: string | null) => DEFAULT_PAYROLL_PAYMENT_METHODS.find((m) => m.key === k)?.label || k || "—";

/* ───────────────────────── log a day ───────────────────────── */

export const folhaDay: ActionDef = {
  name: "folha.day",
  description: "Office: log a worked day for a crew member (already approved), on one or more jobs, with optional sq ft, overtime and note. Not for future dates.",
  args: { employee: "employee name", date: "YYYY-MM-DD (default today)", jobs: "[{job: 'number', sqft?}] (optional)", days_worked: "1 or 0.5", overtime_hours: "extra hours", note: "note" },
  examples: ["Lança o dia do Carlos: 8h no job 1042", "Pedro trabalhou meio dia ontem no 1043", "Log Luis yesterday on the Smith job, 400 sqft"],
  permissions: ["payroll.manage"],
  async prepare(ctx, args) {
    const r = await resolveEmployee(ctx, args);
    if ("error" in r) return { kind: "error", message: r.error, args };
    if ("clarify" in r) return { kind: "clarify", clarify: r.clarify, args };
    const emp = r.emp;
    const date = isIsoDay(args.date) ? String(args.date) : ctx.today;
    if (date > ctx.today) return { kind: "error", message: "Não dá para lançar data futura.", args };
    const specs = Array.isArray(args.jobs) ? (args.jobs as Array<Record<string, unknown>>).slice(0, 10) : [];
    const jobs: Array<{ work_order_id: string; sqft: number | null; label: string }> = [];
    for (const s of specs) {
      const n = Number((str(s.job).match(/\d{2,7}/) || [])[0]);
      const wo = uuidOrNull(s.job_id)
        ? await ctx.tx.workOrder.findFirst({ where: { id: String(s.job_id) }, select: { id: true, number: true, title: true } })
        : Number.isFinite(n)
          ? await ctx.tx.workOrder.findFirst({ where: { number: n }, select: { id: true, number: true, title: true } })
          : null;
      if (!wo) return { kind: "error", message: `Não achei o job “${str(s.job)}”.`, args: { ...args, employee_id: emp.id } };
      jobs.push({ work_order_id: wo.id, sqft: num(s.sqft), label: (wo.number != null ? "#" + wo.number + " · " : "") + wo.title });
    }
    const days = num(args.days_worked) ?? 1;
    const ot = num(args.overtime_hours);
    const note = str(args.note, 400);
    return {
      kind: "card",
      args: { ...args, employee_id: emp.id, date },
      card: {
        title: `Lançar dia de ${emp.name}`,
        sections: [
          {
            type: "fields",
            rows: [
              { label: "Dia", value: fmtDate(date), edit: { path: "date", input: "date", value: date } },
              { label: "Dias", value: days === 0.5 ? "meio dia" : String(days), edit: { path: "days_worked", input: "number", value: days } },
              ...(ot ? [{ label: "Horas extras", value: ot + "h" }] : []),
              { label: "Jobs", value: jobs.length ? jobs.map((j) => j.label + (j.sqft ? ` (${j.sqft} sq ft)` : "")).join(", ") : "sem job" },
              ...(note ? [{ label: "Nota", value: note }] : []),
            ],
          },
          { type: "note", text: "Entra já aprovado, com o horário padrão do funcionário." },
        ],
        confirm: { label: "Lançar dia", tone: "money", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ employee_id: emp.id, name: emp.name, date, days, ot, jobs: jobs.map((j) => ({ work_order_id: j.work_order_id, sqft: j.sqft })), note: note || null }) } } },
        open: FOLHA,
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi(ctx.req, "POST", "/api/folha/dias", {
      employee_id: exec.employee_id,
      date: exec.date,
      days_worked: exec.days,
      ...(exec.ot ? { overtime_minutes: Math.round(Number(exec.ot) * 60) } : {}),
      jobs: exec.jobs,
      note: exec.note,
    });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não consegui lançar o dia.") };
    return { ok: true, title: `Dia de ${exec.name} lançado · ${fmtDate(String(exec.date))}`, links: [FOLHA], memory: `Logged ${exec.days} day for ${exec.name} on ${exec.date}` };
  },
};

/* ───────────────────────── what is waiting ───────────────────────── */

type Shift = { id: string; date: string; employee_name: string; status: string; worked_label: string; amount: number; expenses?: Array<{ id: string; amount: number; description: string | null; status: string; receipt_url?: string | null }> };

async function loadPending(ctx: ActionContext) {
  const res = await callInternalApi<{ data?: { pending: Shift[]; returned: Shift[]; working_now: Shift[] } }>(ctx.req, "GET", "/api/folha/pendencias");
  return res.ok && res.json.data ? res.json.data : null;
}

export const folhaPending: ActionDef = {
  name: "folha.pending",
  description: "Office: what is waiting in the crew pay — days to review, days returned, expenses to approve, who is working now.",
  args: {},
  examples: ["O que falta aprovar na folha?", "Pendências da folha", "Who is clocked in now?"],
  permissions: ["payroll.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const d = await loadPending(ctx);
    if (!d) return { kind: "error", message: "Não consegui abrir as pendências da folha.", args };
    const expenses = d.pending.concat(d.working_now).flatMap((s) => (s.expenses || []).filter((e) => e.status === "pending").map((e) => ({ s, e })));
    const items: ListItem[] = [
      ...d.pending.slice(0, 12).map((s) => ({ title: `${s.employee_name} · ${fmtDate(s.date)}`, detail: `${s.worked_label} · ${money(s.amount)}`, tone: "warning" as const })),
      ...d.returned.slice(0, 6).map((s) => ({ title: `${s.employee_name} · ${fmtDate(s.date)}`, detail: "devolvido para o funcionário corrigir", tone: "neutral" as const })),
      ...expenses.slice(0, 8).map(({ s, e }) => ({ title: `Despesa de ${s.employee_name}: ${money(e.amount)}`, detail: e.description || "sem descrição", tone: "warning" as const, run: { label: "Aprovar", action: "folha.expense", args: { expense_id: e.id, decision: "approve" } } })),
    ];
    return {
      kind: "answer",
      args,
      card: {
        title: d.pending.length || expenses.length ? `${plural(d.pending.length, "dia", "dias")} e ${plural(expenses.length, "despesa", "despesas")} para aprovar` : "Nada para aprovar na folha",
        subtitle: d.working_now.length ? `Trabalhando agora: ${d.working_now.map((s) => s.employee_name).join(", ")}` : undefined,
        sections: [{ type: "list", items, empty: "Tudo em dia." }],
        open: FOLHA,
      },
    };
  },
};

/* ───────────────────────── approve days in bulk ───────────────────────── */

export const folhaApprove: ActionDef = {
  name: "folha.approve",
  description: "Office: approve the crew's pending work days in bulk (optionally only one employee). Shows the list to confirm.",
  args: { employee: "only this employee (optional)" },
  examples: ["Aprova todos os dias da semana", "Aprova os dias do Carlos", "Approve all pending days"],
  permissions: ["payroll.manage"],
  async prepare(ctx, args) {
    const d = await loadPending(ctx);
    if (!d) return { kind: "error", message: "Não consegui abrir as pendências da folha.", args };
    const who = str(args.employee, 80);
    const list = d.pending.filter((s) => !who || nameSimilarity(who, [s.employee_name]) >= 55);
    if (!list.length) return { kind: "answer", args, card: { title: who ? `Nenhum dia pendente de ${who}` : "Nenhum dia pendente", sections: [{ type: "note", text: "Nada para aprovar.", tone: "good" }], open: FOLHA } };
    const items: PickItem[] = list.map((s) => ({ id: s.id, title: `${s.employee_name} · ${fmtDate(s.date)}`, detail: `${s.worked_label} · ${money(s.amount)}` }));
    return {
      kind: "card",
      args,
      card: {
        title: `Aprovar ${plural(list.length, "dia", "dias")}`,
        subtitle: money(list.reduce((s, x) => s + x.amount, 0)) + " no total",
        sections: [{ type: "pick", items }],
        confirm: { label: "Aprovar dias", tone: "money", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ items: list.map((s) => ({ id: s.id })) }) } } },
        open: FOLHA,
      },
    };
  },
  async execute(ctx, exec) {
    const ids = kept(ctx, (exec.items || []) as Array<{ id: string }>).map((x) => x.id);
    if (!ids.length) return { ok: false, status: 400, error: "Nenhum dia marcado." };
    const res = await callInternalApi<{ data?: { approved: number; results: Array<{ ok: boolean; error?: string }> } }>(ctx.req, "POST", "/api/folha/dias/aprovar-lote", { ids });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não consegui aprovar.") };
    const failed = (res.json.data?.results || []).filter((r) => !r.ok);
    return { ok: true, title: `${plural(res.json.data?.approved ?? 0, "dia aprovado", "dias aprovados")}`, detail: failed.length ? "Falharam: " + failed.map((f) => f.error).join("; ") : undefined, links: [FOLHA], memory: `Approved ${res.json.data?.approved ?? 0} payroll days` };
  },
};

/* ───────────────────────── expenses ───────────────────────── */

export const folhaExpense: ActionDef = {
  name: "folha.expense",
  description: "Office: approve or reject a crew member's expense (gas, material) waiting for review.",
  args: { employee: "employee name", description: "what it was (e.g. 'gasolina')", decision: "approve | reject", reason: "why, when rejecting" },
  examples: ["Aprova a despesa de gasolina do Pedro", "Recusa a despesa do Carlos, sem recibo"],
  permissions: ["payroll.manage"],
  async prepare(ctx, args) {
    const who = str(args.employee, 80);
    const what = str(args.description, 80);
    const rows = await ctx.tx.campoShiftExpense.findMany({
      where: { status: "pending", ...(uuidOrNull(args.expense_id) ? { id: String(args.expense_id) } : {}) },
      select: { id: true, amount: true, description: true, receiptUrl: true, createdAt: true, employee: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const scored = rows
      .map((e) => ({ e, s: (who ? nameSimilarity(who, [e.employee.name]) : 60) + (what ? nameSimilarity(what, [e.description]) / 4 : 0) }))
      .filter((x) => uuidOrNull(args.expense_id) || x.s >= 55)
      .sort((a, b) => b.s - a.s);
    if (!scored.length) return { kind: "error", message: "Não achei despesa pendente" + (who ? " de " + who : "") + ".", args };
    if (scored.length > 1 && scored[0]!.s - scored[1]!.s < 5 && !uuidOrNull(args.expense_id)) {
      return { kind: "clarify", args, clarify: { question: "Qual despesa?", options: scored.slice(0, 6).map(({ e }) => ({ label: `${e.employee.name}: ${money(Number(e.amount))}`, detail: [e.description, fmtDate(dayIn(e.createdAt, ctx.timezone)!)].filter(Boolean).join(" · "), patch: { expense_id: e.id } })) } };
    }
    const e = scored[0]!.e;
    const decision = /rec|reje|nega|reject|deny/i.test(str(args.decision)) ? "reject" : "approve";
    const reason = str(args.reason, 300);
    return {
      kind: "card",
      args: { ...args, expense_id: e.id, decision },
      card: {
        title: `${decision === "approve" ? "Aprovar" : "Recusar"} despesa de ${e.employee.name}`,
        sections: [
          {
            type: "fields",
            rows: [
              { label: "Valor", value: money(Number(e.amount)) },
              { label: "O quê", value: e.description || "—" },
              { label: "Recibo", value: e.receiptUrl ? "tem foto" : "sem recibo" },
              { label: "Decisão", value: decision === "approve" ? "Aprovar" : "Recusar", edit: { path: "decision", input: "select", value: decision, options: [{ value: "approve", label: "Aprovar" }, { value: "reject", label: "Recusar" }] } },
              ...(decision === "reject" ? [{ label: "Motivo", value: reason || "—", edit: { path: "reason", input: "text" as const, value: reason } }] : []),
            ],
          },
        ],
        links: e.receiptUrl ? [{ label: "Ver recibo", href: e.receiptUrl }] : [],
        confirm: { label: decision === "approve" ? "Aprovar despesa" : "Recusar despesa", tone: "money", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ id: e.id, decision, reason: reason || null, name: e.employee.name, amount: Number(e.amount) }) } } },
        open: FOLHA,
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi(ctx.req, "POST", `/api/folha/despesas/${enc(String(exec.id))}/${exec.decision === "approve" ? "aprovar" : "recusar"}`, exec.decision === "approve" ? {} : { reason: exec.reason });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não consegui registrar a decisão.") };
    return { ok: true, title: `Despesa de ${exec.name} (${money(Number(exec.amount))}) ${exec.decision === "approve" ? "aprovada" : "recusada"}`, links: [FOLHA], memory: `Expense of ${exec.name} ${exec.decision}d` };
  },
};

/* ───────────────────────── the week ───────────────────────── */

export const folhaWeek: ActionDef = {
  name: "folha.week",
  description: "Office: crew pay of a week — total to pay, paid, days pending, and per employee.",
  args: { week: "a day of the week (YYYY-MM-DD) or 'last' (default this week)" },
  examples: ["Quanto vou pagar esta semana?", "Folha da semana passada", "Payroll this week"],
  permissions: ["payroll.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const w = await loadWeek(ctx, weekRef(ctx, args));
    if ("error" in w) return { kind: "error", message: w.error, args };
    const t = w.totals.all;
    const rows = w.employees.filter((e) => e.totals.days || e.totals.net).sort((a, b) => b.totals.net - a.totals.net);
    return {
      kind: "answer",
      args,
      card: {
        title: `Folha ${w.week.label}: ${money(t.to_pay)} a pagar`,
        subtitle: `${plural(t.employees, "funcionário", "funcionários")} · pago ${money(t.paid)}` + (t.pending_days ? ` · ${plural(t.pending_days, "dia pendente", "dias pendentes")}` : ""),
        sections: [
          rows.length
            ? { type: "table", columns: ["Funcionário", "Dias", "Líquido", "Situação"], align: ["left", "right", "right", "left"], rows: rows.map((e) => [e.name, String(e.totals.days), money(e.totals.net), e.payment ? "pago " + fmtDate(e.payment.paid_on) : e.totals.pending_days ? `${e.totals.pending_days} pendente(s)` : "a pagar"]) }
            : { type: "note", text: "Nenhum dia nesta semana." },
        ],
        open: FOLHA,
      },
    };
  },
};

/* ───────────────────────── pay ───────────────────────── */

export const folhaPay: ActionDef = {
  name: "folha.pay",
  description: "Office: record crew payments for a week (one employee or everyone with a balance), with the method (Zelle, cash, check…).",
  args: { employee: "employee name (empty = everyone to pay)", method: "zelle | cash | check | ach | transfer", paid_on: "YYYY-MM-DD (default today)", week: "a day of the week or 'last'", reference: "check number / reference" },
  examples: ["Paguei 1.200 ao Carlos via Zelle", "Paga todo mundo da semana passada em dinheiro", "Paid Luis by check 1043"],
  permissions: ["payroll.manage"],
  async prepare(ctx, args) {
    const w = await loadWeek(ctx, weekRef(ctx, args));
    if ("error" in w) return { kind: "error", message: w.error, args };
    let list = w.employees.filter((e) => !e.payment && e.totals.net > 0);
    const who = str(args.employee, 80);
    if (who || uuidOrNull(args.employee_id)) {
      const r = await resolveEmployee(ctx, args);
      if ("error" in r) return { kind: "error", message: r.error, args };
      if ("clarify" in r) return { kind: "clarify", clarify: r.clarify, args };
      const one = w.employees.find((e) => e.id === r.emp.id);
      if (!one) return { kind: "error", message: `${r.emp.name} não tem nada na folha de ${w.week.label}.`, args };
      if (one.payment) return { kind: "error", message: `${r.emp.name} já foi pago em ${fmtDate(one.payment.paid_on)} (${money(one.payment.amount)}).`, args };
      list = [one];
    }
    if (!list.length) return { kind: "answer", args, card: { title: `Ninguém a pagar em ${w.week.label}`, sections: [{ type: "note", text: "Todos pagos ou sem saldo." }], open: FOLHA } };
    const method = methodKey(args.method);
    const paidOn = isIsoDay(args.paid_on) ? String(args.paid_on) : ctx.today;
    const said = num(args.amount);
    const mismatch = list.length === 1 && said != null && Math.abs(said - list[0]!.totals.net) > 0.5;
    const pending = list.filter((e) => e.totals.pending_days > 0);
    return {
      kind: "card",
      args,
      card: {
        title: `Pagar ${list.length === 1 ? list[0]!.name : plural(list.length, "funcionário", "funcionários")} · ${w.week.label}`,
        subtitle: money(list.reduce((s, e) => s + e.totals.net, 0)) + " no total",
        sections: [
          ...(list.length > 1 ? [{ type: "pick" as const, items: list.map((e) => ({ id: e.id, title: e.name, detail: `${e.totals.days} dia(s) · ${money(e.totals.net)}`, meta: e.payment_method ? methodLabel(e.payment_method) : undefined })) }] : [{ type: "fields" as const, rows: [{ label: "Valor da folha", value: money(list[0]!.totals.net) }] }]),
          { type: "fields", rows: [{ label: "Forma", value: methodLabel(method), edit: { path: "method", input: "select", value: method || "", options: DEFAULT_PAYROLL_PAYMENT_METHODS.map((m) => ({ value: m.key, label: m.label })) } }, { label: "Data", value: fmtDate(paidOn), edit: { path: "paid_on", input: "date", value: paidOn } }] },
          ...(mismatch ? [{ type: "note" as const, tone: "warning" as const, text: `Você disse ${money(said!)}, mas a folha dá ${money(list[0]!.totals.net)}. O pagamento registra o valor da folha; ajuste reembolso/desconto na Folha se precisar.` }] : []),
          ...(pending.length ? [{ type: "note" as const, tone: "warning" as const, text: `${pending.map((e) => e.name).join(", ")} ainda tem dia(s) em conferência: o pagamento vai mesmo assim.` }] : []),
        ],
        confirm: { label: "Registrar pagamento", tone: "money", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ period_id: w.period.id, label: w.week.label, items: list.map((e) => ({ id: e.id, name: e.name })), method, paid_on: paidOn, reference: str(args.reference, 100) || null, force: pending.length > 0 }) } } },
        open: FOLHA,
      },
    };
  },
  async execute(ctx, exec) {
    const people = kept(ctx, (exec.items || []) as Array<{ id: string; name: string }>);
    if (!people.length) return { ok: false, status: 400, error: "Ninguém marcado." };
    const res = await callInternalApi<{ data?: { paid?: Array<{ name: string; amount: number }>; skipped?: Array<{ name: string; reason: string }> } }>(ctx.req, "POST", "/api/folha/pagamentos", {
      period_id: exec.period_id,
      employee_ids: people.map((p) => p.id),
      paid_on: exec.paid_on,
      method: exec.method || "",
      reference: exec.reference,
      force: exec.force,
    });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não consegui registrar o pagamento.") };
    const created = res.json.data?.paid || [];
    const skipped = res.json.data?.skipped || [];
    if (!created.length) return { ok: false, status: 409, error: skipped.map((s) => `${s.name}: ${s.reason}`).join("; ") || "Nada foi pago." };
    return {
      ok: true,
      title: `${plural(created.length, "pagamento registrado", "pagamentos registrados")} · ${money(created.reduce((s, c) => s + c.amount, 0))}`,
      detail: [created.map((c) => `${c.name} ${money(c.amount)}`).join(", "), skipped.length ? "Não pagos: " + skipped.map((s) => `${s.name} (${s.reason})`).join(", ") : ""].filter(Boolean).join(" · "),
      links: [FOLHA],
      memory: `Paid ${created.map((c) => c.name).join(", ")} for ${exec.label}`,
    };
  },
};

/* ───────────────────────── conference PDF ───────────────────────── */

export const folhaConference: ActionDef = {
  name: "folha.conference",
  description: "Office: e-mail an employee the week's conference PDF (days, hours, amounts) to check before payment.",
  args: { employee: "employee name", week: "a day of the week or 'last'", to: "e-mail if different" },
  examples: ["Gera a conferência da semana do Carlos", "Manda a conferência da semana passada pro Pedro"],
  permissions: ["payroll.manage"],
  async prepare(ctx, args) {
    const r = await resolveEmployee(ctx, args);
    if ("error" in r) return { kind: "error", message: r.error, args };
    if ("clarify" in r) return { kind: "clarify", clarify: r.clarify, args };
    const emp = r.emp;
    const w = await loadWeek(ctx, weekRef(ctx, args));
    if ("error" in w) return { kind: "error", message: w.error, args };
    const to = str(args.to, 200) || emp.email || "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { kind: "clarify", args: { ...args, employee_id: emp.id }, clarify: { question: `${emp.name} não tem e-mail. Para qual e-mail mandar?`, options: [], search: { placeholder: "email@exemplo.com", path: "to" } } };
    const row = w.employees.find((e) => e.id === emp.id);
    return {
      kind: "card",
      args: { ...args, employee_id: emp.id },
      card: {
        title: `Conferência de ${emp.name} · ${w.week.label}`,
        badge: { text: "Vai para o funcionário", tone: "warning" },
        sections: [{ type: "fields", rows: [{ label: "Dias", value: String(row?.totals.days ?? 0) }, { label: "Líquido", value: money(row?.totals.net ?? 0) }, { label: "Para", value: to, edit: { path: "to", input: "text", value: to } }] }],
        confirm: { label: "Enviar conferência", tone: "send", checkbox: "Enviar para " + to, exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ employee_id: emp.id, name: emp.name, week: w.week.start, label: w.week.label, to }) } } },
        open: FOLHA,
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi(ctx.req, "POST", "/api/folha/conferencia", { week: exec.week, employee_id: exec.employee_id, to: exec.to });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não consegui enviar a conferência.") };
    return { ok: true, title: `Conferência de ${exec.name} enviada`, detail: `${exec.label} · para ${exec.to}`, links: [FOLHA], memory: `Sent payroll conference to ${exec.name}` };
  },
};

export const PAYROLL_ACTIONS: ActionDef[] = [folhaDay, folhaPending, folhaApprove, folhaExpense, folhaWeek, folhaPay, folhaConference];
