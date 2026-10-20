import { computeInvoiceMoney, computeNewInvoiceAmount, invoiceKindLabel, PAYMENT_METHOD_LABELS, resolvePaymentAmount } from "../../invoices/core.js";
import { invoicedTotalForQuote } from "../../invoices/service.js";
import { normalizeQuoteStatus } from "../../quotes/transitions.js";
import { callInternalApi, internalError } from "../internal-api.js";
import { quoteLabel, quoteStatusPt, resolveInvoice, resolveQuote, customerQuoteOptions } from "./resolve.js";
import { addDays, fmtDate, isIsoDay } from "./time.js";
import type { ActionDef, Clarify } from "./types.js";
import { money, num, str } from "./types.js";

const INVOICE_TYPES = ["deposit", "progress", "final", "full", "custom"] as const;

function invoiceLink(id: string) {
  return { label: "Abrir invoice", href: "invoice.html?id=" + encodeURIComponent(id) };
}

function typeOptions(): Clarify["options"] {
  return [
    { label: "Depósito de 50%", patch: { invoice_type: "deposit", deposit_pct: 50 } },
    { label: "Depósito de 30%", patch: { invoice_type: "deposit", deposit_pct: 30 } },
    { label: "Valor total", patch: { invoice_type: "full" } },
    { label: "Saldo restante", patch: { invoice_type: "final" } },
  ];
}

/* ───────────────────────── invoice from a quote ───────────────────────── */

export const invoiceFromQuote: ActionDef = {
  name: "invoice.quote",
  description:
    "Issue an invoice from a quote (deposit %, full, remaining balance, progress or a custom amount). Use invoice.job when the user names a JOB instead of a quote.",
  args: {
    quote_id: "id of a quote seen earlier in this conversation ([quote <id>] in history) — use it when the user says 'esse quote', 'o último quote', 'o que você criou'",
    quote: "quote number like Q-1007, or \"latest\" for the newest one; empty to use the customer's quote / current screen",
    customer: "customer name",
    invoice_type: "deposit | full | final | progress | custom",
    deposit_pct: "number for deposits (e.g. 50)",
    amount: "dollar amount for progress/custom",
    due_date: "YYYY-MM-DD if said",
  },
  examples: ["Fatura o depósito de 50% do quote aprovado do John", "Invoice the remaining balance on quote 2041 due Friday"],
  permissions: ["invoices.manage"],
  async prepare(ctx, args) {
    const q = await resolveQuote(ctx, args);
    if (q.status === "clarify") return { kind: "clarify", clarify: q.clarify, args };
    if (q.status === "missing") return { kind: "error", message: q.message, args };
    const quote = q.row;
    const s = normalizeQuoteStatus(quote.status);
    if (s === "archived" || s === "expired") {
      return { kind: "error", message: `O Quote ${quoteLabel(quote)} está ${quoteStatusPt(quote.status)} e não pode ser faturado.`, args };
    }
    let type = str(args.invoice_type).toLowerCase();
    const invoiced = await invoicedTotalForQuote(ctx.tx, quote.id);
    const total = Number(quote.total);
    if (!INVOICE_TYPES.includes(type as (typeof INVOICE_TYPES)[number])) {
      if (invoiced > 0) type = "final";
      else {
        return {
          kind: "clarify",
          args: { ...args, quote_id: quote.id },
          clarify: { question: `Que invoice emitir do Quote ${quoteLabel(quote)} (${money(total)})?`, options: typeOptions() },
        };
      }
    }
    const depositPct = num(args.deposit_pct);
    const amountArg = num(args.amount);
    if (type === "deposit" && depositPct == null) {
      return {
        kind: "clarify",
        args: { ...args, quote_id: quote.id, invoice_type: "deposit" },
        clarify: {
          question: "Qual a porcentagem do depósito?",
          options: [30, 50, 100].map((p) => ({ label: p + "%", detail: money((total * p) / 100), patch: { deposit_pct: p } })),
        },
      };
    }
    if ((type === "progress" || type === "custom") && amountArg == null) {
      return { kind: "clarify", args: { ...args, quote_id: quote.id }, clarify: { question: "Qual o valor da invoice?", options: [], search: { placeholder: "Valor em $", path: "amount" } } };
    }
    const calc = computeNewInvoiceAmount({ kind: type, quoteTotal: total, invoicedTotal: invoiced, depositPct, customAmount: amountArg });
    if (!calc.ok) return { kind: "error", message: calc.error, args: { ...args, quote_id: quote.id } };
    const due = isIsoDay(args.due_date) ? String(args.due_date) : null;
    const quoteOptions = await customerQuoteOptions(ctx, quote.customerId, ctx.timezone);
    const exec = {
      quote_id: quote.id,
      label: quoteLabel(quote),
      body: { invoice_type: type, deposit_pct: depositPct, custom_amount: amountArg, due_date: due },
      amount: calc.amount,
      invoiced_before: invoiced,
    };
    return {
      kind: "card",
      args: { ...args, quote_id: quote.id, invoice_type: type },
      card: {
        title: "Emitir invoice do Quote " + quoteLabel(quote),
        subtitle: quote.customer?.name || undefined,
        badge: { text: "Dinheiro", tone: "accent" },
        sections: [
          {
            type: "fields",
            rows: [
              {
                // Always show which quote, with its total and date, and let the user switch.
                label: "Quote",
                value: (quote.quoteNumber || "#" + quote.number) + " · " + money(total) + " · criado " + fmtDate(new Intl.DateTimeFormat("en-CA", { timeZone: ctx.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(quote.createdAt)),
                ...(quoteOptions.length > 1
                  ? { edit: { path: "quote_id", input: "select" as const, value: quote.id, options: quoteOptions } }
                  : {}),
              },
              {
                label: "Tipo",
                value: invoiceKindLabel(calc.kind, "pt") + (type === "deposit" && depositPct != null ? ` (${depositPct}%)` : ""),
                edit: {
                  path: "invoice_type",
                  input: "select",
                  value: type,
                  options: [
                    { value: "deposit", label: "Depósito" },
                    { value: "full", label: "Valor total" },
                    { value: "final", label: "Saldo restante" },
                    { value: "progress", label: "Parcial" },
                    { value: "custom", label: "Valor específico" },
                  ],
                },
              },
              ...(type === "deposit" ? [{ label: "Depósito %", value: String(depositPct), edit: { path: "deposit_pct", input: "number" as const, value: depositPct } }] : []),
              ...(type === "progress" || type === "custom" ? [{ label: "Valor", value: money(amountArg || 0), edit: { path: "amount", input: "money" as const, value: amountArg } }] : []),
              { label: "Vencimento", value: due ? fmtDate(due) : "padrão das configurações", edit: { path: "due_date", input: "date", value: due } },
            ],
          },
          {
            type: "totals",
            rows: [
              { label: "Total do Quote", value: money(total) },
              { label: "Já faturado", value: money(invoiced) },
              { label: "Esta invoice", value: money(calc.amount), strong: true },
            ],
          },
          ...(s !== "approved" && s !== "converted" ? [{ type: "note" as const, tone: "warning" as const, text: "O Quote ainda não foi aprovado; emitir a invoice marca o Quote como aprovado." }] : []),
          { type: "note", text: "A invoice é criada e aparece em Invoices. Nada é enviado ao cliente." },
        ],
        confirm: { label: "Emitir invoice de " + money(calc.amount), tone: "money", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign(exec) } } },
        open: { label: "Abrir Quote", href: "quote-builder.html?id=" + encodeURIComponent(quote.id) },
      },
    };
  },
  async execute(ctx, exec) {
    // Re-check that nothing was invoiced since the preview, so the amount shown is the one created.
    const body = exec.body as Record<string, unknown>;
    const res = await callInternalApi<{ data?: { id: string; invoice_number?: string; amount?: number } }>(
      ctx.req,
      "POST",
      "/api/quotes/" + encodeURIComponent(String(exec.quote_id)) + "/invoices",
      body,
    );
    if (!res.ok || !res.json.data?.id) return { ok: false, status: res.status, error: internalError(res, "Não foi possível emitir a invoice.") };
    const d = res.json.data;
    return {
      ok: true,
      title: "Invoice " + (d.invoice_number || "") + " emitida",
      detail: money(Number(d.amount ?? exec.amount)) + " · Quote " + exec.label,
      links: [invoiceLink(d.id)],
      next: { label: "Enviar ao cliente", action: "invoice.send", args: { invoice_id: d.id } },
      entity: { type: "invoice", id: d.id },
      memory: `Issued invoice ${d.invoice_number || d.id} (${money(Number(d.amount ?? exec.amount))}) from quote ${exec.label}`,
    };
  },
};

/* ───────────────────────── send an invoice ───────────────────────── */

export const sendInvoice: ActionDef = {
  name: "invoice.send",
  description: "E-mail an existing invoice to the customer (with the payment link).",
  args: { invoice: "invoice number", customer: "customer name", to: "e-mail address if different from the customer's" },
  examples: ["Manda a invoice 3012 por e-mail", "Envia a invoice do John", "Send the Smith invoice to mike@x.com"],
  permissions: ["invoices.manage"],
  async prepare(ctx, args) {
    const r = await resolveInvoice(ctx, args, { openOnly: true });
    if (r.status === "clarify") return { kind: "clarify", clarify: r.clarify, args };
    if (r.status === "missing") return { kind: "error", message: r.message, args };
    const inv = r.row;
    if (inv.status === "void") return { kind: "error", message: "Esta invoice foi anulada.", args };
    const to = str(args.to, 200) || inv.customer?.email || inv.sentTo || "";
    const m = computeInvoiceMoney(inv);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      return {
        kind: "clarify",
        args: { ...args, invoice_id: inv.id },
        clarify: { question: `${inv.customer?.name || "O cliente"} não tem e-mail no cadastro. Para qual e-mail enviar?`, options: [], search: { placeholder: "email@exemplo.com", path: "to" } },
      };
    }
    const label = inv.invoiceNumber || "Invoice";
    const exec = { invoice_id: inv.id, label, to };
    return {
      kind: "card",
      args: { ...args, invoice_id: inv.id },
      card: {
        title: "Enviar invoice " + label,
        subtitle: inv.customer?.name || undefined,
        badge: { text: "Vai para o cliente", tone: "warning" },
        sections: [
          {
            type: "fields",
            rows: [
              { label: "Valor", value: money(m.amount) },
              { label: "Saldo", value: money(m.balance) },
              ...(inv.dueDate ? [{ label: "Vencimento", value: fmtDate(new Date(inv.dueDate).toISOString().slice(0, 10)) }] : []),
              { label: "Para", value: to, edit: { path: "to", input: "text" as const, value: to } },
            ],
          },
          { type: "note", text: "O cliente recebe o e-mail com o link para ver e pagar." },
        ],
        confirm: { label: "Enviar e-mail", tone: "send", checkbox: "Enviar para " + to, exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign(exec) } } },
        open: invoiceLink(inv.id),
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi(ctx.req, "POST", "/api/quote-invoices/" + encodeURIComponent(String(exec.invoice_id)) + "/send-email", { to: exec.to });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível enviar a invoice.") };
    return {
      ok: true,
      title: "Invoice " + exec.label + " enviada",
      detail: "Para " + exec.to,
      links: [invoiceLink(String(exec.invoice_id))],
      entity: { type: "invoice", id: String(exec.invoice_id) },
      memory: `Sent invoice ${exec.label} to ${exec.to}`,
    };
  },
};

/* ───────────────────────── record a payment ───────────────────────── */

const METHOD_WORDS: Array<[RegExp, string]> = [
  [/cheque|check/i, "check"],
  [/zelle/i, "zelle"],
  [/venmo/i, "venmo"],
  [/dinheiro|cash|esp[eé]cie|efectivo/i, "cash"],
  [/cart[aã]o|card|cr[eé]dito|d[eé]bito/i, "credit_card"],
  [/ach|transfer|wire|pix/i, "bank_transfer"],
  [/financ/i, "financing"],
];

function methodFrom(v: unknown): string | null {
  const s = str(v, 60).toLowerCase();
  if (!s) return null;
  if (PAYMENT_METHOD_LABELS[s]) return s;
  return METHOD_WORDS.find(([re]) => re.test(s))?.[1] || "other";
}

export const recordPayment: ActionDef = {
  name: "payment.record",
  description: "Record a payment received from a customer on an invoice (amount, method, date).",
  args: {
    invoice: "invoice number if said",
    customer: "customer name",
    amount: "dollar amount received; empty = the whole open balance",
    method: "check | zelle | venmo | cash | credit_card | bank_transfer | financing | other",
    date: "YYYY-MM-DD, default today",
    reference: "check number or reference if said",
  },
  examples: ["O John pagou 2 mil em cheque hoje", "Recebi o Zelle da Maria, 1500", "Mike paid invoice 3012 in full"],
  permissions: ["invoices.record_payment"],
  async prepare(ctx, args) {
    const amount = num(args.amount);
    // When the customer has several open invoices, an amount equal to exactly one balance picks it.
    let r = await resolveInvoice(ctx, args, { openOnly: true });
    if (r.status === "clarify" && amount != null && !args.invoice_id) {
      const ids = r.clarify.options.map((o) => String(o.patch.invoice_id || "")).filter(Boolean);
      if (ids.length) {
        const rows = await ctx.tx.quoteInvoice.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, amount: true, dueDate: true, receipts: { select: { amount: true } } } });
        const exact = rows.filter((x) => Math.abs(computeInvoiceMoney(x).balance - amount) < 0.005);
        if (exact.length === 1) r = await resolveInvoice(ctx, { ...args, invoice_id: exact[0]!.id });
      }
    }
    if (r.status === "clarify") return { kind: "clarify", clarify: r.clarify, args };
    if (r.status === "missing") return { kind: "error", message: r.message, args };
    const inv = r.row;
    if (inv.status === "void") return { kind: "error", message: "Esta invoice foi anulada.", args };
    if (inv.status === "draft") {
      return { kind: "error", message: `A invoice ${inv.invoiceNumber || ""} ainda é rascunho; envie ao cliente antes de registrar pagamento.`, args: { ...args, invoice_id: inv.id } };
    }
    const m = computeInvoiceMoney(inv);
    const resolved = resolvePaymentAmount({ mode: amount == null ? "full" : "partial", amount, balance: m.balance });
    if (!resolved.ok) return { kind: "error", message: resolved.error, args: { ...args, invoice_id: inv.id } };
    const method = methodFrom(args.method);
    if (!method) {
      return {
        kind: "clarify",
        args: { ...args, invoice_id: inv.id },
        clarify: {
          question: "Como foi pago?",
          options: ["check", "zelle", "cash", "credit_card", "bank_transfer", "venmo"].map((k) => ({ label: PAYMENT_METHOD_LABELS[k]!.pt, patch: { method: k } })),
        },
      };
    }
    const date = isIsoDay(args.date) ? String(args.date) : ctx.today;
    if (date > addDays(ctx.today, 1)) return { kind: "error", message: "A data do pagamento não pode ser no futuro.", args };
    const reference = str(args.reference, 120);
    const label = inv.invoiceNumber || "Invoice";
    const exec = {
      invoice_id: inv.id,
      label,
      customer: inv.customer?.name || "",
      body: {
        mode: resolved.settles ? "full" : "partial",
        amount: resolved.amount,
        payment_method: method,
        paid_at: date + "T12:00:00.000Z",
        reference_number: reference || null,
      },
      expected_balance: m.balance,
    };
    return {
      kind: "card",
      args: { ...args, invoice_id: inv.id, method },
      card: {
        title: "Registrar pagamento · " + label,
        subtitle: inv.customer?.name || undefined,
        badge: { text: "Dinheiro", tone: "accent" },
        sections: [
          {
            type: "fields",
            rows: [
              { label: "Valor recebido", value: money(resolved.amount), edit: { path: "amount", input: "money", value: resolved.amount } },
              {
                label: "Forma",
                value: PAYMENT_METHOD_LABELS[method]?.pt || method,
                edit: { path: "method", input: "select", value: method, options: Object.entries(PAYMENT_METHOD_LABELS).filter(([k]) => k !== "card" && k !== "referral_credit").map(([k, v]) => ({ value: k, label: v.pt })) },
              },
              { label: "Data", value: fmtDate(date), edit: { path: "date", input: "date", value: date } },
              ...(reference ? [{ label: "Referência", value: reference }] : []),
            ],
          },
          {
            type: "totals",
            rows: [
              { label: "Saldo antes", value: money(m.balance) },
              { label: "Saldo depois", value: money(Math.max(0, m.balance - resolved.amount)), strong: true },
            ],
          },
          { type: "note", text: resolved.settles ? "Quita a invoice. Nenhum recibo é enviado por e-mail." : "Pagamento parcial. Nenhum recibo é enviado por e-mail." },
        ],
        confirm: { label: "Registrar " + money(resolved.amount), tone: "money", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign(exec) } } },
        open: invoiceLink(inv.id),
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi<{ data?: { receipts?: Array<{ id: string }> } }>(
      ctx.req,
      "POST",
      "/api/quote-invoices/" + encodeURIComponent(String(exec.invoice_id)) + "/receipts",
      exec.body,
    );
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível registrar o pagamento.") };
    const body = exec.body as Record<string, unknown>;
    return {
      ok: true,
      title: "Pagamento de " + money(Number(body.amount)) + " registrado",
      detail: "Invoice " + exec.label + (exec.customer ? " · " + exec.customer : ""),
      links: [invoiceLink(String(exec.invoice_id))],
      entity: { type: "invoice", id: String(exec.invoice_id) },
      memory: `Recorded ${money(Number(body.amount))} payment on invoice ${exec.label}`,
    };
  },
};
