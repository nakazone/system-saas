/**
 * Trade Packs, Phase 0: the Hardwood pack must reproduce exactly what the app did before
 * the values moved out of the code. The fingerprints below were taken on main @ 4e33929.
 */
import { createHash } from "crypto";
import { describe, it, expect } from "vitest";
import {
  DEFAULT_TRADE,
  getPack,
  normalizeTrades,
  phaseKeys,
  phaseLabels,
  primaryPack,
  productLine,
  productSentence,
  servicesForTrades,
} from "../src/lib/trades/index.js";
import { DEFAULT_PRICING_SERVICES, seedDefaultPricingServices } from "../src/lib/pricing/default-services.js";
import { groupItemsForPdf } from "../src/lib/quotes/pdf.js";

const sha = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");

const QUOTE_SAMPLE = [
  { name: "Hardwood install", serviceType: "installation", amount: 100 },
  { name: "Sand", serviceType: "sand_finish", amount: 50 },
  { name: "Lixa extra", serviceType: "Lixamento", amount: 5 },
  { name: "Delivery", serviceType: "", amount: 20 },
  { name: "Oak boards", itemType: "product", amount: 300 },
  { name: "Add on stain", serviceType: "add on", amount: 7 },
  { name: "Add-on sealer", serviceType: "finish", amount: 9 },
  { name: "Stairs", serviceType: "", amount: 11 },
];

describe("Hardwood pack reproduces pre-pack behavior", () => {
  it("default service catalog is byte-for-byte the old one (92 services)", () => {
    expect(DEFAULT_PRICING_SERVICES).toHaveLength(92);
    expect(sha(DEFAULT_PRICING_SERVICES)).toBe("26fa9f79e84ddb653d7f79f609e1790c4578744d83fc35bd9c19e7451778353f");
    expect(servicesForTrades(undefined)).toEqual(DEFAULT_PRICING_SERVICES);
    expect(servicesForTrades(["hardwood"])).toEqual(DEFAULT_PRICING_SERVICES);
  });

  it("customer quote sections group lines exactly as before", () => {
    const groups = groupItemsForPdf(QUOTE_SAMPLE as never);
    expect(sha(groups)).toBe("b35655e4425f85669ba5e90bef24d23354b2f702e61c2049342ae8c8350c3d61");
    expect(groups.map((g) => [g.key, g.label, g.items.length])).toEqual([
      ["supply", "SUPPLY", 1],
      ["installation", "INSTALLATION", 3],
      ["sand_finish", "SAND & FINISH", 2],
      ["add_on", "ADD ON", 2],
    ]);
    expect(getPack().quote.tagline).toBe("Hardwood · LVP · Refinishing");
  });

  it("job phases are the old payroll sectors", () => {
    expect(phaseKeys()).toEqual(["installation", "sand_finish", "both"]);
    expect(phaseLabels()).toEqual({ installation: "Instalação", sand_finish: "Lixa" });
  });

  it("Mate keeps describing the product the same way", () => {
    expect(`You are Mate AI, the assistant inside ${productLine()}.`).toBe(
      "You are Mate AI, the assistant inside ObraMate, a CRM for flooring installation companies in the USA.",
    );
    expect(productSentence()).toBe("ObraMate is a CRM for flooring installation companies in the USA.");
  });
});

describe("trade registry", () => {
  it("normalizes an organization's trades", () => {
    expect(DEFAULT_TRADE).toBe("hardwood");
    expect(normalizeTrades(undefined)).toEqual(["hardwood"]);
    expect(normalizeTrades([])).toEqual(["hardwood"]);
    expect(normalizeTrades(["Hardwood", "hardwood", "unknown", 3])).toEqual(["hardwood"]);
    expect(primaryPack(["nope"]).id).toBe("hardwood");
  });

  it("every service prints in a declared quote section or rolls into one", () => {
    const keys = new Set(getPack().quote.sections.map((s) => s.key));
    for (const s of getPack().services) {
      // "custom" lines print under Installation (the PDF's fallback bucket).
      expect(keys.has(s.category === "custom" ? "installation" : s.category)).toBe(true);
    }
  });
});

describe("seedDefaultPricingServices", () => {
  function fakeTx(existing: Array<{ name: string; category: string }> = []) {
    const created: Array<Record<string, unknown>> = [];
    return {
      created,
      tx: {
        pricingItem: {
          count: async () => existing.length,
          findMany: async () => existing,
          createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
            created.push(...data);
            return { count: data.length };
          },
        },
      },
    };
  }

  it("seeds the hardwood catalog by default and when the org runs hardwood", async () => {
    const a = fakeTx();
    const b = fakeTx();
    expect(await seedDefaultPricingServices(a.tx as never, "org-1")).toBe(92);
    expect(await seedDefaultPricingServices(b.tx as never, "org-1", { trades: ["hardwood"] })).toBe(92);
    expect(a.created.map((r) => r.name)).toEqual(b.created.map((r) => r.name));
  });

  it("still skips services the org already has", async () => {
    const first = DEFAULT_PRICING_SERVICES[0]!;
    const t = fakeTx([{ name: first.name.toUpperCase(), category: first.category }]);
    expect(await seedDefaultPricingServices(t.tx as never, "org-1", { trades: ["hardwood"] })).toBe(91);
  });
});

describe("AI wording comes from the pack (delivery 3)", () => {
  it("trade noun is the word every prompt used", async () => {
    expect(getPack().ai.tradeNoun).toBe("flooring");
    const { buildMateVoiceInstructions } = await import("../src/lib/mate-voice/realtime.js");
    const text = buildMateVoiceInstructions(null);
    expect(text).toContain('"businessName":"empresa de flooring"');
    expect(text).toContain("atendente virtual da empresa de flooring identificada");
  });
});

describe("company settings show the trades (read-only)", () => {
  it("serializes trade_packs and ignores them on update", async () => {
    const { serializeOrganizationSettings, organizationSettingsPatchSchema, ORGANIZATION_SETTINGS_SELECT } = await import(
      "../src/lib/settings/organization.js"
    );
    const base = Object.fromEntries(Object.keys(ORGANIZATION_SETTINGS_SELECT).map((k) => [k, null]));
    const row = (tradePacks: string[]) => ({ ...base, updatedAt: new Date(), tradePacks }) as never;
    expect(serializeOrganizationSettings(row(["hardwood"])).trade_packs).toEqual(["hardwood"]);
    expect(serializeOrganizationSettings(row([])).trade_packs).toEqual(["hardwood"]);
    const parsed = organizationSettingsPatchSchema.safeParse({ trade_packs: ["tile"] });
    expect(parsed.success && "trade_packs" in (parsed.data as object)).toBe(false);
  });
});

describe("ObraBuilder takeoff and work order reading come from the pack (delivery 4)", () => {
  it("takeoff catalog is exactly the old one", async () => {
    const T = await import("../src/lib/builders/takeoff.js");
    expect(T.FLOORING_KINDS).toEqual(["hardwood", "lvp", "laminate", "carpet", "rubber"]);
    expect(T.SPEC_FIELDS).toEqual({
      hardwood: ["species", "construction", "width", "thickness", "grade", "finish", "color", "sheen", "install", "pattern", "brand"],
      lvp: ["brand", "color", "size", "thickness", "wear", "install", "underlayment"],
      laminate: ["brand", "color", "size", "thickness", "install", "underlayment"],
      carpet: ["brand", "color", "pad"],
      rubber: ["brand", "color", "thickness"],
      tile: ["brand", "color", "size"],
      stone: ["brand", "color", "size"],
      concrete: ["color"],
      other: ["brand", "color"],
    });
    expect(T.SPEC_LABEL).toEqual({
      species: "Species", construction: "Construction", width: "Width", thickness: "Thickness", grade: "Grade", finish: "Finish", color: "Color / stain",
      sheen: "Sheen", install: "Install", pattern: "Pattern", brand: "Brand / product", size: "Plank size", wear: "Wear layer", underlayment: "Underlayment", pad: "Pad",
    });
    expect(T.DEFAULT_WASTE).toEqual({ hardwood: 10, lvp: 10, laminate: 10, carpet: 12, rubber: 8, tile: 12, stone: 12, concrete: 0, other: 10 });
    // Keys keep the same order (the PDF and the app list them in this order).
    expect(Object.keys(T.SPEC_FIELDS)).toEqual([...T.FLOOR_KINDS]);
    expect(Object.keys(T.DEFAULT_WASTE)).toEqual([...T.FLOOR_KINDS]);
  });

  it("work order reading prompt is byte-for-byte the old one", () => {
    // sha256 of SYSTEM_PROMPT evaluated from src/lib/partner-intake/extract.ts on main @ 2a593d4.
    expect(sha256(getPack().ai.workOrderPrompt)).toBe("ad7f4762d956107cd0ed11a8665a38208b9f2a261ee2a5c1fcac4f9763f824f2");
  });
});

function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}
