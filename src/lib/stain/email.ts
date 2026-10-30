/** Samples de stain — e-mails to the client (English, same look as the quote e-mail). */

const PAL = { ink: "#221E1A", muted: "#667085", rule: "#E5E7EB", page: "#F7F8FA", white: "#ffffff" };
const MATE_EMAIL_ICON = `${(process.env.APP_BASE_URL || "https://obramate.com").replace(/\/+$/, "")}/assets/img/mascot/mate-icon-96.png?v=20261027-m2`;

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function firstName(full: string | null | undefined): string {
  return String(full || "").trim().split(/\s+/)[0] || "there";
}

function shell(company: string, inner: string, accent?: string | null): string {
  const bar = (accent || "").trim() || "#E7792C";
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background-color:${PAL.page};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${PAL.page};padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;border-collapse:collapse;background-color:${PAL.white};border-radius:12px;overflow:hidden;font-family:Inter,Segoe UI,Arial,sans-serif;color:${PAL.ink};">
<tr><td style="height:5px;background-color:${esc(bar)};line-height:5px;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:24px 28px 8px;"><p style="margin:0;font-size:18px;font-weight:bold;">${esc(company)}</p></td></tr>
<tr><td style="padding:8px 28px 28px;">${inner}</td></tr>
<tr><td style="padding:14px 28px;border-top:1px solid ${PAL.rule};font-size:11px;color:${PAL.muted};">
<img src="${MATE_EMAIL_ICON}" width="16" height="16" alt="" style="vertical-align:middle;margin-right:6px;" />Sent via ObraMate</td></tr>
</table></td></tr></table></body></html>`;
}

function button(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 0;border-collapse:separate;">
<tr><td style="border-radius:8px;background-color:${PAL.ink};">
<a href="${esc(url)}" style="display:inline-block;padding:14px 26px;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">${esc(label)}</a>
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:${PAL.muted};">Or open this link: <a href="${esc(url)}" style="color:${PAL.ink};word-break:break-all;">${esc(url)}</a></p>`;
}

export function stainRequestEmail(input: {
  companyName: string;
  clientName?: string | null;
  sampleCount: number;
  woodSpecies?: string | null;
  url: string;
  phone?: string | null;
  accentColor?: string | null;
}): { subject: string; text: string; html: string } {
  const n = input.sampleCount;
  const wood = input.woodSpecies ? ` ${input.woodSpecies}` : "";
  const lead = `We applied ${n} stain sample${n === 1 ? "" : "s"} on your${wood} floor. Please look at them, choose one and sign so we can finish your floors.`;
  const help = input.phone ? `Questions? Reply to this email or call ${input.phone}.` : "Questions? Reply to this email.";
  const html = shell(
    input.companyName,
    `<p style="margin:0;font-size:20px;font-weight:bold;">Choose your stain color</p>
<p style="margin:12px 0 0;font-size:15px;line-height:1.55;">Hi ${esc(firstName(input.clientName))},</p>
<p style="margin:8px 0 0;font-size:15px;line-height:1.55;color:#344054;">${esc(lead)}</p>
${button(input.url, "Choose your color")}
<p style="margin:18px 0 0;font-size:13px;line-height:1.5;color:${PAL.muted};">If you can, look at the samples on your floor in person. Photos and screens change colors. ${esc(help)}</p>`,
    input.accentColor,
  );
  const text = `Hi ${firstName(input.clientName)},\n\n${lead}\n\nChoose your color: ${input.url}\n\n${help}\n— ${input.companyName}`;
  return { subject: `Choose your stain color — ${input.companyName}`, text, html };
}

export function stainApprovedEmail(input: {
  companyName: string;
  clientName?: string | null;
  colorName: string;
  signedAtText: string;
  url: string;
  phone?: string | null;
  accentColor?: string | null;
}): { subject: string; text: string; html: string } {
  const change = "Need to change the color? Call us before the stain goes on. Changes after approval have a fee, and after the stain is applied they need re-sanding.";
  const html = shell(
    input.companyName,
    `<p style="margin:0;font-size:20px;font-weight:bold;">You approved ${esc(input.colorName)}</p>
<p style="margin:12px 0 0;font-size:15px;line-height:1.55;color:#344054;">Thanks, ${esc(firstName(input.clientName))}. Our crew will apply this color on your floor. Your signed confirmation is attached as a PDF.</p>
<p style="margin:12px 0 0;font-size:13px;color:${PAL.muted};">Signed ${esc(input.signedAtText)}</p>
${button(input.url, "View your approval")}
<p style="margin:18px 0 0;font-size:13px;line-height:1.5;color:${PAL.muted};">${esc(change)}${input.phone ? ` ${esc(input.phone)}` : ""}</p>`,
    input.accentColor,
  );
  const text = `Thanks, ${firstName(input.clientName)}. You approved ${input.colorName} (signed ${input.signedAtText}). The PDF is attached.\n\n${input.url}\n\n${change}\n— ${input.companyName}`;
  return { subject: `Stain color approved: ${input.colorName}`, text, html };
}
