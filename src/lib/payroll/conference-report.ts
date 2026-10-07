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

/** E-mail table-based — ticket de serviço (ink header + hero + detalhe). */
export function buildConferenceEmailHtml(input: ConferenceReportInput): string {
  const PAL = palette(input.org.primaryColor, input.org.accentColor);
  const org = escapeHtml(input.org.name || "ObraMate");
  const greet = escapeHtml(firstName(input.employeeName) || input.employeeName);
  const period = escapeHtml(input.periodLabel);
  const sector = escapeHtml(input.sectorLabel);
  const payType = escapeHtml(input.payTypeLabel);
  const name = escapeHtml(input.employeeName);
  const contact = [input.org.contactPhone, input.org.contactEmail].filter(Boolean).map(String).join(" · ");

  const dayRows = input.days.length
    ? input.days
        .map(
          (d, i) => `<tr>
  <td style="padding:11px 0;${i ? `border-top:1px solid ${PAL.rule};` : ""}width:34%;vertical-align:top;font-weight:800;font-size:13.5px;color:${PAL.primary};">${escapeHtml(d.dateLabel)}</td>
  <td style="padding:11px 8px;${i ? `border-top:1px solid ${PAL.rule};` : ""}vertical-align:top;font-size:12.5px;color:${PAL.muted};font-weight:600;">${escapeHtml(d.detail || "—")}</td>
  <td style="padding:11px 0;${i ? `border-top:1px solid ${PAL.rule};` : ""}text-align:right;vertical-align:top;font-weight:800;font-size:13.5px;color:${PAL.primary};white-space:nowrap;">${usd(d.amount)}</td>
</tr>`,
        )
        .join("")
    : `<tr><td colspan="3" style="padding:10px 0;color:${PAL.muted};font-weight:600;font-size:14px;">Nenhum dia aprovado nesta semana.</td></tr>`;

  const adjRows = [
    input.reimbursement
      ? `<tr><td colspan="2" style="padding:8px 0;color:${PAL.ink2};font-size:14px;">Reembolso</td><td style="padding:8px 0;text-align:right;font-weight:800;color:${PAL.green};">+${usd(input.reimbursement)}</td></tr>`
      : "",
    input.discount
      ? `<tr><td colspan="2" style="padding:8px 0;color:${PAL.ink2};font-size:14px;">Desconto</td><td style="padding:8px 0;text-align:right;font-weight:800;color:${PAL.red};">−${usd(input.discount)}</td></tr>`
      : "",
  ].join("");

  const waitingBlock = input.waitingNote
    ? `<tr><td style="padding:12px 16px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:${PAL.warnBg};border:1px solid ${PAL.warnLine};border-radius:12px;">
  <tr><td style="padding:12px 14px;font-size:13px;color:${PAL.primary};font-weight:600;line-height:1.45;">${escapeHtml(input.waitingNote)}</td></tr>
  </table>
</td></tr>`
    : "";

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background-color:${PAL.cream};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${PAL.cream};padding:0 0 28px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;border-collapse:collapse;font-family:'Plus Jakarta Sans',Segoe UI,Arial,sans-serif;color:${PAL.primary};">

<tr><td style="height:5px;background-color:${PAL.accent};line-height:5px;font-size:0;">&nbsp;</td></tr>
<tr><td style="background-color:${PAL.primary};padding:16px 20px 52px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="width:40px;vertical-align:middle;">
<div style="width:40px;height:40px;border-radius:10px;background-color:${PAL.accent};color:#fff;font-weight:800;font-size:16px;text-align:center;line-height:40px;">${escapeHtml(initials(input.org.name || "O"))}</div>
</td>
<td style="padding-left:12px;vertical-align:middle;">
<div style="font-weight:800;font-size:15px;color:#fff;line-height:1.2;">${org}</div>
<div style="font-size:12px;color:rgba(255,255,255,0.68);font-weight:600;">Folha para conferência</div>
</td>
<td style="text-align:right;vertical-align:middle;">
<span style="display:inline-block;background:rgba(255,255,255,0.12);color:#fff;font-size:11.5px;font-weight:800;padding:5px 10px;border-radius:8px;">${period}</span>
</td>
</tr></table>
</td></tr>

<tr><td style="padding:0 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:-36px;background-color:${PAL.white};border-radius:16px;border-collapse:separate;box-shadow:0 8px 28px rgba(33,29,26,0.12);">
<tr><td style="padding:18px 18px 0;">
<p style="margin:0 0 8px;font-size:13.5px;color:${PAL.muted};font-weight:600;">Olá${greet ? `, ${greet}` : ""} — confira os valores abaixo.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:6px;"><tr>
<td style="background:${PAL.pillBg};color:${PAL.pillInk};font-size:11.5px;font-weight:800;padding:3px 9px;border-radius:999px;">${sector}</td>
<td style="padding-left:8px;font-size:12.5px;color:${PAL.ink2};font-weight:600;">${payType}</td>
</tr></table>
<h1 style="margin:0;font-size:21px;line-height:1.25;font-weight:800;letter-spacing:-0.01em;">${name}</h1>
</td></tr>
<tr><td style="padding:14px 18px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAL.cream};border-radius:12px;border-collapse:separate;">
<tr><td style="padding:12px 14px;">
<div style="font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:${PAL.muted};">Total a receber</div>
<div style="font-size:30px;font-weight:800;letter-spacing:-0.02em;line-height:1.15;margin-top:2px;">${usd(input.net)}</div>
</td>
<td style="padding:12px 14px;text-align:right;vertical-align:middle;">
<span style="display:inline-block;background:${PAL.accent};color:#fff;font-weight:800;font-size:11.5px;padding:5px 10px;border-radius:8px;">Conferência</span>
</td></tr></table>
</td></tr>
</table>
</td></tr>

<tr><td style="padding:12px 16px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${PAL.white};border:1px solid ${PAL.rule};border-radius:14px;border-collapse:separate;">
<tr><td style="padding:14px 16px 6px;">
<div style="font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:${PAL.muted};">Detalhamento</div>
</td></tr>
<tr><td style="padding:0 16px 4px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
<tr>
<td style="padding:6px 0;font-size:11px;font-weight:800;color:${PAL.muted};text-transform:uppercase;letter-spacing:0.04em;border-bottom:1px solid ${PAL.rule};width:34%;">Dia</td>
<td style="padding:6px 8px;font-size:11px;font-weight:800;color:${PAL.muted};text-transform:uppercase;letter-spacing:0.04em;border-bottom:1px solid ${PAL.rule};">Detalhe</td>
<td style="padding:6px 0;font-size:11px;font-weight:800;color:${PAL.muted};text-transform:uppercase;letter-spacing:0.04em;border-bottom:1px solid ${PAL.rule};text-align:right;">Valor</td>
</tr>
${dayRows}
</table>
</td></tr>
<tr><td style="padding:4px 16px 14px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-top:1px solid ${PAL.rule};margin-top:4px;">
<tr><td colspan="2" style="padding:10px 0 6px;color:${PAL.ink2};font-size:13.5px;">Subtotal</td><td style="padding:10px 0 6px;text-align:right;font-weight:700;font-size:13.5px;">${usd(input.gross)}</td></tr>
${adjRows}
</table>
</td></tr>
<tr><td style="padding:0 10px 10px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAL.primary};border-radius:10px;border-collapse:separate;">
<tr>
<td style="padding:12px 14px;color:rgba(255,255,255,0.75);font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;">Total a receber</td>
<td style="padding:12px 14px;text-align:right;color:#fff;font-size:18px;font-weight:800;">${usd(input.net)}</td>
</tr></table>
</td></tr>
</table>
</td></tr>

${waitingBlock}

<tr><td style="padding:18px 22px 6px;text-align:center;">
<p style="margin:0;font-size:13px;color:${PAL.muted};font-weight:600;line-height:1.5;">Confira os valores e confirme com o escritório antes do pagamento.</p>
${contact ? `<p style="margin:8px 0 0;font-size:12px;color:${PAL.ink2};font-weight:600;">${escapeHtml(contact)}</p>` : ""}
<p style="margin:8px 0 0;font-size:12.5px;color:${PAL.muted};">— <b style="color:${PAL.ink2};">${org}</b></p>
<p style="margin:6px 0 0;font-size:11px;color:#a89f94;">Enviado via ObraMate · PDF em anexo</p>
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
  if (y + need <= doc.page.height - 52) return y;
  doc.addPage();
  fillCream(doc, PAL);
  return m;
}

function rightText(doc: Doc, text: string, rightX: number, y: number) {
  doc.text(text, rightX - doc.widthOfString(text), y, { lineBreak: false });
}

/**
 * PDF em blocos empilhados (sem overlap):
 * accent → header completo (logo livre) → gap → hero → detalhe → rodapé.
 */
export async function buildConferencePdf(input: ConferenceReportInput): Promise<Buffer> {
  const PAL = palette(input.org.primaryColor, input.org.accentColor);
  const logo = await loadLogoBuffer(input.org.logoUrl);
  const orgName = input.org.name || "ObraMate";
  const { doc, done } = newDoc(`Folha conferencia · ${pdfText(input.employeeName)}`, orgName);
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const m = 40;
  const contentW = pageW - 2 * m;
  const pad = 16;
  const colDate = m + pad;
  const colDetail = m + pad + 120;
  const colAmtRight = pageW - m - pad;
  const detailW = Math.max(80, contentW - pad * 2 - 120 - 78);
  const footerReserve = 56;

  fillCream(doc, PAL);

  // 1) Accent strip
  const accentH = 5;
  doc.rect(0, 0, pageW, accentH).fill(PAL.accent);

  // 2) Header band — logo + org fully inside; nothing overlaps this zone
  const headerTop = accentH;
  const headerPadY = 18;
  const logoSize = 40;
  const headerH = headerPadY * 2 + logoSize; // 76
  doc.rect(0, headerTop, pageW, headerH).fill(PAL.primary);

  const logoY = headerTop + headerPadY;
  let drewLogo = false;
  if (logo?.length) {
    try {
      doc.image(logo, m, logoY, { fit: [logoSize, logoSize], align: "center", valign: "center" });
      drewLogo = true;
    } catch {
      drewLogo = false;
    }
  }
  if (!drewLogo) {
    doc.roundedRect(m, logoY, logoSize, logoSize, 9).fill(PAL.accent);
    const ini = initials(orgName);
    doc.fillColor(PAL.white).font("Helvetica-Bold").fontSize(15);
    doc.text(ini, m + (logoSize - doc.widthOfString(ini)) / 2, logoY + 12, { lineBreak: false });
  }

  const textX = m + logoSize + 12;
  const period = pdfText(input.periodLabel);
  doc.font("Helvetica-Bold").fontSize(9);
  const periodW = Math.min(doc.widthOfString(period) + 16, 160);
  const periodX = pageW - m - periodW;
  doc.roundedRect(periodX, logoY + 9, periodW, 22, 6).fill("#3a342f");
  doc.fillColor(PAL.white).text(period, periodX + 8, logoY + 15, { lineBreak: false, width: periodW - 16 });

  const nameMaxW = Math.max(120, periodX - textX - 12);
  doc.fillColor(PAL.white).font("Helvetica-Bold").fontSize(14).text(pdfText(orgName), textX, logoY + 4, {
    width: nameMaxW,
    lineBreak: false,
  });
  doc.fillColor("#cfc8c0").font("Helvetica").fontSize(9.5).text("Folha para conferencia", textX, logoY + 24, {
    width: nameMaxW,
    lineBreak: false,
  });

  // 3) Hero — starts BELOW header with clear gap (no pull-up overlap)
  let y = headerTop + headerH + 16;
  const heroInnerW = contentW - pad * 2;
  const greet = pdfText(
    `Ola${firstName(input.employeeName) ? `, ${firstName(input.employeeName)}` : ""} — confira os valores abaixo.`,
  );
  const empName = pdfText(input.employeeName);
  doc.font("Helvetica").fontSize(9.5);
  const greetH = doc.heightOfString(greet, { width: heroInnerW });
  doc.font("Helvetica-Bold").fontSize(17);
  const nameH = doc.heightOfString(empName, { width: heroInnerW });
  const heroH = pad + greetH + 10 + 16 + 8 + nameH + 12 + 36 + pad;
  y = needPage(doc, y, heroH + 12, PAL, m);

  const heroY = y;
  doc.roundedRect(m, heroY, contentW, heroH, 14).fill(PAL.white);
  doc.roundedRect(m, heroY, contentW, heroH, 14).lineWidth(0.8).strokeColor(PAL.rule).stroke();

  let cy = heroY + pad;
  doc.fillColor(PAL.muted).font("Helvetica").fontSize(9.5).text(greet, m + pad, cy, { width: heroInnerW });
  cy += greetH + 10;

  const pill = pdfText(input.sectorLabel);
  doc.font("Helvetica-Bold").fontSize(8.5);
  const pw = doc.widthOfString(pill) + 14;
  doc.roundedRect(m + pad, cy, pw, 16, 8).fill(PAL.pillBg);
  doc.fillColor(PAL.pillInk).text(pill, m + pad + 7, cy + 4, { lineBreak: false });
  doc
    .fillColor(PAL.ink2)
    .font("Helvetica")
    .fontSize(9.5)
    .text(pdfText(input.payTypeLabel), m + pad + pw + 8, cy + 3.5, { lineBreak: false });
  cy += 16 + 8;

  doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(17).text(empName, m + pad, cy, { width: heroInnerW });
  cy += nameH + 12;

  const stripH = 36;
  doc.roundedRect(m + pad, cy, heroInnerW, stripH, 9).fill(PAL.cream);
  doc.fillColor(PAL.muted).font("Helvetica-Bold").fontSize(8).text("TOTAL A RECEBER", m + pad + 12, cy + 7);
  doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(15).text(usd(input.net), m + pad + 12, cy + 17);
  doc.font("Helvetica-Bold").fontSize(8.5);
  const badge = "Conferencia";
  const bw = doc.widthOfString(badge) + 14;
  doc.roundedRect(m + pad + heroInnerW - 12 - bw, cy + 9, bw, 18, 5).fill(PAL.accent);
  doc.fillColor(PAL.white).text(badge, m + pad + heroInnerW - 12 - bw + 7, cy + 13.5, { lineBreak: false });

  y = heroY + heroH + 14;

  // 4) Detail card — height from content; draw border after measuring if needed
  const rowH = 26;
  const adjN = (input.reimbursement ? 1 : 0) + (input.discount ? 1 : 0);
  const nDays = Math.max(input.days.length, 1);
  // title 28 + col hdr 24 + rows + gap 8 + sums + bar 38 + pads
  const detailH = 28 + 24 + nDays * rowH + 8 + 18 * (1 + adjN) + 8 + 38 + 14;
  y = needPage(doc, y, Math.min(detailH, pageH - footerReserve - m), PAL, m);

  const detailY = y;
  doc.roundedRect(m, detailY, contentW, detailH, 12).fill(PAL.white);
  doc.roundedRect(m, detailY, contentW, detailH, 12).lineWidth(0.8).strokeColor(PAL.rule).stroke();

  doc.fillColor(PAL.muted).font("Helvetica-Bold").fontSize(8.5).text("DETALHAMENTO", m + pad, detailY + 12, {
    characterSpacing: 0.5,
  });

  let dy = detailY + 28;
  doc
    .moveTo(m + pad, dy)
    .lineTo(pageW - m - pad, dy)
    .strokeColor(PAL.rule)
    .lineWidth(0.6)
    .stroke();
  dy += 8;
  doc.fillColor(PAL.muted).font("Helvetica-Bold").fontSize(8);
  doc.text("DIA", colDate, dy);
  doc.text("DETALHE", colDetail, dy);
  rightText(doc, "VALOR", colAmtRight, dy);
  dy += 12;
  doc
    .moveTo(m + pad, dy)
    .lineTo(pageW - m - pad, dy)
    .strokeColor(PAL.rule)
    .lineWidth(0.6)
    .stroke();
  dy += 4;

  if (!input.days.length) {
    doc.fillColor(PAL.muted).font("Helvetica").fontSize(10).text("Nenhum dia aprovado nesta semana.", colDate, dy + 6);
    dy += rowH;
  } else {
    input.days.forEach((d, i) => {
      if (i > 0) {
        doc
          .moveTo(m + pad, dy)
          .lineTo(pageW - m - pad, dy)
          .strokeColor(PAL.rule)
          .lineWidth(0.45)
          .stroke();
      }
      doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(10).text(pdfText(d.dateLabel), colDate, dy + 6, {
        width: 112,
        lineBreak: false,
      });
      doc
        .fillColor(PAL.muted)
        .font("Helvetica")
        .fontSize(8.5)
        .text(pdfText(d.detail || "-"), colDetail, dy + 7, { width: detailW, lineBreak: false });
      doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(10);
      rightText(doc, usd(d.amount), colAmtRight, dy + 6);
      dy += rowH;
    });
  }

  dy += 6;
  doc
    .moveTo(m + pad, dy)
    .lineTo(pageW - m - pad, dy)
    .strokeColor(PAL.rule)
    .lineWidth(0.7)
    .stroke();
  dy += 10;

  const sumRow = (label: string, value: string, color: string) => {
    doc.fillColor(PAL.ink2).font("Helvetica").fontSize(10).text(pdfText(label), colDate, dy);
    doc.fillColor(color).font("Helvetica-Bold").fontSize(10);
    rightText(doc, value, colAmtRight, dy);
    dy += 18;
  };
  sumRow("Subtotal", usd(input.gross), PAL.primary);
  if (input.reimbursement) sumRow("Reembolso", `+${usd(input.reimbursement)}`, PAL.green);
  if (input.discount) sumRow("Desconto", `-${usd(input.discount)}`, PAL.red);

  dy += 6;
  const barH = 34;
  doc.roundedRect(m + pad, dy, contentW - pad * 2, barH, 8).fill(PAL.primary);
  doc.fillColor("#cfc8c0").font("Helvetica-Bold").fontSize(8).text("TOTAL A RECEBER", m + pad + 12, dy + 12);
  doc.fillColor(PAL.white).font("Helvetica-Bold").fontSize(14);
  rightText(doc, usd(input.net), pageW - m - pad - 12, dy + 10);
  dy += barH + 12;

  y = Math.max(detailY + detailH, dy) + 10;

  if (input.waitingNote) {
    const note = pdfText(input.waitingNote);
    doc.font("Helvetica").fontSize(9);
    const noteH = Math.max(40, doc.heightOfString(note, { width: contentW - 28 }) + 20);
    y = needPage(doc, y, noteH + 8, PAL, m);
    doc.roundedRect(m, y, contentW, noteH, 10).fill(PAL.warnBg);
    doc.roundedRect(m, y, contentW, noteH, 10).lineWidth(0.7).strokeColor(PAL.warnLine).stroke();
    doc.fillColor(PAL.primary).text(note, m + 14, y + 12, { width: contentW - 28 });
  }

  const contact = [input.org.contactPhone, input.org.contactEmail]
    .filter(Boolean)
    .map((s) => pdfText(String(s)))
    .join("  ·  ");
  doc
    .fillColor(PAL.muted)
    .font("Helvetica")
    .fontSize(8.5)
    .text("Confira os valores e confirme com o escritorio antes do pagamento.", m, pageH - 46, {
      width: contentW,
      align: "center",
    });
  if (contact) {
    doc.fillColor(PAL.ink2).font("Helvetica").fontSize(8).text(contact, m, pageH - 34, { width: contentW, align: "center" });
  }
  doc
    .fillColor(PAL.ink2)
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .text(pdfText(orgName), m, pageH - 22, { width: contentW, align: "center" });

  doc.end();
  return done;
}
