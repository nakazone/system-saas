/**
 * Configurações › Faturas — SMS, e-mails por tipo de pagamento e regra de data na baixa.
 * Placeholders: [name] [company] [invoice_number] [amount] [balance] [paid] [due_date] [link]
 */
import { z } from "zod";

export type InvoiceShareMessages = {
  sms_body: string;
  /** Opening copy when sending a deposit, progress, or custom invoice. */
  email_partial: string;
  /** Opening copy when sending the remaining balance. */
  email_balance: string;
  /** Opening copy when sending a full invoice. */
  email_full: string;
  /** Receipt when a balance remains after this payment. */
  receipt_partial: string;
  /** Receipt when this payment settles the invoice. */
  receipt_full: string;
};

/** Default date suggested when recording a payment (baixa). */
export type InvoicePaymentDateDefault = "today" | "due_date";

export type InvoiceSettings = {
  share_messages: InvoiceShareMessages;
  payment_date_default: InvoicePaymentDateDefault;
  /** Days from issue to the default due date (when no date is given). */
  default_due_days: number;
};

export const DEFAULT_DUE_DAYS = 1;

export function parseDefaultDueDays(raw: unknown): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 120 ? n : DEFAULT_DUE_DAYS;
}

/** Default due date for a new invoice: issue day + the company's default days. */
export function defaultDueDate(invoiceSettings: unknown, from = new Date()): Date {
  const o = invoiceSettings && typeof invoiceSettings === "object" && !Array.isArray(invoiceSettings) ? (invoiceSettings as Record<string, unknown>) : {};
  return new Date(from.getTime() + parseDefaultDueDays(o.default_due_days) * 86400000);
}

export const DEFAULT_INVOICE_SHARE_MESSAGES: InvoiceShareMessages = {
  sms_body:
    "Hi [name], your invoice [invoice_number] is ready.\n\nBalance due: [balance]\nDue: [due_date]\n\nView & pay here:\n[link]\n\nThank you!",
  email_partial:
    "Here is invoice [invoice_number] for a partial payment of [balance].\n\nDue: [due_date]\n\nView and pay:\n[link]",
  email_balance:
    "Here is invoice [invoice_number] for the remaining balance of [balance].\n\nDue: [due_date]\n\nView and pay:\n[link]",
  email_full:
    "Here is invoice [invoice_number] for [amount].\n\nBalance due: [balance]\nDue: [due_date]\n\nView and pay:\n[link]",
  receipt_partial:
    "We received your payment of [paid] for invoice [invoice_number].\n\nRemaining balance: [balance].",
  receipt_full:
    "We received your payment of [paid] for invoice [invoice_number].\n\nThis invoice is now paid in full.",
};

const SHARE_SMS_MAX = 2000;

function shareText(raw: unknown, fallback: string): string {
  return typeof raw === "string" && raw.trim() ? raw.trim().slice(0, SHARE_SMS_MAX) : fallback;
}

export function parseInvoiceShareMessages(raw: unknown): InvoiceShareMessages {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_INVOICE_SHARE_MESSAGES;
  return {
    sms_body: shareText(o.sms_body, d.sms_body),
    email_partial: shareText(o.email_partial, d.email_partial),
    email_balance: shareText(o.email_balance, d.email_balance),
    email_full: shareText(o.email_full, d.email_full),
    receipt_partial: shareText(o.receipt_partial, d.receipt_partial),
    receipt_full: shareText(o.receipt_full, d.receipt_full),
  };
}

/** Which saved e-mail opens a send, from the invoice type. */
export function invoiceEmailBodyForType(messages: InvoiceShareMessages, invoiceType: string | null | undefined): string {
  const t = String(invoiceType || "").toLowerCase();
  if (t === "final") return messages.email_balance;
  if (t === "deposit" || t === "progress" || t === "custom" || t === "other") return messages.email_partial;
  return messages.email_full;
}

export function receiptEmailBody(messages: InvoiceShareMessages, settled: boolean): string {
  return settled ? messages.receipt_full : messages.receipt_partial;
}

export function parsePaymentDateDefault(raw: unknown): InvoicePaymentDateDefault {
  return raw === "due_date" ? "due_date" : "today";
}

export function parseInvoiceSettings(raw: unknown): InvoiceSettings {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    share_messages: parseInvoiceShareMessages(o.share_messages),
    payment_date_default: parsePaymentDateDefault(o.payment_date_default),
    default_due_days: parseDefaultDueDays(o.default_due_days),
  };
}

export const invoiceSettingsPatchSchema = z
  .object({
    share_messages: z
      .object({
        sms_body: z.string().trim().min(1, "Indique o texto do SMS").max(SHARE_SMS_MAX),
        email_partial: z.string().trim().max(SHARE_SMS_MAX).optional(),
        email_balance: z.string().trim().max(SHARE_SMS_MAX).optional(),
        email_full: z.string().trim().max(SHARE_SMS_MAX).optional(),
        receipt_partial: z.string().trim().max(SHARE_SMS_MAX).optional(),
        receipt_full: z.string().trim().max(SHARE_SMS_MAX).optional(),
      })
      .optional(),
    payment_date_default: z.enum(["today", "due_date"]).optional(),
    default_due_days: z.number().int().min(0).max(120).optional(),
  })
  .strict();

export type InvoiceSmsVars = {
  name?: string | null;
  company?: string | null;
  invoice_number?: string | null;
  amount?: string | null;
  balance?: string | null;
  paid?: string | null;
  due_date?: string | null;
  link?: string | null;
};

/** Fill [placeholders] in the configured SMS template. */
export function applyInvoiceShareTemplate(template: string, vars: InvoiceSmsVars): string {
  let out = String(template || "");
  const map: Record<string, string> = {
    name: String(vars.name || "").trim() || "there",
    company: String(vars.company || "").trim(),
    invoice_number: String(vars.invoice_number || "").trim(),
    amount: String(vars.amount || "").trim(),
    balance: String(vars.balance || "").trim(),
    paid: String(vars.paid || "").trim(),
    due_date: String(vars.due_date || "").trim(),
    link: String(vars.link || "").trim(),
  };
  out = out.replace(/\[name\]/gi, map.name);
  out = out.replace(/\[company\]/gi, map.company);
  out = out.replace(/\[invoice_number\]/gi, map.invoice_number);
  out = out.replace(/\[amount\]/gi, map.amount);
  out = out.replace(/\[balance\]/gi, map.balance);
  out = out.replace(/\[paid\]/gi, map.paid);
  out = out.replace(/\[due_date\]/gi, map.due_date);
  out = out.replace(/\[link\]/gi, map.link);
  out = out.replace(/\(\s*\)/g, "");
  out = out.replace(/[ \t]{2,}/g, " ");
  out = out.replace(/[ \t]+\n/g, "\n");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}
