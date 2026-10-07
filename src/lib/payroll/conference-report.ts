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
    /** Phone · email (Configurações › Dados da empresa) */
    contact?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
    /** Address line when not private */
    address?: string | null;
    /** License line when shown on documents */
    license?: string | null;
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

function orgContactLine(org: ConferenceReportInput["org"]): string {
  if (org.contact) return String(org.contact);
  return [org.contactPhone, org.contactEmail].filter(Boolean).map(String).join(" · ");
}

function orgMetaLines(org: ConferenceReportInput["org"]): string[] {
  return [org.address, orgContactLine(org), org.license].filter(Boolean).map(String);
}

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
  const contact = escapeHtml(orgContactLine(input.org));
  const address = escapeHtml(input.org.address || "");
  const license = escapeHtml(input.org.license || "");

  const dayRows = input.days.length
    ? input.days
        .map(
          (d, i) => `<tr><td style="padding:12px 0;${i ? `border-top:1px solid ${PAL.rule};` : ""}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  <td style="font-weight:800;font-size:15px;color:${PAL.primary};">${escapeHtml(d.dateLabel)}</td>
  <td style="text-align:right;font-weight:800;font-size:16px;color:${PAL.primary};white-space:nowrap;">${usd(d.amount)}</td>
  </tr></table>
  <div style="margin-top:4px;font-size:13px;color:${PAL.muted};font-weight:600;line-height:1.35;">${escapeHtml(d.detail || "—")}</div>
</td></tr>`,
        )
        .join("")
    : `<tr><td style="padding:10px 0;color:${PAL.muted};font-weight:600;font-size:14px;">Nenhum dia aprovado nesta semana.</td></tr>`;

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
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:420px;border-collapse:collapse;font-family:'Plus Jakarta Sans',Segoe UI,Arial,sans-serif;color:${PAL.primary};">

<tr><td style="height:5px;background-color:${PAL.accent};line-height:5px;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:18px 18px 8px;background-color:${PAL.cream};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="width:48px;vertical-align:top;">
${
  input.org.logoUrl
    ? `<img src="${escapeHtml(input.org.logoUrl)}" alt="" width="48" height="48" style="display:block;border-radius:10px;object-fit:contain;background:#fff;" />`
    : `<div style="width:48px;height:48px;border-radius:10px;background-color:${PAL.primary};color:#fff;font-weight:800;font-size:16px;text-align:center;line-height:48px;">${escapeHtml(initials(input.org.name || "O"))}</div>`
}
</td>
<td style="padding-left:12px;vertical-align:top;">
<div style="font-weight:800;font-size:16px;color:${PAL.primary};line-height:1.2;">${org}</div>
${address ? `<div style="font-size:11.5px;color:${PAL.muted};font-weight:600;margin-top:3px;line-height:1.35;">${address}</div>` : ""}
${contact ? `<div style="font-size:11.5px;color:${PAL.ink2};font-weight:600;margin-top:2px;">${contact}</div>` : ""}
${license ? `<div style="font-size:11px;color:${PAL.muted};font-weight:600;margin-top:2px;">${license}</div>` : ""}
</td>
</tr></table>
<div style="margin-top:14px;padding-top:12px;border-top:1px solid ${PAL.rule};">
<div style="font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:${PAL.accent};">Folha para conferência</div>
<div style="margin-top:6px;"><span style="display:inline-block;background:${PAL.primary};color:#fff;font-size:12px;font-weight:800;padding:5px 10px;border-radius:8px;">${period}</span></div>
</div>
</td></tr>

<tr><td style="padding:0 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;background-color:${PAL.white};border-radius:16px;border-collapse:separate;box-shadow:0 8px 28px rgba(33,29,26,0.12);">
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
<div style="font-size:34px;font-weight:800;letter-spacing:-0.03em;line-height:1.1;margin-top:4px;">${usd(input.net)}</div>
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
${contact ? `<p style="margin:8px 0 0;font-size:12px;color:${PAL.ink2};font-weight:600;">${contact}</p>` : ""}
<p style="margin:8px 0 0;font-size:12.5px;color:${PAL.muted};">— <b style="color:${PAL.ink2};">${org}</b></p>
<p style="margin:14px 0 0;font-size:11px;color:#a89f94;font-weight:600;">
  <img src="/assets/favicon-192.png" alt="" width="14" height="14" style="vertical-align:middle;margin-right:5px;border-radius:3px;" />
  Made with <b style="color:${PAL.ink2};">ObraMate</b>
</p>
</td></tr>

</table>
</td></tr></table>
</body></html>`;
}

export function conferenceEmailSubject(input: ConferenceReportInput): string {
  return `Folha para conferência · ${input.employeeName} · ${input.periodLabel}`;
}

type Doc = InstanceType<typeof PDFDocument>;

/** Largura de celular (~390 CSS px) — PDF/PNG ocupa a tela do chat. */
const MOBILE_W = 390;
const M = 18;
const PAD = 16;

function rightText(doc: Doc, text: string, rightX: number, y: number) {
  doc.text(text, rightX - doc.widthOfString(text), y, { lineBreak: false });
}

function measureDetailH(doc: Doc, input: ConferenceReportInput, innerW: number): number {
  const adjN = (input.reimbursement ? 1 : 0) + (input.discount ? 1 : 0);
  let h = 32 + 10; // title + rule gap
  if (!input.days.length) {
    h += 36;
  } else {
    input.days.forEach((d, i) => {
      if (i > 0) h += 10; // separator
      doc.font("Helvetica").fontSize(11);
      const detail = pdfText(d.detail || "-");
      const detailH = Math.max(14, doc.heightOfString(detail, { width: innerW }));
      h += 18 + detailH + 10; // date line + detail + pad
    });
  }
  h += 4 + 12 + 20 * (1 + adjN) + 6 + 48 + 12; // rule + sums + total bar + pad
  return h;
}

function measureBrandHeaderH(doc: Doc, input: ConferenceReportInput, textW: number): number {
  const meta = orgMetaLines(input.org).map((l) => pdfText(l));
  let metaH = 0;
  doc.font("Helvetica").fontSize(9);
  for (const line of meta) {
    metaH += Math.max(11, doc.heightOfString(line, { width: textW }));
  }
  const logoBlock = 48;
  const companyBlock = 18 + metaH;
  // padTop + brand + gap + rule + title + period chip + padBottom
  return 16 + Math.max(logoBlock, companyBlock) + 12 + 8 + 12 + 22 + 12;
}

function measurePageH(doc: Doc, input: ConferenceReportInput): number {
  const contentW = MOBILE_W - 2 * M;
  const innerW = contentW - 2 * PAD;
  const accentH = 6;
  const textW = contentW - 48 - 12;
  const headerH = measureBrandHeaderH(doc, input, textW);
  const greet = pdfText(
    `Ola${firstName(input.employeeName) ? `, ${firstName(input.employeeName)}` : ""} — confira os valores.`,
  );
  const empName = pdfText(input.employeeName);
  doc.font("Helvetica").fontSize(12);
  const greetH = doc.heightOfString(greet, { width: innerW });
  doc.font("Helvetica-Bold").fontSize(20);
  const nameH = doc.heightOfString(empName, { width: innerW });
  const heroH = PAD + greetH + 12 + 20 + 10 + nameH + 14 + 64 + PAD;
  const detailH = measureDetailH(doc, input, innerW);
  let warnH = 0;
  if (input.waitingNote) {
    doc.font("Helvetica").fontSize(11);
    warnH = Math.max(44, doc.heightOfString(pdfText(input.waitingNote), { width: contentW - 24 }) + 22) + 12;
  }
  const footerH = 78;
  return Math.ceil(accentH + headerH + 10 + heroH + 12 + detailH + warnH + footerH + 8);
}

/**
 * PDF/imagem em formato celular (retrato estreito, tipografia grande):
 * accent → header → hero com total grande → dias empilhados → rodapé.
 */
export async function buildConferencePdf(input: ConferenceReportInput): Promise<Buffer> {
  const PAL = palette(input.org.primaryColor, input.org.accentColor);
  const logo = await loadLogoBuffer(input.org.logoUrl);
  const systemLogo =
    (await loadLogoBuffer("/assets/favicon-192.png")) ||
    (await loadLogoBuffer("/assets/obramate-logo.png"));
  const orgName = input.org.name || "ObraMate";

  // Mede altura com um doc temporário (mesma fonte/métricas).
  const probe = new PDFDocument({ size: [MOBILE_W, 2000], margin: 0 });
  probe.on("data", () => undefined);
  const pageH = Math.min(Math.max(measurePageH(probe, input), 560), 1400);
  probe.end();

  const doc = new PDFDocument({
    size: [MOBILE_W, pageH],
    margin: 0,
    info: {
      Title: `Folha conferencia · ${pdfText(input.employeeName)}`,
      Author: orgName,
      Producer: "ObraMate",
    },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const pageW = MOBILE_W;
  const contentW = pageW - 2 * M;
  const innerW = contentW - 2 * PAD;
  const amtRight = pageW - M - PAD;

  doc.rect(0, 0, pageW, pageH).fill(PAL.cream);

  // Accent (marca da empresa)
  const accentH = 6;
  doc.rect(0, 0, pageW, accentH).fill(PAL.accent);

  // Header claro — logo + dados da empresa (Configurações › Marca / Dados)
  const logoSize = 48;
  const textX = M + logoSize + 12;
  const textW = pageW - textX - M;
  const headerTop = accentH;
  const logoY = headerTop + 16;

  let drewLogo = false;
  if (logo?.length) {
    try {
      doc.image(logo, M, logoY, { fit: [logoSize, logoSize], align: "center", valign: "center" });
      drewLogo = true;
    } catch {
      drewLogo = false;
    }
  }
  if (!drewLogo) {
    doc.roundedRect(M, logoY, logoSize, logoSize, 10).fill(PAL.primary);
    const ini = initials(orgName);
    doc.fillColor(PAL.white).font("Helvetica-Bold").fontSize(16);
    doc.text(ini, M + (logoSize - doc.widthOfString(ini)) / 2, logoY + 15, { lineBreak: false });
  }

  let ty = logoY;
  doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(15).text(pdfText(orgName), textX, ty, {
    width: textW,
    lineBreak: false,
  });
  ty += 18;
  doc.font("Helvetica").fontSize(9).fillColor(PAL.muted);
  for (const line of orgMetaLines(input.org)) {
    const t = pdfText(line);
    const h = Math.max(11, doc.heightOfString(t, { width: textW }));
    doc.text(t, textX, ty, { width: textW });
    ty += h;
  }

  let y = Math.max(logoY + logoSize, ty) + 12;
  doc
    .moveTo(M, y)
    .lineTo(pageW - M, y)
    .strokeColor(PAL.rule)
    .lineWidth(0.7)
    .stroke();
  y += 10;
  doc.fillColor(PAL.accent).font("Helvetica-Bold").fontSize(9).text("FOLHA PARA CONFERENCIA", M, y, {
    characterSpacing: 0.6,
    lineBreak: false,
  });
  y += 14;
  const period = pdfText(input.periodLabel);
  doc.font("Helvetica-Bold").fontSize(10);
  const periodW = Math.min(doc.widthOfString(period) + 18, contentW);
  doc.roundedRect(M, y, periodW, 20, 6).fill(PAL.primary);
  doc.fillColor(PAL.white).text(period, M + 9, y + 5, { lineBreak: false });

  // Hero
  y += 32;
  const greet = pdfText(
    `Ola${firstName(input.employeeName) ? `, ${firstName(input.employeeName)}` : ""} — confira os valores.`,
  );
  const empName = pdfText(input.employeeName);
  doc.font("Helvetica").fontSize(12);
  const greetH = doc.heightOfString(greet, { width: innerW });
  doc.font("Helvetica-Bold").fontSize(20);
  const nameH = doc.heightOfString(empName, { width: innerW });
  const heroH = PAD + greetH + 12 + 20 + 10 + nameH + 14 + 64 + PAD;

  const heroY = y;
  doc.roundedRect(M, heroY, contentW, heroH, 16).fill(PAL.white);

  let cy = heroY + PAD;
  doc.fillColor(PAL.muted).font("Helvetica").fontSize(12).text(greet, M + PAD, cy, { width: innerW });
  cy += greetH + 12;

  const pill = pdfText(input.sectorLabel);
  doc.font("Helvetica-Bold").fontSize(10);
  const pw = doc.widthOfString(pill) + 16;
  doc.roundedRect(M + PAD, cy, pw, 20, 10).fill(PAL.pillBg);
  doc.fillColor(PAL.pillInk).text(pill, M + PAD + 8, cy + 5, { lineBreak: false });
  doc
    .fillColor(PAL.ink2)
    .font("Helvetica")
    .fontSize(12)
    .text(pdfText(input.payTypeLabel), M + PAD + pw + 10, cy + 4, { lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(10);
  const badge = "Conferencia";
  const bw = doc.widthOfString(badge) + 16;
  doc.roundedRect(M + PAD + innerW - bw, cy, bw, 20, 7).fill(PAL.accent);
  doc.fillColor(PAL.white).text(badge, M + PAD + innerW - bw + 8, cy + 5, { lineBreak: false });
  cy += 20 + 10;

  doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(20).text(empName, M + PAD, cy, { width: innerW });
  cy += nameH + 14;

  const stripH = 64;
  doc.roundedRect(M + PAD, cy, innerW, stripH, 12).fill(PAL.cream);
  doc.fillColor(PAL.muted).font("Helvetica-Bold").fontSize(11).text("TOTAL A RECEBER", M + PAD + 14, cy + 12);
  doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(28).text(usd(input.net), M + PAD + 14, cy + 28);

  y = heroY + heroH + 12;

  // Detail — stacked day rows (date+amount, detail below)
  const detailH = measureDetailH(doc, input, innerW);
  const detailY = y;
  doc.roundedRect(M, detailY, contentW, detailH, 16).fill(PAL.white);

  doc.fillColor(PAL.muted).font("Helvetica-Bold").fontSize(10).text("DETALHAMENTO", M + PAD, detailY + 14, {
    characterSpacing: 0.4,
  });

  let dy = detailY + 32;
  doc
    .moveTo(M + PAD, dy)
    .lineTo(pageW - M - PAD, dy)
    .strokeColor(PAL.rule)
    .lineWidth(0.7)
    .stroke();
  dy += 10;

  if (!input.days.length) {
    doc
      .fillColor(PAL.muted)
      .font("Helvetica")
      .fontSize(13)
      .text("Nenhum dia aprovado nesta semana.", M + PAD, dy + 6, { width: innerW });
    dy += 36;
  } else {
    input.days.forEach((d, i) => {
      if (i > 0) {
        doc
          .moveTo(M + PAD, dy)
          .lineTo(pageW - M - PAD, dy)
          .strokeColor(PAL.rule)
          .lineWidth(0.5)
          .stroke();
        dy += 10;
      }
      const dateLabel = pdfText(d.dateLabel);
      const amt = usd(d.amount);
      doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(14).text(dateLabel, M + PAD, dy, {
        width: innerW * 0.58,
        lineBreak: false,
      });
      doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(15);
      rightText(doc, amt, amtRight, dy);
      dy += 18;
      const detail = pdfText(d.detail || "-");
      doc.font("Helvetica").fontSize(11);
      const detailHRow = Math.max(14, doc.heightOfString(detail, { width: innerW }));
      doc.fillColor(PAL.muted).text(detail, M + PAD, dy, { width: innerW });
      dy += detailHRow + 10;
    });
  }

  dy += 4;
  doc
    .moveTo(M + PAD, dy)
    .lineTo(pageW - M - PAD, dy)
    .strokeColor(PAL.rule)
    .lineWidth(0.8)
    .stroke();
  dy += 12;

  const sumRow = (label: string, value: string, color: string) => {
    doc.fillColor(PAL.ink2).font("Helvetica").fontSize(13).text(pdfText(label), M + PAD, dy);
    doc.fillColor(color).font("Helvetica-Bold").fontSize(13);
    rightText(doc, value, amtRight, dy);
    dy += 20;
  };
  sumRow("Subtotal", usd(input.gross), PAL.primary);
  if (input.reimbursement) sumRow("Reembolso", `+${usd(input.reimbursement)}`, PAL.green);
  if (input.discount) sumRow("Desconto", `-${usd(input.discount)}`, PAL.red);

  dy += 6;
  const barH = 48;
  doc.roundedRect(M + PAD, dy, innerW, barH, 12).fill(PAL.primary);
  doc.fillColor("#cfc8c0").font("Helvetica-Bold").fontSize(10).text("TOTAL A RECEBER", M + PAD + 14, dy + 10);
  doc.fillColor(PAL.white).font("Helvetica-Bold").fontSize(20).text(usd(input.net), M + PAD + 14, dy + 24);
  dy += barH + 12;

  y = Math.max(detailY + detailH, dy) + 4;

  if (input.waitingNote) {
    const note = pdfText(input.waitingNote);
    doc.font("Helvetica").fontSize(11);
    const noteH = Math.max(44, doc.heightOfString(note, { width: contentW - 24 }) + 22);
    doc.roundedRect(M, y, contentW, noteH, 12).fill(PAL.warnBg);
    doc.roundedRect(M, y, contentW, noteH, 12).lineWidth(0.8).strokeColor(PAL.warnLine).stroke();
    doc.fillColor(PAL.primary).text(note, M + 12, y + 12, { width: contentW - 24 });
    y += noteH + 10;
  }

  const contact = pdfText(orgContactLine(input.org));
  doc
    .fillColor(PAL.muted)
    .font("Helvetica")
    .fontSize(10.5)
    .text("Confira os valores com o escritorio antes do pagamento.", M, pageH - 68, {
      width: contentW,
      align: "center",
    });
  if (contact) {
    doc.fillColor(PAL.ink2).font("Helvetica").fontSize(9.5).text(contact, M, pageH - 52, {
      width: contentW,
      align: "center",
    });
  }

  // Made with ObraMate (favicon do sistema)
  const made = "Made with";
  doc.font("Helvetica").fontSize(9).fillColor(PAL.muted);
  const madeW = doc.widthOfString(made);
  const iconSize = 12;
  const brandGap = 5;
  const brandLabel = "ObraMate";
  doc.font("Helvetica-Bold").fontSize(9);
  const brandW = doc.widthOfString(brandLabel);
  const blockW = madeW + brandGap + iconSize + 4 + brandW;
  const brandX = (pageW - blockW) / 2;
  const brandY = pageH - 28;
  doc.font("Helvetica").fontSize(9).fillColor(PAL.muted).text(made, brandX, brandY, { lineBreak: false });
  let ix = brandX + madeW + brandGap;
  let drewSys = false;
  if (systemLogo?.length) {
    try {
      doc.image(systemLogo, ix, brandY - 1, { fit: [iconSize, iconSize], align: "center", valign: "center" });
      drewSys = true;
    } catch {
      drewSys = false;
    }
  }
  if (!drewSys) {
    doc.roundedRect(ix, brandY - 1, iconSize, iconSize, 2).fill(PAL.accent);
  }
  ix += iconSize + 4;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(PAL.ink2).text(brandLabel, ix, brandY, { lineBreak: false });

  doc.end();
  return done;
}
