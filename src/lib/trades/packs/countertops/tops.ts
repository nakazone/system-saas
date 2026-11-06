/**
 * Countertops measured on a visit (Field Quote → Bancadas, quote editor): the same model and math
 * as the countertop builder in the browser (crm/public/countertop-builder.js, window.ObTops), so
 * the client tour shows the same square feet and edges as the quote. Estimates before the template.
 */
const KINDS = {
  run: { length: 96, depth: 25.5, edges: { front: true, back: false, left: false, right: false }, splash: { back: true, left: false, right: false }, sink: "undermount" },
  island: { length: 96, depth: 42, edges: { front: true, back: true, left: true, right: true }, splash: { back: false, left: false, right: false }, sink: "none" },
  vanity: { length: 49, depth: 22, edges: { front: true, back: false, left: false, right: false }, splash: { back: true, left: false, right: false }, sink: "undermount" },
} as const;
export type TopKind = keyof typeof KINDS;
const SINKS = ["none", "undermount", "farmhouse", "dropin"] as const;
const EDGES = ["eased", "bevel", "ogee", "mitered"] as const;
const SLAB_SF = (55 * 120) / 144;
const MAX_RUN = 120;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown, d: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};
const bool = (v: unknown, d: boolean) => (v === undefined ? d : Boolean(v));
const r1 = (n: number) => Math.round(n * 10) / 10;

export type TopPiece = {
  id: string;
  name: string;
  kind: TopKind;
  length: number;
  depth: number;
  overhang: number;
  edges: { front: boolean; back: boolean; left: boolean; right: boolean };
  splash: { back: boolean; left: boolean; right: boolean };
  waterfall: { left: boolean; right: boolean };
  sink: (typeof SINKS)[number];
  cooktop: boolean;
  faucet_holes: number;
  outlets: number;
};
export type TopSpec = {
  level: number;
  material: string;
  color: string;
  thickness: "3 cm" | "2 cm";
  edge: (typeof EDGES)[number];
  splash: "none" | "4in" | "full";
  full_h: number;
  tearout: boolean;
};
export type Tops = { spec: TopSpec; pieces: TopPiece[] };

function normPiece(raw: unknown, i: number): TopPiece {
  const p = obj(raw);
  const kind: TopKind = typeof p.kind === "string" && p.kind in KINDS ? (p.kind as TopKind) : "run";
  const k = KINDS[kind];
  const e = obj(p.edges);
  const s = obj(p.splash);
  const w = obj(p.waterfall);
  return {
    id: String(p.id || `ct${i}`).slice(0, 40),
    name: String(p.name || "").slice(0, 80),
    kind,
    length: num(p.length, k.length, 6, 240),
    depth: num(p.depth, k.depth, 6, 72),
    overhang: num(p.overhang, 0, 0, 24),
    edges: { front: bool(e.front, k.edges.front), back: bool(e.back, k.edges.back), left: bool(e.left, k.edges.left), right: bool(e.right, k.edges.right) },
    splash: { back: bool(s.back, k.splash.back), left: bool(s.left, k.splash.left), right: bool(s.right, k.splash.right) },
    waterfall: { left: bool(w.left, false), right: bool(w.right, false) },
    sink: (SINKS as readonly string[]).includes(String(p.sink)) ? (p.sink as TopPiece["sink"]) : k.sink,
    cooktop: Boolean(p.cooktop),
    faucet_holes: num(p.faucet_holes, kind === "island" ? 0 : 1, 0, 6),
    outlets: num(p.outlets, 0, 0, 8),
  };
}
function normSpec(raw: unknown): TopSpec {
  const s = obj(raw);
  return {
    level: num(s.level, 2, 1, 4),
    material: String(s.material || "Quartz").slice(0, 60),
    color: String(s.color || "").slice(0, 80),
    thickness: s.thickness === "2 cm" ? "2 cm" : "3 cm",
    edge: (EDGES as readonly string[]).includes(String(s.edge)) ? (s.edge as TopSpec["edge"]) : "eased",
    splash: s.splash === "none" || s.splash === "full" ? s.splash : "4in",
    full_h: num(s.full_h, 18, 4, 60),
    tearout: Boolean(s.tearout),
  };
}
/** Every field filled; at most 30 pieces. */
export function normalizeTops(raw: unknown): Tops {
  const t = obj(raw);
  return { spec: normSpec(t.spec), pieces: (Array.isArray(t.pieces) ? t.pieces : []).slice(0, 30).map(normPiece) };
}

export function pieceQuantities(p: TopPiece, spec: TopSpec) {
  const deep = p.depth + p.overhang;
  const wfIn2 = (p.waterfall.left ? 1 : 0) * deep * 36 + (p.waterfall.right ? 1 : 0) * deep * 36;
  const sf = (p.length * deep + wfIn2) / 144;
  const edgeIn = (p.edges.front ? p.length : 0) + (p.edges.back ? p.length : 0) + (p.edges.left && !p.waterfall.left ? deep : 0) + (p.edges.right && !p.waterfall.right ? deep : 0);
  const splashIn = (p.splash.back ? p.length : 0) + (p.splash.left ? p.depth : 0) + (p.splash.right ? p.depth : 0);
  const limit = spec.thickness === "2 cm" ? 6 : 10;
  return {
    sf: r1(sf),
    edge_lf: r1(edgeIn / 12),
    splash_lf: spec.splash === "none" ? 0 : r1(splashIn / 12),
    waterfalls: (p.waterfall.left ? 1 : 0) + (p.waterfall.right ? 1 : 0),
    supports: p.overhang > limit ? Math.max(2, Math.ceil(p.length / 32)) : 0,
    seams: p.length > MAX_RUN ? Math.ceil(p.length / MAX_RUN) - 1 : 0,
  };
}

/** Same numbers as ObTops.quantities in the browser. */
export function topsQuantities(raw: unknown) {
  const t = normalizeTops(raw);
  const per = t.pieces.map((p) => pieceQuantities(p, t.spec));
  const sum = (k: keyof (typeof per)[number]) => r1(per.reduce((a, q) => a + q[k], 0));
  const count = (f: (p: TopPiece) => number) => t.pieces.reduce((a, p) => a + f(p), 0);
  const splashLf = sum("splash_lf");
  const sf = sum("sf");
  return {
    per,
    sf,
    edge_lf: sum("edge_lf"),
    splash_lf: t.spec.splash === "4in" ? splashLf : 0,
    splash_sf: t.spec.splash === "full" ? r1((splashLf * t.spec.full_h) / 12) : 0,
    waterfalls: sum("waterfalls"),
    supports: sum("supports"),
    seams: sum("seams"),
    sinks: { undermount: count((p) => (p.sink === "undermount" ? 1 : 0)), farmhouse: count((p) => (p.sink === "farmhouse" ? 1 : 0)), dropin: count((p) => (p.sink === "dropin" ? 1 : 0)) },
    cooktops: count((p) => (p.cooktop ? 1 : 0)),
    faucet_holes: count((p) => p.faucet_holes),
    outlets: count((p) => p.outlets),
    slabs: sf ? Math.ceil((sf * 1.2 + (t.spec.splash === "full" ? (splashLf * t.spec.full_h) / 12 : 0)) / SLAB_SF) : 0,
  };
}

const KIND_LABEL: Record<TopKind, string> = { run: "Wall run", island: "Island", vanity: "Vanity" };
const EDGE_LABEL: Record<TopSpec["edge"], string> = { eased: "Eased", bevel: "Bevel / half bullnose", ogee: "Ogee / full bullnose", mitered: "Mitered" };
const SINK_LABEL: Record<TopPiece["sink"], string> = { none: "", undermount: "undermount sink", farmhouse: "farmhouse sink", dropin: "drop-in sink" };

/** "Wall run" / "Island" / "Vanity", or the name the person gave the piece. */
export function topName(p: TopPiece, i: number): string {
  return p.name || `${KIND_LABEL[p.kind]} ${i + 1}`;
}

/**
 * Countertops in the words a work order uses (builder measurement summary, job notes):
 * one line per piece in SF, then edges, backsplash, cutouts and the rest for the whole job.
 */
export function topsSummaryLines(raw: unknown): { kind: "top"; text: string; qty: number; uom: "SF" | "LF" | "EA" }[] {
  const t = normalizeTops(raw);
  if (!t.pieces.length) return [];
  const q = topsQuantities(t);
  const stone = [t.spec.material, t.spec.color, t.spec.thickness, `level ${t.spec.level}`].filter(Boolean).join(" · ");
  const out: { kind: "top"; text: string; qty: number; uom: "SF" | "LF" | "EA" }[] = t.pieces.map((p, i) => {
    const extras = [SINK_LABEL[p.sink], p.cooktop ? "cooktop" : "", p.overhang ? `${p.overhang}" overhang` : "", p.waterfall.left || p.waterfall.right ? "waterfall" : ""].filter(Boolean);
    return { kind: "top", qty: q.per[i]!.sf, uom: "SF", text: `${topName(p, i)} · ${p.length}" × ${p.depth}"${extras.length ? ` · ${extras.join(" · ")}` : ""} · ${stone}` };
  });
  if (q.edge_lf) out.push({ kind: "top", qty: q.edge_lf, uom: "LF", text: `Edge · ${EDGE_LABEL[t.spec.edge]}` });
  if (q.splash_lf) out.push({ kind: "top", qty: q.splash_lf, uom: "LF", text: 'Backsplash 4"' });
  if (q.splash_sf) out.push({ kind: "top", qty: q.splash_sf, uom: "SF", text: `Full-height backsplash · ${t.spec.full_h}"` });
  if (q.waterfalls) out.push({ kind: "top", qty: q.waterfalls, uom: "EA", text: "Waterfall side" });
  const sinks = q.sinks.undermount + q.sinks.farmhouse + q.sinks.dropin;
  if (sinks) out.push({ kind: "top", qty: sinks, uom: "EA", text: `Sink cutout${q.sinks.farmhouse ? ` (${q.sinks.farmhouse} farmhouse)` : ""}${q.sinks.dropin ? ` (${q.sinks.dropin} drop-in)` : ""}` });
  if (q.cooktops) out.push({ kind: "top", qty: q.cooktops, uom: "EA", text: "Cooktop cutout" });
  if (q.faucet_holes) out.push({ kind: "top", qty: q.faucet_holes, uom: "EA", text: "Faucet hole" });
  if (q.outlets) out.push({ kind: "top", qty: q.outlets, uom: "EA", text: "Outlet cutout" });
  if (q.supports) out.push({ kind: "top", qty: q.supports, uom: "EA", text: "Overhang support / corbel" });
  if (q.seams) out.push({ kind: "top", qty: q.seams, uom: "EA", text: "Seam (estimate, the template decides)" });
  if (t.spec.tearout) out.push({ kind: "top", qty: 1, uom: "EA", text: "Remove old countertops" });
  out.push({ kind: "top", qty: q.slabs, uom: "EA", text: "Slabs (estimate +20%, the shop confirms)" });
  return out;
}
