/**
 * Configurações › Mensagens das Faturas — SMS ao enviar o link da invoice.
 * Placeholders: [name] [company] [invoice_number] [amount] [balance] [due_date] [link]
 */
import { z } from "zod";

export type InvoiceShareMessages = {
  sms_body: string;
};

export type InvoiceSettings = {
  share_messages: InvoiceShareMessages;
};

export const DEFAULT_INVOICE_SHARE_MESSAGES: InvoiceShareMessages = {
  sms_body:
    "Hi [name], your invoice [invoice_number] is ready.\n\nBalance due: [balance]\nDue: [due_date]\n\nView & pay here:\n[link]\n\nThank you!",
};

const SHARE_SMS_MAX = 2000;

export function parseInvoiceShareMessages(raw: unknown): InvoiceShareMessages {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const sms =
    typeof o.sms_body === "string" && o.sms_body.trim()
      ? o.sms_body.trim().slice(0, SHARE_SMS_MAX)
      : DEFAULT_INVOICE_SHARE_MESSAGES.sms_body;
  return { sms_body: sms };
}

export function parseInvoiceSettings(raw: unknown): InvoiceSettings {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    share_messages: parseInvoiceShareMessages(o.share_messages),
  };
}

export const invoiceSettingsPatchSchema = z
  .object({
    share_messages: z
      .object({
        sms_body: z.string().trim().min(1, "Indique o texto do SMS").max(SHARE_SMS_MAX),
      })
      .optional(),
  })
  .strict();

export type InvoiceSmsVars = {
  name?: string | null;
  company?: string | null;
  invoice_number?: string | null;
  amount?: string | null;
  balance?: string | null;
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
    due_date: String(vars.due_date || "").trim(),
    link: String(vars.link || "").trim(),
  };
  out = out.replace(/\[name\]/gi, map.name);
  out = out.replace(/\[company\]/gi, map.company);
  out = out.replace(/\[invoice_number\]/gi, map.invoice_number);
  out = out.replace(/\[amount\]/gi, map.amount);
  out = out.replace(/\[balance\]/gi, map.balance);
  out = out.replace(/\[due_date\]/gi, map.due_date);
  out = out.replace(/\[link\]/gi, map.link);
  out = out.replace(/\(\s*\)/g, "");
  out = out.replace(/[ \t]{2,}/g, " ");
  out = out.replace(/[ \t]+\n/g, "\n");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}
