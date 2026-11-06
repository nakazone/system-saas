/**
 * Countertops in the ObraBuilder measurement: the builder measures tops in the portal, the
 * summary, counts and PDF carry them, and a measurement with only tops can be completed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { counts, measurementPdf, parseData, summarize } from "../src/lib/builders/measurements.js";
import { builderMeasureTabs, tradeInject } from "../src/lib/trades/browser.js";
import { topsQuantities } from "../src/lib/trades/packs/countertops/tops.js";

const tops = {
  spec: { level: 3, material: "Quartz", color: "Calacatta", thickness: "3 cm", splash: "4in" },
  pieces: [
    { id: "a", kind: "run", name: "Sink wall", length: 120, depth: 25.5, sink: "undermount", faucet_holes: 1 },
    { id: "b", kind: "island", length: 96, depth: 42, overhang: 12, waterfall: { left: true } },
  ],
};

function boot(trades: string[]) {
  const tag = tradeInject(trades);
  return JSON.parse(tag.replace(/^[\s\S]*?__OM_TRADE\s*=\s*/, "").replace(/;?\s*<\/script>[\s\S]*$/, ""));
}

describe("countertops in the ObraBuilder measurement", () => {
  it("keeps tops through parsing and counts them", () => {
    const data = parseData({ tops, stairs: [], vents: [] });
    expect(data.tops?.pieces).toHaveLength(2);
    const c = counts(data);
    expect(c.tops).toBe(2);
    expect(c.tops_sf).toBe(topsQuantities(data.tops!).sf);
    expect(c.stairs).toBe(0);
  });

  it("drops empty tops, so a hardwood measurement reads as before", () => {
    expect(parseData({ tops: { spec: {}, pieces: [] } }).tops).toBeNull();
    expect(parseData({ stairs: [], vents: [] }).tops).toBeNull();
    expect(counts(parseData({})).tops).toBe(0);
  });

  it("lists one line per piece, then edge, splash and cutouts, with no prices", () => {
    const lines = summarize(parseData({ tops })).filter((l) => l.kind === "top");
    expect(lines[0].text).toContain("Sink wall");
    expect(lines[0].uom).toBe("SF");
    expect(lines.some((l) => /edge/i.test(l.text) && l.uom === "LF")).toBe(true);
    expect(lines.some((l) => /sink/i.test(l.text))).toBe(true);
    expect(lines.some((l) => /waterfall/i.test(l.text))).toBe(true);
    expect(JSON.stringify(lines)).not.toMatch(/\$/);
  });

  it("builds the PDF with a countertops section", async () => {
    const pdf = await measurementPdf({ builder: "Acme Homes", address: "12 Elm St", community: null, lot: null, notes: null, data: parseData({ tops }), measuredBy: "Sam", measuredAt: new Date("2026-11-05") });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("shows the Countertops tab to builders of a countertops company", () => {
    expect(boot(["countertops"]).measureTabs).toEqual(["countertops", "floors", "summary"]);
    expect(builderMeasureTabs([["countertops"]])).toEqual(["countertops", "floors", "summary"]);
    expect(builderMeasureTabs([["hardwood"], ["countertops"]])).toEqual(["stairs", "vents", "countertops", "floors", "summary"]);
  });
});

describe("the portal uses the same countertop quantities as the server", () => {
  it("runs countertop-builder.js on the same tops", () => {
    const win: Record<string, any> = {};
    new Function("window", "document", readFileSync("crm/public/countertop-builder.js", "utf8"))(win, {});
    const q = win.ObTops.quantities(tops);
    const s = topsQuantities(parseData({ tops }).tops!);
    expect(q.sf).toBe(s.sf);
    expect(q.edge_lf).toBe(s.edge_lf);
    expect(q.slabs).toBe(s.slabs);
  });

  it("wires the Countertops tab into the portal", () => {
    const js = readFileSync("crm/public/partner-portal.js", "utf8");
    const html = readFileSync("crm/public/partner-portal.html", "utf8");
    expect(js).toContain("window.ObTops.html(m)");
    expect(js).toContain("window.ObTops.bind(view, m");
    expect(html).toMatch(/countertop-builder\.js\?v=/);
  });
});
