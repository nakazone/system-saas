import PDFDocument from "pdfkit";

export type QuotePdfInput = {
  organizationName: string;
  organizationContact?: string | null;
  title: string;
  number: number | string;
  status: string;
  customerName?: string | null;
  validUntil?: Date | null;
  terms?: string | null;
  clientMessage?: string | null;
  rooms: { name: string; areaSqft: number }[];
  optionGroups: { id: string; name: string }[];
  selectedOptionGroupId?: string | null;
  lines: {
    description: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    amount: number;
    isOptional?: boolean;
    isSelected?: boolean;
    optionGroupId?: string | null;
  }[];
  clientView?: {
    showQuantities?: boolean;
    showUnitPrices?: boolean;
    showLineTotals?: boolean;
    showRoomBreakdown?: boolean;
  } | null;
  subtotal: number;
  taxTotal: number;
  total: number;
  signatureUrl?: string | null;
  signedByName?: string | null;
  signedAt?: Date | null;
};

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function buildQuotePdf(input: QuotePdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "LETTER" });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const view = {
      showQuantities: true,
      showUnitPrices: true,
      showLineTotals: true,
      showRoomBreakdown: true,
      ...(input.clientView ?? {}),
    };

    doc.fontSize(18).text(input.organizationName, { continued: false });
    if (input.organizationContact) {
      doc.fontSize(10).fillColor("#555").text(input.organizationContact);
    }
    doc.moveDown();
    doc.fillColor("#000").fontSize(14).text(`Quote #${input.number} — ${input.title}`);
    doc.fontSize(10).fillColor("#555").text(`Status: ${input.status}`);
    if (input.customerName) doc.text(`Customer: ${input.customerName}`);
    if (input.validUntil) {
      doc.text(`Valid until: ${input.validUntil.toISOString().slice(0, 10)}`);
    }
    doc.moveDown();

    if (input.clientMessage) {
      doc.fillColor("#000").fontSize(11).text(input.clientMessage);
      doc.moveDown();
    }

    if (view.showRoomBreakdown && input.rooms.length) {
      doc.fontSize(12).text("Rooms");
      for (const room of input.rooms) {
        doc.fontSize(10).text(`• ${room.name}: ${Number(room.areaSqft).toFixed(2)} sqft`);
      }
      doc.moveDown();
    }

    if (input.optionGroups.length) {
      doc.fontSize(12).fillColor("#000").text("Options");
      for (const g of input.optionGroups) {
        const mark = g.id === input.selectedOptionGroupId ? "✓ " : "  ";
        doc.fontSize(10).text(`${mark}${g.name}`);
      }
      doc.moveDown();
    }

    doc.fontSize(12).text("Line items");
    const selectedGroup = input.selectedOptionGroupId ?? null;
    for (const line of input.lines) {
      if (line.isOptional && line.isSelected === false) continue;
      if (line.optionGroupId && selectedGroup && line.optionGroupId !== selectedGroup) continue;
      if (line.optionGroupId && !selectedGroup) continue;
      const parts: string[] = [line.description];
      if (view.showQuantities) parts.push(`${line.quantity} ${line.unit}`);
      if (view.showUnitPrices) parts.push(money(line.unitPrice));
      if (view.showLineTotals) parts.push(money(line.amount));
      doc.fontSize(10).text(parts.join(" · "));
    }

    doc.moveDown();
    doc.fontSize(11).text(`Subtotal: ${money(input.subtotal)}`);
    if (input.taxTotal > 0) doc.text(`Tax: ${money(input.taxTotal)}`);
    doc.fontSize(13).text(`Total: ${money(input.total)}`);

    if (input.terms) {
      doc.moveDown().fontSize(10).fillColor("#333").text("Terms", { underline: true });
      doc.fontSize(9).text(input.terms);
    }

    if (input.signedByName && input.signedAt) {
      doc.moveDown().fillColor("#000").fontSize(11).text("Approved");
      doc.fontSize(10).text(`Signed by: ${input.signedByName}`);
      doc.text(`Date: ${input.signedAt.toISOString()}`);
      if (input.signatureUrl?.startsWith("data:image")) {
        try {
          const b64 = input.signatureUrl.split(",")[1];
          if (b64) {
            doc.image(Buffer.from(b64, "base64"), { width: 200 });
          }
        } catch {
          // ignore bad signature image
        }
      }
    }

    doc.end();
  });
}
