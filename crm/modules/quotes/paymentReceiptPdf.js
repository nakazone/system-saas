/**
 * Payment receipt PDF (recibo) for invoice payments — partial or full.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sanitizePdfText } from '../../lib/pdfWinAnsi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COMPANY = {
  name: 'Senior Floors',
  tagline: 'Hardwood · LVP · Refinishing · Denver Metro',
  phone: '(720) 751-9813',
  email: 'contact@senior-floors.com',
};

const PAL = {
  primary: rgb(26 / 255, 32 / 255, 54 / 255),
  secondary: rgb(214 / 255, 181 / 255, 152 / 255),
  panelBg: rgb(240 / 255, 242 / 255, 248 / 255),
  muted: rgb(0.4, 0.42, 0.48),
  rule: rgb(0.86, 0.88, 0.92),
  white: rgb(1, 1, 1),
  paid: rgb(21 / 255, 128 / 255, 61 / 255),
};

const METHOD_LABELS = {
  cash: 'Cash',
  check: 'Check',
  zelle: 'Zelle',
  venmo: 'Venmo',
  credit_card: 'Credit card',
  bank_transfer: 'Bank transfer',
  other: 'Other',
};

const winAnsiSafe = sanitizePdfText;

function money(n) {
  const x = Number(n) || 0;
  return `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

/**
 * @param {object} opts
 * @param {object} opts.receipt
 * @param {object} opts.invoice
 * @param {object} [opts.quote]
 * @param {object} [opts.customer]
 * @param {{ invoice_amount: number, paid_total: number, remaining: number }} opts.balance
 */
export async function buildPaymentReceiptPdfBuffer(opts) {
  const { receipt, invoice, quote = {}, customer = {}, balance } = opts;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageW = 612;
  const pageH = 792;
  const page = pdf.addPage([pageW, pageH]);
  const margin = 48;
  let y = pageH - 48;

  const drawTxt = (text, o) => page.drawText(winAnsiSafe(text), o);

  const logo = await tryEmbedLogo(pdf);
  if (logo) {
    const maxH = 36;
    const scale = maxH / logo.height;
    const w = logo.width * scale;
    page.drawImage(logo, { x: margin, y: y - maxH, width: w, height: maxH });
  }

  drawTxt(COMPANY.name, {
    x: margin + (logo ? 90 : 0),
    y: y - 14,
    size: 16,
    font: fontBold,
    color: PAL.primary,
  });
  drawTxt(COMPANY.tagline, {
    x: margin + (logo ? 90 : 0),
    y: y - 30,
    size: 8,
    font,
    color: PAL.muted,
  });

  const title = 'PAYMENT RECEIPT';
  const titleW = fontBold.widthOfTextAtSize(title, 14);
  drawTxt(title, {
    x: pageW - margin - titleW,
    y: y - 14,
    size: 14,
    font: fontBold,
    color: PAL.primary,
  });
  const receiptNo = String(receipt.receipt_number || '');
  const rnW = font.widthOfTextAtSize(receiptNo, 10);
  drawTxt(receiptNo, {
    x: pageW - margin - rnW,
    y: y - 30,
    size: 10,
    font,
    color: PAL.muted,
  });

  y -= 56;
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageW - margin, y },
    thickness: 1,
    color: PAL.rule,
  });
  y -= 24;

  const paidAmt = Number(receipt.amount) || 0;
  const invAmt = Number(balance?.invoice_amount ?? invoice.amount) || 0;
  const paidTotal = Number(balance?.paid_total) || 0;
  const remaining = Number(balance?.remaining) || 0;
  const isFull = remaining <= 0.009;

  // Amount highlight
  page.drawRectangle({
    x: margin,
    y: y - 58,
    width: pageW - 2 * margin,
    height: 66,
    color: PAL.panelBg,
    borderColor: PAL.secondary,
    borderWidth: 1,
  });
  drawTxt(isFull ? 'Payment received in full' : 'Partial payment received', {
    x: margin + 14,
    y: y - 18,
    size: 10,
    font,
    color: PAL.muted,
  });
  drawTxt(money(paidAmt), {
    x: margin + 14,
    y: y - 46,
    size: 26,
    font: fontBold,
    color: isFull ? PAL.paid : PAL.primary,
  });
  y -= 84;

  const clientName = customer.name || 'Client';
  const payDate = receipt.payment_date
    ? String(receipt.payment_date).slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const method =
    METHOD_LABELS[String(receipt.payment_method || 'other').toLowerCase()] ||
    String(receipt.payment_method || 'Other');

  const rows = [
    ['Received from', clientName],
    ['Payment date', payDate],
    ['Payment method', method],
    ['Reference', receipt.reference_number ? String(receipt.reference_number) : '—'],
    ['Invoice', String(invoice.invoice_number || '')],
    ['Quote', String(quote.quote_number || invoice.quote_number || '—')],
    ['Invoice amount', money(invAmt)],
    ['Total paid to date', money(paidTotal)],
    ['Balance remaining', money(Math.max(0, remaining))],
  ];

  for (const [label, value] of rows) {
    drawTxt(label, { x: margin, y, size: 9, font, color: PAL.muted });
    drawTxt(String(value), { x: margin + 150, y, size: 10, font: fontBold, color: PAL.primary });
    y -= 18;
  }

  if (receipt.notes && String(receipt.notes).trim()) {
    y -= 8;
    drawTxt('Notes', { x: margin, y, size: 9, font, color: PAL.muted });
    y -= 14;
    const words = winAnsiSafe(String(receipt.notes)).split(/\s+/);
    let line = '';
    const maxW = pageW - 2 * margin;
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(test, 10) <= maxW) line = test;
      else {
        drawTxt(line, { x: margin, y, size: 10, font, color: PAL.primary });
        y -= 14;
        line = w;
      }
    }
    if (line) {
      drawTxt(line, { x: margin, y, size: 10, font, color: PAL.primary });
      y -= 14;
    }
  }

  y -= 20;
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageW - margin, y },
    thickness: 1,
    color: PAL.rule,
  });
  y -= 18;
  drawTxt('Thank you for your payment.', {
    x: margin,
    y,
    size: 10,
    font,
    color: PAL.primary,
  });
  y -= 14;
  drawTxt(`${COMPANY.phone}  ·  ${COMPANY.email}`, {
    x: margin,
    y,
    size: 8,
    font,
    color: PAL.muted,
  });

  return Buffer.from(await pdf.save());
}
