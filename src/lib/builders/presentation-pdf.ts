/**
 * The presentation PDF: the Present mode of a measurement as a landscape document the builder can
 * send ahead of (or after) the meeting. Same chapters as on screen — the house, the stairs, the
 * vents and the quote — with stills of the 3D rendered by the browser (three.js runs there, not here).
 */
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { prisma } from "../prisma.js";
import type { ActiveMember } from "./accounts.js";
import { can } from "./roles.js";
import { fmtInches, getMeasurement, openLabel, parseData, VENT_LABEL, type MeasurementData, type Stair } from "./measurements.js";
import { planTotals, takeoffSettings, withWaste } from "./takeoff.js";

type Doc = InstanceType<typeof PDFDocument>;

/* ───────────────────────────── input ───────────────────────────── */

const jpeg = z.string().max(8_000_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/).optional();
export const presentationInputSchema = z.object({
  company: z.string().uuid().nullable().optional().default(null),
  lines: z.array(z.object({
    sec: z.enum(["Floors", "Stairs", "Vents"]),
    name: z.string().trim().min(1).max(160),
    spec: z.string().max(300).optional().default(""),
    qty: z.number().min(0).max(1_000_000),
    uom: z.string().max(20).optional().default("EA"),
    rate: z.number().min(0).max(1_000_000).nullable().optional().default(null),
    color: z.string().regex(/^#[0-9a-f]{3,8}$/i).or(z.literal("")).optional().default(""),
  })).max(80).optional().default([]),
  images: z.object({ cover: jpeg, house: jpeg, ventsMap: jpeg, stairs: jpeg, vents: jpeg }).optional().default({}),
});
export type PresentationInput = z.infer<typeof presentationInputSchema>;

function decodeJpeg(url: string | undefined): Buffer | null {
  if (!url) return null;
  const buf = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  return buf.length > 100 && buf[0] === 0xff && buf[1] === 0xd8 ? buf : null;
}

/* ───────────────────────────── look ───────────────────────────── */

const PW = 792; const PH = 612; const M = 44;
/** The Present stage: warm paper (the 3D background), ink, and the portal's strong orange. */
const C = { ink: "#221E1A", body: "#3D3833", muted: "#6B645C", faint: "#8C847B", line: "#E4DFD8", paper: "#F3F1EE", accent: "#B9581A", white: "#FFFFFF" };
const WOOD: Record<string, string> = { "white oak": "#D6B488", "red oak": "#C8936E", hickory: "#CDA06C", maple: "#E9D3AA", walnut: "#6E4B34", ash: "#DEC79F", "brazilian cherry": "#8E3B22" };

type Fonts = { regular: string; medium: string; semibold: string; bold: string };
const FONT_DIR = path.resolve(process.cwd(), "crm/assets/fonts/geist");
function useFonts(doc: Doc): Fonts {
  const f: Fonts = { regular: "Helvetica", medium: "Helvetica", semibold: "Helvetica-Bold", bold: "Helvetica-Bold" };
  const files: Array<[keyof Fonts, string]> = [["regular", "Geist-Regular.ttf"], ["medium", "Geist-Medium.ttf"], ["semibold", "Geist-SemiBold.ttf"], ["bold", "Geist-Bold.ttf"]];
  for (const [k, file] of files) {
    const p = path.join(FONT_DIR, file);
    try { if (fs.existsSync(p)) { doc.registerFont(`Geist-${k}`, p); f[k] = `Geist-${k}`; } } catch { /* keep Helvetica */ }
  }
  return f;
}

/** The fonts have no ⅛-style glyphs: "11⅛" → "11-1/8". */
function clean(text: string): string {
  const map: Record<string, string> = { "¼": "1/4", "½": "1/2", "¾": "3/4", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8", "⅓": "1/3", "⅔": "2/3" };
  return String(text || "").replace(/(\d)?([¼½¾⅛⅜⅝⅞⅓⅔])/g, (_m, d: string | undefined, g: string) => `${d ? `${d}-` : ""}${map[g]}`);
}
const num = (n: number) => Math.round(n).toLocaleString("en-US");
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");
function andList(list: string[]): string {
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : (list[0] || "");
}

type TextOpts = { font: string; size: number; color?: string; width?: number; align?: "left" | "right" | "center"; gap?: number; cs?: number; height?: number };
/** Draws text and returns its height. */
function text(doc: Doc, s: string, x: number, y: number, o: TextOpts): number {
  const str = clean(s);
  doc.font(o.font).fontSize(o.size).fillColor(o.color ?? C.ink);
  const opts = { width: o.width, align: o.align, lineGap: o.gap ?? 0, characterSpacing: o.cs ?? 0, height: o.height, ellipsis: o.height ? true : undefined, lineBreak: o.width != null };
  const h = o.width != null ? doc.heightOfString(str, opts) : doc.currentLineHeight();
  doc.text(str, x, y, opts);
  return o.height != null ? Math.min(h, o.height) : h;
}
function measure(doc: Doc, s: string, o: TextOpts): number {
  doc.font(o.font).fontSize(o.size);
  return doc.heightOfString(clean(s), { width: o.width, lineGap: o.gap ?? 0, characterSpacing: o.cs ?? 0 });
}
function rule(doc: Doc, x: number, y: number, w: number, color = C.line) {
  doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.6).strokeColor(color).stroke();
}
function swatch(doc: Doc, color: string, x: number, y: number, size = 9) {
  doc.roundedRect(x, y, size, size, 2).fill(color || C.faint);
}
/** A 3D still in a rounded frame of the stage color (the render's own background). */
function stage(doc: Doc, img: Buffer | null, x: number, y: number, w: number, h: number, mode: "cover" | "fit" = "cover") {
  doc.save();
  doc.roundedRect(x, y, w, h, 12).clip();
  doc.rect(x, y, w, h).fill(C.paper);
  if (img) { try { doc.image(img, x + (mode === "fit" ? 16 : 0), y, mode === "fit" ? { fit: [w - 32, h], align: "center", valign: "center" } : { cover: [w, h], align: "center", valign: "center" }); } catch { /* bad image: empty stage */ } }
  doc.restore();
}

/* ───────────────────────────── stairs in words ───────────────────────────── */

function stairChains(data: MeasurementData): Stair[][] {
  const roots = data.stairs.filter((s) => !s.starts_on_landing_of && s.steps.length);
  return roots.map((root) => {
    const chain = [root]; const seen = new Set([root.id]);
    for (;;) {
      const next = data.stairs.find((s) => s.starts_on_landing_of === chain[chain.length - 1]!.id && !seen.has(s.id));
      if (!next) break;
      chain.push(next); seen.add(next.id);
    }
    return chain;
  });
}
function chainShape(chain: Stair[]): string {
  if (chain[0]!.layout === "round") return `Round stair · ${chain[0]!.round_sweep}° sweep`;
  const turns = chain.slice(1).map((s) => s.turn);
  if (turns.some((t) => t === "u_left" || t === "u_right")) return "U-shaped stair";
  if (turns.length === 1 && (turns[0] === "left" || turns[0] === "right")) return "L-shaped stair";
  if (turns.length > 1) return `${chain.length}-flight stair`;
  return "Straight stair";
}

/* ───────────────────────────── document ───────────────────────────── */

type Line = PresentationInput["lines"][number];

export async function presentationPdf(member: ActiveMember, measurementId: string, raw: PresentationInput): Promise<{ name: string; body: Buffer }> {
  const m = await getMeasurement(member, measurementId);
  const data: MeasurementData = m.data ?? parseData(null);
  const money = can(member.role, "money.view");
  const [account, link] = await Promise.all([
    prisma.builderAccount.findUnique({ where: { id: member.builderAccountId }, select: { name: true, takeoffSettings: true } }),
    raw.company ? prisma.builderLink.findFirst({ where: { id: raw.company, builderAccountId: member.builderAccountId }, select: { companyName: true } }) : null,
  ]);
  const builder = account?.name || "Builder";
  const company = link?.companyName || "";
  const settings = takeoffSettings(account?.takeoffSettings);
  const measuredBy = (m.measured && m.measured.names.length ? m.measured.names.join(" & ") : "") || m.completed_by || m.updated_by || m.created_by || "";
  const measuredAt = m.measured && m.measured.on ? new Date(`${m.measured.on}T12:00:00Z`) : (m.completed_at || m.updated_at);
  const img = {
    cover: decodeJpeg(raw.images.cover), house: decodeJpeg(raw.images.house), ventsMap: decodeJpeg(raw.images.ventsMap),
    stairs: decodeJpeg(raw.images.stairs), vents: decodeJpeg(raw.images.vents),
  };
  const lines: Line[] = raw.lines.map((l) => ({ ...l, rate: money ? l.rate : null }));
  const totals = data.plan && data.plan.levels.length ? planTotals(data.plan).filter((t) => t.include) : [];
  const c = m.counts;
  const floorSf = totals.reduce((a, t) => a + t.area_sf, 0);
  const priced = lines.filter((l) => l.rate != null);
  const quoteTotal = priced.reduce((a, l) => a + l.qty * (l.rate as number), 0);

  const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margin: 0, autoFirstPage: false, bufferPages: true, info: { Title: `${m.address} · Presentation`, Author: builder, Subject: company ? `Prepared for ${company}` : "Project presentation" } });
  const chunks: Buffer[] = [];
  doc.on("data", (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const F = useFonts(doc);
  const page = (bg = C.white) => { doc.addPage({ size: "LETTER", layout: "landscape", margin: 0 }); doc.rect(0, 0, PW, PH).fill(bg); };

  /* ── cover: the house, the address, the scope ── */
  page(C.paper);
  text(doc, builder, M, 34, { font: F.semibold, size: 11, color: C.ink, width: 360, height: 16 });
  text(doc, fmtDate(measuredAt), PW - M - 240, 34, { font: F.regular, size: 10, color: C.muted, width: 240, align: "right" });
  if (img.cover) {
    try { doc.image(img.cover, 0, 54, { fit: [PW, 400], align: "center", valign: "center" }); } catch { /* bad image */ }
  }
  const sub = [m.community, m.lot ? `Lot ${m.lot}` : ""].filter(Boolean).join(" · ");
  const addrW = 410;
  const addrSize = measure(doc, m.address, { font: F.bold, size: 30, width: addrW, cs: -0.6 }) > 40 ? 24 : 30;
  let y = 470;
  y += text(doc, m.address, M, y, { font: F.bold, size: addrSize, color: C.ink, width: addrW, cs: addrSize * -0.02, gap: -2, height: addrSize * 2.3 });
  if (sub) y += 4 + text(doc, sub, M, y + 4, { font: F.medium, size: 11.5, color: C.body, width: addrW });
  const prepared = [company ? `Prepared for ${company}` : "", measuredBy ? `Measured on site by ${measuredBy}` : ""].filter(Boolean).join("  ·  ");
  if (prepared) text(doc, prepared, M, Math.max(y + 14, 552), { font: F.regular, size: 9.5, color: C.muted, width: addrW, height: 28 });
  // the scope, one row per trade
  const scope: Array<[string, string]> = [];
  if (floorSf) scope.push(["Flooring", `${num(floorSf)} SF · ${plural(totals.length, "product")}`]);
  if (c.treads) scope.push(["Stairs", [plural(c.treads, "tread"), c.risers ? plural(c.risers, "riser") : "", c.landings ? plural(c.landings, "landing") : ""].filter(Boolean).join(" · ")]);
  if (c.vents) scope.push(["Vents", plural(c.vents, "vent")]);
  if (money && quoteTotal) scope.push(["Quote", usd(quoteTotal)]);
  const sx = 488; const sw = PW - M - sx; let sy = 474;
  for (const [i, [label, value]] of scope.entries()) {
    if (i) rule(doc, sx, sy - 7, sw, "#DCD5CC");
    const last = label === "Quote";
    text(doc, label, sx, sy, { font: F.medium, size: 9.5, color: C.muted, width: 80 });
    text(doc, value, sx + 80, sy - (last ? 2 : 0), { font: last ? F.bold : F.semibold, size: last ? 14 : 11, color: last ? C.accent : C.ink, width: sw - 80, align: "right", height: 18 });
    sy += 26;
  }

  /** Chapter: a 3D still on one side, the story on the other. Returns the text column. */
  const chapter = (still: Buffer | null, side: "left" | "right", title: string, lead: string, mode: "cover" | "fit" = "cover") => {
    page();
    const sw_ = 420; const col = PW - M * 2 - sw_ - 34;
    const sx_ = side === "left" ? M : PW - M - sw_;
    const cx = side === "left" ? M + sw_ + 34 : M;
    stage(doc, still, sx_, M, sw_, PH - M * 2 - 18, mode);
    let cy = M + 6;
    cy += text(doc, title, cx, cy, { font: F.bold, size: 22, color: C.ink, width: col, cs: -0.4, gap: 1 });
    cy += 8 + text(doc, lead, cx, cy + 8, { font: F.regular, size: 10.5, color: C.body, width: col, gap: 2 });
    return { x: cx, w: col, y: cy + 24 };
  };
  /** One big figure with its unit underneath. */
  const figure = (x: number, y: number, value: string, unit: string, w: number) => {
    text(doc, value, x, y, { font: F.bold, size: 40, color: C.ink, width: w, cs: -1, height: 46 });
    text(doc, unit, x, y + 44, { font: F.medium, size: 10, color: C.muted, width: w });
    return 64;
  };

  /* ── the house ── */
  if (totals.length) {
    const levels = (data.plan?.levels || []).filter((l) => l.include && l.rooms.some((r) => !r.exclude));
    const rooms = levels.reduce((a, l) => a + l.rooms.filter((r) => !r.exclude).length, 0);
    const col = chapter(img.house || img.cover, "left", "The house, measured from the plans", `${plural(levels.length, "level")} · ${plural(rooms, "room")} read from the drawings. Areas exclude walls; the order adds the waste set for each floor.`);
    let cy = col.y + figure(col.x, col.y, num(floorSf), "SF of flooring", col.w) + 14;
    for (const t of totals) {
      const w = settings.waste[t.kind] ?? 10;
      rule(doc, col.x, cy - 8, col.w);
      swatch(doc, t.color, col.x, cy + 2);
      text(doc, t.label, col.x + 16, cy, { font: F.semibold, size: 11, color: C.ink, width: col.w - 96, height: 15 });
      text(doc, `${num(t.area_sf)} SF`, col.x + col.w - 90, cy, { font: F.semibold, size: 11, color: C.ink, width: 90, align: "right" });
      cy += 16;
      const detail = [t.spec, t.sand_finish ? "sand & finish on site" : "", `order ${num(withWaste(t.area_sf, w))} SF with ${w}% waste`].filter(Boolean).join(" · ");
      cy += text(doc, detail, col.x + 16, cy, { font: F.regular, size: 9, color: C.muted, width: col.w - 16, gap: 1, height: 36 }) + 16;
      if (cy > PH - 110) break;
    }
    if (levels.length > 1 && cy < PH - 96) {
      cy += 4;
      text(doc, "By level", col.x, cy, { font: F.semibold, size: 9.5, color: C.body });
      cy += 16;
      for (const lv of levels) {
        const sf = lv.rooms.filter((r) => !r.exclude && totals.some((t) => t.key === r.material)).reduce((a, r) => a + r.area_sf, 0);
        if (!sf) continue;
        text(doc, lv.name, col.x, cy, { font: F.regular, size: 9.5, color: C.body, width: col.w - 90, height: 13 });
        text(doc, `${num(sf)} SF`, col.x + col.w - 90, cy, { font: F.medium, size: 9.5, color: C.body, width: 90, align: "right" });
        cy += 15;
        if (cy > PH - 80) break;
      }
    }
  }

  /* ── stairs ── */
  const chains = stairChains(data);
  if (c.treads && chains.length) {
    const col = chapter(img.stairs, totals.length ? "right" : "left", "Stairs, built from the site measurement", `${plural(c.flights, "flight")}${c.nosings ? ` · ${plural(c.nosings, "nosing")}` : ""} · every tread and riser sized on site, so the parts are cut before the crew arrives.`);
    const third = col.w / 3;
    const figs: Array<[number, string]> = [[c.treads, c.treads === 1 ? "tread" : "treads"], [c.risers, c.risers === 1 ? "riser" : "risers"]];
    if (c.landings) figs.push([c.landings, c.landings === 1 ? "landing" : "landings"]);
    figs.forEach(([n, unit], i) => figure(col.x + i * third, col.y, num(n), unit, third - 6));
    let cy = col.y + 64 + 18;
    for (const chain of chains) {
      if (cy > PH - 120) break;
      const root = chain[0]!;
      const treadsIn = chain.map((s) => s.steps.filter((st) => st.kind !== "riser").length);
      const widths = [...new Set(chain.flatMap((s) => s.steps.filter((st) => st.kind !== "riser" && st.tread_w).map((st) => `${fmtInches(st.tread_w)}"`)))];
      const sides = [...new Set(chain.flatMap((s) => s.steps.filter((st) => st.kind !== "riser").map((st) => openLabel(st.open, st.ret))))];
      const wood = [root.species, root.finish, root.color].filter(Boolean).join(" · ");
      rule(doc, col.x, cy - 8, col.w);
      swatch(doc, WOOD[String(root.species || "").toLowerCase()] || "#C9A57A", col.x, cy + 2);
      text(doc, (root.name || "Stair").replace(/\s*·\s*upper flight$/i, ""), col.x + 16, cy, { font: F.semibold, size: 11, color: C.ink, width: col.w - 16, height: 15 });
      cy += 17;
      const facts = [
        `${chainShape(chain)} · ${treadsIn.join(" + ")} treads${chain.some((s) => s.landing.enabled) ? " with a landing" : ""}`,
        widths.length ? `Treads ${widths.slice(0, 3).join(", ")} wide · ${sides.slice(0, 2).join("; ")}` : "",
        wood,
        root.note,
      ].filter(Boolean);
      for (const f of facts) cy += text(doc, f, col.x + 16, cy, { font: F.regular, size: 9, color: C.muted, width: col.w - 16, gap: 1, height: 26 }) + 3;
      cy += 16;
    }
  }

  /* ── vents ── */
  if (c.vents) {
    const lead = "Size, type and wood matched to the floor around each one, so they sit flush when the floor is done.";
    /** One row per vent line; returns false when the space ran out. */
    const ventRows = (x: number, w: number, y0: number, bottom: number) => {
      let cy = y0;
      const rows = data.vents.slice(0, 40);
      for (const [i, v] of rows.entries()) {
        if (cy > bottom) { text(doc, `+ ${rows.length - i} more on the measurement PDF`, x, cy, { font: F.regular, size: 9, color: C.muted, width: w }); break; }
        if (i) rule(doc, x, cy - 6, w);
        text(doc, v.room || "Vent", x, cy, { font: F.semibold, size: 10, color: C.ink, width: w - 40, height: 14 });
        text(doc, `× ${v.qty || 1}`, x + w - 40, cy, { font: F.semibold, size: 10, color: C.ink, width: 40, align: "right" });
        cy += 14;
        cy += text(doc, [`${v.size || "?"}"`, VENT_LABEL[v.type] || v.type, [v.species, v.finish].filter(Boolean).join(" · ")].filter(Boolean).join(" · "), x, cy, { font: F.regular, size: 8.5, color: C.muted, width: w, height: 24 }) + 12;
      }
    };
    if (img.ventsMap) {
      // the vents on the house, with the vent kinds up close
      const col = chapter(img.ventsMap, "left", "Vents, room by room", lead);
      figure(col.x, col.y, num(c.vents), c.vents === 1 ? "vent" : "vents", col.w);
      let cy = col.y + 64 + 14;
      if (img.vents) { stage(doc, img.vents, col.x, cy, col.w, Math.round(col.w / 2)); cy += Math.round(col.w / 2) + 20; }
      ventRows(col.x, col.w, cy, PH - 84);
    } else {
      // no house to place them on: the vent kinds as a wide band, the list underneath
      page();
      const bandH = 250;
      stage(doc, img.vents, M, M, PW - M * 2, bandH);
      const top = M + bandH + 30; const lw = 262; const rx = M + lw + 40; const rw = PW - M - rx;
      let ly = top;
      ly += text(doc, "Vents, room by room", M, ly, { font: F.bold, size: 22, color: C.ink, width: lw, cs: -0.4 });
      ly += 8 + text(doc, lead, M, ly + 8, { font: F.regular, size: 10.5, color: C.body, width: lw, gap: 2 });
      figure(M, ly + 22, num(c.vents), c.vents === 1 ? "vent" : "vents", lw);
      ventRows(rx, rw, top + 4, PH - 84);
    }
  }

  /* ── the quote ── */
  if (lines.length) {
    const leftW = 214; const rx = M + leftW + 40; const rw = PW - M - rx;
    const amtW = money ? 78 : 0; const qtyW = 120; const nameW = rw - qtyW - amtW - 12;
    const secs = (["Floors", "Stairs", "Vents"] as const).map((s) => [s, lines.filter((l) => l.sec === s)] as const).filter(([, ls]) => ls.length);
    const secTotal = (ls: readonly Line[]) => ls.reduce((a, l) => a + (l.rate != null ? l.qty * l.rate : 0), 0);
    const missing = lines.filter((l) => l.rate == null).length;

    const left = (continued: boolean) => {
      let ly = M + 6;
      ly += text(doc, money ? "Work order & quote" : "Work order", M, ly, { font: F.bold, size: 22, color: C.ink, width: leftW, cs: -0.4 });
      ly += 6 + text(doc, continued ? `${m.address} · continued` : m.address, M, ly + 6, { font: F.regular, size: 10, color: C.body, width: leftW, height: 28 });
      if (continued) return;
      ly += 26;
      for (const [label, name] of [["From", builder], ["To", company || "The subcontractor"]] as const) {
        text(doc, label, M, ly, { font: F.medium, size: 9, color: C.muted });
        ly += 13 + text(doc, name, M, ly + 13, { font: F.semibold, size: 12, color: C.ink, width: leftW, height: 32 }) + 12;
      }
      if (money && priced.length) {
        ly += 6;
        for (const [s, ls] of secs) {
          rule(doc, M, ly - 6, leftW);
          text(doc, s, M, ly, { font: F.regular, size: 10, color: C.body });
          text(doc, ls.some((l) => l.rate != null) ? usd(secTotal(ls)) : "To price", M + 80, ly, { font: F.medium, size: 10, color: C.body, width: leftW - 80, align: "right" });
          ly += 20;
        }
        rule(doc, M, ly - 6, leftW, C.ink);
        text(doc, "Total", M, ly + 4, { font: F.semibold, size: 11, color: C.ink });
        text(doc, usd(quoteTotal), M + 60, ly, { font: F.bold, size: 20, color: C.accent, width: leftW - 60, align: "right" });
        ly += 34;
        if (missing) ly += text(doc, `${plural(missing, "line")} without a price yet — ${company || "the company"} prices ${missing === 1 ? "it" : "them"} on their side.`, M, ly, { font: F.regular, size: 8.5, color: C.muted, width: leftW, gap: 1 }) + 10;
      }
      if (m.notes && ly < PH - 170) {
        ly += 6;
        text(doc, "Notes", M, ly, { font: F.medium, size: 9, color: C.muted });
        ly += 14 + text(doc, m.notes, M, ly + 14, { font: F.regular, size: 9, color: C.body, width: leftW, gap: 1.5, height: Math.max(24, PH - 160 - ly) });
      }
      const thumbH = Math.round(leftW * 0.6);
      if (img.cover && ly < PH - M - 18 - thumbH - 10) stage(doc, img.cover, M, PH - M - 18 - thumbH, leftW, thumbH);
    };
    const head = (yy: number) => {
      text(doc, "Service", rx, yy, { font: F.medium, size: 8.5, color: C.muted });
      text(doc, "Quantity", rx + nameW + 12, yy, { font: F.medium, size: 8.5, color: C.muted, width: qtyW, align: "right" });
      if (money) text(doc, "Amount", rx + rw - amtW, yy, { font: F.medium, size: 8.5, color: C.muted, width: amtW, align: "right" });
      rule(doc, rx, yy + 15, rw, C.ink);
      return yy + 26;
    };
    const BOTTOM = PH - M - 24;
    page(); left(false);
    let ry = head(M + 12);
    for (const [s, ls] of secs) {
      if (ry + 60 > BOTTOM) { page(); left(true); ry = head(M + 12); }
      ry += 4;
      text(doc, s, rx, ry, { font: F.semibold, size: 12.5, color: C.ink });
      if (money) text(doc, ls.some((l) => l.rate != null) ? usd(secTotal(ls)) : "To price", rx + rw - 140, ry + 1, { font: F.semibold, size: 11, color: C.ink, width: 140, align: "right" });
      ry += 24;
      for (const l of ls) {
        const nameH = measure(doc, l.name, { font: F.semibold, size: 10, width: nameW - 14 });
        const specH = l.spec ? measure(doc, l.spec, { font: F.regular, size: 8.5, width: nameW - 14, gap: 1 }) : 0;
        const h = Math.min(60, nameH + (specH ? specH + 2 : 0)) + 14;
        if (ry + h > BOTTOM) { page(); left(true); ry = head(M + 12); }
        if (l.color) swatch(doc, l.color, rx, ry + 2.5, 8);
        text(doc, l.name, rx + 14, ry, { font: F.semibold, size: 10, color: C.ink, width: nameW - 14, height: 28 });
        if (l.spec) text(doc, l.spec, rx + 14, ry + nameH + 2, { font: F.regular, size: 8.5, color: C.muted, width: nameW - 14, gap: 1, height: 30 });
        const q = `${num(l.qty)} ${l.uom}${money && l.rate != null ? ` × ${usd(l.rate)}` : ""}`;
        text(doc, q, rx + nameW + 12, ry, { font: F.regular, size: 9.5, color: C.body, width: qtyW, align: "right" });
        if (money) text(doc, l.rate != null ? usd(l.qty * l.rate) : "—", rx + rw - amtW, ry, { font: F.semibold, size: 10, color: l.rate != null ? C.ink : C.faint, width: amtW, align: "right" });
        ry += h;
        rule(doc, rx, ry - 7, rw);
      }
      ry += 10;
    }
    if (ry + 40 < BOTTOM) {
      const what = andList([totals.length ? "floors" : "", c.treads ? "stairs" : "", c.vents ? "vents" : ""].filter(Boolean));
      const close = `${what.charAt(0).toUpperCase()}${what.slice(1)} in one work order — sent from ObraBuilder with ${data.plan?.file ? "the plans, " : ""}the 3D and the measurement PDF.`;
      text(doc, close, rx, ry + 6, { font: F.regular, size: 9.5, color: C.body, width: rw, gap: 1.5 });
    }
  }

  /* ── footer (not on the cover) ── */
  const range = doc.bufferedPageRange();
  for (let i = range.start + 1; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const fy = PH - 30;
    text(doc, `${m.address}  ·  ${builder}`, M, fy, { font: F.regular, size: 8, color: C.faint, width: PW - M * 2 - 80, height: 11 });
    text(doc, `${i - range.start + 1} / ${range.count}`, PW - M - 80, fy, { font: F.medium, size: 8, color: C.faint, width: 80, align: "right" });
  }
  doc.end();
  const body = await done;
  return { name: `Presentation - ${m.address}.pdf`.replace(/[\\/:*?"<>|]+/g, " ").slice(0, 150), body };
}
