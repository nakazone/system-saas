/** Secure quote-access e-mail — link only, no line items / totals / PDF attachment. */

const DEFAULT_PAL = {
  primary: "#211d1a",
  accent: "#e8792c",
  accentDark: "#a85428",
  muted: "#6b645c",
  rule: "#e2d9cc",
  pageBg: "#f3f0ea",
  white: "#ffffff",
};

const DEFAULT_TAGLINE = "Hardwood · LVP · Refinishing";

export type QuoteAccessEmailInput = {
  companyName: string;
  clientName: string;
  quoteNumber: string;
  publicUrl: string;
  phone?: string | null;
  validUntil?: string | Date | null;
  tagline?: string | null;
  accentColor?: string | null;
  primaryColor?: string | null;
  clientMessage?: string | null;
  /** pt | en — defaults to en (matches public quote e-mail tone) */
  locale?: string | null;
};

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function firstName(full: string): string {
  const t = String(full || "").trim();
  if (!t) return "";
  return t.split(/\s+/)[0] || t;
}

function isPt(locale?: string | null): boolean {
  return String(locale || "")
    .toLowerCase()
    .startsWith("pt");
}

function formatValidUntil(raw: string | Date | null | undefined): string {
  if (raw == null) return "";
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  return String(raw).slice(0, 10);
}

export function buildQuoteAccessEmailHtml(input: QuoteAccessEmailInput): string {
  const accent = (input.accentColor || "").trim() || DEFAULT_PAL.accent;
  const primary = (input.primaryColor || "").trim() || DEFAULT_PAL.primary;
  const accentDark = DEFAULT_PAL.accentDark;
  const muted = DEFAULT_PAL.muted;
  const pt = isPt(input.locale);

  const company = escapeHtml(input.companyName || "ObraMate");
  const greetName = escapeHtml(firstName(input.clientName) || (pt ? "Cliente" : "there"));
  const qn = escapeHtml(String(input.quoteNumber || "").replace(/^#/, ""));
  const tagline = escapeHtml(input.tagline?.trim() || DEFAULT_TAGLINE);
  const safeUrl =
    input.publicUrl && /^https?:\/\//i.test(input.publicUrl) ? input.publicUrl : "";
  const phone = String(input.phone || "").trim();
  const exp = formatValidUntil(input.validUntil);
  const msg = String(input.clientMessage || "").trim();

  const copy = pt
    ? {
        yourQuote: "Seu orçamento",
        hello: `Olá ${greetName},`,
        body:
          "O seu orçamento está pronto. Por segurança, os detalhes e o PDF estão <strong style=\"color:" +
          primary +
          ';">disponíveis apenas pelo botão abaixo</strong> — não neste e-mail.',
        cta: "Ver orçamento",
        orCopy: "Ou copie este link no navegador:",
        noLink: "Link indisponível — entre em contacto connosco.",
        validUntil: "Válido até",
        questions: phone
          ? `Dúvidas? Responda a este e-mail ou ligue ${escapeHtml(phone)}.`
          : "Dúvidas? Responda a este e-mail.",
        signOff: `— ${company}`,
        powered: "Enviado via ObraMate",
      }
    : {
        yourQuote: "Your quote",
        hello: `Hello ${greetName},`,
        body:
          "Your quote is ready. For security, the full details and PDF are <strong style=\"color:" +
          primary +
          ';">only available through the button below</strong> — not in this email.',
        cta: "View your quote",
        orCopy: "Or copy this link into your browser:",
        noLink: "Online link unavailable — please contact us.",
        validUntil: "Valid until",
        questions: phone
          ? `Questions? Reply to this email or call ${escapeHtml(phone)}.`
          : "Questions? Reply to this email.",
        signOff: `— ${company}`,
        powered: "Sent via ObraMate",
      };

  const cta = safeUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto 0;border-collapse:separate;">
<tr><td align="center" style="border-radius:8px;background-color:${accent};">
<a href="${escapeHtml(safeUrl)}" style="display:inline-block;padding:16px 32px;font-size:16px;font-weight:bold;color:${DEFAULT_PAL.white};text-decoration:none;letter-spacing:0.02em;">${copy.cta}</a>
</td></tr></table>
<p style="margin:20px 0 0;font-size:12px;color:${muted};line-height:1.5;text-align:center;">${copy.orCopy}</p>
<p style="margin:6px 0 0;font-size:12px;color:${accentDark};word-break:break-all;text-align:center;"><a href="${escapeHtml(safeUrl)}" style="color:${accentDark};">${escapeHtml(safeUrl)}</a></p>`
    : `<p style="margin:20px 0 0;font-size:14px;color:#b45309;">${copy.noLink}</p>`;

  const expLine = exp
    ? `<p style="margin:16px 0 0;font-size:13px;color:${muted};">${copy.validUntil} <strong style="color:${primary};">${escapeHtml(exp)}</strong></p>`
    : "";

  const msgLine = msg
    ? `<p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:${muted};">${escapeHtml(msg)}</p>`
    : "";

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background-color:${DEFAULT_PAL.pageBg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${DEFAULT_PAL.pageBg};padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;border-collapse:collapse;background-color:${DEFAULT_PAL.white};border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(33,29,26,0.1);font-family:Inter,Segoe UI,Arial,sans-serif;color:${primary};">
<tr><td style="height:5px;background-color:${accent};line-height:5px;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:28px 28px 12px;text-align:center;">
<p style="margin:0;font-size:22px;font-weight:bold;letter-spacing:-0.02em;">${company}</p>
<p style="margin:6px 0 0;font-size:12px;color:${muted};text-transform:uppercase;letter-spacing:0.04em;">${tagline}</p>
</td></tr>
<tr><td style="padding:8px 28px 28px;text-align:center;border-top:1px solid ${DEFAULT_PAL.rule};">
<p style="margin:0 0 4px;font-size:11px;color:${accentDark};font-weight:bold;text-transform:uppercase;letter-spacing:0.08em;">${copy.yourQuote}</p>
<p style="margin:0;font-size:20px;font-weight:bold;color:${primary};">#${qn}</p>
<p style="margin:16px 0 0;font-size:15px;line-height:1.6;color:${primary};">${copy.hello}</p>
<p style="margin:12px 0 0;font-size:14px;line-height:1.65;color:${muted};max-width:420px;margin-left:auto;margin-right:auto;">${copy.body}</p>
${msgLine}
${cta}
${expLine}
<p style="margin:28px 0 0;font-size:12px;color:${muted};line-height:1.5;">${copy.questions}</p>
<p style="margin:8px 0 0;font-size:12px;color:${muted};">${copy.signOff}</p>
<p style="margin:16px 0 0;font-size:11px;color:#a89f94;">${copy.powered}</p>
</td></tr>
</table>
</td></tr></table></body></html>`;
}

export function buildQuoteAccessEmailText(input: QuoteAccessEmailInput): string {
  const pt = isPt(input.locale);
  const company = input.companyName || "ObraMate";
  const greetName = firstName(input.clientName) || (pt ? "Cliente" : "there");
  const qn = String(input.quoteNumber || "").replace(/^#/, "");
  const url = input.publicUrl || "";
  const phone = String(input.phone || "").trim();

  if (pt) {
    return (
      `Olá ${greetName},\n\n` +
      `O seu orçamento #${qn} está pronto. Por segurança, os detalhes e o PDF estão apenas neste link:\n` +
      `${url}\n\n` +
      (input.clientMessage ? `${input.clientMessage}\n\n` : "") +
      (phone ? `Dúvidas? Responda a este e-mail ou ligue ${phone}.\n` : "Dúvidas? Responda a este e-mail.\n") +
      `\n— ${company}\n(Enviado via ObraMate)`
    );
  }

  return (
    `Hello ${greetName},\n\n` +
    `Your quote #${qn} is ready. For security, the full details and PDF are only available at this link:\n` +
    `${url}\n\n` +
    (input.clientMessage ? `${input.clientMessage}\n\n` : "") +
    (phone ? `Questions? Reply to this email or call ${phone}.\n` : "Questions? Reply to this email.\n") +
    `\n— ${company}\n(Sent via ObraMate)`
  );
}

export function defaultQuoteAccessSubject(input: {
  companyName: string;
  quoteNumber: string;
  locale?: string | null;
}): string {
  const qn = String(input.quoteNumber || "").replace(/^#/, "");
  const company = input.companyName || "ObraMate";
  if (isPt(input.locale)) {
    return `Orçamento #${qn} — ${company}`;
  }
  return `Quote #${qn} — ${company}`;
}
