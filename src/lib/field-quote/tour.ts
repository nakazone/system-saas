/**
 * Client tour of a proposal made from a Field Quote: the animated walk-through the
 * homeowner sees (in person on the tablet, or on the public quote link).
 *
 * Built from the visit data (rooms, services, material) plus the quote's real line items,
 * so every number on screen is the quote's number. Client-facing text is in English.
 */

type Num = number | string | { toString(): string } | null | undefined;

export type TourLine = {
  name: string | null;
  description?: string | null;
  quantity: Num;
  unit: string | null;
  amount: Num;
  itemType?: string | null;
  meta?: unknown;
};

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
  stairs: number;
  trim: boolean;
  transitions: number;
  details: Array<{ label: string; value: string }>;
  categories: Array<{ label: string; amount: number }>;
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

function category(l: TourLine): string {
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

export function buildFieldQuoteTour(input: TourInput): Tour {
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

  // Spread each line over the rooms it belongs to, so each room can show its share.
  const lines = input.lines.filter((l) => n(l.amount) !== 0);
  for (const l of lines) {
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
    .filter((l) => ["Stairs", "Trim & transitions", "Subfloor prep", "Furniture moving", "Other work", "Haul away"].includes(category(l)))
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
  const matId = String(inst.material || "lvp");
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
    stairs: stairsLine ? Math.round(n(stairsLine.quantity)) : 0,
    trim: lines.some((l) => /quarter round|baseboard|trim/i.test(String(l.name || ""))),
    transitions: transitionsLine ? Math.round(n(transitionsLine.quantity)) : 0,
    details,
    categories,
  };
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
