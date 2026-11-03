/**
 * Client tour of a proposal made from a Field Quote: the animated walk-through the
 * homeowner sees (in person on the tablet, or on the public quote link).
 *
 * Built from the visit data (rooms, services, material) plus the quote's real line items,
 * so every number on screen is the quote's number. Client-facing text is in English.
 */

import { SHAPE_INFO, showerQuantities, showerSchema, wallsOf } from "../trades/packs/tile/shower.js";

type Num = number | string | { toString(): string } | null | undefined;

export type TourLine = {
  name: string | null;
  description?: string | null;
  quantity: Num;
  unit: string | null;
  amount: Num;
  itemType?: string | null;
  meta?: unknown;
  optionGroupId?: string | null;
};

export type TourGroup = { id: string; name: string; flooringType?: string | null };

export type TourInput = {
  data: unknown; // FieldQuote.data
  clientName: string | null;
  companyName: string | null;
  quoteNumber: string | null;
  total: Num;
  taxTotal?: Num;
  validUntil?: Date | string | null;
  deposit?: { label: string; amount: number } | null;
  lines: TourLine[];
  /** Quote option groups (Option A / Option B). With 2+ groups the tour lets the client compare them. */
  groups?: TourGroup[];
  selectedGroupId?: string | null;
  taxRate?: Num;
  /** Raw payment schedule, to work out the deposit of each option. */
  schedule?: unknown;
};

export type TourOption = {
  id: string;
  name: string;
  floor: { id: string; label: string; note: string } | null;
  total: number;
  per_sqft: number | null;
  deposit: { label: string; amount: number } | null;
  room_prices: number[];
  categories: Array<{ label: string; amount: number }>;
  details: Array<{ label: string; value: string }>;
};

/** A tile shower from the visit (Field Quote → Boxes), drawn by the tour, with its share of the price. */
export type TourShower = {
  name: string;
  shape: string;
  shape_label: string;
  width: number;
  depth: number;
  height: number;
  walls: Array<{ key: string; label: string; width: number; height: number }>;
  niches: number;
  niche_w: number;
  niche_h: number;
  niche_wall: string;
  bench: boolean;
  bench_l: number;
  bench_d: number;
  bench_h: number;
  bench_wall: string;
  curb: boolean;
  door: string;
  pan: string;
  drain: string;
  tile_long: number;
  pattern: string;
  wall_tile: string;
  floor_tile: string;
  wall_sf: number;
  floor_sf: number;
  waterproofing_sf: number;
  price: number;
};

export type TourRoom = { name: string; sqft: number; l: number; w: number; services: string[]; price: number; perimeter: number };

export type Tour = {
  company: string;
  client_first: string;
  quote_number: string;
  total: number;
  sqft: number;
  per_sqft: number | null;
  valid_until: string | null;
  deposit: { label: string; amount: number } | null;
  removal: { existing: string[] } | null;
  floor: { id: string; label: string; note: string } | null;
  refinish: { label: string } | null;
  rooms: TourRoom[];
  /** Tile showers; empty for flooring visits. */
  showers: TourShower[];
  stairs: number;
  trim: boolean;
  transitions: number;
  details: Array<{ label: string; value: string }>;
  categories: Array<{ label: string; amount: number }>;
  /** Present when the quote has 2+ option groups; the top-level numbers are the selected option's. */
  options?: TourOption[];
  selected_option?: string | null;
};

const n = (v: Num) => {
  const x = Number(v == null ? 0 : String(v));
  return Number.isFinite(x) ? x : 0;
};
const r2 = (v: number) => Math.round(v * 100) / 100;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

const MATERIAL: Record<string, { label: string; note: string }> = {
  lvp: { label: "Luxury vinyl plank", note: "Water-resistant and easy to live with, a good fit for kitchens and homes with pets." },
  solid_hardwood: { label: "Solid hardwood", note: "Real wood through and through. It can be sanded and refinished for decades." },
  engineered_wood: { label: "Engineered hardwood", note: "A real wood surface on a stable core, with the warm look of hardwood." },
  laminate: { label: "Laminate", note: "A durable, budget-friendly floor with a wood look." },
  tile: { label: "Tile", note: "Hard-wearing and easy to clean." },
  carpet: { label: "Carpet", note: "Soft and warm underfoot." },
  other: { label: "New flooring", note: "Your new floor, installed room by room." },
};
const EXISTING: Record<string, string> = {
  carpet: "carpet", lvp: "vinyl plank", solid_hardwood: "hardwood", engineered_wood: "engineered wood", laminate: "laminate", tile: "tile", other: "old flooring",
};
const SANDING: Record<string, string> = {
  sand_finish: "Full sand and refinish",
  screen_coat: "Screen and recoat",
  stain: "Sand, stain and refinish",
  spot_repair: "Spot repair",
};
const UNIT_EN: Record<string, string> = { sq_ft: "sq ft", sqft: "sq ft", linear_ft: "ft", lf: "ft", step: "treads", each: "", fixed: "", hour: "hours", box: "boxes" };

function lineService(l: TourLine): string {
  const st = String(obj(l.meta).service_type || obj(l.meta).serviceType || "").toLowerCase();
  const name = String(l.name || l.description || "").toLowerCase();
  if (st.includes("supply") || l.itemType === "product" || /\bmaterial\b/.test(name)) return "supply";
  if (st.includes("demol") || /removal|remove|tear/.test(name)) return "demolition";
  if (st.includes("sand") || /sand|refinish|recoat/.test(name)) return "sanding";
  return "installation";
}

/** Lines the Field Quote makes from a shower (field-quote.js showerLines). */
export function isShowerLine(l: TourLine): boolean {
  return /^(shower |linear drain installation$|flood test$)/i.test(String(l.name || "").trim());
}

function showerCategory(l: TourLine): string {
  const name = String(l.name || "").toLowerCase();
  if (/walls|floor/.test(name)) return "Shower tile";
  if (/niche|bench|curb/.test(name)) return "Niche, bench & curb";
  if (/trim|edge/.test(name)) return "Shower trim";
  return "Waterproofing & pan";
}

function category(l: TourLine): string {
  if (isShowerLine(l)) return showerCategory(l);
  const name = String(l.name || l.description || "").toLowerCase();
  const unit = String(l.unit || "").toLowerCase();
  const svc = lineService(l);
  if (/haul|disposal|dumpster/.test(name)) return "Haul away";
  if (unit === "step" || /stair|tread/.test(name)) return "Stairs";
  if (unit === "linear_ft" || unit === "lf" || /transition|threshold|quarter round|baseboard|trim/.test(name)) return "Trim & transitions";
  if (/underlay|moisture|vapor|level/.test(name)) return "Subfloor prep";
  if (/furniture/.test(name)) return "Furniture moving";
  if (svc === "supply") return "Flooring material";
  if (svc === "demolition") return "Old floor removal";
  if (svc === "sanding") return "Sand & finish";
  if ((unit === "sq_ft" || unit === "sqft") && /install/.test(name)) return "Installation";
  return "Other work";
}

function roomDims(r: Record<string, unknown>) {
  const ft = (a: unknown, b: unknown) => n(a as Num) + n(b as Num) / 12;
  let l = ft(r.l_ft, r.l_in);
  let w = ft(r.w_ft, r.w_in);
  let area = 0;
  if (r.mode === "area") {
    area = n(r.sqft as Num);
    l = w = Math.sqrt(Math.max(area, 1));
  } else {
    area = l * w;
    for (const p of Array.isArray(r.parts) ? r.parts : []) {
      const po = obj(p);
      area += (n(po.sign as Num) < 0 ? -1 : 1) * n(po.l as Num) * n(po.w as Num);
    }
  }
  area = Math.max(0, r2(area));
  const perimeter = r.mode === "area" ? 0 : r2(2 * (l + w));
  return { l: r2(l), w: r2(w), sqft: area, perimeter };
}

function buildOne(input: TourInput, materialOverride?: string | null): Tour {
  const d = obj(input.data);
  const services = (Array.isArray(d.services) ? d.services : []).map(String);
  const svc = obj(d.svc);
  const inst = obj(svc.installation);
  const answers = obj(d.answers);
  const rooms: TourRoom[] = (Array.isArray(d.rooms) ? d.rooms : [])
    .map((raw) => {
      const r = obj(raw);
      const dims = roomDims(r);
      return {
        name: String(r.en || r.label || "Room").slice(0, 40),
        ...dims,
        services: (Array.isArray(r.services) ? r.services : []).map(String),
        price: 0,
      };
    })
    .filter((r) => r.sqft > 0);

  const lines = input.lines.filter((l) => n(l.amount) !== 0);
  const showers = toursShowers(d, lines);
  // Spread each line over the rooms it belongs to, so each room can show its share.
  for (const l of lines) {
    if (showers.length && isShowerLine(l)) continue;
    const unit = String(l.unit || "").toLowerCase();
    const amount = n(l.amount);
    const svcId = lineService(l) === "supply" ? "installation" : lineService(l);
    const cat = category(l);
    if (unit === "sq_ft" || unit === "sqft") {
      if (cat === "Stairs") continue;
      const pool = rooms.filter((r) => !r.services.length || r.services.includes(svcId));
      const area = pool.reduce((s, r) => s + r.sqft, 0);
      if (area > 0) pool.forEach((r) => (r.price += (amount * r.sqft) / area));
    } else if (unit === "linear_ft" || unit === "lf") {
      const pool = rooms.filter((r) => r.perimeter > 0);
      const per = pool.reduce((s, r) => s + r.perimeter, 0);
      if (per > 0) pool.forEach((r) => (r.price += (amount * r.perimeter) / per));
    }
  }
  rooms.forEach((r) => (r.price = Math.round(r.price)));

  const cats = new Map<string, number>();
  for (const l of lines) cats.set(category(l), (cats.get(category(l)) || 0) + n(l.amount));
  if (n(input.taxTotal) > 0) cats.set("Tax", n(input.taxTotal));
  const categories = [...cats.entries()].map(([label, amount]) => ({ label, amount: r2(amount) })).sort((a, b) => b.amount - a.amount);

  const stairsLine = lines.find((l) => category(l) === "Stairs");
  const transitionsLine = lines.find((l) => /transition|threshold/i.test(String(l.name || "")));
  const details = lines
    .filter((l) => !isShowerLine(l) && ["Stairs", "Trim & transitions", "Subfloor prep", "Furniture moving", "Other work", "Haul away"].includes(category(l)))
    .map((l) => {
      const unit = UNIT_EN[String(l.unit || "").toLowerCase()] ?? "";
      const qty = n(l.quantity);
      return { label: String(l.name || l.description || "Item").slice(0, 60), value: unit ? `${Math.round(qty * 10) / 10} ${unit}` : qty > 1 ? String(qty) : "Included" };
    })
    .slice(0, 6);

  const sqft = r2(rooms.reduce((s, r) => s + r.sqft, 0));
  const total = r2(n(input.total));
  const demo = obj(answers.demolition);
  const existing = (Array.isArray(demo.existing) ? demo.existing : []).map((m) => EXISTING[String(m)] || "old flooring");
  const matId = String(materialOverride || inst.material || "lvp");
  const mat = MATERIAL[matId] || MATERIAL.other;
  const sandType = String(obj(svc.sanding).type || "sand_finish");
  const valid = input.validUntil ? new Date(input.validUntil) : null;

  return {
    company: String(input.companyName || "Your flooring team"),
    client_first: String(input.clientName || "").trim().split(/\s+/)[0] || "there",
    quote_number: String(input.quoteNumber || ""),
    total,
    sqft,
    per_sqft: sqft > 0 ? r2(total / sqft) : null,
    valid_until: valid && !Number.isNaN(valid.getTime()) ? valid.toISOString().slice(0, 10) : null,
    deposit: input.deposit && input.deposit.amount > 0 ? input.deposit : null,
    removal: services.includes("demolition") ? { existing: [...new Set(existing)] } : null,
    floor: services.includes("installation") ? { id: MATERIAL[matId] ? matId : "other", label: mat.label, note: mat.note } : null,
    refinish: services.includes("sanding") ? { label: SANDING[sandType] || SANDING.sand_finish } : null,
    rooms,
    showers,
    stairs: stairsLine ? Math.round(n(stairsLine.quantity)) : 0,
    trim: lines.some((l) => !isShowerLine(l) && /quarter round|baseboard|trim/i.test(String(l.name || ""))),
    transitions: transitionsLine ? Math.round(n(transitionsLine.quantity)) : 0,
    details,
    categories,
  };
}

/**
 * The visit's showers with their drawing data, each with the price of its lines (the line
 * description starts with the shower's name; two showers with the same name split it).
 */
function toursShowers(d: Record<string, unknown>, lines: TourLine[]): TourShower[] {
  const raw = Array.isArray(d.showers) ? d.showers : [];
  const list = raw
    .map((x, i) => {
      const p = showerSchema.safeParse({ id: `s${i}`, ...obj(x), ...(obj(x).id ? {} : { id: `s${i}` }) });
      return p.success ? { s: p.data, name: p.data.name || `Shower ${i + 1}` } : null;
    })
    .filter((x): x is { s: ReturnType<typeof showerSchema.parse>; name: string } => Boolean(x));
  const price = new Map<string, number>();
  for (const l of lines) {
    if (!isShowerLine(l)) continue;
    const desc = String(l.description || "");
    // The longest matching name wins ("Box 1" vs "Box 10"); lines edited by hand go to the first shower.
    const who = list.filter((x) => desc === x.name || desc.startsWith(`${x.name} · `)).sort((a, b) => b.name.length - a.name.length)[0] || list[0];
    if (who) price.set(who.name, (price.get(who.name) || 0) + n(l.amount));
  }
  return list.map(({ s, name }) => {
    const q = showerQuantities(s);
    const same = list.filter((x) => x.name === name).length;
    return {
      name: name.slice(0, 60),
      shape: s.shape,
      shape_label: SHAPE_INFO[s.shape].label,
      width: s.width,
      depth: s.depth,
      height: s.height,
      walls: wallsOf(s),
      niches: s.niches,
      niche_w: s.niche_w,
      niche_h: s.niche_h,
      niche_wall: s.niche_wall,
      bench: s.bench,
      bench_l: s.bench_l,
      bench_d: s.bench_d,
      bench_h: s.bench_h,
      bench_wall: s.bench_wall,
      curb: q.curb_lf > 0,
      door: s.door,
      pan: s.pan,
      drain: s.drain,
      tile_long: s.tile_long,
      pattern: s.pattern,
      wall_tile: s.wall_tile,
      floor_tile: s.floor_tile,
      wall_sf: q.wall_sf,
      floor_sf: q.floor_sf,
      waterproofing_sf: q.waterproofing_sf,
      price: Math.round((price.get(name) || 0) / same),
    };
  });
}

/** First payment-schedule item (the amount due on approval), when the quote has one. */
export function tourDeposit(schedule: unknown, total: number): { label: string; amount: number } | null {
  const items = Array.isArray(obj(schedule).items) ? (obj(schedule).items as unknown[]) : [];
  const first = obj(items[0]);
  if (!items.length) return null;
  const fixed = n(first.fixedAmount as Num);
  const pct = n(first.percent as Num);
  const amount = fixed > 0 ? fixed : pct > 0 ? r2((total * pct) / 100) : 0;
  if (!amount) return null;
  return { label: `${String(first.label || "Due on approval")}${pct > 0 && !(fixed > 0) ? ` · ${pct}%` : ""}`, amount };
}

/** Tour for a Field Quote proposal; with option groups, each option gets its own floor, prices and total. */
export function buildFieldQuoteTour(input: TourInput): Tour {
  const groups = (input.groups || []).filter((g) => g && g.id);
  if (groups.length < 2) return buildOne(input);
  const selected = groups.find((g) => g.id === input.selectedGroupId) || groups[0];
  const taxRate = n(input.taxRate);
  const options: TourOption[] = groups.map((g) => {
    const lines = input.lines.filter((l) => !l.optionGroupId || l.optionGroupId === g.id);
    const subtotal = lines.reduce((s, l) => s + n(l.amount), 0);
    const total = g.id === selected.id ? r2(n(input.total)) : r2(subtotal * (1 + taxRate / 100));
    const one = buildOne(
      { ...input, lines, total, taxTotal: g.id === selected.id ? input.taxTotal : r2(subtotal * (taxRate / 100)), deposit: input.schedule !== undefined ? tourDeposit(input.schedule, total) : input.deposit },
      g.flooringType || null,
    );
    return { id: g.id, name: g.name, floor: one.floor, total: one.total, per_sqft: one.per_sqft, deposit: one.deposit, room_prices: one.rooms.map((r) => r.price), categories: one.categories, details: one.details };
  });
  const main = buildOne(
    { ...input, lines: input.lines.filter((l) => !l.optionGroupId || l.optionGroupId === selected.id), deposit: input.schedule !== undefined ? tourDeposit(input.schedule, n(input.total)) : input.deposit },
    selected.flooringType || null,
  );
  return { ...main, options, selected_option: selected.id };
}
