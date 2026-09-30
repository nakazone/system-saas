import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** ObraMate design tokens (design-system.css) */
const PAL = {
  primary: "#211d1a",
  primaryMuted: "#3a332e",
  secondary: "#e8792c",
  secondaryDark: "#a85428",
  panelBg: "#f7f4ee",
  lineMuted: "#6b645c",
  rule: "#e2d9cc",
  white: "#ffffff",
};

const DEFAULT_TAGLINE = "Pisos · Instalação · Acabamento";

const SECTION_DEFS = [
  { key: "installation", label: "Instalação" },
  { key: "sand_finish", label: "Lixamento & Acabamento" },
  { key: "supply", label: "Fornecimento" },
  { key: "products", label: "Materiais & produtos" },
] as const;

export type QuotePdfLine = {
  name?: string | null;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  amount: number;
  isOptional?: boolean;
  isSelected?: boolean;
  optionGroupId?: string | null;
  itemType?: string | null;
  serviceType?: string | null;
  notes?: string | null;
  catalogNotes?: string | null;
};

export type QuotePdfInput = {
  organizationName: string;
  organizationContact?: string | null;
  organizationAddress?: string | null;
  organizationLicense?: string | null;
  organizationTagline?: string | null;
  title: string;
  number: number | string;
  status: string;
  issueDate?: Date | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  quoteParty?: string | null;
  projectName?: string | null;
  projectAddress?: string | null;
  validUntil?: Date | null;
  terms?: string | null;
  clientMessage?: string | null;
  notes?: string | null;
  rooms: { name: string; areaSqft: number }[];
  optionGroups: { id: string; name: string }[];
  selectedOptionGroupId?: string | null;
  lines: QuotePdfLine[];
  clientView?: {
    showQuantities?: boolean;
    showUnitPrices?: boolean;
    showLineTotals?: boolean;
    showRoomBreakdown?: boolean;
  } | null;
  subtotal: number;
  taxTotal: number;
  discountType?: string | null;
  discountValue?: number;
  total: number;
  signatureUrl?: string | null;
  signedByName?: string | null;
  signedAt?: Date | null;
  ownerSignature?: {
    name?: string | null;
    title?: string | null;
    imageUrl?: string | null;
  } | null;
};

function money(n: number): string {
  const x = Number(n) || 0;
  return `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function defaultTerms(): string {
  return (
    "Este orçamento é válido até a data de validade indicada. Os preços pressupõem acesso ao local da obra e " +
    "medições precisas; alterações de escopo podem exigir um orçamento revisado. Uma aprovação assinada ou " +
    "sinal pode ser necessária para agendar o trabalho."
  );
}

function lineSection(it: QuotePdfLine): (typeof SECTION_DEFS)[number]["key"] {
  if (String(it.itemType || "").toLowerCase() === "product") return "products";
  const st = String(it.serviceType || "").trim();
  if (!st) return "installation";
  const lower = st.toLowerCase();
  if (lower.includes("supply") || lower.includes("fornec")) return "supply";
  if (lower.includes("sand") || lower.includes("finish") || lower.includes("lix") || lower.includes("acab")) {
    return "sand_finish";
  }
  return "installation";
}

export function groupItemsForPdf(items: QuotePdfLine[]) {
  const list = Array.isArray(items) ? items : [];
  const buckets: Record<string, QuotePdfLine[]> = {
    installation: [],
    sand_finish: [],
    supply: [],
    products: [],
  };
  for (const it of list) {
    const k = lineSection(it);
    if (buckets[k]) buckets[k].push(it);
    else buckets.installation.push(it);
  }
  return SECTION_DEFS.filter((d) => buckets[d.key].length > 0).map((d) => ({
    label: d.label,
    items: buckets[d.key],
  }));
}

/** Map persisted quote line rows (+ meta JSON) into PDF line input. */
export function pdfLinesFromDbItems(
  lineItems: Array<{
    name?: string | null;
    description: string;
    quantity: unknown;
    unit: string;
    unitPrice: unknown;
    amount: unknown;
    isOptional?: boolean;
    isSelected?: boolean;
    optionGroupId?: string | null;
    itemType?: string | null;
    meta?: unknown;
  }>,
): QuotePdfLine[] {
  return lineItems.map((li) => {
    const meta =
      li.meta && typeof li.meta === "object" && !Array.isArray(li.meta)
        ? (li.meta as Record<string, unknown>)
        : {};
    return {
      name: li.name ?? null,
      description: li.description,
      quantity: Number(li.quantity),
      unit: li.unit,
      unitPrice: Number(li.unitPrice),
      amount: Number(li.amount),
      isOptional: li.isOptional,
      isSelected: li.isSelected,
      optionGroupId: li.optionGroupId,
      itemType: li.itemType ?? null,
      serviceType: meta.service_type != null ? String(meta.service_type) : null,
      notes: meta.notes != null ? String(meta.notes) : null,
      catalogNotes:
        meta.catalog_customer_notes != null ? String(meta.catalog_customer_notes) : null,
    };
  });
}

function findLogoPath(): string | null {
  const candidates = [
    path.join(__dirname, "../../crm/assets/obramate-logo.png"),
    path.join(__dirname, "../../src/public/obramate-logo.png"),
    path.join(__dirname, "../../public/obramateLogoSmallTransp.png"),
    path.join(process.cwd(), "crm/assets/obramate-logo.png"),
    path.join(process.cwd(), "src/public/obramate-logo.png"),
    path.join(process.cwd(), "crm/public/assets/obramateLogoSmallTransp.png"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* continue */
    }
  }
  return null;
}

function dataUrlToBuffer(url: string | null | undefined): Buffer | null {
  if (!url || !url.startsWith("data:image")) return null;
  try {
    const b64 = url.split(",")[1];
    return b64 ? Buffer.from(b64, "base64") : null;
  } catch {
    return null;
  }
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: "rascunho",
    sent: "enviado",
    changes_requested: "alterações pedidas",
    approved: "aprovado",
    converted: "convertido",
    archived: "arquivado",
    expired: "expirado",
  };
  const key = String(status || "").toLowerCase();
  return map[key] || status || "rascunho";
}

export function buildQuotePdf(input: QuotePdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margin: 0,
      bufferPages: true,
      info: {
        Title: `Orçamento ${input.number}`,
        Author: input.organizationName,
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const margin = 48;
    const contentW = pageW - 2 * margin;
    const lineH = 13;

    const view = {
      showQuantities: true,
      showUnitPrices: true,
      showLineTotals: true,
      showRoomBreakdown: true,
      ...(input.clientView ?? {}),
    };

    const selectedGroup = input.selectedOptionGroupId ?? null;
    const visibleLines = input.lines.filter((line) => {
      if (line.isOptional && line.isSelected === false) return false;
      if (line.optionGroupId && selectedGroup && line.optionGroupId !== selectedGroup) return false;
      if (line.optionGroupId && !selectedGroup) return false;
      return true;
    });

    let y = 0;

    const ensureSpace = (need: number) => {
      if (y + need <= pageH - margin) return;
      doc.addPage({ size: "LETTER", margin: 0 });
      y = margin;
    };

    const drawAccentBar = () => {
      doc.rect(0, 0, pageW, 5).fill(PAL.secondary);
    };

    // —— Header ——
    drawAccentBar();
    y = 5 + 14;

    const logoPath = findLogoPath();
    const logoW = 72;
    let logoH = 0;
    const logoTop = y;
    if (logoPath) {
      try {
        // Aspect ≈ 1000×400
        logoH = logoW * 0.4;
        doc.image(logoPath, margin, logoTop, { width: logoW, height: logoH });
      } catch {
        logoH = 0;
      }
    }

    const textColumnX = margin + (logoH > 0 ? logoW + 18 : 0);
    const nameSize = 17;
    doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(nameSize);
    doc.text(input.organizationName, textColumnX, logoTop + 2, { width: 260, lineBreak: false });
    doc.fillColor(PAL.primaryMuted).font("Helvetica").fontSize(8.5);
    const tagline = input.organizationTagline || DEFAULT_TAGLINE;
    doc.text(tagline, textColumnX, logoTop + 20, { width: 260, lineBreak: false });
    if (input.organizationContact) {
      doc.text(input.organizationContact, textColumnX, logoTop + 32, { width: 260, lineBreak: false });
    }
    let headerLowY = Math.max(logoTop + (logoH || 44), logoTop + 44);
    if (input.organizationAddress) {
      doc.text(input.organizationAddress, textColumnX, logoTop + 44, { width: 260 });
      headerLowY = Math.max(headerLowY, logoTop + 56);
    }
    if (input.organizationLicense) {
      doc.fontSize(8).text(input.organizationLicense, textColumnX, headerLowY, { width: 260 });
      headerLowY += 12;
    }

    // Quote panel (right)
    const rightW = 178;
    const rightX = pageW - margin - rightW;
    const panelH = 82;
    const panelTop = 5 + 12;
    doc.rect(rightX - 6, panelTop, rightW + 12, panelH).fill(PAL.panelBg);
    doc.rect(rightX - 6, panelTop, 3, panelH).fill(PAL.secondaryDark);

    let ry = panelTop + 14;
    doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(11);
    doc.text("ORÇAMENTO", rightX, ry, { lineBreak: false });
    ry += lineH;
    doc.fillColor(PAL.secondaryDark).fontSize(10);
    const quoteLabel =
      typeof input.number === "string" && input.number.trim()
        ? input.number
        : `Orçamento #${input.number}`;
    doc.text(quoteLabel, rightX, ry, { lineBreak: false });
    ry += lineH;
    doc.fillColor(PAL.lineMuted).font("Helvetica").fontSize(8);
    if (input.issueDate) {
      doc.text(`Emissão: ${input.issueDate.toISOString().slice(0, 10)}`, rightX, ry, { lineBreak: false });
      ry += lineH;
    }
    if (input.validUntil) {
      doc.text(`Validade: ${input.validUntil.toISOString().slice(0, 10)}`, rightX, ry, { lineBreak: false });
      ry += lineH;
    }
    doc.text(`Status: ${statusLabel(input.status)}`, rightX, ry, { lineBreak: false });

    y = Math.max(headerLowY, panelTop + panelH) + 18;

    // Bill to
    doc.fillColor(PAL.secondaryDark).font("Helvetica-Bold").fontSize(9);
    doc.text("Cliente", margin, y, { lineBreak: false });
    y += lineH;
    doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(11);
    doc.text(input.customerName || "Cliente", margin, y, { width: contentW * 0.55, lineBreak: false });
    y += lineH;
    doc.fillColor(PAL.lineMuted).font("Helvetica").fontSize(8.5);
    if (input.customerEmail) {
      doc.text(input.customerEmail, margin, y, { lineBreak: false });
      y += lineH;
    }
    if (input.customerPhone) {
      doc.text(input.customerPhone, margin, y, { lineBreak: false });
      y += lineH;
    }
    if (input.projectName || input.projectAddress) {
      y += 6;
      doc.fillColor(PAL.secondaryDark).font("Helvetica-Bold").fontSize(9);
      doc.text("Projeto", margin, y, { lineBreak: false });
      y += lineH;
      if (input.projectName) {
        doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(9);
        doc.text(input.projectName, margin, y, { width: contentW * 0.7 });
        y += lineH;
      }
      if (input.projectAddress) {
        doc.fillColor(PAL.lineMuted).font("Helvetica").fontSize(8.5);
        doc.text(input.projectAddress, margin, y, { width: contentW * 0.7 });
        y += lineH;
      }
    }
    if (input.title && input.title !== input.projectName) {
      y += 4;
      doc.fillColor(PAL.lineMuted).font("Helvetica").fontSize(8.5);
      doc.text(input.title, margin, y, { width: contentW * 0.7 });
      y += lineH;
    }

    if (input.clientMessage) {
      y += 8;
      ensureSpace(40);
      doc.fillColor(PAL.primary).font("Helvetica").fontSize(10);
      doc.text(input.clientMessage, margin, y, { width: contentW });
      y = doc.y + 6;
    }

    if (view.showRoomBreakdown && input.rooms.length) {
      y += 8;
      ensureSpace(40);
      doc.fillColor(PAL.secondaryDark).font("Helvetica-Bold").fontSize(9);
      doc.text("Ambientes", margin, y, { lineBreak: false });
      y += lineH;
      doc.fillColor(PAL.lineMuted).font("Helvetica").fontSize(8.5);
      for (const room of input.rooms) {
        ensureSpace(20);
        doc.text(`• ${room.name}: ${Number(room.areaSqft).toFixed(2)} sqft`, margin, y);
        y += lineH - 1;
      }
    }

    if (input.optionGroups.length) {
      y += 8;
      ensureSpace(40);
      doc.fillColor(PAL.secondaryDark).font("Helvetica-Bold").fontSize(9);
      doc.text("Opções", margin, y, { lineBreak: false });
      y += lineH;
      for (const g of input.optionGroups) {
        ensureSpace(18);
        const mark = g.id === input.selectedOptionGroupId ? "✓ " : "  ";
        doc.fillColor(PAL.primary).font("Helvetica").fontSize(8.5);
        doc.text(`${mark}${g.name}`, margin, y);
        y += lineH - 1;
      }
    }

    y += 16;

    const colDesc = margin;
    const colQty = pageW - margin - 210;
    const colRate = pageW - margin - 128;
    const colAmt = pageW - margin - 58;
    const descMaxW = colQty - colDesc - 10;

    const drawSectionTitle = (label: string) => {
      ensureSpace(48);
      const barH = 22;
      doc.rect(margin, y, contentW, barH).fillOpacity(0.22).fill(PAL.secondary);
      doc.fillOpacity(1);
      doc.rect(margin, y, 3, barH).fill(PAL.primary);
      doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(9);
      doc.text(label.toUpperCase(), margin + 10, y + 6, { lineBreak: false });
      y += barH + 8;
    };

    const drawTableHeader = () => {
      ensureSpace(36);
      const barH = 20;
      doc.rect(margin, y, contentW, barH).fillOpacity(0.06).fill(PAL.primary);
      doc.fillOpacity(1);
      doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(8);
      const ty = y + 6;
      doc.text("Descrição", colDesc + 4, ty, { lineBreak: false });
      if (view.showQuantities) doc.text("Qtd", colQty, ty, { lineBreak: false });
      if (view.showUnitPrices) doc.text("Preço", colRate, ty, { lineBreak: false });
      if (view.showLineTotals) doc.text("Valor", colAmt, ty, { lineBreak: false });
      y += barH + 2;
      doc
        .moveTo(margin, y)
        .lineTo(pageW - margin, y)
        .strokeColor(PAL.secondary)
        .lineWidth(0.75)
        .stroke();
      y += 10;
    };

    const sections = groupItemsForPdf(visibleLines);
    if (!sections.length) {
      ensureSpace(40);
      doc.fillColor(PAL.lineMuted).font("Helvetica").fontSize(9);
      doc.text("Sem itens no orçamento.", margin, y);
      y += lineH;
    }

    for (let si = 0; si < sections.length; si++) {
      const sec = sections[si]!;
      drawSectionTitle(sec.label);
      drawTableHeader();

      for (const it of sec.items) {
        ensureSpace(48);
        const nameStr = String(it.name || "").trim();
        const descStr = String(it.description || "").trim();
        const headline =
          nameStr || (descStr ? descStr.split(/\n/)[0] : "") || "Item";
        let bodyStr = "";
        if (nameStr && descStr && descStr !== nameStr) bodyStr = descStr;
        else if (!nameStr && descStr.includes("\n")) {
          bodyStr = descStr.split(/\n/).slice(1).join("\n").trim();
        }

        const qty = Number(it.quantity) || 0;
        const rate = Number(it.unitPrice) || 0;
        const amt = Number(it.amount) || qty * rate;
        const ut = String(it.unit || "sqft").replace(/_/g, " ");

        const rowStartY = y;
        doc.fillColor(PAL.primary).font("Helvetica").fontSize(8.5);
        if (view.showQuantities) {
          doc.text(`${qty} ${ut}`, colQty, rowStartY, { lineBreak: false });
        }
        if (view.showUnitPrices) {
          doc.text(money(rate), colRate, rowStartY, { lineBreak: false });
        }
        if (view.showLineTotals) {
          doc.font("Helvetica-Bold").text(money(amt), colAmt, rowStartY, { lineBreak: false });
        }

        doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(9);
        doc.text(headline, colDesc, rowStartY, { width: descMaxW });
        let dy = doc.y;

        if (bodyStr) {
          doc.fillColor(PAL.lineMuted).font("Helvetica-Oblique").fontSize(7.5);
          doc.text(bodyStr, colDesc, dy, { width: descMaxW });
          dy = doc.y;
        }

        const detailParts: string[] = [];
        if (it.catalogNotes) detailParts.push(String(it.catalogNotes).trim());
        if (it.notes) detailParts.push(`Obs.: ${String(it.notes).trim()}`);
        if (detailParts.length) {
          doc.fillColor(PAL.lineMuted).font("Helvetica-Oblique").fontSize(7.5);
          doc.text(detailParts.join(" — "), colDesc, dy, { width: descMaxW });
          dy = doc.y;
        }

        y = Math.max(dy, rowStartY + lineH) + 6;
      }

      if (si < sections.length - 1) {
        y += 4;
        ensureSpace(24);
        doc
          .moveTo(margin + 20, y)
          .lineTo(pageW - margin - 20, y)
          .strokeColor(PAL.rule)
          .lineWidth(0.35)
          .stroke();
        y += 16;
      }
    }

    // Totals
    y += 8;
    ensureSpace(100);
    doc
      .moveTo(margin, y)
      .lineTo(pageW - margin, y)
      .strokeColor(PAL.secondaryDark)
      .lineWidth(0.75)
      .stroke();
    y += 16;

    const totalsX = pageW - margin - 198;
    const valX = pageW - margin - 58;

    const drawTotalRow = (label: string, val: string, bold = false) => {
      ensureSpace(24);
      doc.fillColor(PAL.lineMuted).font("Helvetica").fontSize(9);
      doc.text(label, totalsX, y, { lineBreak: false });
      doc
        .fillColor(PAL.primary)
        .font(bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(9);
      doc.text(val, valX, y, { lineBreak: false });
      y += lineH + 2;
    };

    drawTotalRow("Subtotal", money(input.subtotal));
    if (input.taxTotal > 0) drawTotalRow("Imposto", money(input.taxTotal));
    const discVal = Number(input.discountValue) || 0;
    if (discVal > 0) {
      const discType = input.discountType === "fixed" ? "$" : "%";
      drawTotalRow(
        `Desconto (${discType})`,
        discType === "$" ? money(discVal) : `${discVal}%`,
      );
    }

    y += 6;
    doc.fillColor(PAL.secondaryDark).font("Helvetica-Bold").fontSize(8);
    doc.text("Total do orçamento", margin, y, { lineBreak: false });
    y += 14;

    // Grand total callout
    ensureSpace(56);
    const barH = 44;
    const totalStr = money(input.total);
    doc.rect(margin, y, contentW, barH).fill(PAL.primary);
    doc.rect(margin, y, 5, barH).fill(PAL.secondary);
    doc.fillColor(PAL.white).font("Helvetica-Bold").fontSize(11);
    doc.text("TOTAL", margin + 14, y + 16, { lineBreak: false });
    doc.fillColor(PAL.secondary).fontSize(20);
    const valW = doc.widthOfString(totalStr);
    doc.text(totalStr, pageW - margin - valW, y + 12, { lineBreak: false });
    y += barH + 14;

    // Terms
    ensureSpace(60);
    doc.fillColor(PAL.secondaryDark).font("Helvetica-Bold").fontSize(9);
    doc.text("Termos e condições", margin, y, { lineBreak: false });
    y += lineH + 2;
    const terms = input.terms || defaultTerms();
    doc.fillColor(PAL.lineMuted).font("Helvetica").fontSize(7.5);
    doc.text(terms, margin, y, { width: contentW, align: "left" });
    y = doc.y + 10;

    if (input.notes) {
      ensureSpace(40);
      doc.fillColor(PAL.secondaryDark).font("Helvetica-Bold").fontSize(9);
      doc.text("Notas", margin, y, { lineBreak: false });
      y += lineH + 2;
      doc.fillColor(PAL.primary).font("Helvetica").fontSize(7.5);
      doc.text(input.notes, margin, y, { width: contentW });
      y = doc.y + 10;
    }

    // Signatures
    ensureSpace(140);
    y += 8;
    const colW = (contentW - 24) / 2;
    const boxH = 56;
    const ownerBuf = dataUrlToBuffer(input.ownerSignature?.imageUrl);
    const clientBuf = dataUrlToBuffer(input.signatureUrl);

    const drawSigColumn = (
      x: number,
      title: string,
      imgBuf: Buffer | null,
      signerName: string,
      signerTitle: string,
      signedAt: Date | null | undefined,
    ) => {
      doc.fillColor(PAL.secondaryDark).font("Helvetica-Bold").fontSize(8);
      doc.text(title, x, y, { lineBreak: false });
      const boxTop = y + 12;
      doc.rect(x, boxTop, colW, boxH).strokeColor(PAL.rule).lineWidth(0.75).stroke();
      if (imgBuf) {
        try {
          doc.image(imgBuf, x + 8, boxTop + 6, {
            fit: [colW - 16, boxH - 12],
            align: "center",
            valign: "center",
          });
        } catch {
          /* ignore bad signature */
        }
      }
      let sy = boxTop + boxH + 8;
      if (signerName) {
        doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(8);
        doc.text(signerName, x, sy, { width: colW });
        sy = doc.y + 2;
      }
      if (signerTitle) {
        doc.fillColor(PAL.lineMuted).font("Helvetica").fontSize(7.5);
        doc.text(signerTitle, x, sy, { width: colW });
        sy = doc.y + 2;
      }
      if (signedAt) {
        doc.fillColor(PAL.lineMuted).font("Helvetica").fontSize(7.5);
        doc.text(`Data: ${signedAt.toISOString().slice(0, 10)}`, x, sy, { lineBreak: false });
        sy += lineH;
      }
      return sy;
    };

    const sigStartY = y;
    const leftEnd = drawSigColumn(
      margin,
      "Autorizado por",
      ownerBuf,
      input.ownerSignature?.name || input.organizationName,
      input.ownerSignature?.title || "",
      null,
    );
    y = sigStartY;
    const rightEnd = drawSigColumn(
      margin + colW + 24,
      "Aprovação do cliente",
      clientBuf,
      input.signedByName || input.customerName || "",
      "",
      input.signedAt,
    );
    y = Math.max(leftEnd, rightEnd) + 8;

    // Page numbers
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc
        .fillColor(PAL.lineMuted)
        .font("Helvetica")
        .fontSize(7)
        .text(`${i + 1} / ${range.count}`, margin, pageH - 28, {
          width: contentW,
          align: "center",
          lineBreak: false,
        });
    }

    doc.end();
  });
}
