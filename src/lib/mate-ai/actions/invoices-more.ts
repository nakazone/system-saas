/**
 * Invoices beyond issue/send/pay: reminders in bulk, due date, void, receipts, payment links,
 * and removing a payment entered by mistake. Every write goes through the invoice routes.
 */
import { computeInvoiceMoney, PAYMENT_METHOD_LABELS } from "../../invoices/core.js";
import { callInternalApi, internalError } from "../internal-api.js";
import { resolveInvoice } from "./resolve.js";
import { addDays, fmtDate, isIsoDay } from "./time.js";
import type { ActionDef, PickItem } from "./types.js";
import { dayIn, isEmail, kept, money, num, plural, runEach, str } from "./types.js";

const enc = encodeURIComponent;

function invoiceLink(id: string) {
  return { label: "Abrir invoice", href: "invoice.html?id=" + enc(id) };
}

/* ───────────────────────── reminders in bulk ───────────────────────── */

export const remindInvoices: ActionDef = {
  name: "invoice.remind",
  description:
    "Send payment reminders (the invoice e-mail again) to every customer with an overdue invoice, optionally only those late more than N days or of one customer. Shows the list to confirm.",
  args: { min_days: "only invoices overdue at least this many days (default 1)", customer: "only this customer (optional)" },
  examples: ["Cobra todo mundo que está vencido há mais de 15 dias", "Manda lembrete das invoices vencidas", "Send reminders for overdue invoices"],
  permissions: ["invoices.manage"],
  async prepare(ctx, args) {
    const minDays = Math.max(0, Math.round(num(args.min_days) ?? 1));
    const cutoff = addDays(ctx.today, -minDays);
    const customer = str(args.customer, 120);
    const rows = await ctx.tx.quoteInvoice.findMany({
      where: {
        status: { notIn: ["void", "draft", "paid"] },
        dueDate: { not: null },
        ...(customer ? { customer: { name: { contains: customer, mode: "insensitive" } } } : {}),
      },
      select: { id: true, invoiceNumber: true, status: true, amount: true, dueDate: true, receipts: { select: { amount: true } }, customer: { select: { name: true, email: true } } },
      orderBy: { dueDate: "asc" },
      take: 200,
    });
    const late = rows
      .map((r) => ({ r, m: computeInvoiceMoney(r), due: dayIn(r.dueDate, ctx.timezone)! }))
      .filter((x) => x.m.balance > 0.004 && x.due <= cutoff);
    if (!late.length) {
      return { kind: "answer", args, card: { title: minDays > 1 ? `Nada vencido há mais de ${minDays} dias` : "Nenhuma invoice vencida", sections: [{ type: "note", text: "Ninguém para cobrar agora.", tone: "good" }] } };
    }
    const withEmail = late.filter((x) => isEmail(x.r.customer?.email || ""));
    const noEmail = late.length - withEmail.length;
    const items: PickItem[] = withEmail.map((x) => {
      const days = Math.round((Date.parse(ctx.today) - Date.parse(x.due)) / 864e5);
      return {
        id: x.r.id,
        title: `${x.r.customer?.name || "Cliente"} · ${money(x.m.balance)}`,
        detail: `${x.r.invoiceNumber || "Invoice"} · venceu há ${plural(days, "dia", "dias")}`,
        meta: x.r.customer?.email || "",
        tone: days > 30 ? "critical" : "warning",
      };
    });
    const total = withEmail.reduce((s, x) => s + x.m.balance, 0);
    const exec = { items: withEmail.map((x) => ({ id: x.r.id, label: x.r.invoiceNumber || "Invoice", who: x.r.customer?.name || "" })) };
    return {
      kind: "card",
      args,
      card: {
        title: `Cobrar ${plural(withEmail.length, "invoice vencida", "invoices vencidas")}`,
        subtitle: money(total) + " em aberto",
        badge: { text: "Vai para os clientes", tone: "warning" },
        sections: [
          { type: "pick", items },
          ...(noEmail ? [{ type: "note" as const, tone: "warning" as const, text: `${plural(noEmail, "invoice vencida não tem", "invoices vencidas não têm")} e-mail do cliente e ficaram de fora.` }] : []),
          { type: "note", text: "Cada cliente recebe de novo o e-mail da invoice, com o saldo e o link para pagar." },
        ],
        confirm: { label: "Enviar lembretes", tone: "send", checkbox: "Enviar para os clientes marcados", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign(exec) } } },
        open: { label: "Abrir Invoices", href: "invoices.html" },
      },
    };
  },
  async execute(ctx, exec) {
    const items = kept(ctx, (exec.items || []) as Array<{ id: string; label: string; who: string }>);
    if (!items.length) return { ok: false, status: 400, error: "Nenhuma invoice marcada." };
    const r = await runEach(items, async (it) => {
      const res = await callInternalApi(ctx.req, "POST", `/api/quote-invoices/${enc(it.id)}/send-email`, {});
      return { ok: res.ok, error: internalError(res, "falhou") };
    });
    if (!r.done.length) return { ok: false, status: 502, error: "Nenhum lembrete foi enviado: " + (r.failed[0]?.error || "erro") };
    return {
      ok: true,
      title: `${plural(r.done.length, "lembrete enviado", "lembretes enviados")}`,
      detail: r.failed.length ? `Falharam: ${r.failed.map((f) => f.item.label + " (" + f.error + ")").join(", ")}` : r.done.map((d) => d.who).join(", "),
      links: [{ label: "Abrir Invoices", href: "invoices.html" }],
      memory: `Sent payment reminders for ${r.done.map((d) => d.label).join(", ")}`,
    };
  },
};

/* ───────────────────────── due date ───────────────────────── */

export const setInvoiceDue = {
  name: "invoice.due",
  description: "Change the due date of an existing invoice.",
  args: { invoice: "invoice number", customer: "customer name", due_date: "new due date YYYY-MM-DD" },
  examples: ["Muda o vencimento da invoice 1032 para dia 30", "Push the Smith invoice due date to Friday"],
  permissions: ["invoices.manage"],
  async prepare(ctx, args) {
    const r = await resolveInvoice(ctx, args, { openOnly: true });
    if (r.status === "clarify") return { kind: "clarify", clarify: r.clarify, args };
    if (r.status === "missing") return { kind: "error", message: r.message, args };
    const inv = r.row;
    const a = { ...args, invoice_id: inv.id };
    if (!isIsoDay(args.due_date)) {
      return { kind: "clarify", args: a, clarify: { question: "Qual o novo vencimento?", options: [7, 15, 30].map((d) => ({ label: `Em ${d} dias`, detail: fmtDate(addDays(ctx.today, d)), patch: { due_date: addDays(ctx.today, d) } })) } };
    }
    const before = dayIn(inv.dueDate, ctx.timezone);
    const label = inv.invoiceNumber || "Invoice";
    return {
      kind: "card",
      args: a,
      card: {
        title: "Mudar vencimento da " + label,
        subtitle: inv.customer?.name || undefined,
        sections: [
          {
            type: "fields",
            rows: [
              { label: "Antes", value: before ? fmtDate(before) : "sem vencimento" },
              { label: "Novo vencimento", value: fmtDate(String(args.due_date)), edit: { path: "due_date", input: "date", value: String(args.due_date) } },
            ],
          },
        ],
        confirm: { label: "Mudar vencimento", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ invoice_id: inv.id, label, due: args.due_date, before }) } } },
        open: invoiceLink(inv.id),
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi(ctx.req, "PATCH", "/api/quote-invoices/" + enc(String(exec.invoice_id)), { due_date: exec.due });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível mudar o vencimento.") };
    return {
      ok: true,
      title: `Vencimento da ${exec.label}: ${fmtDate(String(exec.due))}`,
      links: [invoiceLink(String(exec.invoice_id))],
      entity: { type: "invoice", id: String(exec.invoice_id) },
      undo: exec.before ? { invoice_id: exec.invoice_id, label: exec.label, due: exec.before } : undefined,
      memory: `Changed due date of ${exec.label} to ${exec.due}`,
    };
  },
  async undo(ctx, u) {
    const res = await callInternalApi(ctx.req, "PATCH", "/api/quote-invoices/" + enc(String(u.invoice_id)), { due_date: u.due });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível desfazer.") };
    return { ok: true, title: `Vencimento da ${u.label} voltou para ${fmtDate(String(u.due))}` };
  },
} satisfies ActionDef;

/* ───────────────────────── void ───────────────────────── */

export const voidInvoice: ActionDef = {
  name: "invoice.void",
  description: "Void (cancel) an invoice issued by mistake. Not possible when it has payments.",
  args: { invoice: "invoice number", customer: "customer name", reason: "why (optional)" },
  examples: ["Anula a invoice 1032", "Cancela a invoice do Mike, foi emitida errada", "Void invoice 1032"],
  permissions: ["invoices.manage"],
  async prepare(ctx, args) {
    const r = await resolveInvoice(ctx, args);
    if (r.status === "clarify") return { kind: "clarify", clarify: r.clarify, args };
    if (r.status === "missing") return { kind: "error", message: r.message, args };
    const inv = r.row;
    const label = inv.invoiceNumber || "Invoice";
    if (inv.status === "void") return { kind: "error", message: `A ${label} já está anulada.`, args };
    if (inv.receipts.length) return { kind: "error", message: `A ${label} tem pagamentos. Remova os pagamentos antes de anular.`, args: { ...args, invoice_id: inv.id } };
    const reason = str(args.reason, 300);
    return {
      kind: "card",
      args: { ...args, invoice_id: inv.id },
      card: {
        title: "Anular a " + label,
        subtitle: inv.customer?.name || undefined,
        badge: { text: "Não dá para desfazer", tone: "critical" },
        sections: [
          {
            type: "fields",
            rows: [
              { label: "Valor", value: money(Number(inv.amount)) },
              { label: "Motivo", value: reason || "—", edit: { path: "reason", input: "text", value: reason } },
            ],
          },
          { type: "note", text: "O link de pagamento para de funcionar e a invoice sai do a receber." },
        ],
        confirm: { label: "Anular invoice", tone: "money", checkbox: "Anular a " + label, exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ invoice_id: inv.id, label, reason }) } } },
        open: invoiceLink(inv.id),
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi(ctx.req, "POST", `/api/quote-invoices/${enc(String(exec.invoice_id))}/void`, { reason: exec.reason || null });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível anular.") };
    return { ok: true, title: `${exec.label} anulada`, links: [invoiceLink(String(exec.invoice_id))], entity: { type: "invoice", id: String(exec.invoice_id) }, memory: `Voided ${exec.label}` };
  },
};

/* ───────────────────────── receipts and payments ───────────────────────── */

async function invoiceReceipts(ctx: Parameters<ActionDef["prepare"]>[0], invoiceId: string) {
  return ctx.tx.invoiceReceipt.findMany({
    where: { invoiceId },
    select: { id: true, amount: true, method: true, paidAt: true, referenceNumber: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

function receiptLabel(r: { amount: unknown; method: string | null; paidAt: Date | null; createdAt: Date }, tz: string) {
  const labels = PAYMENT_METHOD_LABELS as unknown as Record<string, { pt?: string } | string>;
  const l = r.method ? labels[r.method] : null;
  const method = typeof l === "string" ? l : l?.pt || r.method || "pagamento";
  return `${money(Number(r.amount))} · ${method} · ${fmtDate(dayIn(r.paidAt || r.createdAt, tz)!)}`;
}

export const sendReceipt: ActionDef = {
  name: "receipt.send",
  description: "E-mail the payment receipt of an invoice to the customer (the latest payment unless said otherwise).",
  args: { invoice: "invoice number", customer: "customer name", to: "e-mail if different" },
  examples: ["Manda o recibo do pagamento do John", "Send the receipt for invoice 1032"],
  permissions: ["invoices.record_payment"],
  async prepare(ctx, args) {
    const r = await resolveInvoice(ctx, args);
    if (r.status === "clarify") return { kind: "clarify", clarify: r.clarify, args };
    if (r.status === "missing") return { kind: "error", message: r.message, args };
    const inv = r.row;
    const receipts = await invoiceReceipts(ctx, inv.id);
    if (!receipts.length) return { kind: "error", message: `A ${inv.invoiceNumber || "invoice"} ainda não tem pagamento.`, args };
    const pick = receipts.find((x) => x.id === args.receipt_id) || receipts[0]!;
    const to = str(args.to, 200) || inv.customer?.email || "";
    const a = { ...args, invoice_id: inv.id, receipt_id: pick.id };
    if (!isEmail(to)) {
      return { kind: "clarify", args: a, clarify: { question: "Para qual e-mail mandar o recibo?", options: [], search: { placeholder: "email@exemplo.com", path: "to" } } };
    }
    return {
      kind: "card",
      args: a,
      card: {
        title: "Enviar recibo",
        subtitle: (inv.customer?.name || "") + " · " + (inv.invoiceNumber || ""),
        badge: { text: "Vai para o cliente", tone: "warning" },
        sections: [
          {
            type: "fields",
            rows: [
              {
                label: "Pagamento",
                value: receiptLabel(pick, ctx.timezone),
                ...(receipts.length > 1 ? { edit: { path: "receipt_id", input: "select" as const, value: pick.id, options: receipts.map((x) => ({ value: x.id, label: receiptLabel(x, ctx.timezone) })) } } : {}),
              },
              { label: "Para", value: to, edit: { path: "to", input: "text", value: to } },
            ],
          },
        ],
        confirm: { label: "Enviar recibo", tone: "send", checkbox: "Enviar para " + to, exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ receipt_id: pick.id, invoice_id: inv.id, to }) } } },
        open: invoiceLink(inv.id),
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi(ctx.req, "POST", `/api/invoice-receipts/${enc(String(exec.receipt_id))}/send`, { to: exec.to });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível enviar o recibo.") };
    return { ok: true, title: "Recibo enviado", detail: "Para " + exec.to, entity: { type: "invoice", id: String(exec.invoice_id) }, memory: `Sent receipt to ${exec.to}` };
  },
};

export const removePayment: ActionDef = {
  name: "payment.remove",
  description: "Remove a payment recorded by mistake on an invoice (the balance goes back up).",
  args: { invoice: "invoice number", customer: "customer name" },
  examples: ["Lancei errado o pagamento do John, desfaz", "Remove the last payment on invoice 1032"],
  permissions: ["invoices.record_payment"],
  async prepare(ctx, args) {
    const r = await resolveInvoice(ctx, args);
    if (r.status === "clarify") return { kind: "clarify", clarify: r.clarify, args };
    if (r.status === "missing") return { kind: "error", message: r.message, args };
    const inv = r.row;
    const receipts = await invoiceReceipts(ctx, inv.id);
    if (!receipts.length) return { kind: "error", message: `A ${inv.invoiceNumber || "invoice"} não tem pagamento para remover.`, args };
    const pick = receipts.find((x) => x.id === args.receipt_id) || receipts[0]!;
    const label = inv.invoiceNumber || "Invoice";
    return {
      kind: "card",
      args: { ...args, invoice_id: inv.id, receipt_id: pick.id },
      card: {
        title: "Remover pagamento da " + label,
        subtitle: inv.customer?.name || undefined,
        badge: { text: "Dinheiro", tone: "critical" },
        sections: [
          {
            type: "fields",
            rows: [
              {
                label: "Pagamento",
                value: receiptLabel(pick, ctx.timezone) + (pick.referenceNumber ? " · nº " + pick.referenceNumber : ""),
                ...(receipts.length > 1 ? { edit: { path: "receipt_id", input: "select" as const, value: pick.id, options: receipts.map((x) => ({ value: x.id, label: receiptLabel(x, ctx.timezone) })) } } : {}),
              },
            ],
          },
          { type: "note", text: "O saldo da invoice volta a subir. Para lançar o valor certo, registre o pagamento de novo depois." },
        ],
        confirm: { label: "Remover pagamento", tone: "money", checkbox: "Remover " + money(Number(pick.amount)) + " da " + label, exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ invoice_id: inv.id, receipt_id: pick.id, label, amount: Number(pick.amount) }) } } },
        open: invoiceLink(inv.id),
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi(ctx.req, "DELETE", `/api/quote-invoices/${enc(String(exec.invoice_id))}/receipts/${enc(String(exec.receipt_id))}`);
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível remover o pagamento.") };
    return {
      ok: true,
      title: `Pagamento de ${money(Number(exec.amount))} removido da ${exec.label}`,
      links: [invoiceLink(String(exec.invoice_id))],
      next: { label: "Registrar o valor certo", action: "payment.record", args: { invoice_id: exec.invoice_id } },
      entity: { type: "invoice", id: String(exec.invoice_id) },
      memory: `Removed payment ${money(Number(exec.amount))} from ${exec.label}`,
    };
  },
};

/* ───────────────────────── payment link ───────────────────────── */

export const invoiceLinkAction: ActionDef = {
  name: "invoice.link",
  description: "Get the public payment link of an invoice to paste in WhatsApp or SMS (a draft becomes sent).",
  args: { invoice: "invoice number", customer: "customer name" },
  examples: ["Me dá o link de pagamento da invoice 1032", "Link da invoice do John pra mandar no WhatsApp"],
  permissions: ["invoices.manage"],
  async prepare(ctx, args) {
    const r = await resolveInvoice(ctx, args, { openOnly: true });
    if (r.status === "clarify") return { kind: "clarify", clarify: r.clarify, args };
    if (r.status === "missing") return { kind: "error", message: r.message, args };
    const inv = r.row;
    const label = inv.invoiceNumber || "Invoice";
    if (inv.status === "void") return { kind: "error", message: `A ${label} está anulada.`, args };
    const m = computeInvoiceMoney(inv);
    return {
      kind: "card",
      args: { ...args, invoice_id: inv.id },
      card: {
        title: "Link de pagamento da " + label,
        subtitle: inv.customer?.name || undefined,
        sections: [
          { type: "fields", rows: [{ label: "Saldo", value: money(m.balance) }] },
          ...(inv.status === "draft" ? [{ type: "note" as const, tone: "warning" as const, text: "A invoice está em rascunho: gerar o link marca como enviada." }] : []),
        ],
        confirm: { label: "Gerar e copiar link", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ invoice_id: inv.id, label }) } } },
        open: invoiceLink(inv.id),
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi<{ public_url?: string }>(ctx.req, "POST", `/api/quote-invoices/${enc(String(exec.invoice_id))}/public-link`, {});
    const url = res.json.public_url;
    if (!res.ok || !url) return { ok: false, status: res.status, error: internalError(res, "Não foi possível gerar o link.") };
    return { ok: true, title: "Link da " + exec.label + " copiado", detail: url, links: [{ label: "Abrir link", href: url }], client: { type: "copy", text: url }, entity: { type: "invoice", id: String(exec.invoice_id) }, memory: `Shared payment link of ${exec.label}` };
  },
};

export const INVOICE_MORE_ACTIONS: ActionDef[] = [remindInvoices, setInvoiceDue, voidInvoice, sendReceipt, removePayment, invoiceLinkAction];
