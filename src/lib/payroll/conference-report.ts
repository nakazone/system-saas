/**
 * Folha — relatório de conferência (e-mail HTML + PDF).
 * Visual alinhado ao ticket de serviço público (ink / accent / cream).
 */
import PDFDocument from "pdfkit";
import { loadLogoBuffer } from "../quotes/pdf.js";

const BASE = {
  primary: "#211d1a",
  accent: "#e8792c",
  muted: "#8a8074",
  ink2: "#4a433d",
  rule: "#e8dfd2",
  cream: "#f7f4ee",
  white: "#ffffff",
  green: "#1a7a3a",
  red: "#b42318",
  pillBg: "#eef1f6",
  pillInk: "#3d4b63",
  warnBg: "#fff6e8",
  warnLine: "#f0d9b0",
};

const HEX = /^#[0-9a-fA-F]{6}$/;

function palette(primary?: string | null, accent?: string | null) {
  return {
    ...BASE,
    primary: primary && HEX.test(primary) ? primary : BASE.primary,
    accent: accent && HEX.test(accent) ? accent : BASE.accent,
  };
}

function usd(n: number) {
  return (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function escapeHtml(s: string) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function firstName(full: string) {
  const t = String(full || "").trim();
  if (!t) return "";
  return t.split(/\s+/)[0] || t;
}

function initials(name: string) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  return (String(name || "O").replace(/[^A-Za-z0-9]/g, "").slice(0, 2) || "O").toUpperCase();
}

/** Helvetica (WinAnsi) — strip combining marks and fancy dashes. */
function pdfText(s: string, maxLen?: number) {
  let t = String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u2014|\u2013/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/[^\u0020-\u007E\u00A0-\u00FF]/g, "");
  if (maxLen != null) t = t.slice(0, maxLen);
  return t;
}

export type ConferenceDayLine = {
  dateLabel: string;
  detail: string;
  amount: number;
};

export type ConferenceReportInput = {
  org: {
    name: string;
    logoUrl?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
    primaryColor?: string | null;
    accentColor?: string | null;
  };
  employeeName: string;
  sectorLabel: string;
  payTypeLabel: string;
  periodLabel: string;
  days: ConferenceDayLine[];
  gross: number;
  reimbursement: number;
  discount: number;
  net: number;
  waitingNote?: string | null;
};

export function buildConferenceText(input: ConferenceReportInput): string {
  const org = input.org.name || "ObraMate";
  const lines = input.days.map((d) => `• ${d.dateLabel}${d.detail ? ` · ${d.detail}` : ""} · ${usd(d.amount)}`);
  const parts = [
    `${org} — Folha para conferência`,
    "",
    `Olá${firstName(input.employeeName) ? `, ${firstName(input.employeeName)}` : ""}!`,
    `Período: ${input.periodLabel}`,
    `Setor: ${input.sectorLabel} · ${input.payTypeLabel}`,
    "",
    "Dias aprovados:",
    lines.length ? lines.join("\n") : "• Nenhum dia aprovado nesta semana",
    "",
    `Subtotal: ${usd(input.gross)}`,
  ];
  if (input.reimbursement) parts.push(`Reembolso: +${usd(input.reimbursement)}`);
  if (input.discount) parts.push(`Desconto: −${usd(input.discount)}`);
  parts.push(`Total a receber: ${usd(input.net)}`);
  if (input.waitingNote) parts.push("", input.waitingNote);
  parts.push("", "Por favor confira os valores e confirme com o escritório antes do pagamento.");
  parts.push(`— ${org}`);
  return parts.join("\n");
}

/** E-mail table-based (clients strip most CSS) — ticket de serviço look. */
export function buildConferenceEmailHtml(input: ConferenceReportInput): string {
  const PAL = palette(input.org.primaryColor, input.org.accentColor);
  const org = escapeHtml(input.org.name || "ObraMate");
  const greet = escapeHtml(firstName(input.employeeName) || input.employeeName);
  const period = escapeHtml(input.periodLabel);
  const sector = escapeHtml(input.sectorLabel);
  const payType = escapeHtml(input.payTypeLabel);
  const name = escapeHtml(input.employeeName);

  const dayRows = input.days.length
    ? input.days
        .map(
          (d, i) => `<tr>
  <td style="padding:12px 0;${i ? `border-top:1px solid ${PAL.rule};` : ""}vertical-align:top;">
    <div style="font-weight:800;font-size:14px;color:${PAL.primary};">${escapeHtml(d.dateLabel)}</div>
    ${d.detail ? `<div style="margin-top:2px;font-size:12.5px;color:${PAL.muted};font-weight:600;">${escapeHtml(d.detail)}</div>` : ""}
  </td>
  <td style="padding:12px 0;${i ? `border-top:1px solid ${PAL.rule};` : ""}text-align:right;vertical-align:top;font-weight:800;font-size:14px;color:${PAL.primary};white-space:nowrap;">${usd(d.amount)}</td>
</tr>`,
        )
        .join("")
    : `<tr><td colspan="2" style="padding:8px 0;color:${PAL.muted};font-weight:600;font-size:14px;">Nenhum dia aprovado nesta semana.</td></tr>`;

  const adjRows = [
    input.reimbursement
      ? `<tr><td style="padding:8px 0;color:${PAL.ink2};font-size:14px;">Reembolso</td><td style="padding:8px 0;text-align:right;font-weight:800;color:${PAL.green};">+${usd(input.reimbursement)}</td></tr>`
      : "",
    input.discount
      ? `<tr><td style="padding:8px 0;color:${PAL.ink2};font-size:14px;">Desconto</td><td style="padding:8px 0;text-align:right;font-weight:800;color:${PAL.red};">−${usd(input.discount)}</td></tr>`
      : "",
  ].join("");

  const waitingBlock = input.waitingNote
    ? `<tr><td style="padding:14px 16px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:${PAL.warnBg};border:1px solid ${PAL.warnLine};border-radius:12px;">
  <tr><td style="padding:12px 14px;font-size:13px;color:${PAL.primary};font-weight:600;line-height:1.45;">${escapeHtml(input.waitingNote)}</td></tr>
  </table>
</td></tr>`
    : "";

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background-color:${PAL.cream};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${PAL.cream};padding:0 0 32px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;border-collapse:collapse;font-family:'Plus Jakarta Sans',Segoe UI,Arial,sans-serif;color:${PAL.primary};">

<tr><td style="background-color:${PAL.primary};padding:18px 20px 56px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:40px;height:40px;border-radius:10px;background-color:${PAL.accent};color:#fff;font-weight:800;font-size:18px;text-align:center;vertical-align:middle;line-height:40px;">${escapeHtml(initials(input.org.name || "O"))}</td>
<td style="padding-left:12px;vertical-align:middle;">
<div style="font-weight:800;font-size:16px;color:#fff;line-height:1.2;">${org}</div>
<div style="font-size:12.5px;color:rgba(255,255,255,0.7);font-weight:600;">Folha para conferência</div>
</td>
</tr></table>
</td></tr>

<tr><td style="padding:0 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:-40px;background-color:${PAL.white};border-radius:18px;border-collapse:separate;box-shadow:0 6px 24px rgba(33,29,26,0.10);">
<tr><td style="padding:18px 18px 16px;">
<p style="margin:0 0 10px;font-size:14px;color:${PAL.muted};font-weight:600;">Olá${greet ? `, ${greet}` : ""}! Confira sua folha antes do pagamento.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:8px;"><tr>
<td style="font-size:12px;font-weight:800;color:${PAL.muted};letter-spacing:0.02em;padding-right:8px;">${period}</td>
<td style="background:${PAL.pillBg};color:${PAL.pillInk};font-size:12px;font-weight:800;padding:3px 10px;border-radius:999px;">${sector}</td>
</tr></table>
<h1 style="margin:0;font-size:22px;line-height:1.25;font-weight:800;letter-spacing:-0.01em;color:${PAL.primary};">${name}</h1>
<p style="margin:4px 0 0;color:${PAL.ink2};font-size:14.5px;font-weight:600;">${payType}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border-top:1px solid ${PAL.rule};">
<tr>
<td style="padding-top:14px;">
<div style="font-size:12px;font-weight:700;color:${PAL.muted};">Total a receber</div>
<div style="font-size:34px;font-weight:800;letter-spacing:-0.02em;color:${PAL.primary};line-height:1.1;">${usd(input.net)}</div>
</td>
<td style="padding-top:14px;text-align:right;vertical-align:top;">
<span style="display:inline-block;background-color:${PAL.accent};color:#fff;font-weight:800;font-size:12.5px;padding:5px 10px;border-radius:8px;">Conferência</span>
</td>
</tr></table>
</td></tr>
</table>
</td></tr>

<tr><td style="padding:14px 16px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${PAL.white};border:1px solid ${PAL.rule};border-radius:16px;border-collapse:separate;">
<tr><td style="padding:16px 18px;">
<div style="margin:0 0 10px;font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:${PAL.muted};">Dias aprovados</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
${dayRows}
</table>
</td></tr>
</table>
</td></tr>

<tr><td style="padding:14px 16px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${PAL.white};border:1px solid ${PAL.rule};border-radius:16px;border-collapse:separate;">
<tr><td style="padding:16px 18px;">
<div style="margin:0 0 10px;font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:${PAL.muted};">Resumo</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">
<tr><td style="padding:8px 0;color:${PAL.ink2};">Subtotal</td><td style="padding:8px 0;text-align:right;font-weight:700;">${usd(input.gross)}</td></tr>
${adjRows}
<tr><td style="padding:12px 0 0;border-top:1px solid ${PAL.rule};font-weight:800;font-size:15px;">Total a receber</td><td style="padding:12px 0 0;border-top:1px solid ${PAL.rule};text-align:right;font-weight:800;font-size:15px;">${usd(input.net)}</td></tr>
</table>
</td></tr>
</table>
</td></tr>

${waitingBlock}

<tr><td style="padding:18px 24px 8px;text-align:center;">
<p style="margin:0;font-size:13px;color:${PAL.muted};font-weight:600;line-height:1.5;">Por favor confira os valores e confirme com o escritório antes do pagamento.</p>
<p style="margin:10px 0 0;font-size:12.5px;color:${PAL.muted};">— <b style="color:${PAL.ink2};">${org}</b></p>
<p style="margin:8px 0 0;font-size:11px;color:#a89f94;">Enviado via ObraMate · PDF em anexo</p>
</td></tr>

</table>
</td></tr></table>
</body></html>`;
}

export function conferenceEmailSubject(input: ConferenceReportInput): string {
  return `Folha para conferência · ${input.employeeName} · ${input.periodLabel}`;
}

type Doc = InstanceType<typeof PDFDocument>;
type Pal = ReturnType<typeof palette>;

function newDoc(title: string, author: string): { doc: Doc; done: Promise<Buffer> } {
  const doc = new PDFDocument({
    size: "LETTER",
    margin: 0,
    info: { Title: title, Author: author, Producer: "ObraMate" },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  return { doc, done };
}

function fillCream(doc: Doc, PAL: Pal) {
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(PAL.cream);
}

function needPage(doc: Doc, y: number, need: number, PAL: Pal, m: number): number {
  if (y + need <= doc.page.height - 56) return y;
  doc.addPage();
  fillCream(doc, PAL);
  return m;
}

/** PDF letter — cabeçalho escuro + cartão branco (ticket) + linhas + total. */
export async function buildConferencePdf(input: ConferenceReportInput): Promise<Buffer> {
  const PAL = palette(input.org.primaryColor, input.org.accentColor);
  const logo = await loadLogoBuffer(input.org.logoUrl);
  const orgName = input.org.name || "ObraMate";
  const { doc, done } = newDoc(`Folha conferencia · ${pdfText(input.employeeName)}`, orgName);
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const m = 40;
  const contentW = pageW - 2 * m;
  const pad = 18;

  fillCream(doc, PAL);

  const headerH = 88;
  doc.rect(0, 0, pageW, headerH).fill(PAL.primary);

  let drewLogo = false;
  if (logo?.length) {
    try {
      doc.image(logo, m, 22, { fit: [40, 40], align: "center", valign: "center" });
      drewLogo = true;
    } catch {
      drewLogo = false;
    }
  }
  if (!drewLogo) {
    doc.roundedRect(m, 22, 40, 40, 8).fill(PAL.accent);
    const ini = initials(orgName);
    doc.fillColor(PAL.white).font("Helvetica-Bold").fontSize(16);
    doc.text(ini, m + (40 - doc.widthOfString(ini)) / 2, 33, { lineBreak: false });
  }
  doc.fillColor(PAL.white).font("Helvetica-Bold").fontSize(15).text(pdfText(orgName), m + 52, 26, { width: 320 });
  doc.fillColor("#cfc8c0").font("Helvetica").fontSize(10).text("Folha para conferencia", m + 52, 46, { width: 320 });

  // Hero
  const heroY = headerH - 28;
  const heroH = 142;
  doc.roundedRect(m, heroY, contentW, heroH, 14).fill(PAL.white);
  doc.roundedRect(m, heroY, contentW, heroH, 14).lineWidth(0.8).strokeColor(PAL.rule).stroke();

  const greet = pdfText(
    `Ola${firstName(input.employeeName) ? `, ${firstName(input.employeeName)}` : ""}! Confira sua folha antes do pagamento.`,
  );
  doc.fillColor(PAL.muted).font("Helvetica").fontSize(10).text(greet, m + pad, heroY + pad, {
    width: contentW - pad * 2,
  });

  let hy = heroY + pad + 18;
  doc.fillColor(PAL.muted).font("Helvetica-Bold").fontSize(9).text(pdfText(input.periodLabel).toUpperCase(), m + pad, hy, {
    width: contentW - 140,
    lineBreak: false,
  });
  const pill = pdfText(input.sectorLabel);
  doc.font("Helvetica-Bold").fontSize(9);
  const pw = doc.widthOfString(pill) + 16;
  doc.roundedRect(pageW - m - pad - pw, hy - 3, pw, 16, 8).fill(PAL.pillBg);
  doc.fillColor(PAL.pillInk).text(pill, pageW - m - pad - pw + 8, hy, { lineBreak: false });

  hy += 20;
  doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(20).text(pdfText(input.employeeName), m + pad, hy, {
    width: contentW - pad * 2,
  });
  hy = doc.y + 2;
  doc.fillColor(PAL.ink2).font("Helvetica").fontSize(11).text(pdfText(input.payTypeLabel), m + pad, hy);

  hy = Math.max(hy + 16, heroY + 92);
  doc
    .moveTo(m + pad, hy)
    .lineTo(pageW - m - pad, hy)
    .strokeColor(PAL.rule)
    .lineWidth(0.8)
    .stroke();
  hy += 10;
  doc.fillColor(PAL.muted).font("Helvetica-Bold").fontSize(9).text("TOTAL A RECEBER", m + pad, hy);
  doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(24).text(usd(input.net), m + pad, hy + 12);

  const badge = "Conferencia";
  doc.font("Helvetica-Bold").fontSize(10);
  const bw = doc.widthOfString(badge) + 18;
  doc.roundedRect(pageW - m - pad - bw, hy + 12, bw, 22, 6).fill(PAL.accent);
  doc.fillColor(PAL.white).text(badge, pageW - m - pad - bw + 9, hy + 17, { lineBreak: false });

  let y = heroY + heroH + 16;

  // Days
  const rowH = 34;
  const daysH = 28 + Math.max(input.days.length, 1) * rowH + 16;
  y = needPage(doc, y, daysH, PAL, m);
  doc.roundedRect(m, y, contentW, daysH, 12).fill(PAL.white);
  doc.roundedRect(m, y, contentW, daysH, 12).lineWidth(0.8).strokeColor(PAL.rule).stroke();
  doc.fillColor(PAL.muted).font("Helvetica-Bold").fontSize(9).text("DIAS APROVADOS", m + pad, y + 14, {
    characterSpacing: 0.5,
  });

  let dy = y + 32;
  if (!input.days.length) {
    doc.fillColor(PAL.muted).font("Helvetica").fontSize(11).text("Nenhum dia aprovado nesta semana.", m + pad, dy + 6);
  } else {
    input.days.forEach((d, i) => {
      if (i > 0) {
        doc
          .moveTo(m + pad, dy)
          .lineTo(pageW - m - pad, dy)
          .strokeColor(PAL.rule)
          .lineWidth(0.6)
          .stroke();
      }
      doc
        .fillColor(PAL.primary)
        .font("Helvetica-Bold")
        .fontSize(11)
        .text(pdfText(d.dateLabel), m + pad, dy + 6, { width: contentW - 110 });
      if (d.detail) {
        doc
          .fillColor(PAL.muted)
          .font("Helvetica")
          .fontSize(9)
          .text(pdfText(d.detail), m + pad, dy + 20, { width: contentW - 110, lineBreak: false });
      }
      const amt = usd(d.amount);
      doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(11);
      doc.text(amt, pageW - m - pad - doc.widthOfString(amt), dy + 10, { lineBreak: false });
      dy += rowH;
    });
  }
  y += daysH + 12;

  // Summary
  const nAdj = (input.reimbursement ? 1 : 0) + (input.discount ? 1 : 0);
  const sumH = 36 + (2 + nAdj) * 20 + 16;
  y = needPage(doc, y, sumH + (input.waitingNote ? 56 : 0), PAL, m);
  doc.roundedRect(m, y, contentW, sumH, 12).fill(PAL.white);
  doc.roundedRect(m, y, contentW, sumH, 12).lineWidth(0.8).strokeColor(PAL.rule).stroke();
  doc.fillColor(PAL.muted).font("Helvetica-Bold").fontSize(9).text("RESUMO", m + pad, y + 14, { characterSpacing: 0.5 });

  let sy = y + 34;
  const row = (label: string, value: string, color: string) => {
    doc.fillColor(PAL.ink2).font("Helvetica").fontSize(11).text(pdfText(label), m + pad, sy);
    doc.fillColor(color).font("Helvetica-Bold").fontSize(11);
    doc.text(value, pageW - m - pad - doc.widthOfString(value), sy, { lineBreak: false });
    sy += 20;
  };
  row("Subtotal", usd(input.gross), PAL.primary);
  if (input.reimbursement) row("Reembolso", `+${usd(input.reimbursement)}`, PAL.green);
  if (input.discount) row("Desconto", `-${usd(input.discount)}`, PAL.red);
  doc
    .moveTo(m + pad, sy - 2)
    .lineTo(pageW - m - pad, sy - 2)
    .strokeColor(PAL.rule)
    .lineWidth(0.8)
    .stroke();
  sy += 6;
  doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(12).text("Total a receber", m + pad, sy);
  doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(12);
  const tot = usd(input.net);
  doc.text(tot, pageW - m - pad - doc.widthOfString(tot), sy, { lineBreak: false });
  y += sumH + 12;

  if (input.waitingNote) {
    y = needPage(doc, y, 52, PAL, m);
    doc.roundedRect(m, y, contentW, 48, 10).fill(PAL.warnBg);
    doc.roundedRect(m, y, contentW, 48, 10).lineWidth(0.8).strokeColor(PAL.warnLine).stroke();
    doc
      .fillColor(PAL.primary)
      .font("Helvetica")
      .fontSize(10)
      .text(pdfText(input.waitingNote), m + 14, y + 12, { width: contentW - 28 });
  }

  doc
    .fillColor(PAL.muted)
    .font("Helvetica")
    .fontSize(9)
    .text("Confira os valores e confirme com o escritorio antes do pagamento.", m, pageH - 48, {
      width: contentW,
      align: "center",
    });
  doc
    .fillColor(PAL.ink2)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(pdfText(orgName), m, pageH - 34, { width: contentW, align: "center" });

  doc.end();
  return done;
}
