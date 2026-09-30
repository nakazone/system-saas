/** Client e-mails for invoices and payment receipts (English, like the quote e-mail). */

const HEX = /^#[0-9a-fA-F]{6}$/;

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(n: number): string {
  return `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function firstName(full?: string | null): string {
  return String(full || "").trim().split(/\s+/)[0] || "";
}

type Brand = { companyName: string; accentColor?: string | null; primaryColor?: string | null; phone?: string | null };

function shell(brand: Brand, bodyHtml: string): string {
  const accent = brand.accentColor && HEX.test(brand.accentColor) ? brand.accentColor : "#e8792c";
  const primary = brand.primaryColor && HEX.test(brand.primaryColor) ? brand.primaryColor : "#211d1a";
  return `<!doctype html><html><body style="margin:0;background:#f3f0ea;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:${primary}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f0ea;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2d9cc">
<tr><td style="height:5px;background:${accent}"></td></tr>
<tr><td style="padding:28px 32px 8px;font-size:15px;font-weight:700">${esc(brand.companyName)}</td></tr>
<tr><td style="padding:8px 32px 28px;font-size:15px;line-height:1.55">${bodyHtml}</td></tr>
<tr><td style="padding:16px 32px;background:#f7f4ee;color:#6b645c;font-size:12px">${esc(brand.companyName)}${brand.phone ? ` · ${esc(brand.phone)}` : ""}</td></tr>
</table></td></tr></table></body></html>`;
}

function button(url: string, text: string, color: string): string {
  return `<p style="margin:24px 0"><a href="${esc(url)}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px">${esc(text)}</a></p>`;
}

export type InvoiceEmailInput = Brand & {
  clientName?: string | null;
  invoiceNumber: string;
  amount: number;
  balance: number;
  dueDate?: Date | null;
  publicUrl: string;
  message?: string | null;
  paymentInstructions?: string | null;
};

export function invoiceEmail(input: InvoiceEmailInput): { subject: string; text: string; html: string } {
  const hi = firstName(input.clientName) ? `Hi ${firstName(input.clientName)},` : "Hello,";
  const due = input.dueDate ? ` due ${fmtDate(input.dueDate)}` : "";
  const accent = input.accentColor && HEX.test(input.accentColor) ? input.accentColor : "#e8792c";
  const subject = `Invoice ${input.invoiceNumber} from ${input.companyName} — ${money(input.balance)}${due}`;
  const custom = input.message?.trim() || "";
  const text = [
    hi,
    "",
    custom || `Here is invoice ${input.invoiceNumber} for ${money(input.amount)}.`,
    `Balance due: ${money(input.balance)}${due}.`,
    "",
    `View and download your invoice: ${input.publicUrl}`,
    input.paymentInstructions?.trim() ? `\nHow to pay:\n${input.paymentInstructions.trim()}` : "",
    "",
    `Thank you,\n${input.companyName}`,
  ].join("\n");
  const html = shell(
    input,
    `<p style="margin:0 0 12px">${esc(hi)}</p>
<p style="margin:0 0 12px">${esc(custom || `Here is invoice ${input.invoiceNumber} for ${money(input.amount)}.`).replace(/\n/g, "<br>")}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;background:#f7f4ee;border-radius:8px"><tr>
<td style="padding:14px 16px;color:#6b645c;font-size:13px">Balance due${esc(due)}</td>
<td style="padding:14px 16px;text-align:right;font-size:20px;font-weight:700">${money(input.balance)}</td></tr></table>
${button(input.publicUrl, "View invoice", accent)}
${input.paymentInstructions?.trim() ? `<p style="margin:0 0 4px;font-size:12px;font-weight:700;color:${esc(accent)};text-transform:uppercase;letter-spacing:.06em">How to pay</p><p style="margin:0;white-space:pre-line">${esc(input.paymentInstructions.trim())}</p>` : ""}`,
  );
  return { subject, text, html };
}

export type ReceiptEmailInput = Brand & {
  clientName?: string | null;
  receiptNumber: string;
  invoiceNumber: string;
  amount: number;
  paidAt: Date;
  methodLabel?: string | null;
  balance: number;
  publicUrl?: string | null;
};

export function receiptEmail(input: ReceiptEmailInput): { subject: string; text: string; html: string } {
  const hi = firstName(input.clientName) ? `Hi ${firstName(input.clientName)},` : "Hello,";
  const accent = input.accentColor && HEX.test(input.accentColor) ? input.accentColor : "#e8792c";
  const settled = input.balance <= 0.004;
  const subject = `Payment received — receipt ${input.receiptNumber} (${input.companyName})`;
  const lead = `We received your payment of ${money(input.amount)} on ${fmtDate(input.paidAt)}${
    input.methodLabel ? ` (${input.methodLabel})` : ""
  } for invoice ${input.invoiceNumber}.`;
  const tail = settled
    ? `Invoice ${input.invoiceNumber} is now paid in full.`
    : `Remaining balance on invoice ${input.invoiceNumber}: ${money(input.balance)}.`;
  const text = [hi, "", lead, tail, "", "Your receipt is attached as a PDF.", input.publicUrl ? `Invoice: ${input.publicUrl}` : "", "", `Thank you,\n${input.companyName}`].join("\n");
  const html = shell(
    input,
    `<p style="margin:0 0 12px">${esc(hi)}</p>
<p style="margin:0 0 12px">${esc(lead)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;background:#f7f4ee;border-radius:8px">
<tr><td style="padding:12px 16px;color:#6b645c;font-size:13px">Receipt ${esc(input.receiptNumber)}</td><td style="padding:12px 16px;text-align:right;font-size:20px;font-weight:700">${money(input.amount)}</td></tr>
<tr><td style="padding:0 16px 12px;color:#6b645c;font-size:13px">${settled ? "Invoice status" : "Remaining balance"}</td><td style="padding:0 16px 12px;text-align:right;font-weight:700">${settled ? "Paid in full" : money(input.balance)}</td></tr></table>
<p style="margin:0 0 12px">Your receipt is attached as a PDF.</p>
${input.publicUrl ? button(input.publicUrl, "View invoice", accent) : ""}`,
  );
  return { subject, text, html };
}
