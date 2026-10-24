/**
 * Mate AI agent endpoints (panel on every screen):
 *   POST /api/mate-ai/act       text → pick an action → prepare a card / question / answer
 *                               (or action + args + patch → re-prepare without the AI)
 *   POST /api/mate-ai/execute   run a confirmed card (signed token, once)
 *   POST /api/mate-ai/undo      revert within 30 s (reversible actions only)
 *   GET  /api/mate-ai/suggestions  proactive cards and deduped office notifications
 *   GET  /api/mate-ai/context   label for the record on screen
 */
import { Prisma } from "@prisma/client";
import { Router, type Request } from "express";
import { z } from "zod";
import { recordActivity, type ActivityEntityType } from "../../lib/activity/record.js";
import { isAiConfigured } from "../../lib/ai/client.js";
import { normalizeMateAiUnit } from "../../lib/mate-ai/command.js";
import { mateAiPlanSchema, todayInTimezone } from "../../lib/mate-ai/interpret.js";
import { applyPatch, canUse, getAction, listActions, memorySchema, pendingSchema, pickAction, registerAction, type AgentPersona, type ScreenSummary } from "../../lib/mate-ai/agent.js";
import { runLookup } from "../../lib/mate-ai/lookups.js";
import { setPrice } from "../../lib/mate-ai/actions/pricing.js";
import { aiChatTurn, aiProviderHost, getLastAiError } from "../../lib/ai/client.js";
import { mateAiChatModel } from "../../lib/mate-ai/interpret.js";
import { callInternalApi, internalError } from "../../lib/mate-ai/internal-api.js";
import { signActionToken, verifyActionToken } from "../../lib/mate-ai/token.js";
import { editQuote, sendQuote } from "../../lib/mate-ai/actions/quotes.js";
import { INVOICE_MORE_ACTIONS } from "../../lib/mate-ai/actions/invoices-more.js";
import { isImageDataUrl, putAttachment } from "../../lib/mate-ai/attachments.js";
import { LEAD_MORE_ACTIONS } from "../../lib/mate-ai/actions/leads-more.js";
import { CALENDAR_ACTIONS } from "../../lib/mate-ai/actions/calendar.js";
import { JOB_MORE_ACTIONS } from "../../lib/mate-ai/actions/jobs-more.js";
import { CUSTOMER_MORE_ACTIONS } from "../../lib/mate-ai/actions/customers-more.js";
import { FIELD_ACTIONS } from "../../lib/mate-ai/actions/field.js";
import { PAYROLL_ACTIONS } from "../../lib/mate-ai/actions/payroll.js";
import { QUOTE_MORE_ACTIONS } from "../../lib/mate-ai/actions/quotes-more.js";
import { FINANCE_ACTIONS } from "../../lib/mate-ai/actions/finance.js";
import { PRICING_MORE_ACTIONS } from "../../lib/mate-ai/actions/pricing-more.js";
import { MEDIA_CHAT_ACTIONS } from "../../lib/mate-ai/actions/media-chat.js";
import { REPORT_SETTINGS_ACTIONS } from "../../lib/mate-ai/actions/reports-settings.js";
import { EXTRA_ACTIONS } from "../../lib/mate-ai/actions/extras.js";
import { REMINDER_ACTIONS, REMINDER_ACTION_NAMES } from "../../lib/mate-ai/actions/reminders.js";
import { addJobNote, createJob, scheduleJob, setJobStatus } from "../../lib/mate-ai/actions/jobs.js";
import { invoiceFromQuote, recordPayment, sendInvoice } from "../../lib/mate-ai/actions/money.js";
import { createCustomer, createLead, moveLead } from "../../lib/mate-ai/actions/crm.js";
import {
  agendaList,
  approvedWithoutJob,
  customerBalance,
  invoicesOverdue,
  jobsToInvoice,
  moneySummary,
  overdueInvoices,
  quotesFollowUp,
  staleQuotes,
  uninvoicedJobs,
} from "../../lib/mate-ai/actions/insights.js";
import { jobCustomerName, jobLabel, quoteLabel } from "../../lib/mate-ai/actions/resolve.js";
import { fmtDateTime } from "../../lib/mate-ai/actions/time.js";
import type { ActionContext, ActionDef, Card, ExecuteContext, PrepareResult, ScreenContext } from "../../lib/mate-ai/actions/types.js";
import { money, unitLabel } from "../../lib/mate-ai/actions/types.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { notifyUsersPush } from "../../lib/push/notify.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth } from "../http.js";
import { loadCatalog, previewInvoice, previewQuote } from "./mate-ai.js";

export const mateAiAgentRouter = Router();

const EXEC_TTL_MS = 10 * 60 * 1000;
const UNDO_TTL_MS = 30 * 1000;

/* ───────────────────────── the two original actions, as registry actions ───────────────────────── */

const quoteCreate: ActionDef = {
  name: "quote.create",
  description: "Create a new draft quote for a customer with service lines priced from the company's table.",
  args: {
    customer: "customer name as said",
    items: "[{service_ref, service_text, quantity, unit, unit_price?}] — see the catalog below",
    send: "email | sms | link — ONLY when the user also asks to send it (\"cria e manda por e-mail\", or \"envia\" while this quote card is still open/unconfirmed). One confirmation creates and sends.",
    send_to: "e-mail address if the user said a different one",
  },
  examples: [
    "Criar um quote para o John Smith, instalação de 1350 pés de madeira",
    "Quote for Maria with 800 sqft vinyl and 180 linear feet of baseboard",
    "Cria e envia por e-mail um quote pro Naka com 1375 pés de madeira",
  ],
  permissions: ["quotes.create", "customers.view", "pricing.view"],
  async prepare(ctx, args) {
    const items = Array.isArray(args.items) ? args.items : [];
    if (!items.length) {
      return {
        kind: "error",
        message: "Quais serviços e quantidades? Ex.: “1350 pés de instalação de madeira e 400 pés de remoção de carpete”.",
        args,
      };
    }
    const parsed = mateAiPlanSchema.safeParse({ action: "quote", ...args, items });
    if (!parsed.success || parsed.data.action !== "quote") return { kind: "error", message: "Não entendi os serviços do Quote.", args };
    const catalog = await loadCatalog(ctx.tx, ctx.organizationId);
    const r = await previewQuote(ctx.req, ctx.tx, parsed.data, catalog);
    const plan = (r.plan || parsed.data) as unknown as Record<string, unknown>;
    if (r.status === "customer_missing" || r.status === "customer_ambiguous" || r.status === "customer_not_found") {
      return {
        kind: "clarify",
        args: plan,
        clarify: {
          question: r.message,
          options: r.candidates.map((c) => ({ label: c.name, detail: c.company || undefined, patch: { customer_id: c.id } })),
          search: { placeholder: "Buscar cliente", path: "customer_query", clear: ["customer_id"] },
        },
      };
    }
    if (r.status === "needs_clarification") {
      const issue = r.issues.find((i) => i.options?.length) || r.issues.find((i) => i.code === "price_missing") || r.issues[0];
      if (!issue) return { kind: "error", message: "Não consegui montar o Quote.", args: plan };
      if (issue.code === "price_missing" && issue.line >= 1) {
        // Ask the price in the conversation; the answer becomes this line's unit price.
        return {
          kind: "clarify",
          args: plan,
          message: issue.message,
          clarify: {
            question: issue.message,
            options: [],
            search: { placeholder: "Preço em $ (ex.: 1.00)", path: `items.${issue.line - 1}.unit_price` },
          },
        };
      }
      if (!issue.options?.length || issue.line < 1) return { kind: "error", message: issue.message, args: plan };
      const i = issue.line - 1;
      return {
        kind: "clarify",
        args: plan,
        clarify: {
          question: issue.message,
          options: issue.options.map((o) => ({
            label: o.name,
            detail: o.unit,
            patch: { [`items.${i}.catalog_item_id`]: o.id, [`items.${i}.catalog_source`]: o.source, [`items.${i}.unit`]: null, [`items.${i}.candidates`]: null },
          })),
        },
      };
    }
    if (r.status !== "ready") return { kind: "error", message: "Não foi possível preparar o Quote.", args: plan };
    const send = ["email", "sms", "link"].includes(String(args.send || "")) ? String(args.send) : "";
    if (send) plan.send = send;
    if (args.send_to) plan.send_to = args.send_to;
    const contact = await ctx.tx.customer.findFirst({ where: { id: r.customer.id }, select: { email: true, phone: true } });
    const sendTo = String(args.send_to || contact?.email || "").trim();
    if (send === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sendTo)) {
      return {
        kind: "clarify",
        args: plan,
        clarify: { question: `${r.customer.name} não tem e-mail no cadastro. Para qual e-mail enviar o Quote?`, options: [], search: { placeholder: "email@exemplo.com", path: "send_to" } },
      };
    }
    const sendLabel = send === "email" ? "por e-mail" : send === "sms" ? "por SMS" : "o link";
    const assumptions = r.lines
      .filter((l) => l.spoken && l.spoken.trim().toLowerCase() !== l.name.toLowerCase())
      .map((l) => ({ said: l.spoken, chosen: l.name }));
    return {
      kind: "card",
      args: plan,
      card: {
        title: (send ? "Criar e enviar Quote para " : "Criar Quote para ") + r.customer.name,
        subtitle: r.customer.company || undefined,
        badge: send && send !== "link" ? { text: "Vai para o cliente", tone: "warning" } : undefined,
        sections: [
          {
            type: "table",
            columns: ["Serviço", "Qtd", "Preço", "Total"],
            align: ["left", "right", "right", "right"],
            rows: r.lines.map((l) => [l.name, (l.quantity.toLocaleString("en-US") + " " + unitLabel(normalizeMateAiUnit(l.unit) || l.unit)).trim(), money(l.unitPrice), money(l.amount)]),
            editColumn: 1,
            edits: r.lines.map((l, idx) => ({ path: `items.${idx}.quantity`, input: "number" as const, value: l.quantity })),
          },
          {
            type: "totals",
            rows: [
              { label: "Subtotal", value: money(r.totals.subtotal) },
              { label: `Tax (${Number(r.taxRate).toFixed(2)}%)`, value: money(r.totals.taxTotal) },
              { label: "Total", value: money(r.totals.total), strong: true },
            ],
          },
          ...(r.lines.some((l) => l.priceOverride)
            ? [{
                type: "note" as const,
                tone: "warning" as const,
                text:
                  "Preço informado por você (não está na Tabela de Valores): " +
                  r.lines.filter((l) => l.priceOverride).map((l) => `${l.name} ${money(l.unitPrice)}/${unitLabel(normalizeMateAiUnit(l.unit) || l.unit)}`).join(", ") + ".",
              }]
            : []),
          ...(send === "email"
            ? [{ type: "fields" as const, rows: [{ label: "Enviar para", value: sendTo, edit: { path: "send_to", input: "text" as const, value: sendTo } }] }]
            : []),
          {
            type: "note",
            text: !send
              ? "Cria um rascunho. Nada é enviado ao cliente."
              : send === "email"
                ? "Cria o Quote e envia o e-mail com o link para ver e aprovar. O Quote passa para “enviado”."
                : send === "sms"
                  ? "Cria o Quote, gera o link e abre o app de mensagens com o texto pronto."
                  : "Cria o Quote e gera o link para você compartilhar.",
          },
        ],
        assumptions,
        confirm: {
          label: send ? "Criar e enviar " + sendLabel : "Criar Quote em rascunho",
          tone: send && send !== "link" ? "send" : "normal",
          checkbox: send === "email" ? "Enviar para " + sendTo : undefined,
          exec: {
            endpoint: "/api/mate-ai/execute",
            body: {
              token: ctx.sign({
                preview_token: r.previewToken,
                customer: r.customer.name,
                customer_id: r.customer.id,
                send: send || null,
                send_to: send === "email" ? sendTo : null,
                phone: contact?.phone || null,
                overrides: r.lines
                  .filter((l) => l.priceOverride)
                  .map((l) => ({ catalog_item_id: l.catalogItemId, catalog_source: l.catalogSource, pricing_item_id: l.pricingItemId, name: l.name, unit_price: l.unitPrice })),
              }),
            },
          },
        },
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi<{ data?: { id: string; quote_number: string; total: number; customer_name: string; item_count: number } }>(
      ctx.req,
      "POST",
      "/api/mate-ai/quote-drafts",
      { preview_token: exec.preview_token, confirmed_review: true },
    );
    if (!res.ok || !res.json.data?.id) return { ok: false, status: res.status, error: internalError(res, "Não foi possível criar o Quote.") };
    const d = res.json.data;
    const savePrice =
      Array.isArray(exec.overrides) && exec.overrides.length
        ? { label: "Salvar preço", action: "pricing.set", args: { items: exec.overrides, customer_id: exec.customer_id, column: "customer" } }
        : null;
    const created = {
      ok: true as const,
      title: "Quote " + d.quote_number + " criado",
      detail: d.customer_name + " · " + d.item_count + " serviço(s) · " + money(d.total),
      links: [{ label: "Abrir no editor", href: "quote-builder.html?id=" + encodeURIComponent(d.id) }],
      next: savePrice || { label: "Enviar ao cliente", action: "quote.send", args: { quote_id: d.id } },
      entity: { type: "quote", id: d.id },
      memory: `Created draft quote ${d.quote_number} for ${d.customer_name} (${money(d.total)})`,
    };
    if (!exec.send) return created;
    // Same send path as quote.send; a failed send keeps the quote and says why.
    const sent = await sendQuote.execute!(ctx, {
      quote_id: d.id,
      label: d.quote_number,
      channel: exec.send,
      to: exec.send_to,
      phone: exec.phone,
      who: d.customer_name,
    });
    if (!sent.ok) {
      return {
        ...created,
        title: "Quote " + d.quote_number + " criado, mas não foi enviado",
        detail: sent.error,
        next: { label: "Tentar enviar de novo", action: "quote.send", args: { quote_id: d.id, channel: exec.send } },
        memory: created.memory + "; sending failed: " + sent.error,
      };
    }
    return {
      ...sent,
      title: exec.send === "email" ? "Quote " + d.quote_number + " criado e enviado" : sent.title,
      detail: exec.send === "email" ? money(d.total) + " · para " + exec.send_to : sent.detail,
      links: [...(sent.links || []), ...created.links].filter((l, i, all) => all.findIndex((x) => x.href === l.href) === i),
      next: savePrice || undefined,
      entity: created.entity,
      memory: created.memory + "; " + (sent.memory || "sent"),
    };
  },
};

const invoiceJob: ActionDef = {
  name: "invoice.job",
  description: "Issue an invoice for an existing JOB (work order): full, remaining balance, deposit % or a custom amount, with a due date.",
  args: {
    job: "job number like '1042', title or address; empty when only the customer was named or on the job screen",
    customer: "customer name if said",
    invoice_type: "auto | full | final | deposit | progress | custom",
    deposit_pct: "number for deposits",
    amount: "dollar amount for custom/progress",
    due_date: "YYYY-MM-DD if said",
  },
  examples: ["Emitir a invoice do job 1042 para sexta", "Fatura de depósito de 30% para o trabalho da Maria"],
  permissions: ["invoices.view", "invoices.manage"],
  async prepare(ctx, args) {
    const raw: Record<string, unknown> = { action: "invoice", job_query: "", customer_query: "", invoice_type: "auto", ...args };
    if (!raw.job_id && !String(raw.job_query || "") && !String(raw.customer_query || "") && ctx.screen?.type === "job") raw.job_id = ctx.screen.id;
    const parsed = mateAiPlanSchema.safeParse(raw);
    if (!parsed.success || parsed.data.action !== "invoice") return { kind: "error", message: "Qual job devo faturar? Diga o número do job.", args };
    if (!parsed.data.job_id && !parsed.data.job_query && !parsed.data.customer_query) {
      return { kind: "clarify", args: parsed.data as unknown as Record<string, unknown>, clarify: { question: "Qual job devo faturar?", options: [], search: { placeholder: "Número do job, cliente ou endereço", path: "job_query", clear: ["job_id"] } } };
    }
    const r = await previewInvoice(ctx.req, ctx.tx, parsed.data, ctx.today);
    const plan = (r.plan || parsed.data) as unknown as Record<string, unknown>;
    if (r.status === "job_ambiguous" || r.status === "job_not_found") {
      return {
        kind: "clarify",
        args: plan,
        clarify: {
          question: r.message,
          options: r.candidates.map((j) => ({
            label: (j.number != null ? "#" + j.number + " · " : "") + j.title,
            detail: [j.customer_name, j.billing.billing_status_label, j.billing.remaining_to_invoice > 0 ? "falta " + money(j.billing.remaining_to_invoice) : null].filter(Boolean).join(" · "),
            patch: { job_id: j.id },
          })),
          search: { placeholder: "Número do job, cliente ou endereço", path: "job_query", clear: ["job_id"] },
        },
      };
    }
    if (r.status !== "ready") return { kind: "error", message: r.message, args: plan };
    const p = r.plan as Record<string, unknown>;
    const type = String(p.invoice_type);
    return {
      kind: "card",
      args: plan,
      card: {
        title: "Emitir invoice do job " + (r.job.number != null ? "#" + r.job.number + " · " : "") + r.job.title,
        subtitle: r.job.customer_name || undefined,
        badge: { text: "Dinheiro", tone: "accent" },
        sections: [
          {
            type: "fields",
            rows: [
              {
                label: "Tipo",
                value: r.invoice.type_label + (type === "deposit" && p.deposit_pct ? ` (${p.deposit_pct}%)` : ""),
                edit: {
                  path: "invoice_type",
                  input: "select",
                  value: type,
                  options: [
                    { value: "full", label: "Valor total" },
                    { value: "final", label: "Saldo restante" },
                    { value: "deposit", label: "Depósito" },
                    { value: "progress", label: "Parcial" },
                    { value: "custom", label: "Valor específico" },
                  ],
                },
              },
              ...(type === "deposit" ? [{ label: "Depósito %", value: String(p.deposit_pct ?? ""), edit: { path: "deposit_pct", input: "number" as const, value: (p.deposit_pct as number) ?? null } }] : []),
              ...(type === "progress" || type === "custom" ? [{ label: "Valor", value: money(Number(p.custom_amount || 0)), edit: { path: "custom_amount", input: "money" as const, value: (p.custom_amount as number) ?? null } }] : []),
              {
                label: "Vencimento",
                value: r.invoice.due_date ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "short" }).format(new Date(r.invoice.due_date + "T12:00:00Z")) : "padrão das configurações",
                edit: { path: "due_date", input: "date", value: r.invoice.due_date },
              },
            ],
          },
          {
            type: "totals",
            rows: [
              { label: "Total dos serviços", value: money(r.job.billing.services_total) },
              { label: "Já faturado", value: money(r.job.billing.invoiced_total) },
              { label: "Esta invoice", value: money(r.invoice.amount), strong: true },
            ],
          },
          { type: "note", text: "A invoice é emitida e aparece em Invoices. Nenhum e-mail é enviado." },
        ],
        confirm: { label: "Emitir invoice de " + money(r.invoice.amount), tone: "money", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ preview_token: r.previewToken }) } } },
        open: { label: "Abrir job", href: "job-detail.html?id=" + encodeURIComponent(r.job.id) },
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi<{ data?: { id: string; invoice_number?: string; amount: number; due_date?: string } }>(
      ctx.req,
      "POST",
      "/api/mate-ai/invoices",
      { preview_token: exec.preview_token, confirmed_review: true },
    );
    if (!res.ok || !res.json.data?.id) return { ok: false, status: res.status, error: internalError(res, "Não foi possível emitir a invoice.") };
    const d = res.json.data;
    return {
      ok: true,
      title: "Invoice " + (d.invoice_number || "") + " emitida",
      detail: money(d.amount),
      links: [{ label: "Abrir invoice", href: "invoice.html?id=" + encodeURIComponent(d.id) }],
      next: { label: "Enviar ao cliente", action: "invoice.send", args: { invoice_id: d.id } },
      entity: { type: "invoice", id: d.id },
      memory: `Issued invoice ${d.invoice_number || d.id} (${money(d.amount)})`,
    };
  },
};

for (const def of [
  ...INVOICE_MORE_ACTIONS,
  ...LEAD_MORE_ACTIONS,
  ...CALENDAR_ACTIONS,
  ...JOB_MORE_ACTIONS,
  ...CUSTOMER_MORE_ACTIONS,
  ...FIELD_ACTIONS,
  ...PAYROLL_ACTIONS,
  ...QUOTE_MORE_ACTIONS,
  ...FINANCE_ACTIONS,
  ...PRICING_MORE_ACTIONS,
  ...MEDIA_CHAT_ACTIONS,
  ...REPORT_SETTINGS_ACTIONS,
  ...EXTRA_ACTIONS,
  ...REMINDER_ACTIONS,
  setPrice,
  quoteCreate,
  editQuote,
  sendQuote,
  invoiceJob,
  invoiceFromQuote,
  sendInvoice,
  recordPayment,
  createLead,
  moveLead,
  createCustomer,
  createJob,
  scheduleJob,
  setJobStatus,
  addJobNote,
  agendaList,
  moneySummary,
  customerBalance,
  jobsToInvoice,
  quotesFollowUp,
  invoicesOverdue,
]) {
  registerAction(def);
}

/* ───────────────────────── helpers ───────────────────────── */

const screenSchema = z
  .object({ type: z.enum(["customer", "lead", "job", "quote", "invoice"]), id: z.string().uuid() })
  .nullable()
  .optional();

async function orgTimezone(organizationId: string): Promise<string> {
  return withTenantTransaction(organizationId, async (tx) => {
    const org = await tx.organization.findFirst({ where: { id: organizationId }, select: { timezone: true } });
    return org?.timezone || "America/New_York";
  });
}

async function screenSummary(tx: ActionContext["tx"], screen: ScreenContext): Promise<ScreenSummary> {
  if (!screen) return null;
  if (screen.type === "job") {
    const j = await tx.workOrder.findFirst({
      where: { id: screen.id },
      select: { number: true, title: true, sourceName: true, customer: { select: { name: true, company: true } }, builder: { select: { firstName: true, lastName: true, company: true } } },
    });
    if (!j) return null;
    const who = jobCustomerName(j);
    return { type: "job", id: screen.id, label: "Job " + jobLabel(j) + (who ? " · " + who : "") };
  }
  if (screen.type === "quote") {
    const q = await tx.quote.findFirst({ where: { id: screen.id }, select: { number: true, quoteNumber: true, title: true, customer: { select: { name: true } } } });
    if (!q) return null;
    return { type: "quote", id: screen.id, label: "Quote " + quoteLabel(q) + (q.customer ? " · " + q.customer.name : "") };
  }
  if (screen.type === "invoice") {
    const i = await tx.quoteInvoice.findFirst({ where: { id: screen.id }, select: { invoiceNumber: true, customer: { select: { name: true } } } });
    if (!i) return null;
    return { type: "invoice", id: screen.id, label: "Invoice " + (i.invoiceNumber || "") + (i.customer ? " · " + i.customer.name : "") };
  }
  if (screen.type === "customer") {
    const c = await tx.customer.findFirst({ where: { id: screen.id }, select: { name: true } });
    return c ? { type: "customer", id: screen.id, label: "Cliente " + c.name } : null;
  }
  const l = await tx.lead.findFirst({ where: { id: screen.id }, select: { name: true } });
  return l ? { type: "lead", id: screen.id, label: "Lead " + l.name } : null;
}

function cardOut(card: Card | undefined, agentCapabilities?: unknown) {
  if (!card || agentCapabilities === undefined) return card;
  const filterRuns = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(filterRuns);
    if (!value || typeof value !== "object") return value;
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === "run" && item && typeof item === "object") {
        const action = String((item as Record<string, unknown>).action || "");
        if (!agentCanUseAction(agentCapabilities, action)) continue;
      }
      output[key] = filterRuns(item);
    }
    return output;
  };
  return filterRuns(card) as Card;
}

/* ───────────────────────── /act ───────────────────────── */

const actSchema = z
  .object({
    text: z.string().trim().min(1).max(600).optional(),
    action: z.string().max(60).optional(),
    agent_key: z.string().regex(/^[a-z0-9_-]{1,60}$/i).optional(),
    args: z.record(z.string(), z.unknown()).optional(),
    patch: z.record(z.string(), z.unknown()).optional(),
    screen: screenSchema,
    memory: memorySchema.optional(),
    pending: pendingSchema,
    /** A photo taken or picked in the panel (data URL), for actions that use one. */
    attachment: z.string().max(17_000_000).optional(),
  })
  .refine((b) => Boolean(b.text || b.action), { message: "text or action required" });

/** Capabilities are an additional allowlist for a named office agent. CRM permissions still apply. */
const AGENT_ACTIONS: Record<string, readonly string[]> = {
  "office.summary": ["money.summary", "agenda.list", "invoices.overdue", "jobs.uninvoiced", "customer.balance", "quotes.followup"],
  "leads.search": ["leads.new", "leads.stale"],
  "customers.search": ["customer.overview"],
  "quotes.prepare": ["quote.create", "quote.edit", "quotes.followup"],
  "quotes.send": ["quote.send"],
  "jobs.view": ["agenda.list"],
  "jobs.manage": ["job.create", "job.status", "job.note"],
  "schedule.view": ["agenda.list", "schedule.free"],
  "schedule.manage": ["job.schedule", "meeting.create", "meeting.move", "meeting.cancel", "jobs.reschedule"],
  "crews.view": ["schedule.free"],
  "invoices.view": ["money.summary", "invoices.overdue", "jobs.uninvoiced", "customer.balance"],
  "invoices.manage": ["invoice.quote", "invoice.job", "invoice.send", "invoice.remind", "invoice.due", "invoice.link"],
  "payments.view": ["customer.balance", "money.summary"],
  "payments.manage": ["payment.record", "receipt.send"],
};

const DEPARTMENT_LABELS: Record<string, string> = { central: "Coordenação", commercial: "Comercial", operations: "Operações", finance: "Financeiro" };
/** Which office department each suggestion belongs to (same split as the office page). */
const SUGGESTION_DEPARTMENTS: Record<string, string> = {
  "quote.send": "commercial",
  "quotes.followup": "commercial",
  "job.create": "operations",
  "invoices.overdue": "finance",
  "jobs.uninvoiced": "finance",
};

/** The employee's voice: who they are, their colleagues and what is on their desk now. */
async function agentPersona(
  req: AuthedRequest,
  agent: { key: string; name: string; title: string; department: string; description: string; personality?: string | null; followUpStyle?: string },
): Promise<AgentPersona> {
  const organizationId = req.organizationId!;
  const timezone = await orgTimezone(organizationId);
  const [org, team, suggestions, reminders] = await Promise.all([
    withTenantTransaction(organizationId, (tx) => tx.organization.findFirst({ where: { id: organizationId }, select: { name: true } })),
    withTenantTransaction(organizationId, (tx) =>
      tx.virtualAgent.findMany({ where: { organizationId, enabled: true }, select: { key: true, name: true, title: true, department: true } }),
    ),
    officeSuggestions(req).catch(() => [] as Suggestion[]),
    withTenantTransaction(organizationId, (tx) =>
      tx.officeReminder.findMany({
        where: { organizationId, userId: req.user!.id, status: "open", ...(agent.department === "central" ? {} : { agentKey: agent.key }) },
        orderBy: { dueAt: "asc" },
        take: 8,
        select: { text: true, dueAt: true },
      }),
    ).catch(() => [] as Array<{ text: string; dueAt: Date }>),
  ]);
  const manager = agent.department === "central";
  const now = Date.now();
  const mine = suggestions.filter((item) => manager || SUGGESTION_DEPARTMENTS[item.run.action] === agent.department);
  return {
    name: agent.name,
    title: agent.title,
    department: DEPARTMENT_LABELS[agent.department] || agent.department,
    description: agent.description,
    manager,
    company: org?.name || undefined,
    colleagues: team
      .filter((member) => member.key !== agent.key)
      .map((member) => `${member.name} (${member.title}, ${DEPARTMENT_LABELS[member.department] || member.department})`),
    desk: mine.slice(0, 5).map((item) => {
      const owner = manager ? DEPARTMENT_LABELS[SUGGESTION_DEPARTMENTS[item.run.action] || "central"] : "";
      return `${owner ? `[${owner}] ` : ""}${item.title}${item.detail ? ` (${item.detail})` : ""}`;
    }),
    personality: agent.personality || null,
    followUpStyle: agent.followUpStyle || "normal",
    reminders: reminders.map((r) => `${r.text} — ${fmtDateTime(r.dueAt, timezone)}${r.dueAt.getTime() <= now ? " (já passou da hora)" : ""}`),
  };
}

function agentCanUseAction(capabilities: unknown, action: string): boolean {
  // Every employee keeps personal reminders for the user, whatever their area.
  if (REMINDER_ACTION_NAMES.has(action)) return true;
  if (!Array.isArray(capabilities)) return false;
  return capabilities.some((capability) =>
    typeof capability === "string" && AGENT_ACTIONS[capability]?.includes(action),
  );
}

function agentCanUsePayload(capabilities: unknown, action: string, payload: unknown): boolean {
  if (!agentCanUseAction(capabilities, action)) return false;
  if (action === "quote.create" && payload && typeof payload === "object" && String((payload as Record<string, unknown>).send || "").trim()) {
    return agentCanUseAction(capabilities, "quote.send");
  }
  return true;
}

mateAiAgentRouter.post("/api/mate-ai/act", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = actSchema.safeParse(req.body || {});
    if (!body.success) {
      res.status(400).json({ success: false, error: "Pedido inválido" });
      return;
    }
    const organizationId = req.organizationId!;
    const user = req.user!;
    const agentKey = body.data.agent_key;
    const agent = agentKey
      ? await withTenantTransaction(organizationId, (tx) =>
          tx.virtualAgent.findFirst({
            where: { organizationId, key: agentKey, enabled: true },
            select: { key: true, name: true, title: true, department: true, description: true, capabilities: true, personality: true, followUpStyle: true },
          }),
        )
      : null;
    if (agentKey && !agent) {
      res.status(404).json({ success: false, error: "Este funcionário virtual está inativo ou não existe mais." });
      return;
    }
    const timezone = await orgTimezone(organizationId);
    const today = todayInTimezone(timezone).date;
    const allowed = listActions().filter((a) => canUse(a, user) && (!agent || agentCanUseAction(agent.capabilities, a.name)));
    const persona = agent && body.data.text ? await agentPersona(req, agent) : undefined;
    let screen: ScreenContext = body.data.screen ?? null;

    let action = body.data.action || "";
    let args: Record<string, unknown> = body.data.args || {};
    let interpretedBy: "ai" | "rules" | "user" = "user";
    let note: string | undefined;
    let aiError: string | undefined;

    const prepared = await withTenantTransaction(organizationId, async (tx) => {
      const summary = await screenSummary(tx, screen);
      if (!summary) screen = null;

      if (body.data.text) {
        const [catalog, customers] = await Promise.all([
          loadCatalog(tx, organizationId),
          isAiConfigured()
            ? Promise.resolve([])
            : tx.customer.findMany({ where: { organizationId }, select: { id: true, name: true, company: true }, orderBy: { updatedAt: "desc" }, take: 3000 }),
        ]);
        return { summary, catalog, customers };
      }
      return { summary, catalog: [], customers: [] };
    });

    const photoId = isImageDataUrl(body.data.attachment) ? putAttachment(organizationId, user.id, body.data.attachment) : null;

    if (body.data.text) {
      const pending = body.data.pending && allowed.some((a) => a.name === body.data.pending!.action) && JSON.stringify(body.data.pending.args).length < 12_000 ? body.data.pending : null;
      const pick = await pickAction(photoId ? body.data.text + "\n[O usuário anexou uma foto a este pedido.]" : body.data.text, {
        actions: allowed,
        catalog: prepared.catalog,
        customers: prepared.customers,
        timezone,
        screen: prepared.summary,
        memory: body.data.memory || [],
        pending,
        userName: user.name || undefined,
        persona,
        lookup: (name, a) =>
          withTenantTransaction(organizationId, (tx) => runLookup({ tx, timezone, catalog: prepared.catalog }, name, a)),
      });
      interpretedBy = pick.source;
      aiError = pick.aiError && user.roleKey === "admin" ? pick.aiError : undefined;
      if (pick.kind === "reply") {
        res.json({ success: true, type: "reply", message: pick.reply, interpreted_by: interpretedBy, screen: prepared.summary, ...(aiError ? { ai_error: aiError } : {}) });
        return;
      }
      action = pick.action;
      args = pick.args;
      note = pick.reply;
    }
    if (photoId && getAction(action)?.acceptsPhoto) args = { ...args, photo_id: photoId };

    const def = getAction(action);
    if (!def) {
      res.status(404).json({ success: false, error: "Ação desconhecida." });
      return;
    }
    if (!canUse(def, user)) {
      res.status(403).json({ success: false, error: "Você não tem permissão para isso.", missing: def.permissions.filter((p) => !user.permissions.includes(p)) });
      return;
    }
    if (agent && !agentCanUseAction(agent.capabilities, def.name)) {
      res.status(403).json({ success: false, error: `${agent.name} não tem capacidade para executar essa ação.` });
      return;
    }
    if (body.data.patch) args = applyPatch(args, body.data.patch);
    if (agent && !agentCanUsePayload(agent.capabilities, def.name, args)) {
      res.status(403).json({ success: false, error: `${agent.name} pode preparar o orçamento, mas não tem capacidade para enviá-lo.` });
      return;
    }

    const result: PrepareResult = await withTenantTransaction(organizationId, async (tx) => {
      const ctx: ActionContext = {
        req,
        tx,
        organizationId,
        userId: user.id,
        timezone,
        today,
        screen,
        recent: (body.data.memory || [])
          .map((m) => m.entity)
          .filter((e): e is { type: string; id: string } => Boolean(e && e.id))
          .reverse(),
        sign: (exec) => signActionToken({ k: "exec", a: def.name, o: organizationId, u: user.id, e: exec, ...(agent ? { agentKey: agent.key } : {}), ttlMs: EXEC_TTL_MS }).token,
        agentKey: agent?.key,
      };
      return def.prepare(ctx, args);
    });

    res.json({
      success: true,
      type: result.kind,
      action: def.name,
      read_only: Boolean(def.readOnly),
      args: result.args ?? args,
      ...(result.kind === "card" || result.kind === "answer" ? { card: cardOut(result.card, agent?.capabilities) } : {}),
      ...(result.kind === "clarify" ? { clarify: result.clarify } : {}),
      message: result.kind === "error" ? result.message : result.message || note,
      interpreted_by: interpretedBy,
      screen: prepared.summary,
      ...(aiError ? { ai_error: aiError } : {}),
    });
  } catch (error) {
    next(error);
  }
});

/* ───────────────────────── /execute ───────────────────────── */

async function claim(organizationId: string, userId: string, tokenId: string, action: string, agentKey?: string): Promise<boolean> {
  return withTenantTransaction(organizationId, async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text AS locked", tokenId);
    const seen = await tx.activityEvent.findFirst({ where: { entityType: "mate_ai", entityId: tokenId }, select: { id: true } });
    if (seen) return false;
    await tx.activityEvent.create({
      data: { organizationId, entityType: "mate_ai", entityId: tokenId, actorType: "user", actorId: userId, action: "mate_ai.executing", changes: { action: { from: null, to: action }, ...(agentKey ? { agent: { from: null, to: agentKey } } : {}) } },
    });
    return true;
  });
}

async function release(organizationId: string, tokenId: string) {
  await withTenantTransaction(organizationId, (tx) => tx.activityEvent.deleteMany({ where: { entityType: "mate_ai", entityId: tokenId } }));
}

const ACTIVITY_TYPES = new Set<ActivityEntityType>(["quote", "invoice", "work_order", "lead", "customer"]);

mateAiAgentRouter.post("/api/mate-ai/execute", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const token = verifyActionToken(String((req.body || {}).token || ""), "exec");
    if (!token || token.o !== req.organizationId || token.u !== req.user!.id) {
      res.status(400).json({ success: false, error: "Esta confirmação expirou. Peça de novo ao Mate AI." });
      return;
    }
    const def = getAction(token.a);
    if (!def?.execute) {
      res.status(404).json({ success: false, error: "Ação desconhecida." });
      return;
    }
    if (!canUse(def, req.user)) {
      res.status(403).json({ success: false, error: "Você não tem permissão para isso." });
      return;
    }
    const organizationId = req.organizationId!;
    if (token.agentKey) {
      const agent = await withTenantTransaction(organizationId, (tx) =>
        tx.virtualAgent.findFirst({
          where: { organizationId, key: token.agentKey, enabled: true },
          select: { name: true, capabilities: true },
        }),
      );
      if (!agent || !agentCanUsePayload(agent.capabilities, def.name, token.e)) {
        res.status(403).json({ success: false, error: "As capacidades desse funcionário mudaram. Prepare a ação novamente." });
        return;
      }
    }
    if (!(await claim(organizationId, req.user!.id, token.id, def.name, token.agentKey))) {
      res.status(409).json({ success: false, error: "Esta ação já foi feita." });
      return;
    }
    const exclude = Array.isArray((req.body || {}).exclude)
      ? ((req.body as { exclude: unknown[] }).exclude.filter((x) => typeof x === "string").slice(0, 500) as string[])
      : [];
    const g = (req.body || {}).geo as { lat?: unknown; lng?: unknown; accuracy?: unknown } | undefined;
    const geo =
      g && Number.isFinite(Number(g.lat)) && Number.isFinite(Number(g.lng)) && Math.abs(Number(g.lat)) <= 90 && Math.abs(Number(g.lng)) <= 180
        ? { lat: Number(g.lat), lng: Number(g.lng), accuracy: Number.isFinite(Number(g.accuracy)) ? Number(g.accuracy) : null }
        : null;
    const ctx: ExecuteContext = { req: req as AuthedRequest & Request, organizationId, userId: req.user!.id, timezone: await orgTimezone(organizationId), exclude, geo };
    let result;
    try {
      result = await def.execute(ctx, token.e);
    } catch (error) {
      await release(organizationId, token.id);
      throw error;
    }
    if (!result.ok) {
      await release(organizationId, token.id);
      res.status(result.status >= 400 ? result.status : 422).json({ success: false, error: result.error });
      return;
    }
    const done = result;
    await withTenantTransaction(organizationId, async (tx) => {
      await tx.activityEvent.updateMany({
        where: { entityType: "mate_ai", entityId: token.id },
        data: {
          action: "mate_ai.executed",
          changes: {
            action: { from: null, to: def.name },
            title: { from: null, to: done.title },
            detail: { from: null, to: done.detail ?? null },
            links: { from: null, to: (done.links || []).slice(0, 3) },
            entity: { from: null, to: done.entity ?? null },
             ...(token.agentKey ? { agent: { from: null, to: token.agentKey } } : {}),
           } as Prisma.InputJsonValue,
        },
      });
      if (done.entity && ACTIVITY_TYPES.has(done.entity.type as ActivityEntityType)) {
        await recordActivity(tx, {
          organizationId,
          entityType: done.entity.type as ActivityEntityType,
          entityId: done.entity.id,
          actorType: "user",
          actorId: req.user!.id,
          action: "mate_ai.action",
          changes: { source: { from: null, to: "mate_ai" }, action: { from: null, to: def.name }, summary: { from: null, to: done.title }, ...(token.agentKey ? { agent: { from: null, to: token.agentKey } } : {}) },
        });
      }
    });
    const undo = done.undo && def.undo ? signActionToken({ k: "undo", a: def.name, o: organizationId, u: req.user!.id, e: done.undo, ttlMs: UNDO_TTL_MS }) : null;
    res.json({
      success: true,
      result: {
        title: done.title,
        detail: done.detail,
        links: done.links || [],
        next: done.next || null,
        client: done.client || null,
        memory: done.memory || done.title,
        entity: done.entity || null,
      },
      undo_token: undo?.token || null,
      undo_expires_at: undo ? new Date(undo.expiresAt).toISOString() : null,
    });
  } catch (error) {
    next(error);
  }
});

/* ───────────────────────── /undo ───────────────────────── */

mateAiAgentRouter.post("/api/mate-ai/undo", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const token = verifyActionToken(String((req.body || {}).token || ""), "undo");
    if (!token || token.o !== req.organizationId || token.u !== req.user!.id) {
      res.status(400).json({ success: false, error: "O tempo para desfazer acabou." });
      return;
    }
    const def = getAction(token.a);
    if (!def?.undo || !canUse(def, req.user)) {
      res.status(403).json({ success: false, error: "Esta ação não pode ser desfeita aqui." });
      return;
    }
    const organizationId = req.organizationId!;
    if (!(await claim(organizationId, req.user!.id, token.id, def.name + ":undo"))) {
      res.status(409).json({ success: false, error: "Já foi desfeito." });
      return;
    }
    const result = await def.undo({ req: req as AuthedRequest & Request, organizationId, userId: req.user!.id, timezone: await orgTimezone(organizationId) }, token.e);
    if (!result.ok) {
      await release(organizationId, token.id);
      res.status(result.status >= 400 ? result.status : 422).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true, result: { title: result.title, memory: "Undid: " + result.title } });
  } catch (error) {
    next(error);
  }
});

/* ───────────────────────── /suggestions ───────────────────────── */

type Suggestion = { id: string; tone: "accent" | "warning" | "critical" | "neutral"; title: string; detail?: string; run: { label: string; action: string; args: Record<string, unknown> } };

/** Proactive cards (Início, panel, office desks). Only what this user may act on. */
async function officeSuggestions(req: AuthedRequest): Promise<Suggestion[]> {
    const user = req.user!;
    const organizationId = req.organizationId!;
    const timezone = await orgTimezone(organizationId);
    const today = todayInTimezone(timezone).date;
    const can = (name: string) => {
      const def = getAction(name);
      return Boolean(def && canUse(def, user));
    };
    const suggestions = await withTenantTransaction(organizationId, async (tx) => {
      const ctx = { req, tx, organizationId, userId: user.id, timezone, today, screen: null, sign: () => "" } as ActionContext;
      const out: Suggestion[] = [];
      if (can("jobs.uninvoiced") && can("invoice.job")) {
        const jobs = await uninvoicedJobs(ctx, 50);
        if (jobs.length) {
          const total = jobs.reduce((s, x) => s + x.b.remaining_to_invoice, 0);
          out.push({
            id: "uninvoiced",
            tone: "accent",
            title: `${jobs.length} job(s) concluído(s) sem invoice · ${money(total)}`,
            detail: jobs.slice(0, 3).map((x) => jobLabel(x.j)).join(", "),
            run: { label: "Ver e faturar", action: "jobs.uninvoiced", args: {} },
          });
        }
      }
      if (can("invoices.overdue")) {
        const overdue = await overdueInvoices(ctx, 50);
        if (overdue.length) {
          const total = overdue.reduce((s, x) => s + x.m.balance, 0);
          out.push({
            id: "overdue",
            tone: "critical",
            title: `${money(total)} vencidos em ${overdue.length} invoice(s)`,
            detail: overdue.slice(0, 3).map((x) => x.r.customer?.name || x.r.invoiceNumber).filter(Boolean).join(", "),
            run: { label: "Ver vencidas", action: "invoices.overdue", args: {} },
          });
        }
      }
      if (can("quotes.followup")) {
        const stale = (await staleQuotes(ctx, 5, 40)).filter((q) => q.viewedAt);
        if (stale.length) {
          const q = stale[0]!;
          out.push({
            id: "viewed-no-answer",
            tone: "warning",
            title:
              stale.length === 1
                ? `${q.customer?.name || "O cliente"} abriu o Quote ${q.quoteNumber || "#" + q.number} e não respondeu`
                : `${stale.length} clientes abriram o Quote e não responderam`,
            detail: stale.length === 1 ? money(Number(q.total)) : stale.slice(0, 3).map((x) => x.customer?.name).filter(Boolean).join(", "),
            run: stale.length === 1 ? { label: "Reenviar", action: "quote.send", args: { quote_id: q.id } } : { label: "Ver Quotes", action: "quotes.followup", args: { days: 5 } },
          });
        }
      }
      if (can("job.create")) {
        const approved = await approvedWithoutJob(ctx, 5);
        for (const q of approved.slice(0, 2)) {
          out.push({
            id: "approved-" + q.id,
            tone: "neutral",
            title: `Quote ${q.quoteNumber || "#" + q.number} aprovado, sem job`,
            detail: [q.customer?.name, money(Number(q.total))].filter(Boolean).join(" · "),
            run: { label: "Criar job", action: "job.create", args: { quote_id: q.id } },
          });
        }
      }
      return out;
    });
    return suggestions;
}

async function notifyOfficeSuggestions(req: AuthedRequest, suggestions: Suggestion[]): Promise<void> {
  const organizationId = req.organizationId!;
  const userId = req.user!.id;
  const priority = { critical: 0, warning: 1, accent: 2, neutral: 3 } as const;
  const pending = suggestions
    .filter((suggestion) => suggestion.run?.action)
    .slice()
    .sort((a, b) => priority[a.tone] - priority[b.tone]);
  if (!pending.length) return;

  const today = todayInTimezone(await orgTimezone(organizationId)).date;
  const departmentByAction: Record<string, string> = {
    "quote.send": "commercial",
    "quotes.followup": "commercial",
    "job.create": "operations",
    "jobs.uninvoiced": "finance",
    "invoices.overdue": "finance",
  };
  const defaultNames: Record<string, string> = {
    central: "Mate",
    commercial: "Lara",
    operations: "Rafael",
    finance: "Marina",
  };

  const prepared = await withTenantTransaction(organizationId, async (tx) => {
    const agents = await tx.virtualAgent.findMany({
      where: { organizationId, enabled: true },
      select: { department: true, name: true },
    });
    const ownerByDepartment = new Map(agents.map((agent) => [agent.department, agent.name] as const));
    return pending.map((suggestion) => {
      const department = departmentByAction[suggestion.run!.action] || "central";
      const owner = ownerByDepartment.get(department) || defaultNames[department] || "Mate";
      const label = String(suggestion.run?.label || "revisar").toLowerCase();
      const body = [
        `Oi, aqui é ${owner}.`,
        suggestion.detail,
        `O próximo passo é ${label}. Abra o Escritório para revisar isso comigo.`,
      ]
        .filter(Boolean)
        .join(" · ");
      return {
        notification: {
          organizationId,
          userId,
          type: "mate.pending_action",
          title: `${owner}: ${suggestion.title}`.slice(0, 180),
          body: body.slice(0, 2000),
          url: "/escritorio-ia.html",
          dedupeKey: `office-pending:${today}:${suggestion.id}`.slice(0, 180),
        },
        owner,
        suggestion,
        nextStep: label,
      };
    });
  });

  const created = await withTenantTransaction(organizationId, (tx) =>
    tx.staffNotification.createMany({ data: prepared.map((item) => item.notification), skipDuplicates: true }),
  );
  if (created.count > 0 && prepared[0]) {
    const first = prepared[0];
    void notifyUsersPush(organizationId, [userId], {
      title: `${first.owner}: ${first.suggestion.title}`.slice(0, 180),
      body: [
        `Oi, aqui é ${first.owner}.`,
        first.suggestion.detail,
        `O próximo passo é ${first.nextStep}. Abra o Escritório para revisar comigo${pending.length > 1 ? `; há mais ${pending.length - 1} ${pending.length === 2 ? "ação" : "ações"} esperando` : ""}.`,
      ].filter(Boolean).join(" ").slice(0, 180),
      url: "/escritorio-ia.html",
      tag: `office-pending-${today}`,
    }).catch((error) => console.error("[mate-ai] office pending push failed", error));
  }
}

mateAiAgentRouter.get("/api/mate-ai/suggestions", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const suggestions = await officeSuggestions(req);
    await notifyOfficeSuggestions(req, suggestions);
    res.json({ success: true, data: suggestions });
  } catch (error) {
    next(error);
  }
});

/* ───────────────────────── /context ───────────────────────── */

mateAiAgentRouter.get("/api/mate-ai/context", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const parsed = screenSchema.safeParse({ type: req.query.type, id: req.query.id });
    if (!parsed.success || !parsed.data) {
      res.json({ success: true, screen: null });
      return;
    }
    const screen = parsed.data;
    const summary = await withTenantTransaction(req.organizationId!, (tx) => screenSummary(tx, screen));
    const chips: Record<string, string[]> = {
      job: ["Marcar como concluído", "Emitir invoice", "Agendar", "Adicionar nota"],
      quote: ["Enviar ao cliente", "Dar desconto", "Emitir invoice de depósito", "Criar job"],
      invoice: ["Enviar ao cliente", "Registrar pagamento"],
      customer: ["Criar Quote", "Quanto deve?", "Criar job"],
      lead: ["Agendar visita", "Marcar como perdido", "Criar Quote"],
    };
    res.json({ success: true, screen: summary, suggestions: summary ? chips[summary.type] || [] : [] });
  } catch (error) {
    next(error);
  }
});

/* ───────────────────────── /diagnostics (admins) ───────────────────────── */

mateAiAgentRouter.get("/api/mate-ai/diagnostics", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (req.user?.roleKey !== "admin") {
      res.status(403).json({ success: false, error: "Somente administradores." });
      return;
    }
    const model = mateAiChatModel();
    const out: Record<string, unknown> = { configured: isAiConfigured(), provider: aiProviderHost(), model, last_error: getLastAiError() };
    if (isAiConfigured() && String(req.query.probe || "") === "1") {
      const t0 = Date.now();
      const plain = await aiChatTurn({ model, json: true, countUse: false, timeoutMs: 20_000, messages: [{ role: "system", content: 'Return JSON {"ok": true}.' }, { role: "user", content: "ping" }] });
      out.json_mode = plain.ok ? { ok: true, model: plain.model, ms: Date.now() - t0 } : { ok: false, status: plain.status ?? null, error: plain.error };
      const t1 = Date.now();
      const tools = await aiChatTurn({
        model,
        countUse: false,
        timeoutMs: 20_000,
        toolChoice: "required",
        tools: [{ type: "function", function: { name: "reply", description: "Reply", parameters: { type: "object", properties: { message: { type: "string" } }, required: ["message"] } } }],
        messages: [{ role: "user", content: "Say hi with the reply tool." }],
      });
      out.tools_mode = tools.ok ? { ok: tools.toolCalls.length > 0, model: tools.model, ms: Date.now() - t1 } : { ok: false, status: tools.status ?? null, error: tools.error };
    }
    res.json({ success: true, ...out });
  } catch (error) {
    next(error);
  }
});
