/**
 * Samples de stain — the signed approval as a one-page PDF (English, for the client, the job and the builder).
 */
import PDFDocument from "pdfkit";

const INK = "#221E1A";
const MUTED = "#667085";
const RULE = "#E5E7EB";
const OLIVE = "#536249";

export type StainPdfInput = {
  companyName: string;
  companyContact?: string | null;
  logo?: Buffer | null;
  jobNumber?: number | null;
  jobAddress?: string | null;
  clientName?: string | null;
  woodSpecies?: string | null;
  room?: string | null;
  roundNumber: number;
  approved: { number: number; name: string; sub: string; photo?: Buffer | null };
  others: Array<{ number: number; name: string; photo?: Buffer | null }>;
  board?: Buffer | null;
  signerName: string;
  signedAtText: string;
  ip?: string | null;
  signature?: Buffer | null;
  terms: string;
  approvalId: string;
};

/** pdfkit only draws JPEG/PNG: normalize any photo to a JPEG no wider than `width`. */
export async function pdfImage(buf: Buffer | null | undefined, width = 1400): Promise<Buffer | null> {
  if (!buf?.length) return null;
  try {
    const sharp = (await import("sharp")).default;
    return await sharp(buf).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  } catch {
    return null;
  }
}

function tryImage(doc: PDFKit.PDFDocument, buf: Buffer | null | undefined, x: number, y: number, opts: PDFKit.Mixins.ImageOption): boolean {
  if (!buf) return false;
  try {
    doc.image(buf, x, y, opts);
    return true;
  } catch {
    return false;
  }
}

export async function buildStainPdf(input: StainPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", margin: 48, info: { Title: "Stain color approval", Author: input.companyName } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = 48;
  const width = doc.page.width - 96;
  let y = 48;

  // header
  if (input.logo && tryImage(doc, input.logo, left, y, { fit: [120, 40] })) {
    doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text(input.companyName, left + 132, y + 4, { width: width - 132 });
  } else {
    doc.font("Helvetica-Bold").fontSize(16).fillColor(INK).text(input.companyName, left, y);
  }
  if (input.companyContact) doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(input.companyContact, left, y + 24, { width, align: "right" });
  y += 52;
  doc.moveTo(left, y).lineTo(left + width, y).lineWidth(1).strokeColor(RULE).stroke();
  y += 16;

  doc.font("Helvetica-Bold").fontSize(20).fillColor(INK).text("Stain color approval", left, y);
  y += 28;
  const facts = [
    input.jobNumber ? `Job #${input.jobNumber}` : null,
    input.jobAddress || null,
    input.clientName ? `Client: ${input.clientName}` : null,
    input.woodSpecies ? `Wood: ${input.woodSpecies}` : null,
    input.room ? `Samples applied in: ${input.room}` : null,
    `Round ${input.roundNumber}`,
  ].filter(Boolean).join("  ·  ");
  doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(facts, left, y, { width });
  y = doc.y + 16;

  // approved color
  const photoW = 220;
  const photoH = 165;
  doc.roundedRect(left, y, width, photoH + 24, 10).lineWidth(1.5).strokeColor(OLIVE).stroke();
  const drew = tryImage(doc, input.approved.photo, left + 12, y + 12, { fit: [photoW, photoH], align: "center", valign: "center" });
  if (!drew) doc.rect(left + 12, y + 12, photoW, photoH).fillColor("#F1F3F5").fill();
  const tx = left + 12 + photoW + 20;
  const tw = width - photoW - 44;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(OLIVE).text("APPROVED COLOR", tx, y + 18, { width: tw });
  doc.font("Helvetica-Bold").fontSize(20).fillColor(INK).text(input.approved.name, tx, y + 34, { width: tw });
  doc.font("Helvetica").fontSize(11).fillColor(MUTED).text(`Sample #${input.approved.number} · ${input.approved.sub}`, tx, doc.y + 4, { width: tw });
  doc.font("Helvetica").fontSize(10).fillColor(INK).text(`Signed by ${input.signerName}`, tx, doc.y + 14, { width: tw });
  doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(input.signedAtText, tx, doc.y + 2, { width: tw });
  y += photoH + 24 + 18;

  // other samples shown
  if (input.others.length) {
    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("Other samples shown", left, y);
    y += 18;
    const cols = 4;
    const gap = 10;
    const cw = (width - gap * (cols - 1)) / cols;
    const ch = cw * 0.66;
    input.others.slice(0, 8).forEach((o, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = left + col * (cw + gap);
      const yy = y + row * (ch + 36);
      if (!tryImage(doc, o.photo, x, yy, { fit: [cw, ch], align: "center", valign: "center" })) doc.rect(x, yy, cw, ch).fillColor("#F1F3F5").fill();
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(`#${o.number} · ${o.name}`, x, yy + ch + 4, { width: cw, height: 24, ellipsis: true });
    });
    y += Math.ceil(Math.min(8, input.others.length) / cols) * (ch + 36) + 8;
  }

  if (y > doc.page.height - 260) {
    doc.addPage();
    y = 48;
  }

  // terms + signature
  doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("Client agreement", left, y);
  y += 16;
  doc.font("Helvetica").fontSize(10).fillColor(INK).text(input.terms, left, y, { width, lineGap: 2 });
  y = doc.y + 16;
  doc.roundedRect(left, y, 260, 90, 8).lineWidth(1).strokeColor(RULE).stroke();
  tryImage(doc, input.signature, left + 10, y + 8, { fit: [240, 74], align: "center", valign: "center" });
  doc.font("Helvetica").fontSize(9).fillColor(MUTED).text("Signature", left, y + 94);
  const sx = left + 280;
  doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(input.signerName, sx, y + 8, { width: width - 280 });
  doc.font("Helvetica").fontSize(9).fillColor(MUTED)
    .text(input.signedAtText, sx, doc.y + 4, { width: width - 280 })
    .text(input.ip ? `IP address: ${input.ip}` : "", sx, doc.y + 2, { width: width - 280 })
    .text(`Record: ${input.approvalId}`, sx, doc.y + 2, { width: width - 280 });

  doc.page.margins.bottom = 0;
  doc.font("Helvetica").fontSize(8).fillColor(MUTED).text("Sent via ObraMate", left, doc.page.height - 40, { width, align: "center" });
  doc.end();
  return done;
}
