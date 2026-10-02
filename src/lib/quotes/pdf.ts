import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";
import { getLocalFileStorage } from "../storage/index.js";
import {
  DEFAULT_QUOTE_EXCLUSIONS,
  DEFAULT_QUOTE_INCLUSIONS,
  resolveQuoteTermsItems,
} from "./client-document.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** ObraMate design tokens — charcoal / orange / cream */
const DEFAULT_PAL = {
  primary: "#211d1a",
  primaryMuted: "#3a332e",
  accent: "#e8792c",
  accentDark: "#a85428",
  label: "#a85428",
  panelBg: "#f7f4ee",
  tableHeaderBg: "#e8eaee",
  muted: "#6b645c",
  mutedLight: "#8a8074",
  rule: "#e2d9cc",
  white: "#ffffff",
  include: "#15803d",
  exclude: "#dc2626",
};

const DEFAULT_TAGLINE = "Hardwood · LVP · Refinishing";

const SYSTEM_LOGO_CANDIDATES = [
  "src/public/favicon-192.png",
  "crm/public/assets/favicon-192.png",
  "public/favicon-192.png",
  "crm/assets/favicon-192.png",
  "dist/src/public/favicon-192.png",
  "dist/crm/public/assets/favicon-192.png",
];

function findAssetPath(relPaths: string[]): string | null {
  const bases = [
    process.cwd(),
    path.join(__dirname, "../../.."),
    path.join(__dirname, "../.."),
    path.join(__dirname, "../../../.."),
  ];
  for (const base of bases) {
    for (const rel of relPaths) {
      const p = path.join(base, rel);
      try {
        if (fs.existsSync(p)) return p;
      } catch {
        /* continue */
      }
    }
  }
  return null;
}

function loadFileBuffer(filePath: string | null): Buffer | null {
  if (!filePath) return null;
  try {
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

function loadSystemLogoBuffer(): Buffer | null {
  return loadFileBuffer(findAssetPath(SYSTEM_LOGO_CANDIDATES));
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

/** Resolve tenant logo from absolute URL, /api/local-files, /assets, or data URL. */
export async function loadLogoBuffer(url: string | null | undefined): Promise<Buffer | null> {
  if (!url || !String(url).trim()) return null;
  const src = String(url).trim();

  const fromData = dataUrlToBuffer(src);
  if (fromData) return fromData;

  if (src.startsWith("/api/local-files/")) {
    const key = src
      .replace(/^\/api\/local-files\//, "")
      .split("/")
      .map((p) => decodeURIComponent(p))
      .join("/");
    const local = getLocalFileStorage();
    if (local) {
      const entry = await local.get(key);
      if (entry?.body?.length) return entry.body;
    }
    const disk = path.resolve(process.cwd(), "data", "uploads", key);
    return loadFileBuffer(fs.existsSync(disk) ? disk : null);
  }

  if (src.startsWith("/assets/")) {
    const name = src.slice("/assets/".length);
    return loadFileBuffer(
      findAssetPath([
        `crm/assets/${name}`,
        `src/public/${name}`,
        `public/${name}`,
        `crm/public/assets/${name}`,
        `dist/crm/assets/${name}`,
        `dist/src/public/${name}`,
      ]),
    );
  }

  if (src.startsWith("http://") || src.startsWith("https://")) {
    try {
      const res = await fetch(src);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  // Absolute or cwd-relative path
  if (src.startsWith("/") || src.includes(path.sep)) {
    return loadFileBuffer(src.startsWith("/") ? src : path.resolve(process.cwd(), src));
  }

  return null;
}

function resolvePalette(input: { brandPrimary?: string | null; brandAccent?: string | null }) {
  const primary = input.brandPrimary && /^#[0-9a-fA-F]{6}$/.test(input.brandPrimary)
    ? input.brandPrimary
    : DEFAULT_PAL.primary;
  const accent = input.brandAccent && /^#[0-9a-fA-F]{6}$/.test(input.brandAccent)
    ? input.brandAccent
    : DEFAULT_PAL.accent;
  return {
    ...DEFAULT_PAL,
    primary,
    accent,
    label: accent,
    accentDark: accent,
  };
}

/** Fixed customer-facing order: Supply → Installation → Sand & Finish. Products roll into Supply. */
const SECTION_DEFS = [
  { key: "supply", label: "SUPPLY" },
  { key: "installation", label: "INSTALLATION" },
  { key: "sand_finish", label: "SAND & FINISH" },
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

export type QuotePdfPaymentItem = {
  label: string;
  amount: number;
  percent?: number | null;
};

export type QuotePdfInput = {
  organizationName: string;
  organizationContact?: string | null;
  organizationAddress?: string | null;
  organizationLicense?: string | null;
  organizationTagline?: string | null;
  /** Tenant logo URL (/api/local-files/…, /assets/…, https, or data URL). */
  organizationLogoUrl?: string | null;
  /** Tenant brand colors (fall back to ObraMate defaults). */
  brandPrimary?: string | null;
  brandAccent?: string | null;
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
  projectCityLine?: string | null;
  validUntil?: Date | null;
  terms?: string | null;
  clientMessage?: string | null;
  notes?: string | null;
  floorAreaSqft?: number | null;
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
  depositAmount?: number | null;
  paymentSchedule?: QuotePdfPaymentItem[];
  paymentMethods?: string | null;
  inclusions?: string[] | null;
  exclusions?: string[] | null;
  preparedBy?: {
    name?: string | null;
    title?: string | null;
    email?: string | null;
  } | null;
  publicQuoteUrl?: string | null;
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

function formatDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function qtyLabel(qty: number, unit: string): string {
  const u = String(unit || "sqft").replace(/_/g, " ");
  const q =
    Math.abs(qty) >= 100
      ? qty.toLocaleString("en-US", { maximumFractionDigits: 0 })
      : qty.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return `${q} ${u}`;
}

function orgInitials(name: string): string {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return String(name || "OM")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 2)
    .toUpperCase() || "OM";
}

function lineSection(it: QuotePdfLine): (typeof SECTION_DEFS)[number]["key"] {
  // Catalog products belong with Supply on the customer PDF.
  if (String(it.itemType || "").toLowerCase() === "product") return "supply";
  const st = String(it.serviceType || "").trim().toLowerCase();
  if (!st) return "installation";
  if (st.includes("supply") || st.includes("fornec") || st.includes("material")) return "supply";
  if (st.includes("sand") || st.includes("finish") || st.includes("lix") || st.includes("acab")) {
    return "sand_finish";
  }
  return "installation";
}

export function groupItemsForPdf(items: QuotePdfLine[]) {
  const list = Array.isArray(items) ? items : [];
  const buckets: Record<(typeof SECTION_DEFS)[number]["key"], QuotePdfLine[]> = {
    supply: [],
    installation: [],
    sand_finish: [],
  };
  for (const it of list) {
    const k = lineSection(it);
    buckets[k].push(it);
  }
  return SECTION_DEFS.filter((d) => buckets[d.key].length > 0).map((d) => ({
    label: d.label,
    key: d.key,
    items: buckets[d.key],
    sectionTotal: buckets[d.key].reduce((s, it) => s + (Number(it.amount) || 0), 0),
  }));
}

/** Map payment schedule rows into PDF payment lines (amounts from percent of total when needed). */
export function pdfPaymentItemsFromSchedule(
  total: number,
  items: Array<{
    label: string;
    percent?: unknown;
    fixedAmount?: unknown;
  }> | null | undefined,
): QuotePdfPaymentItem[] {
  if (!items?.length) return [];
  return items.map((it) => {
    const fixed = Number(it.fixedAmount);
    const pct = Number(it.percent);
    let amount = Number.isFinite(fixed) && fixed > 0 ? fixed : 0;
    if (!amount && Number.isFinite(pct) && pct > 0) {
      amount = Math.round(((total * pct) / 100) * 100) / 100;
    }
    const pctLabel = Number.isFinite(pct) && pct > 0 ? ` (${pct}%)` : "";
    return {
      label: `${it.label}${pctLabel}`,
      amount,
      percent: Number.isFinite(pct) ? pct : null,
    };
  });
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

function stripRichTextMarkers(text: string): string {
  return text.replace(/\*\*([^*\n]+)\*\*/g, "$1").replace(/_([^_\n]+)_/g, "$1");
}

function termsToItems(terms: string | null | undefined): string[] {
  return resolveQuoteTermsItems(terms);
}

export async function buildQuotePdf(input: QuotePdfInput): Promise<Buffer> {
  const PAL = resolvePalette(input);
  const systemLogoBuf = loadSystemLogoBuffer();
  const tenantLogoBuf = await loadLogoBuffer(input.organizationLogoUrl);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margin: 0,
      bufferPages: true,
      info: {
        Title: `Quote ${input.number}`,
        Author: input.organizationName,
        Producer: "ObraMate",
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
    const colGap = 20;
    const accentBarH = 5;

    const tryDrawImage = (buf: Buffer | null, x: number, yy: number, w: number, h: number) => {
      if (!buf?.length) return false;
      try {
        doc.image(buf, x, yy, { fit: [w, h], align: "center", valign: "center" });
        return true;
      } catch {
        return false;
      }
    };

    const drawAccentBar = () => {
      doc.rect(0, 0, pageW, accentBarH).fill(PAL.accent);
    };

    /** Tenant mark: logo image, else initials square. Returns width used. */
    const drawTenantMark = (x: number, yy: number, size = 32) => {
      if (tryDrawImage(tenantLogoBuf, x, yy, size, size)) return size + 12;
      const r = 4;
      doc.roundedRect(x, yy, size, size, r).fill(PAL.primary);
      doc.fillColor(PAL.white).font("Helvetica-Bold").fontSize(size >= 30 ? 12 : 10);
      const ini = orgInitials(input.organizationName);
      const tw = doc.widthOfString(ini);
      doc.text(ini, x + (size - tw) / 2, yy + size * 0.28, { lineBreak: false });
      return size + 12;
    };

    /** Small ObraMate system favicon. Returns width used. */
    const drawSystemMark = (x: number, yy: number, size = 16) => {
      if (tryDrawImage(systemLogoBuf, x, yy, size, size)) return size + 6;
      doc.roundedRect(x, yy, size, size, 3).fill(PAL.accent);
      doc.fillColor(PAL.white).font("Helvetica-Bold").fontSize(7);
      doc.text("OM", x + 2, yy + 4, { lineBreak: false });
      return size + 6;
    };

    const view = {
      showQuantities: true,
      showUnitPrices: true,
      showLineTotals: true,
      showRoomBreakdown: true,
      ...(input.clientView ?? {}),
    };

    const selectedGroup = input.selectedOptionGroupId ?? null;
    const allVisible = input.lines.filter((line) => {
      if (line.optionGroupId && selectedGroup && line.optionGroupId !== selectedGroup) return false;
      if (line.optionGroupId && !selectedGroup) return false;
      return true;
    });
    const scopedLines = allVisible.filter((l) => !(l.isOptional && l.isSelected === false));
    const mainLines = scopedLines.filter((l) => !l.isOptional);
    const optionalLines = allVisible.filter((l) => l.isOptional);

    const quoteNumber =
      typeof input.number === "string" && input.number.trim()
        ? input.number
        : `Q-${input.number}`;
    const customerName = input.customerName || "Client";
    const floorArea =
      Number(input.floorAreaSqft) ||
      input.rooms.reduce((s, r) => s + (Number(r.areaSqft) || 0), 0) ||
      0;

    let depositAmount = Number(input.depositAmount);
    if (!Number.isFinite(depositAmount) || depositAmount <= 0) {
      const first = input.paymentSchedule?.[0];
      if (first && Number(first.amount) > 0) depositAmount = Number(first.amount);
      else depositAmount = Math.round(input.total * 0.5 * 100) / 100;
    }

    const paymentItems: QuotePdfPaymentItem[] =
      input.paymentSchedule && input.paymentSchedule.length
        ? input.paymentSchedule
        : [
            { label: "Deposit · due on approval (50%)", amount: depositAmount, percent: 50 },
            {
              label: "Balance · due on completion",
              amount: Math.max(0, input.total - depositAmount),
              percent: 50,
            },
          ];

    const inclusions = input.inclusions?.length ? input.inclusions : [...DEFAULT_QUOTE_INCLUSIONS];
    const exclusions = input.exclusions?.length ? input.exclusions : [...DEFAULT_QUOTE_EXCLUSIONS];
    const termItems = termsToItems(input.terms);
    const prepared = input.preparedBy || input.ownerSignature || {};

    let y = 0;

    const ensureSpace = (need: number) => {
      if (y + need <= pageH - 52) return false;
      addFooterPage();
      doc.addPage({ size: "LETTER", margin: 0 });
      y = margin;
      drawCompactHeader();
      return true;
    };

    const rule = (x1: number, x2: number, yy: number, color = PAL.rule, w = 0.6) => {
      doc.moveTo(x1, yy).lineTo(x2, yy).strokeColor(color).lineWidth(w).stroke();
    };

    const drawCompactHeader = () => {
      drawAccentBar();
      y = accentBarH + 12;
      const markW = drawTenantMark(margin, y, 22);
      doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(12);
      doc.text(input.organizationName, margin + markW, y + 4, { lineBreak: false });
      const meta = `Quote ${quoteNumber}${
        input.projectName || input.projectCityLine
          ? ` · ${[input.projectName, input.projectCityLine].filter(Boolean).join(", ")}`
          : ""
      }`;
      doc.fillColor(PAL.mutedLight).font("Helvetica").fontSize(8);
      const mw = doc.widthOfString(meta);
      doc.text(meta, pageW - margin - mw, y + 6, { lineBreak: false });
      // system mark top-right of compact header
      drawSystemMark(pageW - margin - mw - 22, y + 2, 14);
      y += 34;
      rule(margin, pageW - margin, y, PAL.rule, 0.5);
      y += 16;
    };

    const addFooterPage = () => {
      /* footers stamped at end via buffered pages */
    };

    // ═══════════════════════════════════════
    // PAGE 1 — Scope
    // ═══════════════════════════════════════
    drawAccentBar();
    y = accentBarH + 14;

    // Header: tenant logo + company | ObraMate system mark + QUOTE
    const markW = drawTenantMark(margin, y, 36);
    const textX = margin + markW;
    doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(18);
    doc.text(input.organizationName, textX, y + 2, { lineBreak: false });
    doc.fillColor(PAL.muted).font("Helvetica").fontSize(8);
    doc.text(input.organizationTagline || DEFAULT_TAGLINE, textX, y + 24, { lineBreak: false });
    const contactBits = [
      input.organizationContact,
      input.organizationLicense,
    ]
      .filter(Boolean)
      .join("  ·  ");
    if (contactBits) {
      doc.fillColor(PAL.mutedLight).fontSize(7.5);
      doc.text(contactBits, textX, y + 36, { width: 280, lineBreak: false });
    }

    // Right: system mark + QUOTE block
    const sysSize = 18;
    drawSystemMark(pageW - margin - sysSize, y, sysSize);
    doc.fillColor(PAL.mutedLight).font("Helvetica").fontSize(7);
    const powered = "ObraMate";
    const pw = doc.widthOfString(powered);
    doc.text(powered, pageW - margin - sysSize - pw - 6, y + 4, { lineBreak: false });

    doc.fillColor(PAL.mutedLight).font("Helvetica").fontSize(8);
    const quoteLabel = "QUOTE";
    const qlW = doc.widthOfString(quoteLabel);
    doc.text(quoteLabel, pageW - margin - qlW, y + 22, { lineBreak: false });
    doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(16);
    const qnW = doc.widthOfString(quoteNumber);
    doc.text(quoteNumber, pageW - margin - qnW, y + 36, { lineBreak: false });
    doc.fillColor(PAL.muted).font("Helvetica").fontSize(8);
    const issued = `Issued ${formatDate(input.issueDate)}`;
    const valid = `Valid until ${formatDate(input.validUntil)}`;
    doc.text(issued, pageW - margin - doc.widthOfString(issued), y + 56, { lineBreak: false });
    doc.text(valid, pageW - margin - doc.widthOfString(valid), y + 68, { lineBreak: false });

    y += 88;

    // Summary bar
    const barH = 56;
    doc.roundedRect(margin, y, contentW, barH, 4).fill(PAL.panelBg);
    const colW = contentW / 4;
    const summaryCols: { label: string; value: string; large?: boolean }[] = [
      { label: "QUOTE TOTAL", value: money(input.total), large: true },
      { label: "DUE ON APPROVAL", value: money(depositAmount), large: true },
      {
        label: "FLOOR AREA",
        value: floorArea > 0 ? `${floorArea.toLocaleString("en-US")} sq ft` : "—",
      },
      { label: "VALID UNTIL", value: formatDate(input.validUntil) },
    ];
    summaryCols.forEach((c, i) => {
      const cx = margin + i * colW + 14;
      doc.fillColor(PAL.label).font("Helvetica-Bold").fontSize(7);
      doc.text(c.label, cx, y + 12, { lineBreak: false });
      doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(c.large ? 14 : 11);
      doc.text(c.value, cx, y + 28, { lineBreak: false });
    });
    y += barH + 22;

    // Bill to / Job site / Prepared by
    const infoColW = (contentW - colGap * 2) / 3;
    const infoY = y;
    const drawInfoCol = (
      x: number,
      label: string,
      lines: Array<{ text: string; bold?: boolean; size?: number }>,
    ) => {
      doc.fillColor(PAL.label).font("Helvetica-Bold").fontSize(7.5);
      doc.text(label, x, infoY, { lineBreak: false });
      let ly = infoY + 14;
      for (const line of lines) {
        if (!line.text) continue;
        doc
          .fillColor(PAL.primary)
          .font(line.bold ? "Helvetica-Bold" : "Helvetica")
          .fontSize(line.size ?? (line.bold ? 10 : 8.5));
        doc.text(line.text, x, ly, { width: infoColW - 4 });
        ly = doc.y + 1;
      }
      return ly;
    };

    const billLines = [
      { text: customerName, bold: true, size: 10 },
      { text: input.customerEmail || "", size: 8.5 },
      { text: input.customerPhone || "", size: 8.5 },
    ];
    const jobLines = [
      { text: input.projectName || input.title || "Project", bold: true, size: 10 },
      { text: input.projectAddress || "", size: 8.5 },
      { text: input.projectCityLine || "", size: 8.5 },
    ];
    const prepName = prepared.name || input.organizationName;
    const prepTitle = ("title" in prepared ? prepared.title : null) || "";
    const prepEmail = ("email" in prepared ? prepared.email : null) || "";
    const prepLines = [
      { text: prepName || "", bold: true, size: 10 },
      { text: [prepTitle, prepEmail].filter(Boolean).join(" · ") || "", size: 8.5 },
    ];

    const infoEnd = Math.max(
      drawInfoCol(margin, "BILL TO", billLines),
      drawInfoCol(margin + infoColW + colGap, "JOB SITE", jobLines),
      drawInfoCol(margin + 2 * (infoColW + colGap), "PREPARED BY", prepLines),
    );
    y = infoEnd + 20;

    if (input.clientMessage) {
      doc.fillColor(PAL.muted).font("Helvetica-Oblique").fontSize(9);
      doc.text(input.clientMessage, margin, y, { width: contentW });
      y = doc.y + 14;
    }

    // Table columns — right edges with wider gaps between Qty / Rate / Amount
    const colDesc = margin;
    const colAmtRight = pageW - margin;
    const colAmtW = 78;
    const colRateRight = colAmtRight - colAmtW - 22;
    const colRateW = 72;
    const colQtyRight = colRateRight - colRateW - 22;
    const colQtyW = 68;
    const descMaxW = colQtyRight - colQtyW - colDesc - 14;

    const drawTableHeader = () => {
      ensureSpace(36);
      const headH = 18;
      const headTop = y;
      doc.save();
      doc.rect(margin, headTop, contentW, headH).fill(PAL.tableHeaderBg);
      doc.restore();
      const titleY = headTop + (headH - 8) / 2;
      doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(8);
      doc.text("DESCRIPTION", colDesc + 8, titleY, { lineBreak: false });
      if (view.showQuantities) {
        doc.text("QTY", colQtyRight - colQtyW, titleY, {
          width: colQtyW,
          align: "right",
          lineBreak: false,
        });
      }
      if (view.showUnitPrices) {
        doc.text("RATE", colRateRight - colRateW, titleY, {
          width: colRateW,
          align: "right",
          lineBreak: false,
        });
      }
      if (view.showLineTotals) {
        doc.text("AMOUNT", colAmtRight - colAmtW, titleY, {
          width: colAmtW,
          align: "right",
          lineBreak: false,
        });
      }
      y = headTop + headH + 8;
    };

    const sections = groupItemsForPdf(mainLines);
    if (!sections.length) {
      doc.fillColor(PAL.muted).font("Helvetica").fontSize(9);
      doc.text("No line items.", margin, y);
      y += 16;
    }

    /** Min height so category + description header stay with the first service line. */
    const SECTION_HEAD_H = 28;
    const TABLE_HEAD_H = 26;
    const LINE_MIN_H = 44;

    for (let si = 0; si < sections.length; si++) {
      const sec = sections[si]!;
      // Keep category + description header + first line on the same page.
      const broke = ensureSpace(SECTION_HEAD_H + TABLE_HEAD_H + LINE_MIN_H);
      if (broke && si === 0) {
        /* first section on fresh page after break — nothing else to redraw */
      }

      const headPadY = 5;
      const headH = 20;
      const headTop = y - headPadY;
      doc.save();
      doc.rect(margin, headTop, contentW, headH).fill(PAL.panelBg);
      doc.rect(margin, headTop, 3.5, headH).fill(PAL.accent);
      doc.restore();

      const titleY = headTop + (headH - 9) / 2;
      doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(9);
      doc.text(sec.label, colDesc + 10, titleY, { lineBreak: false });
      doc.fillColor(PAL.muted).font("Helvetica").fontSize(8);
      const stLabel = `Section total  ${money(sec.sectionTotal)}`;
      doc.text(stLabel, pageW - margin - doc.widthOfString(stLabel) - 6, titleY + 1, {
        lineBreak: false,
      });
      y = headTop + headH + 6;

      // Order: Category → Description header → Services
      drawTableHeader();

      for (let ii = 0; ii < sec.items.length; ii++) {
        const it = sec.items[ii]!;
        const brokeItem = ensureSpace(LINE_MIN_H);
        // After a mid-section page break, repeat Description header (not a lone title).
        if (brokeItem && ii > 0) drawTableHeader();

        const nameStr = stripRichTextMarkers(String(it.name || "").trim());
        const descStr = stripRichTextMarkers(String(it.description || "").trim());
        const headline = nameStr || descStr.split(/\n/)[0] || "Line item";
        let body = "";
        if (nameStr && descStr && descStr !== nameStr) body = descStr;
        else if (!nameStr && descStr.includes("\n")) body = descStr.split(/\n/).slice(1).join(" ").trim();

        const rowY = y;
        doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(9.5);
        doc.text(headline, colDesc, rowY, { width: descMaxW });
        let dy = doc.y;
        if (body) {
          doc.fillColor(PAL.muted).font("Helvetica").fontSize(8);
          doc.text(body, colDesc, dy + 1, { width: descMaxW });
          dy = doc.y;
        }
        if (it.catalogNotes || it.notes) {
          const detail = [
            it.catalogNotes ? stripRichTextMarkers(String(it.catalogNotes)) : "",
            it.notes ? `Note: ${stripRichTextMarkers(String(it.notes))}` : "",
          ]
            .filter(Boolean)
            .join(" — ");
          doc.fillColor(PAL.mutedLight).font("Helvetica-Oblique").fontSize(7.5);
          doc.text(detail, colDesc, dy + 1, { width: descMaxW });
          dy = doc.y;
        }

        doc.fillColor(PAL.primary).font("Helvetica").fontSize(9);
        if (view.showQuantities) {
          doc.text(qtyLabel(Number(it.quantity) || 0, it.unit), colQtyRight - colQtyW, rowY, {
            width: colQtyW,
            align: "right",
            lineBreak: false,
          });
        }
        if (view.showUnitPrices) {
          doc.text(money(Number(it.unitPrice) || 0), colRateRight - colRateW, rowY, {
            width: colRateW,
            align: "right",
            lineBreak: false,
          });
        }
        if (view.showLineTotals) {
          doc.font("Helvetica-Bold").text(money(Number(it.amount) || 0), colAmtRight - colAmtW, rowY, {
            width: colAmtW,
            align: "right",
            lineBreak: false,
          });
        }

        y = Math.max(dy, rowY + 14) + 8;
      }

      if (si < sections.length - 1) {
        y += 10;
      }
    }

    y += 12;
    doc.fillColor(PAL.mutedLight).font("Helvetica-Oblique").fontSize(8);
    doc.text("Totals, optional add-ons and approval on the next page", margin, y, { lineBreak: false });

    // ═══════════════════════════════════════
    // PAGE 2 — Totals & approval
    // ═══════════════════════════════════════
    doc.addPage({ size: "LETTER", margin: 0 });
    y = margin;
    drawCompactHeader();

    // Optional add-ons
    doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(11);
    doc.text("OPTIONAL ADD-ONS", margin, y, { lineBreak: false });
    doc.fillColor(PAL.mutedLight).font("Helvetica").fontSize(8);
    const addOnHint = "Not included in the total · check to add when approving";
    doc.text(addOnHint, pageW - margin - doc.widthOfString(addOnHint), y + 2, { lineBreak: false });
    y += 18;

    if (optionalLines.length) {
      for (const it of optionalLines) {
        ensureSpace(48);
        const boxH = 36;
        doc
          .roundedRect(margin, y, contentW, boxH, 3)
          .dash(3, { space: 2 })
          .strokeColor(PAL.rule)
          .lineWidth(0.8)
          .stroke()
          .undash();
        // checkbox
        doc.rect(margin + 10, y + 12, 10, 10).strokeColor(PAL.muted).lineWidth(0.8).stroke();
        const nameStr = String(it.name || it.description || "Add-on").trim();
        const descStr =
          it.name && it.description && it.description !== it.name ? String(it.description) : "";
        doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(9);
        doc.text(nameStr, margin + 28, y + 8, { width: descMaxW - 20, lineBreak: false });
        if (descStr) {
          doc.fillColor(PAL.muted).font("Helvetica").fontSize(7.5);
          doc.text(descStr, margin + 28, y + 20, { width: descMaxW - 20, lineBreak: false });
        }
        doc.fillColor(PAL.primary).font("Helvetica").fontSize(8.5);
        doc.text(qtyLabel(Number(it.quantity) || 0, it.unit), colQtyRight - colQtyW, y + 12, {
          width: colQtyW,
          align: "right",
          lineBreak: false,
        });
        doc.text(money(Number(it.unitPrice) || 0), colRateRight - colRateW, y + 12, {
          width: colRateW,
          align: "right",
          lineBreak: false,
        });
        doc.font("Helvetica-Bold").text(money(Number(it.amount) || 0), colAmtRight - colAmtW, y + 12, {
          width: colAmtW,
          align: "right",
          lineBreak: false,
        });
        y += boxH + 8;
      }
    } else {
      doc
        .roundedRect(margin, y, contentW, 32, 3)
        .dash(3, { space: 2 })
        .strokeColor(PAL.rule)
        .lineWidth(0.8)
        .stroke()
        .undash();
      doc.fillColor(PAL.mutedLight).font("Helvetica").fontSize(8.5);
      doc.text("No optional add-ons on this quote.", margin + 12, y + 11, { lineBreak: false });
      y += 40;
    }

    y += 10;

    // Payment schedule | Totals
    ensureSpace(110);
    const halfW = (contentW - colGap) / 2;
    const payY = y;

    doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(10);
    doc.text("PAYMENT SCHEDULE", margin, payY, { lineBreak: false });
    let py = payY + 16;
    for (const item of paymentItems) {
      doc.fillColor(PAL.primary).font("Helvetica").fontSize(9);
      doc.text(item.label, margin, py, { width: halfW - 70 });
      const amt = money(item.amount);
      doc.font("Helvetica-Bold").text(amt, margin + halfW - 70, py, {
        width: 70,
        align: "right",
        lineBreak: false,
      });
      py = Math.max(doc.y, py + 14) + 4;
    }
    doc.fillColor(PAL.mutedLight).font("Helvetica").fontSize(8);
    doc.text(
      `We accept ${input.paymentMethods || "card, ACH, and check"}.`,
      margin,
      py + 4,
      { lineBreak: false },
    );
    py += 18;

    // Totals column
    let ty = payY;
    const totalsX = margin + halfW + colGap;
    doc.fillColor(PAL.muted).font("Helvetica").fontSize(9);
    doc.text("Subtotal", totalsX, ty, { lineBreak: false });
    doc.fillColor(PAL.primary).font("Helvetica").fontSize(9);
    doc.text(money(input.subtotal), pageW - margin - 70, ty, {
      width: 70,
      align: "right",
      lineBreak: false,
    });
    ty += 14;
    doc.fillColor(PAL.muted).font("Helvetica").fontSize(9);
    doc.text("Tax", totalsX, ty, { lineBreak: false });
    doc.fillColor(PAL.primary).text(money(input.taxTotal), pageW - margin - 70, ty, {
      width: 70,
      align: "right",
      lineBreak: false,
    });
    ty += 18;

    const totalBoxH = 44;
    doc.roundedRect(totalsX, ty, halfW, totalBoxH, 6).fill(PAL.primary);
    doc.roundedRect(totalsX, ty, 5, totalBoxH, 2).fill(PAL.accent);
    doc.fillColor(PAL.white).font("Helvetica-Bold").fontSize(9);
    doc.text("TOTAL", totalsX + 14, ty + 16, { lineBreak: false });
    doc.fillColor(PAL.accent).fontSize(18);
    const totalStr = money(input.total);
    doc.text(totalStr, totalsX + halfW - 14 - doc.widthOfString(totalStr), ty + 12, {
      lineBreak: false,
    });
    ty += totalBoxH;

    y = Math.max(py, ty) + 22;

    // What's included / Not included
    ensureSpace(100);
    const incY = y;
    doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(10);
    doc.text("WHAT'S INCLUDED", margin, incY, { lineBreak: false });
    doc.text("NOT INCLUDED", totalsX, incY, { lineBreak: false });
    let iy = incY + 16;
    let ey = incY + 16;
    for (const item of inclusions) {
      doc
        .strokeColor(PAL.include)
        .lineWidth(1.4)
        .moveTo(margin, iy + 5)
        .lineTo(margin + 3.5, iy + 9)
        .lineTo(margin + 9, iy + 1)
        .stroke();
      doc.fillColor(PAL.primary).font("Helvetica").fontSize(8.5);
      doc.text(item, margin + 14, iy, { width: halfW - 18 });
      iy = doc.y + 6;
    }
    for (const item of exclusions) {
      doc
        .strokeColor(PAL.exclude)
        .lineWidth(1.4)
        .moveTo(totalsX, ey + 4)
        .lineTo(totalsX + 9, ey + 4)
        .stroke();
      doc.fillColor(PAL.primary).font("Helvetica").fontSize(8.5);
      doc.text(item, totalsX + 14, ey, { width: halfW - 18 });
      ey = doc.y + 6;
    }
    y = Math.max(iy, ey) + 16;

    // Terms
    ensureSpace(90);
    doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(10);
    doc.text("TERMS", margin, y, { lineBreak: false });
    y += 14;
    const termColW = halfW;
    const mid = Math.ceil(termItems.length / 2);
    const leftTerms = termItems.slice(0, mid);
    const rightTerms = termItems.slice(mid);
    let tLeft = y;
    let tRight = y;
    leftTerms.forEach((t, i) => {
      doc.fillColor(PAL.muted).font("Helvetica").fontSize(8);
      doc.text(`${i + 1}.  ${t}`, margin, tLeft, { width: termColW - 8 });
      tLeft = doc.y + 6;
    });
    rightTerms.forEach((t, i) => {
      doc.fillColor(PAL.muted).font("Helvetica").fontSize(8);
      doc.text(`${mid + i + 1}.  ${t}`, totalsX, tRight, { width: termColW - 8 });
      tRight = doc.y + 6;
    });
    y = Math.max(tLeft, tRight) + 18;

    // Signatures
    ensureSpace(110);
    const sigColW = halfW;
    doc.fillColor(PAL.label).font("Helvetica-Bold").fontSize(8);
    doc.text("AUTHORIZED BY", margin, y, { lineBreak: false });
    doc.text("CLIENT APPROVAL", totalsX, y, { lineBreak: false });
    y += 14;

    const ownerBuf = dataUrlToBuffer(input.ownerSignature?.imageUrl);
    const clientBuf = dataUrlToBuffer(input.signatureUrl);
    const sigBoxH = 40;

    if (ownerBuf) {
      try {
        doc.image(ownerBuf, margin, y, { fit: [sigColW - 20, sigBoxH] });
      } catch {
        /* ignore */
      }
    } else if (prepared.name) {
      doc.fillColor(PAL.primaryMuted).font("Helvetica-Oblique").fontSize(16);
      doc.text(String(prepared.name), margin, y + 8, { lineBreak: false });
    }
    rule(margin, margin + sigColW - 10, y + sigBoxH + 4, PAL.rule, 0.7);
    if (clientBuf) {
      try {
        doc.image(clientBuf, totalsX, y, { fit: [sigColW - 20, sigBoxH] });
      } catch {
        /* ignore */
      }
    }
    rule(totalsX, totalsX + sigColW - 10, y + sigBoxH + 4, PAL.rule, 0.7);

    y += sigBoxH + 10;
    const ownerLine = [prepared.name, ("title" in prepared ? prepared.title : null)]
      .filter(Boolean)
      .join(" · ");
    doc.fillColor(PAL.primary).font("Helvetica").fontSize(8);
    doc.text(ownerLine || input.organizationName, margin, y, { lineBreak: false });
    doc.fillColor(PAL.muted).fontSize(8);
    doc.text(formatDate(input.issueDate), margin, y + 12, { lineBreak: false });

    if (input.signedByName) {
      doc.fillColor(PAL.primary).font("Helvetica").fontSize(8);
      doc.text(input.signedByName, totalsX, y, { lineBreak: false });
      doc.fillColor(PAL.muted).text(formatDate(input.signedAt), totalsX, y + 12, {
        lineBreak: false,
      });
    } else {
      doc.fillColor(PAL.muted).font("Helvetica").fontSize(8);
      doc.text("Name: ________________________", totalsX, y, { lineBreak: false });
      doc.text("Date: ________________________", totalsX, y + 12, { lineBreak: false });
    }
    y += 36;

    // CTA
    ensureSpace(56);
    const ctaH = 48;
    doc.roundedRect(margin, y, contentW, ctaH, 6).fill(PAL.panelBg);
    doc.roundedRect(margin, y, 4, ctaH, 2).fill(PAL.accent);
    doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(11);
    doc.text("Approve and sign online", margin + 16, y + 12, { lineBreak: false });
    doc.fillColor(PAL.muted).font("Helvetica").fontSize(8);
    doc.text(
      "Pick add-ons, sign and pay the deposit from your phone. By signing you accept these terms.",
      margin + 16,
      y + 28,
      { width: contentW * 0.55, lineBreak: false },
    );
    const link = input.publicQuoteUrl || "Ask your contractor for the quote link";
    doc.fillColor(PAL.primary).font("Helvetica-Bold").fontSize(9);
    const linkDisplay = link.length > 42 ? `${link.slice(0, 40)}…` : link;
    const lw = doc.widthOfString(linkDisplay);
    doc.text(linkDisplay, pageW - margin - 16 - lw, y + 18, { lineBreak: false });
    y += ctaH + 10;

    // Stamp footers on all pages
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      // Ensure accent bar on continuation pages that already have compact header
      // (page 1 + page 2 already drew it in their header paths)
      const footerY = pageH - 32;
      rule(margin, pageW - margin, footerY - 8, PAL.rule, 0.5);
      doc.fillColor(PAL.mutedLight).font("Helvetica").fontSize(7.5);
      const left = `${quoteNumber} · ${customerName}`;
      doc.text(left, margin, footerY, { lineBreak: false });

      const brand = "Made with ObraMate";
      const bw = doc.widthOfString(brand);
      const brandX = (pageW - bw) / 2;
      const iconSize = 11;
      drawSystemMark(brandX - iconSize - 5, footerY - 1, iconSize);
      doc.fillColor(PAL.mutedLight).font("Helvetica").fontSize(7.5);
      doc.text(brand, brandX, footerY, { lineBreak: false });

      const pageLabel = `Page ${i + 1} of ${range.count}`;
      doc.text(pageLabel, pageW - margin - doc.widthOfString(pageLabel), footerY, {
        lineBreak: false,
      });
    }

    doc.end();
  });
}
