/**
 * Client payment invoice PDF (from approved quote) — includes full quote line items.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sanitizePdfText } from '../../lib/pdfWinAnsi.js';
import { groupItemsForPdf } from './quotePdf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COMPANY = {
  name: 'Senior Floors',
  tagline: 'Hardwood - LVP - Refinishing - Denver Metro',
  phone: '(720) 751-9813',
  email: 'contact@senior-floors.com',
};

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

const TYPE_LABELS = {
  deposit: 'Deposit',
  progress: 'Progress payment',
  final: 'Final payment',
  full: 'Full payment',
  other: 'Payment',
};

const winAnsiSafe = sanitizePdfText;

function money(n) {
  const x = Number(n) || 0;
  return `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function defaultTerms() {
  return (
    'This quote is valid until the expiration date shown. Pricing assumes access to the job site and ' +
    'accurate measurements; changes in scope may require a revised quote. A signed approval or deposit ' +
    'may be required to schedule work.'
  );
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

const DEFAULT_PAYMENT_INSTRUCTIONS =
  'Please remit payment by check, Zelle, or bank transfer. Include the invoice number on your payment. ' +
  'Contact us if you need wiring details or have questions about this invoice.';

/**
 * @param {object} opts
 * @param {object} opts.invoice
 * @param {object} opts.quote
 * @param {Array} [opts.items]
 * @param {object} [opts.customer]
 */
export async function buildInvoicePdfBuffer(opts) {
  const { invoice, quote, items = [], customer = {} } = opts;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const pageW = 612;
  const pageH = 792;
  let page = pdf.addPage([pageW, pageH]);
  let y = pageH - 48;
  const margin = 48;
  const contentW = pageW - 2 * margin;
  const lineH = 13;
  const textColor = PAL.primary;

  const drawTxt = (text, opts2) => {
    page.drawText(winAnsiSafe(text), opts2);
  };

  const wrap = (text, maxW, size, f = font) => {
    const words = winAnsiSafe(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(test, size) <= maxW) line = test;
      else {
        if (line) lines.push(line);
        line = w;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  };

  const colDesc = margin;
  const colQty = pageW - margin - 210;
  const colRate = pageW - margin - 128;
  const colAmt = pageW - margin - 58;
  const descMaxW = colQty - colDesc - 10;

  const ensureSpace = (needFromBottom) => {
    if (y >= needFromBottom) return;
    page = pdf.addPage([pageW, pageH]);
    y = pageH - margin;
  };

  const baselineCenteredInBar = (barBottom, barH, fontSize) => {
    const ascent = fontSize * 0.76;
    const descent = fontSize * 0.235;
    return barBottom + barH / 2 - (ascent - descent) / 2;
  };

  const drawTableHeader = () => {
    ensureSpace(100);
    const fs = 8;
    const barPad = 5;
    const th = fontBold.heightAtSize(fs);
    const barH = th + 2 * barPad;
    const barTop = y;
    const barBottom = barTop - barH;
    const baselineY = baselineCenteredInBar(barBottom, barH, fs);
    page.drawRectangle({
      x: margin,
      y: barBottom,
      width: contentW,
      height: barH,
      color: PAL.primary,
      opacity: 0.06,
    });
    drawTxt('Description', { x: colDesc + 4, y: baselineY, size: fs, font: fontBold, color: PAL.primary });
    drawTxt('Qty', { x: colQty, y: baselineY, size: fs, font: fontBold, color: PAL.primary });
    drawTxt('Rate', { x: colRate, y: baselineY, size: fs, font: fontBold, color: PAL.primary });
    drawTxt('Amount', { x: colAmt, y: baselineY, size: fs, font: fontBold, color: PAL.primary });
    y = barBottom - 4;
    page.drawLine({
      start: { x: margin, y },
      end: { x: pageW - margin, y },
      thickness: 0.75,
      color: PAL.secondary,
    });
    y -= 14;
  };

  const drawSectionTitle = (label) => {
    ensureSpace(72);
    const fs = 9;
    const barPad = 6;
    const th = fontBold.heightAtSize(fs);
    const barH = th + 2 * barPad;
    const barTop = y;
    const barBottom = barTop - barH;
    const baselineY = baselineCenteredInBar(barBottom, barH, fs);
    page.drawRectangle({
      x: margin,
      y: barBottom,
      width: contentW,
      height: barH,
      color: PAL.secondary,
      opacity: 0.22,
    });
    page.drawRectangle({
      x: margin,
      y: barBottom,
      width: 3,
      height: barH,
      color: PAL.primary,
    });
    drawTxt(label.toUpperCase(), {
      x: margin + 10,
      y: baselineY,
      size: fs,
      font: fontBold,
      color: PAL.primary,
    });
    y = barBottom - 8;
  };

  const accentBarH = 5;
  const gapBelowAccent = 14;
  page.drawRectangle({ x: 0, y: pageH - accentBarH, width: pageW, height: accentBarH, color: PAL.secondary });

  const contentTopY = pageH - accentBarH - gapBelowAccent;
  const logoTopY = contentTopY;
  const logo = await tryEmbedLogo(pdf);
  const lw = logo ? 68 : 0;
  const lh = logo ? (logo.height / logo.width) * lw : 0;
  const logoBottomY = logoTopY - lh;
  if (logo) page.drawImage(logo, { x: margin, y: logoBottomY, width: lw, height: lh });

  const nameSize = 17;
  const tagSize = 8.5;
  const textColumnX = margin + (logo ? lw + 18 : 0);
  const nameBaselineY = logoTopY - nameSize * 0.72;
  const tagBaselineY = nameBaselineY - 14;
  const contactBaselineY = tagBaselineY - 12;

  drawTxt(COMPANY.name, { x: textColumnX, y: nameBaselineY, size: nameSize, font: fontBold, color: PAL.primary });
  drawTxt(COMPANY.tagline, { x: textColumnX, y: tagBaselineY, size: tagSize, font, color: PAL.primaryMuted });
  drawTxt(`${COMPANY.phone} - ${COMPANY.email}`, {
    x: textColumnX,
    y: contactBaselineY,
    size: tagSize,
    font,
    color: PAL.primaryMuted,
  });

  const textBlockLowY = contactBaselineY - 4;
  const headerLowY = lh > 0 ? Math.min(logoBottomY, textBlockLowY) : textBlockLowY;

  const rightW = 178;
  const rightX = pageW - margin - rightW;
  const panelH = 88;
  const panelTopY = contentTopY + 2;
  const panelBottomY = panelTopY - panelH;
  page.drawRectangle({ x: rightX - 6, y: panelBottomY, width: rightW + 12, height: panelH, color: PAL.panelBg });
  page.drawRectangle({ x: rightX - 6, y: panelBottomY, width: 3, height: panelH, color: PAL.secondaryDark });

  let ry = panelTopY - 16;
  drawTxt('INVOICE', { x: rightX, y: ry, size: 11, font: fontBold, color: PAL.primary });
  ry -= lineH;
  drawTxt(invoice.invoice_number || `INV-${invoice.id}`, {
    x: rightX,
    y: ry,
    size: 10,
    font: fontBold,
    color: PAL.secondaryDark,
  });
  ry -= lineH;
  const issueDate = invoice.created_at ? String(invoice.created_at).slice(0, 10) : new Date().toISOString().slice(0, 10);
  drawTxt(`Issue: ${issueDate}`, { x: rightX, y: ry, size: 8, font, color: PAL.lineMuted });
  ry -= lineH;
  if (invoice.due_date) {
    drawTxt(`Due: ${String(invoice.due_date).slice(0, 10)}`, { x: rightX, y: ry, size: 8, font, color: PAL.lineMuted });
    ry -= lineH;
  }
  drawTxt(`Status: ${invoice.status || 'issued'}`, { x: rightX, y: ry, size: 8, font, color: PAL.lineMuted });
  ry -= lineH;
  drawTxt(`Quote: ${quote.quote_number || `#${quote.id}`}`, { x: rightX, y: ry, size: 8, font, color: PAL.lineMuted });

  const quoteContentLowY = ry - 4;
  y = Math.min(headerLowY - 10, panelBottomY - 8, quoteContentLowY) - 12;

  drawTxt('Bill to', { x: margin, y, size: 9, font: fontBold, color: PAL.secondaryDark });
  y -= lineH;
  const isBuilderQuote = String(quote.quote_party || '') === 'builder' || quote.builder_id;
  const builderPerson = [quote.builder_first_name, quote.builder_last_name].filter(Boolean).join(' ').trim();
  const clientName = isBuilderQuote
    ? quote.builder_company || builderPerson || customer.name || quote.customer_name || 'Builder'
    : customer.name || quote.customer_name || 'Client';
  drawTxt(clientName, { x: margin, y, size: 11, font: fontBold, color: PAL.primary });
  y -= lineH;
  if (isBuilderQuote && builderPerson && quote.builder_company) {
    drawTxt(builderPerson, { x: margin, y, size: 8.5, font, color: PAL.lineMuted });
    y -= lineH;
  }
  if (customer.email || quote.customer_email || quote.builder_email) {
    drawTxt(String(customer.email || quote.customer_email || quote.builder_email), { x: margin, y, size: 8.5, font, color: PAL.lineMuted });
    y -= lineH;
  }
  if (customer.phone || quote.customer_phone || quote.builder_phone) {
    drawTxt(String(customer.phone || quote.customer_phone || quote.builder_phone), { x: margin, y, size: 8.5, font, color: PAL.lineMuted });
    y -= lineH;
  }
  if (isBuilderQuote && (quote.job_name || quote.job_address)) {
    y -= 8;
    drawTxt('Project', { x: margin, y, size: 9, font: fontBold, color: PAL.secondaryDark });
    y -= lineH;
    if (quote.job_name) {
      drawTxt(String(quote.job_name), { x: margin, y, size: 9, font: fontBold, color: PAL.primary });
      y -= lineH;
    }
    if (quote.job_address) {
      drawTxt(String(quote.job_address), { x: margin, y, size: 8.5, font, color: PAL.lineMuted });
      y -= lineH;
    }
  }

  y -= 16;
  drawTxt('Services & scope (per approved quote)', {
    x: margin,
    y,
    size: 9,
    font: fontBold,
    color: PAL.secondaryDark,
  });
  y -= lineH + 4;

  const sections = groupItemsForPdf(items);
  if (!sections.length) {
    ensureSpace(100);
    drawTxt('No line items.', { x: margin, y, size: 9, font, color: PAL.lineMuted });
    y -= lineH;
  }

  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si];
    drawSectionTitle(sec.label);
    drawTableHeader();

    for (const it of sec.items) {
      ensureSpace(110);
      const nameStr = String(it.name || '').trim();
      const descStr = String(it.description || '').trim();
      const headline =
        nameStr || (descStr ? descStr.split(/\n/)[0] : '') || String(it.floor_type || '') || 'Line item';
      let bodyStr = '';
      if (nameStr && descStr && descStr !== nameStr) {
        bodyStr = descStr;
      } else if (!nameStr && descStr && descStr.includes('\n')) {
        bodyStr = descStr.split(/\n/).slice(1).join('\n').trim();
      }
      const qty = Number(it.quantity) || Number(it.area_sqft) || 0;
      const rate = Number(it.rate ?? it.unit_price) || 0;
      const amt = Number(it.amount ?? it.total_price) || qty * rate;
      const ut = it.unit_type ? String(it.unit_type).replace(/_/g, ' ') : 'sq ft';

      const descLines = wrap(headline, descMaxW, 9, fontBold);
      const rowStartY = y;
      drawTxt(`${qty} ${ut}`, { x: colQty, y: rowStartY, size: 8.5, font, color: textColor });
      drawTxt(money(rate), { x: colRate, y: rowStartY, size: 8.5, font, color: textColor });
      drawTxt(money(amt), { x: colAmt, y: rowStartY, size: 8.5, font: fontBold, color: PAL.primary });

      let dy = rowStartY;
      for (const line of descLines) {
        ensureSpace(88);
        drawTxt(line, { x: colDesc, y: dy, size: 9, font: fontBold, color: textColor });
        dy -= lineH;
      }
      if (bodyStr) {
        for (const line of wrap(bodyStr, descMaxW, 7.5, fontItalic)) {
          ensureSpace(88);
          drawTxt(line, { x: colDesc, y: dy, size: 7.5, font: fontItalic, color: PAL.lineMuted });
          dy -= lineH - 1;
        }
      }
      const catalogNotes = String(it.catalog_customer_notes || '').trim();
      const lineComment = String(it.notes || '').trim();
      const detailParts = [];
      if (catalogNotes) detailParts.push(catalogNotes);
      if (lineComment) detailParts.push(`Comment: ${lineComment}`);
      if (detailParts.length) {
        const detailText = detailParts.join(' - ');
        for (const line of wrap(detailText, descMaxW, 7.5, fontItalic)) {
          ensureSpace(88);
          drawTxt(line, { x: colDesc, y: dy, size: 7.5, font: fontItalic, color: PAL.lineMuted });
          dy -= lineH - 1;
        }
      }
      y = Math.min(dy, rowStartY - lineH) - 6;
    }

    if (si < sections.length - 1) {
      y -= 4;
      ensureSpace(90);
      page.drawLine({
        start: { x: margin + 20, y },
        end: { x: pageW - margin - 20, y },
        thickness: 0.35,
        color: PAL.rule,
      });
      y -= 16;
    }
  }

  y -= 8;
  ensureSpace(140);
  page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.75, color: PAL.secondaryDark });
  y -= 18;

  const sub = Number(quote.subtotal) || 0;
  const tax = Number(quote.tax_total) || 0;
  const quoteTotal = Number(quote.total_amount ?? invoice.quote_total) || 0;
  const totalsX = pageW - margin - 198;
  const valX = pageW - margin - 58;

  const drawRow = (label, val, { bold = false } = {}) => {
    ensureSpace(72);
    drawTxt(label, { x: totalsX, y, size: 9, font, color: PAL.lineMuted });
    drawTxt(val, { x: valX, y, size: 9, font: bold ? fontBold : font, color: textColor });
    y -= lineH + 2;
  };

  drawRow('Subtotal', money(sub));
  drawRow('Tax', money(tax));
  const discType = quote.discount_type === 'fixed' ? '$' : '%';
  const discVal = Number(quote.discount_value) || 0;
  drawRow(`Discount (${discType})`, discType === '$' ? money(discVal) : `${discVal}%`);
  drawRow('Quote total', money(quoteTotal), { bold: true });

  const bal = opts.balance || {};
  const previouslyInvoiced = Number(bal.previously_invoiced) || 0;
  const remainingAfter =
    bal.remaining_after != null
      ? Number(bal.remaining_after)
      : Math.max(0, quoteTotal - previouslyInvoiced - (Number(invoice.amount) || 0));
  if (previouslyInvoiced > 0.009) {
    drawRow('Previously invoiced', money(previouslyInvoiced));
    drawRow('Remaining after this invoice', money(remainingAfter));
  }

  y -= 10;
  ensureSpace(120);
  const typeLabel = TYPE_LABELS[invoice.invoice_type] || 'Payment';
  const invoiceAmt = Number(invoice.amount) || 0;
  drawTxt('Payment requested on this invoice', { x: margin, y, size: 9, font: fontBold, color: PAL.secondaryDark });
  y -= lineH + 2;
  drawTxt(`${typeLabel} per approved quote ${quote.quote_number || `#${quote.id}`}`, {
    x: margin,
    y,
    size: 8.5,
    font,
    color: PAL.lineMuted,
  });
  y -= lineH;
  drawRow(`${typeLabel} due now`, money(invoiceAmt), { bold: true });

  if (invoice.notes) {
    y -= 4;
    ensureSpace(80);
    drawTxt('Invoice notes', { x: margin, y, size: 9, font: fontBold, color: PAL.secondaryDark });
    y -= lineH + 2;
    for (const line of wrap(invoice.notes, contentW, 8)) {
      ensureSpace(56);
      drawTxt(line, { x: margin, y, size: 8, font, color: PAL.lineMuted });
      y -= lineH - 1;
    }
  }

  y -= 8;
  ensureSpace(100);
  const amtStr = money(invoiceAmt);
  const barPadY = 14;
  const fsVal = 20;
  const fsLabel = 11;
  const barH = fontBold.heightAtSize(fsVal) + 2 * barPadY;
  const barTop = y;
  const barBottom = barTop - barH;
  const baselineVal = baselineCenteredInBar(barBottom, barH, fsVal);
  const baselineLabel = baselineVal - (fsVal - fsLabel) * 0.32;
  page.drawRectangle({ x: margin, y: barBottom, width: contentW, height: barH, color: PAL.primary });
  page.drawRectangle({ x: margin, y: barBottom, width: 5, height: barH, color: PAL.secondary });
  drawTxt('AMOUNT DUE', { x: margin + 14, y: baselineLabel, size: fsLabel, font: fontBold, color: PAL.white });
  const dueW = fontBold.widthOfTextAtSize(winAnsiSafe(amtStr), fsVal);
  drawTxt(amtStr, {
    x: pageW - margin - dueW,
    y: baselineVal,
    size: fsVal,
    font: fontBold,
    color: PAL.secondary,
  });
  y = barBottom - 20;

  ensureSpace(80);
  drawTxt('Payment instructions', { x: margin, y, size: 9, font: fontBold, color: PAL.secondaryDark });
  y -= lineH + 2;
  const payText = invoice.payment_instructions || DEFAULT_PAYMENT_INSTRUCTIONS;
  for (const line of wrap(payText, contentW, 8)) {
    ensureSpace(56);
    drawTxt(line, { x: margin, y, size: 8, font, color: PAL.lineMuted });
    y -= lineH - 1;
  }

  y -= 12;
  ensureSpace(80);
  drawTxt('Terms & conditions', { x: margin, y, size: 9, font: fontBold, color: PAL.secondaryDark });
  y -= lineH + 2;
  const terms = quote.terms_conditions || defaultTerms();
  for (const line of wrap(terms, contentW, 7.5)) {
    ensureSpace(56);
    drawTxt(line, { x: margin, y, size: 7.5, font, color: PAL.lineMuted });
    y -= lineH - 1;
  }

  if (quote.notes) {
    y -= 10;
    ensureSpace(80);
    drawTxt('Quote notes', { x: margin, y, size: 9, font: fontBold, color: PAL.secondaryDark });
    y -= lineH + 2;
    for (const line of wrap(quote.notes, contentW, 7.5)) {
      ensureSpace(50);
      drawTxt(line, { x: margin, y, size: 7.5, font, color: textColor });
      y -= lineH - 1;
    }
  }

  y -= 14;
  ensureSpace(40);
  drawTxt('Thank you for choosing Senior Floors. Please contact us with any questions about this invoice.', {
    x: margin,
    y,
    size: 7.5,
    font,
    color: PAL.lineMuted,
  });

  return Buffer.from(await pdf.save());
}
