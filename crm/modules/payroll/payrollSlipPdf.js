/**
 * Recibo individual de folha (pdf-lib) — mesma paleta e cabeçalho que quotePdf.js (Senior Floors).
 * Relatórios individuais multi-página reutilizam o mesmo layout (painel direito com título distinto).
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COMPANY = {
  name: 'Senior Floors',
  tagline: 'Hardwood · LVP · Refinishing · Denver Metro',
  phone: '(720) 751-9813',
  email: 'contact@senior-floors.com',
};

/** Manter alinhado com modules/quotes/quotePdf.js */
const PAL = {
  primary: rgb(26 / 255, 32 / 255, 54 / 255),
  primaryMuted: rgb(42 / 255, 49 / 255, 80 / 255),
  secondary: rgb(214 / 255, 181 / 255, 152 / 255),
  secondaryDark: rgb(196 / 255, 165 / 255, 136 / 255),
  panelBg: rgb(240 / 255, 242 / 255, 248 / 255),
  lineMuted: rgb(0.35, 0.37, 0.42),
  rule: rgb(0.86, 0.88, 0.92),
  white: rgb(1, 1, 1),
};

const PAGE_W = 612;
const PAGE_H = 520;
const MARGIN = 48;

function moneyFmt(n) {
  const x = Number(n) || 0;
  return `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtQty(n) {
  const x = Number(n) || 0;
  return Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100);
}

/** StandardFonts (Helvetica) usam WinAnsi — sem →, — longo, etc. */
function winAnsiSafe(s, maxLen) {
  let t = String(s ?? '')
    .replace(/\u2192/g, '->')
    .replace(/\u2014/g, '-')
    .replace(/\u2013/g, '-')
    .replace(/\u00A0/g, ' ');
  t = t.replace(/[^\u0020-\u007E\u00A0-\u00FF]/g, '');
  if (maxLen != null) t = t.slice(0, maxLen);
  return t;
}

async function tryEmbedLogo(pdf) {
  const candidates = [
    path.join(__dirname, '../../public/assets/SeniorFloors.png'),
    path.join(__dirname, '../../public/assets/logoSeniorFloors.png'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const bytes = fs.readFileSync(p);
        try {
          return await pdf.embedPng(bytes);
        } catch {
          try {
            return await pdf.embedJpg(bytes);
          } catch {
            /* continue */
          }
        }
      }
    } catch {
      /* continue */
    }
  }
  return null;
}

function sectorLabel(sector) {
  if (sector === 'installation') return 'Installation';
  if (sector === 'sand_finish') return 'Sand & Finish';
  return '-';
}

/** Igual à lógica de previewNormativoBlock em payroll-module.js */
function normativeBlockFromRow(row) {
  const pt = String(row.payment_type || 'daily').toLowerCase();
  const days = Number(row.days_worked_sum) || 0;
  const regH = Number(row.regular_hours_sum) || 0;
  const baseAmt = Number(row.amount_sheet_base) || 0;
  if (pt === 'hourly') {
    const h = regH > 0 ? regH : days;
    return {
      qtyLabel: 'Horas em taxa normal (total)',
      qty: `${fmtQty(h)} h`,
      totalLabel: 'Valor (parte normal)',
      total: baseAmt,
    };
  }
  if (pt === 'mixed') {
    const parts = [];
    if (days > 0) parts.push(`${fmtQty(days)} dia(s)`);
    if (regH > 0) parts.push(`${fmtQty(regH)} h`);
    return {
      qtyLabel: 'Dias / horas normais',
      qty: parts.length ? parts.join(' · ') : '-',
      totalLabel: 'Valor (parte normal)',
      total: baseAmt,
    };
  }
    return {
      qtyLabel: 'Diarias (total)',
      qty: fmtQty(days),
      totalLabel: 'Valor (parte normal)',
      total: baseAmt,
    };
}

/**
 * @param {import('pdf-lib').PDFDocument} pdf
 * @param {import('pdf-lib').PDFFont} font
 * @param {import('pdf-lib').PDFFont} fontBold
 * @param {object} opts
 * @param {object} opts.period
 * @param {object} opts.row — linha by_employee
 * @param {string} opts.rightTitle — ex.: PAY SLIP, RELATORIO INDIVIDUAL
 * @param {number} [opts.pageIndex]
 * @param {number} [opts.pageTotal]
 */
async function drawPayrollSlipStyledPage(pdf, font, fontBold, opts) {
  const { period, row, rightTitle, pageIndex, pageTotal } = opts;
  const contentW = PAGE_W - 2 * MARGIN;
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 48;
  const lineH = 13;
  const textColor = PAL.primary;

  const baselineCenteredInBar = (barBottom, barH, fontSize) => {
    const ascent = fontSize * 0.76;
    const descent = fontSize * 0.235;
    return barBottom + barH / 2 - (ascent - descent) / 2;
  };

  const accentBarH = 5;
  const gapBelowAccent = 14;
  page.drawRectangle({
    x: 0,
    y: PAGE_H - accentBarH,
    width: PAGE_W,
    height: accentBarH,
    color: PAL.secondary,
  });

  const contentTopY = PAGE_H - accentBarH - gapBelowAccent;
  const logoTopY = contentTopY;
  const logo = await tryEmbedLogo(pdf);
  const lw = logo ? 56 : 0;
  const lh = logo ? (logo.height / logo.width) * lw : 0;
  const logoBottomY = logoTopY - lh;
  if (logo) {
    page.drawImage(logo, { x: MARGIN, y: logoBottomY, width: lw, height: lh });
  }

  const nameSize = 15;
  const tagSize = 8;
  const textColumnX = MARGIN + (logo ? lw + 14 : 0);
  const nameBaselineY = logoTopY - nameSize * 0.72;
  const tagBaselineY = nameBaselineY - 14;
  const contactBaselineY = tagBaselineY - 12;

  page.drawText(COMPANY.name, {
    x: textColumnX,
    y: nameBaselineY,
    size: nameSize,
    font: fontBold,
    color: PAL.primary,
  });
  page.drawText(COMPANY.tagline, {
    x: textColumnX,
    y: tagBaselineY,
    size: tagSize,
    font,
    color: PAL.primaryMuted,
  });
  page.drawText(`${COMPANY.phone} · ${COMPANY.email}`, {
    x: textColumnX,
    y: contactBaselineY,
    size: tagSize,
    font,
    color: PAL.primaryMuted,
  });

  const textBlockLowY = contactBaselineY - 4;
  const headerLowY = lh > 0 ? Math.min(logoBottomY, textBlockLowY) : textBlockLowY;

  const rightW = 168;
  const rightX = PAGE_W - MARGIN - rightW;
  const panelExtra = pageTotal > 1 ? 14 : 0;
  const panelH = 76 + panelExtra;
  const panelTopY = contentTopY + 2;
  const panelBottomY = panelTopY - panelH;
  page.drawRectangle({
    x: rightX - 6,
    y: panelBottomY,
    width: rightW + 12,
    height: panelH,
    color: PAL.panelBg,
  });
  page.drawRectangle({
    x: rightX - 6,
    y: panelBottomY,
    width: 3,
    height: panelH,
    color: PAL.secondaryDark,
  });

  const perName = winAnsiSafe(period?.name ? String(period.name) : 'Período', 42);
  const d0 = period?.start_date ? String(period.start_date).slice(0, 10) : '';
  const d1 = period?.end_date ? String(period.end_date).slice(0, 10) : '';
  let ry = panelTopY - 14;
  const rt = winAnsiSafe(rightTitle, 28);
  page.drawText(rt, { x: rightX, y: ry, size: 10, font: fontBold, color: PAL.primary });
  ry -= lineH;
  page.drawText(perName, { x: rightX, y: ry, size: 9, font: fontBold, color: PAL.secondaryDark });
  ry -= lineH;
  if (d0 && d1) {
    page.drawText(`${d0} - ${d1}`, { x: rightX, y: ry, size: 8, font, color: PAL.lineMuted });
    ry -= lineH;
  }
  page.drawText(`Emitido: ${new Date().toISOString().slice(0, 10)}`, {
    x: rightX,
    y: ry,
    size: 7.5,
    font,
    color: PAL.lineMuted,
  });
  if (pageTotal > 1 && pageIndex >= 1) {
    ry -= lineH * 0.95;
    page.drawText(`Pag ${pageIndex} de ${pageTotal}`, {
      x: rightX,
      y: ry,
      size: 7,
      font,
      color: PAL.lineMuted,
    });
  }

  y = Math.min(headerLowY - 8, panelBottomY - 6) - 10;

  page.drawText('Funcionário(a)', { x: MARGIN, y, size: 9, font: fontBold, color: PAL.secondaryDark });
  y -= lineH;
  page.drawText(winAnsiSafe(row.name || '-', 80), { x: MARGIN, y, size: 11, font: fontBold, color: PAL.primary });
  y -= lineH;
  page.drawText(`Setor: ${winAnsiSafe(sectorLabel(row.sector), 40)}`, {
    x: MARGIN,
    y,
    size: 8.5,
    font,
    color: PAL.lineMuted,
  });
  y -= 16;

  const drawSectionTitle = (label) => {
    const fs = 9;
    const barPad = 5;
    const th = fontBold.heightAtSize(fs);
    const barH = th + 2 * barPad;
    const barTop = y;
    const barBottom = barTop - barH;
    const baselineY = baselineCenteredInBar(barBottom, barH, fs);
    page.drawRectangle({
      x: MARGIN,
      y: barBottom,
      width: contentW,
      height: barH,
      color: PAL.secondary,
      opacity: 0.22,
    });
    page.drawRectangle({
      x: MARGIN,
      y: barBottom,
      width: 3,
      height: barH,
      color: PAL.primary,
    });
    page.drawText(label.toUpperCase(), {
      x: MARGIN + 10,
      y: baselineY,
      size: fs,
      font: fontBold,
      color: PAL.primary,
    });
    y = barBottom - 8;
  };

  const drawKV = (label, value, { boldValue = false } = {}) => {
    page.drawText(winAnsiSafe(label, 80), { x: MARGIN, y, size: 9, font, color: PAL.lineMuted });
    const vStr = winAnsiSafe(value, 40);
    const vw = (boldValue ? fontBold : font).widthOfTextAtSize(vStr, 9);
    page.drawText(vStr, {
      x: PAGE_W - MARGIN - vw,
      y,
      size: 9,
      font: boldValue ? fontBold : font,
      color: textColor,
    });
    y -= lineH + 2;
  };

  drawSectionTitle('Resumo do período');
  const norm = normativeBlockFromRow(row);
  drawKV(norm.qtyLabel, norm.qty);
  drawKV(norm.totalLabel, moneyFmt(norm.total));
  const dd = Array.isArray(row.double_diaria_dates) ? row.double_diaria_dates : [];
  const ptSlip = String(row.payment_type || 'daily').toLowerCase();
  if (dd.length && ptSlip !== 'hourly') {
    const br = dd
      .map((ymd) => {
        const s = String(ymd || '').slice(0, 10);
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
      })
      .join(', ');
    drawKV('Dias em double (2 diarias)', winAnsiSafe(br, 120));
  }
  drawKV('Horas extras (total)', `${fmtQty(row.overtime_hours_sum || 0)} h`);
  drawKV('Valor horas extras', moneyFmt(row.amount_overtime || 0));
  page.drawLine({
    start: { x: MARGIN, y: y + 4 },
    end: { x: PAGE_W - MARGIN, y: y + 4 },
    thickness: 0.5,
    color: PAL.rule,
  });
  y -= 8;
  drawKV('Subtotal folha', moneyFmt(row.subtotal || 0), { boldValue: true });
  drawKV('Reembolso', moneyFmt(row.reimbursement || 0));
  drawKV('Desconto', moneyFmt(row.discount || 0));
  y -= 6;

  const totalVal = moneyFmt(
    row.employee_total != null
      ? Number(row.employee_total)
      : Math.round(
          ((Number(row.subtotal) || 0) + (Number(row.reimbursement) || 0) - (Number(row.discount) || 0)) * 100
        ) / 100
  );
  const fsVal = 18;
  const fsLabel = 10;
  const barPadY = 12;
  const barH = fontBold.heightAtSize(fsVal) + 2 * barPadY;
  const barTop = y;
  const barBottom = barTop - barH;
  const baselineVal = baselineCenteredInBar(barBottom, barH, fsVal);
  const baselineLabel = baselineVal - (fsVal - fsLabel) * 0.32;

  page.drawRectangle({
    x: MARGIN,
    y: barBottom,
    width: contentW,
    height: barH,
    color: PAL.primary,
  });
  page.drawRectangle({
    x: MARGIN,
    y: barBottom,
    width: 4,
    height: barH,
    color: PAL.secondary,
  });
  page.drawText('TOTAL A PAGAR', {
    x: MARGIN + 12,
    y: baselineLabel,
    size: fsLabel,
    font: fontBold,
    color: PAL.white,
  });
  const valW = fontBold.widthOfTextAtSize(totalVal, fsVal);
  page.drawText(totalVal, {
    x: PAGE_W - MARGIN - valW,
    y: baselineVal,
    size: fsVal,
    font: fontBold,
    color: PAL.secondary,
  });
  y = barBottom - 12;

  page.drawText('Documento confidencial - uso interno / funcionário.', {
    x: MARGIN,
    y: Math.max(36, y),
    size: 7,
    font,
    color: PAL.lineMuted,
  });
}

/**
 * @param {object} opts
 * @param {object} opts.period — linha construction_payroll_periods
 * @param {object} opts.employeeRow — item de by_employee do preview
 */
export async function buildPayrollSlipPdfBuffer(opts) {
  const { period, employeeRow: row } = opts;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  await drawPayrollSlipStyledPage(pdf, font, fontBold, {
    period,
    row,
    rightTitle: 'RECIBO DE PAGAMENTO',
  });
  return Buffer.from(await pdf.save());
}

/**
 * Um PDF com uma página por funcionário (mesmo layout que o recibo).
 * @param {object} opts
 * @param {object} opts.period
 * @param {object[]} opts.employeeRows — by_employee
 */
export async function buildIndividualPayrollReportsPdfBuffer(opts) {
  const { period, employeeRows } = opts;
  const rows = Array.isArray(employeeRows) ? employeeRows : [];
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const n = rows.length;
  for (let i = 0; i < n; i++) {
    await drawPayrollSlipStyledPage(pdf, font, fontBold, {
      period,
      row: rows[i],
      rightTitle: 'RELATORIO INDIVIDUAL',
      pageIndex: i + 1,
      pageTotal: n,
    });
  }
  return Buffer.from(await pdf.save());
}
