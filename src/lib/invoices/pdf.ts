import PDFDocument from "pdfkit";
import { loadLogoBuffer } from "../quotes/pdf.js";
import { paymentMethodLabel } from "./core.js";

/**
 * Client-facing invoice + receipt PDFs (English, like the quote PDF).
 * Paid invoices carry a rotated "PAID" stamp; partially paid ones a "PARTIALLY PAID" stamp.
 */

const BASE = {
  primary: "#211d1a",
  accent: "#e8792c",
  stamp: "#c1652f",
  muted: "#6b645c",
  mutedLight: "#8a8074",
  rule: "#e2d9cc",
  panel: "#f7f4ee",
  white: "#ffffff",
  voidGray: "#8a8074",
};

const HEX = /^#[0-9a-fA-F]{6}$/;

function palette(brandPrimary?: string | null, brandAccent?: string | null) {
  return {
    ...BASE,
    primary: brandPrimary && HEX.test(brandPrimary) ? brandPrimary : BASE.primary,
    accent: brandAccent && HEX.test(brandAccent) ? brandAccent : BASE.accent,
  };
}

function money(n: number): string {
  const x = Number(n) || 0;
  const s = Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return x < 0 ? `-$${s}` : `$${s}`;
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function initials(name: string): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return (String(name || "OM").replace(/[^A-Za-z0-9]/g, "").slice(0, 2) || "OM").toUpperCase();
}

export type DocOrg = {
  name: string;
  contact?: string | null;
  address?: string | null;
  license?: string | null;
  logoUrl?: string | null;
  brandPrimary?: string | null;
  brandAccent?: string | null;
};

export type DocClient = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
};

export type InvoicePdfInput = {
  org: DocOrg;
  client: DocClient;
  invoiceNumber: string;
  kindLabel: string;
  quoteNumber?: string | null;
  /** Job reference ("#12") for invoices issued straight from a job. */
  jobNumber?: string | null;
  projectName?: string | null;
  issueDate?: Date | null;
  dueDate?: Date | null;
  lines: { description: string; quantity: number; unitPrice: number; amount: number }[];
  total: number;
  payments: { receiptNumber?: string | null; paidAt: Date; method?: string | null; reference?: string | null; amount: number }[];
  paid: number;
  balance: number;
  /** paid | partially_paid | overdue | void | … */
  displayStatus: string;
  paidAt?: Date | null;
  paymentInstructions?: string | null;
  notes?: string | null;
  publicUrl?: string | null;
};

export type ReceiptPdfInput = {
  org: DocOrg;
  client: DocClient;
  receiptNumber: string;
  paidAt: Date;
  amount: number;
  method?: string | null;
  reference?: string | null;
  notes?: string | null;
  invoiceNumber: string;
  invoiceTotal: number;
  paidToDate: number;
  balance: number;
  projectName?: string | null;
};

type Doc = InstanceType<typeof PDFDocument>;

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

/** Header: accent bar, logo/initials + company block on the left, document title on the right. Returns y after header. */
function drawHeader(
  doc: Doc,
  PAL: ReturnType<typeof palette>,
  org: DocOrg,
  logo: Buffer | null,
  title: string,
  subtitle: string,
): number {
  const pageW = doc.page.width;
  const m = 48;
  doc.rect(0, 0, pageW, 5).fill(PAL.accent);
  let y = 36;
  let x = m;
  let drewLogo = false;
  if (logo?.length) {
    try {
      doc.image(logo, m, y, { fit: [44, 44], align: "center", valign: "center" });
      drewLogo = true;
    } catch {
      drewLogo = false;
    }
  }
  if (!drewLogo) {
    doc.roundedRect(m, y, 44, 44, 6).fill(PAL.primary);
    doc.fillColor(PAL.white).font("Helvetica-Bold").fontSize(15);
    const ini = initials(org.name);
    doc.text(ini, m + (44 - doc.widthOfString(ini)) / 2, y + 14, { lineBreak: false });
  }
  x = m + 56;
  doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(14).text(org.name, x, y + 2, { width: 280 });
  doc.font("Helvetica").fontSize(8.5).fillColor(PAL.muted);
  const lines = [org.address, org.contact, org.license].filter(Boolean) as string[];
  let ly = y + 21;
  for (const l of lines) {
    doc.text(l, x, ly, { width: 280 });
    ly += 11;
  }

  doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(24);
  const tw = doc.widthOfString(title);
  doc.text(title, pageW - m - tw, y, { lineBreak: false });
  doc.font("Helvetica").fontSize(10).fillColor(PAL.muted);
  const sw = doc.widthOfString(subtitle);
  doc.text(subtitle, pageW - m - sw, y + 30, { lineBreak: false });

  y = Math.max(ly, y + 52) + 18;
  doc.moveTo(m, y).lineTo(pageW - m, y).strokeColor(PAL.rule).lineWidth(0.7).stroke();
  return y + 18;
}

function label(doc: Doc, PAL: ReturnType<typeof palette>, text: string, x: number, y: number) {
  doc.fillColor(PAL.accent).font("Helvetica-Bold").fontSize(7.5).text(text.toUpperCase(), x, y, {
    characterSpacing: 0.8,
    lineBreak: false,
  });
}

/** Rotated rubber-stamp look. `size` is the main text size in points. Returns the stamp height. */
function drawStamp(
  doc: Doc,
  text: string,
  sub: string | null,
  color: string,
  cx: number,
  cy: number,
  size = 36,
): number {
  const subSize = Math.max(7, Math.round(size * 0.24));
  doc.save();
  doc.rotate(-12, { origin: [cx, cy] });
  doc.font("Helvetica-Bold").fontSize(size);
  const tw = doc.widthOfString(text) + size * 0.06 * text.length;
  doc.fontSize(subSize);
  const sw = sub ? doc.widthOfString(sub) + subSize * 0.1 * sub.length : 0;
  const padX = size * 0.45;
  const w = Math.max(tw, sw) + padX * 2;
  const h = size * 1.15 + (sub ? subSize + 12 : 0) + 10;
  doc.opacity(0.85);
  doc.roundedRect(cx - w / 2, cy - h / 2, w, h, 7).lineWidth(3).strokeColor(color).stroke();
  doc.roundedRect(cx - w / 2 + 5, cy - h / 2 + 5, w - 10, h - 10, 4).lineWidth(0.8).strokeColor(color).stroke();
  doc.font("Helvetica-Bold").fontSize(size).fillColor(color);
  doc.text(text, cx - tw / 2, cy - h / 2 + 9, { lineBreak: false, characterSpacing: size * 0.06 });
  if (sub) {
    doc.fontSize(subSize);
    doc.text(sub, cx - sw / 2, cy + h / 2 - subSize - 11, { lineBreak: false, characterSpacing: subSize * 0.1 });
  }
  doc.restore();
  doc.opacity(1);
  return h;
}

function footer(doc: Doc, PAL: ReturnType<typeof palette>, text: string) {
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  doc.font("Helvetica").fontSize(7.5).fillColor(PAL.mutedLight);
  doc.text(text, 48, pageH - 36, { width: pageW - 96, align: "center", lineBreak: false });
}

export async function buildInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  const PAL = palette(input.org.brandPrimary, input.org.brandAccent);
  const logo = await loadLogoBuffer(input.org.logoUrl);
  const { doc, done } = newDoc(`Invoice ${input.invoiceNumber}`, input.org.name);
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const m = 48;
  const W = pageW - 2 * m;

  let y = drawHeader(doc, PAL, input.org, logo, "INVOICE", input.invoiceNumber);

  // Bill to + meta
  label(doc, PAL, "Bill to", m, y);
  doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(11).text(input.client.name || "Client", m, y + 13, { width: 250 });
  doc.font("Helvetica").fontSize(9).fillColor(PAL.muted);
  let by = doc.y + 2;
  for (const l of [input.client.address, input.client.email, input.client.phone].filter(Boolean) as string[]) {
    doc.text(l, m, by, { width: 250 });
    by = doc.y + 1;
  }

  const metaX = m + W - 220;
  const meta: [string, string][] = [
    ["Invoice #", input.invoiceNumber],
    ["Issue date", fmtDate(input.issueDate)],
    ["Due date", fmtDate(input.dueDate)],
  ];
  if (input.quoteNumber) meta.push(["Quote #", input.quoteNumber]);
  if (input.jobNumber) meta.push(["Job", input.jobNumber]);
  if (input.projectName) meta.push(["Project", input.projectName]);
  let my = y;
  for (const [k, v] of meta) {
    doc.font("Helvetica").fontSize(9).fillColor(PAL.mutedLight).text(k, metaX, my, { width: 80, lineBreak: false });
    doc.font("Helvetica-Bold").fillColor(PAL.primary).text(v, metaX + 80, my, { width: 140, align: "right" });
    my = Math.max(doc.y, my + 13) + 2;
  }

  // Balance due box
  y = Math.max(by, my) + 16;
  doc.roundedRect(m, y, W, 46, 6).fill(PAL.panel);
  doc.fillColor(PAL.muted).font("Helvetica").fontSize(9).text("Balance due", m + 16, y + 10, { lineBreak: false });
  doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(18).text(money(input.balance), m + 16, y + 21, { lineBreak: false });
  doc.fillColor(PAL.muted).font("Helvetica").fontSize(9);
  const dueTxt =
    input.displayStatus === "paid"
      ? `Paid in full${input.paidAt ? ` on ${fmtDate(input.paidAt)}` : ""}`
      : input.displayStatus === "void"
        ? "This invoice has been voided"
        : `Due ${fmtDate(input.dueDate)}`;
  const dtw = doc.widthOfString(dueTxt);
  doc.text(dueTxt, m + W - 16 - dtw, y + 18, { lineBreak: false });
  y += 64;

  // Line items
  const cDesc = m;
  const cQty = m + W - 230;
  const cRate = m + W - 160;
  const cAmt = m + W - 80;
  doc.fillColor(PAL.mutedLight).font("Helvetica-Bold").fontSize(7.5);
  doc.text("DESCRIPTION", cDesc, y, { lineBreak: false, characterSpacing: 0.6 });
  doc.text("QTY", cQty, y, { width: 50, align: "right", characterSpacing: 0.6 });
  doc.text("RATE", cRate, y, { width: 70, align: "right", characterSpacing: 0.6 });
  doc.text("AMOUNT", cAmt, y, { width: 80, align: "right", characterSpacing: 0.6 });
  y += 14;
  doc.moveTo(m, y).lineTo(m + W, y).strokeColor(PAL.rule).lineWidth(0.6).stroke();
  y += 8;
  const lines = input.lines.length
    ? input.lines
    : [{ description: input.kindLabel, quantity: 1, unitPrice: input.total, amount: input.total }];
  for (const ln of lines) {
    if (y > pageH - 220) {
      footer(doc, PAL, `${input.org.name} · Invoice ${input.invoiceNumber}`);
      doc.addPage({ size: "LETTER", margin: 0 });
      y = 48;
    }
    const [first, ...rest] = String(ln.description || "Item").split("\n");
    doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(10).text(first || "Item", cDesc, y, { width: cQty - cDesc - 12 });
    let ly = doc.y;
    if (rest.length) {
      doc.font("Helvetica").fontSize(8.5).fillColor(PAL.muted).text(rest.join("\n"), cDesc, ly + 1, { width: cQty - cDesc - 12 });
      ly = doc.y;
    }
    doc.font("Helvetica").fontSize(10).fillColor(PAL.primary);
    doc.text(Number(ln.quantity).toLocaleString("en-US", { maximumFractionDigits: 2 }), cQty, y, { width: 50, align: "right" });
    doc.text(money(ln.unitPrice), cRate, y, { width: 70, align: "right" });
    doc.font("Helvetica-Bold").text(money(ln.amount), cAmt, y, { width: 80, align: "right" });
    y = Math.max(ly, y + 14) + 8;
    doc.moveTo(m, y - 4).lineTo(m + W, y - 4).strokeColor(PAL.rule).lineWidth(0.4).stroke();
  }

  // Totals
  y += 6;
  const totalsTop = y;
  const tW = 290;
  const tX = m + W - tW;
  const totalRow = (k: string, v: string, bold = false, color = PAL.primary) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9.5).fillColor(bold ? color : PAL.muted);
    doc.text(k, tX, y, { width: tW - 90, lineBreak: false, ellipsis: true });
    doc.fillColor(color).text(v, tX + tW - 90, y, { width: 90, align: "right", lineBreak: false });
    y += bold ? 18 : 15;
  };
  totalRow("Total", money(input.total));
  for (const p of input.payments) {
    totalRow(
      `Payment ${fmtDate(p.paidAt)}${p.method ? ` · ${paymentMethodLabel(p.method)}` : ""}`,
      `–${money(p.amount)}`,
    );
  }
  doc.moveTo(tX, y).lineTo(m + W, y).strokeColor(PAL.primary).lineWidth(0.8).stroke();
  y += 6;
  totalRow("Balance due", money(input.balance), true);

  // Stamp in the empty space left of the totals (first page when totals fit there).
  const stampX = m + (W - tW) / 2 - 6;
  const stampY = totalsTop + 44;
  let stampH = 0;
  if (input.displayStatus === "paid") {
    stampH = drawStamp(doc, "PAID", input.paidAt ? fmtDate(input.paidAt).toUpperCase() : null, PAL.stamp, stampX, stampY, 38);
  } else if (input.displayStatus === "partially_paid" || (input.paid > 0 && input.balance > 0 && input.displayStatus !== "void")) {
    stampH = drawStamp(doc, "PARTIALLY PAID", `${money(input.paid)} RECEIVED`, PAL.stamp, stampX, stampY, 17);
  } else if (input.displayStatus === "void") {
    stampH = drawStamp(doc, "VOID", null, PAL.voidGray, stampX, stampY, 34);
  }
  if (stampH) y = Math.max(y, stampY + stampH / 2 + 20);


  // Payment instructions / notes
  y += 16;
  const blocks: [string, string][] = [];
  if (input.paymentInstructions?.trim() && input.balance > 0) blocks.push(["How to pay", input.paymentInstructions.trim()]);
  if (input.notes?.trim()) blocks.push(["Notes", input.notes.trim()]);
  if (input.publicUrl && input.balance > 0) blocks.push(["View online", input.publicUrl]);
  for (const [k, v] of blocks) {
    if (y > pageH - 100) {
      footer(doc, PAL, `${input.org.name} · Invoice ${input.invoiceNumber}`);
      doc.addPage({ size: "LETTER", margin: 0 });
      y = 48;
    }
    label(doc, PAL, k, m, y);
    doc.font("Helvetica").fontSize(9).fillColor(PAL.primary).text(v, m, y + 12, { width: W * 0.62 });
    y = doc.y + 12;
  }

  footer(doc, PAL, `${input.org.name} · Invoice ${input.invoiceNumber} · Thank you for your business`);
  doc.end();
  return done;
}

export async function buildReceiptPdf(input: ReceiptPdfInput): Promise<Buffer> {
  const PAL = palette(input.org.brandPrimary, input.org.brandAccent);
  const logo = await loadLogoBuffer(input.org.logoUrl);
  const { doc, done } = newDoc(`Receipt ${input.receiptNumber}`, input.org.name);
  const pageW = doc.page.width;
  const m = 48;
  const W = pageW - 2 * m;

  let y = drawHeader(doc, PAL, input.org, logo, "RECEIPT", input.receiptNumber);

  label(doc, PAL, "Received from", m, y);
  doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(11).text(input.client.name || "Client", m, y + 13, { width: 260 });
  doc.font("Helvetica").fontSize(9).fillColor(PAL.muted);
  let by = doc.y + 2;
  for (const l of [input.client.address, input.client.email].filter(Boolean) as string[]) {
    doc.text(l, m, by, { width: 260 });
    by = doc.y + 1;
  }

  // Amount panel
  y = by + 20;
  doc.roundedRect(m, y, W, 70, 8).fill(PAL.panel);
  doc.fillColor(PAL.muted).font("Helvetica").fontSize(9.5).text("Amount received", m + 20, y + 14, { lineBreak: false });
  doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(26).text(money(input.amount), m + 20, y + 30, { lineBreak: false });
  const right = `${fmtDate(input.paidAt)}${input.method ? ` · ${paymentMethodLabel(input.method)}` : ""}`;
  doc.font("Helvetica").fontSize(10).fillColor(PAL.muted);
  doc.text(right, m + W - 20 - doc.widthOfString(right), y + 30, { lineBreak: false });
  y += 92;

  const rows: [string, string][] = [
    ["Receipt #", input.receiptNumber],
    ["Payment date", fmtDate(input.paidAt)],
    ["Payment method", paymentMethodLabel(input.method)],
  ];
  if (input.reference) rows.push(["Reference", input.reference]);
  rows.push(["Applied to invoice", input.invoiceNumber]);
  if (input.projectName) rows.push(["Project", input.projectName]);
  rows.push(["Invoice total", money(input.invoiceTotal)]);
  rows.push(["Paid to date", money(input.paidToDate)]);
  rows.push(["Remaining balance", money(input.balance)]);

  for (const [k, v] of rows) {
    const bold = k === "Remaining balance";
    doc.font("Helvetica").fontSize(10).fillColor(PAL.muted).text(k, m, y, { width: 200, lineBreak: false });
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fillColor(PAL.primary).text(v, m + 200, y, { width: W - 200, align: "right" });
    y += 20;
    doc.moveTo(m, y - 6).lineTo(m + W, y - 6).strokeColor(PAL.rule).lineWidth(0.4).stroke();
  }

  if (input.notes?.trim()) {
    y += 10;
    label(doc, PAL, "Notes", m, y);
    doc.font("Helvetica").fontSize(9).fillColor(PAL.primary).text(input.notes.trim(), m, y + 12, { width: W });
    y = doc.y + 10;
  }

  if (input.balance <= 0.004) {
    drawStamp(doc, "PAID", "IN FULL", PAL.stamp, m + W - 130, 140, 26);
  }

  y += 24;
  doc.font("Helvetica-Oblique").fontSize(10).fillColor(PAL.muted).text("Thank you for your payment.", m, y, { width: W, align: "center" });

  footer(doc, PAL, `${input.org.name} · Receipt ${input.receiptNumber}`);
  doc.end();
  return done;
}
