/**
 * Tile — the first trade after Hardwood. Pack data, a Tile company's quote PDF sections, what its
 * screens receive, the work order prompt contract, and the job phases API end to end.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { getPack, normalizeTrades, primaryPack, servicesForTrades } from "../src/lib/trades/index.js";
import { tradeInject } from "../src/lib/trades/browser.js";
import { groupItemsForPdf } from "../src/lib/quotes/pdf.js";

const tile = getPack("tile");
const hardwood = getPack("hardwood");
const boot = (trades: unknown) => JSON.parse(tradeInject(trades).replace(/^<script>window\.__OM_TRADE=/, "").replace(/<\/script>$/, ""));

describe("Tile pack", () => {
  it("is selectable by a company and never replaces Hardwood by default", () => {
    expect(normalizeTrades(["tile"])).toEqual(["tile"]);
    expect(primaryPack(["tile"]).id).toBe("tile");
    expect(primaryPack(undefined).id).toBe("hardwood");
    expect(primaryPack([]).id).toBe("hardwood");
  });

  it("catalog: tile services, rates at zero, within the Tabela de Valor groups", () => {
    const names = tile.services.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(["Floor Tile Installation", "Shower Walls Installation", "Shower Niche", "Backsplash Installation", "Metal Edge Profile / Trim"]));
    for (const s of tile.services) expect(["installation", "supply", "custom"]).toContain(s.category);
    expect(new Set(names).size).toBe(names.length);
    // A company with both trades gets both catalogs; Delivery Fee only once.
    const both = servicesForTrades(["hardwood", "tile"]);
    expect(both.length).toBe(hardwood.services.length + tile.services.length - 1);
    expect(both.filter((s) => s.name === "Delivery Fee")).toHaveLength(1);
  });

  it("phases: 7 in the JobPhase table, with cure waits and evidence, labelled in both languages", () => {
    expect(tile.phaseStorage).toBe("table");
    expect(tile.phases.map((p) => p.key)).toEqual(["site_ready", "prep", "waterproofing", "flood_test", "setting", "grout", "seal_clean"]);
    expect(tile.phases.find((p) => p.key === "waterproofing")!.waitAfterHours).toBe(24);
    expect(tile.phases.find((p) => p.key === "flood_test")!.requires!.map((r) => r.key)).toEqual(["flood_result", "water_line_photo"]);
    for (const p of tile.phases) {
      expect(p.label["pt-BR"]).toBeTruthy();
      expect(p.label["en-US"]).toBeTruthy();
      expect(p.doneAtField).toBeUndefined();
    }
  });

  it("quote PDF: a Tile company gets tile sections; Hardwood's grouping is untouched", () => {
    const lines = [
      { name: "Floor Tile Installation", serviceType: "installation", amount: 1000 },
      { name: "Shower Walls Installation", serviceType: "installation", amount: 1500 },
      { name: "Shower Niche", serviceType: "installation", amount: 250 },
      { name: "Tile Demo & Haul Away", serviceType: "custom", amount: 300 },
      { name: "Supply: Tile", serviceType: "supply", amount: 800 },
      { name: "Porcelain 12x24", itemType: "product", amount: 600 },
      { name: "Metal Edge Profile / Trim", serviceType: "installation", amount: 90 },
      { name: "Add on grout sealing", serviceType: "add on", amount: 40 },
    ];
    const g = groupItemsForPdf(lines as never, tile);
    expect(g.map((s) => [s.key, s.label, s.items.map((i) => i.name)])).toEqual([
      ["supply", "SUPPLY", ["Supply: Tile", "Porcelain 12x24"]],
      ["prep", "PREP & DEMO", ["Tile Demo & Haul Away"]],
      ["installation", "INSTALLATION", ["Floor Tile Installation", "Metal Edge Profile / Trim"]],
      ["showers", "SHOWERS", ["Shower Walls Installation", "Shower Niche"]],
      ["add_on", "ADD ON", ["Add on grout sealing"]],
    ]);
    expect(g.reduce((s, x) => s + x.sectionTotal, 0)).toBe(4580);
    expect(tile.quote.tagline).toBe("Tile · Showers · Backsplashes");
    // The name decides before the description: prep stays prep even when it mentions the shower.
    const byName = groupItemsForPdf([
      { name: "Tile Demo & Haul Away", description: "Existing tile floor and shower walls", serviceType: "custom", amount: 490 },
      { name: "Cement Backer Board", description: "Shower walls", serviceType: "custom", amount: 216 },
      { name: "Shower Waterproofing Membrane", description: "Walls and floor", serviceType: "installation", amount: 330 },
      { name: "Floor Tile Installation", description: "Owner's bath floor", serviceType: "installation", amount: 576 },
    ] as never, tile);
    expect(byName.map((s) => [s.key, s.items.map((i) => i.name)])).toEqual([
      ["prep", ["Tile Demo & Haul Away", "Cement Backer Board"]],
      ["installation", ["Floor Tile Installation"]],
      ["showers", ["Shower Waterproofing Membrane"]],
    ]);
    // Hardwood: no word rules, so the original classifier still runs (pinned in trade-packs.test.ts).
    expect(hardwood.quote.match).toBeUndefined();
  });

  it("screens: a Tile company gets its job phases and takeoff, and no payroll sectors", () => {
    const t = boot(["tile"]);
    expect(t.id).toBe("tile");
    expect(t.phases).toBeUndefined();
    expect(t.combined).toBeUndefined();
    expect(t.jobPhases.map((p: { key: string }) => p.key)).toEqual(tile.phases.map((p) => p.key));
    expect(t.takeoff.measuredKinds).toEqual(["tile", "stone"]);
    expect(t.quote.sections.map((s: { key: string }) => s.key)).toEqual(["supply", "prep", "installation", "showers", "add_on"]);
    // Hardwood keeps its sectors (Folha and field app) and also gets jobPhases.
    const h = boot(["hardwood"]);
    expect(h.phases.map((p: { key: string }) => p.key)).toEqual(["installation", "sand_finish"]);
    expect(h.combined).toBe("both");
    expect(h.jobPhases.map((p: { key: string }) => p.key)).toEqual(["installation", "sand_finish"]);
  });

  it("work order prompt asks for the same JSON keys as Hardwood's (same reader)", () => {
    const keys = (p: string) => [...p.matchAll(/^- ([a-z_]+):/gm)].map((m) => m[1]);
    expect(keys(tile.ai.workOrderPrompt)).toEqual(keys(hardwood.ai.workOrderPrompt));
    expect(tile.ai.workOrderPrompt).toContain("tile work orders");
    expect(tile.ai.workOrderPrompt).not.toContain("SITE FINISHED SAND");
  });
});

/* ───────────── job phases API, end to end ───────────── */

const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("Job phases API — a Tile company and a Hardwood company", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const suffix = `tl${Date.now().toString(36)}`;
  const orgs: Record<string, { id: string; email: string; cookie: string; job: string }> = {};

  async function call(who: string, method: string, path: string, body?: unknown) {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { Cookie: orgs[who]!.cookie, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> };
  }

  beforeAll(async () => {
    const { createOrganizationWithAdmin } = await import("../src/modules/organizations/service.js");
    const { DEFAULT_PERMISSIONS } = await import("../src/lib/tenant/defaults.js");
    const { withTenantTransaction } = await import("../src/lib/tenant/prisma-tenant.js");
    const { createApp } = await import("../src/app.js");
    for (const p of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    }
    for (const [who, trades] of [["tile", ["tile"]], ["wood", ["hardwood"]]] as const) {
      const email = `${who}-${suffix}@example.com`;
      const a = await createOrganizationWithAdmin({ organizationName: `${who} ${suffix}`, slug: `${who}-${suffix}`, adminName: "Admin", adminEmail: email, password: "password12345" });
      const id = a.organization.id;
      await prisma.organization.update({ where: { id }, data: { tradePacks: [...trades] } });
      const job = (await withTenantTransaction(id, (tx) => tx.workOrder.create({ data: { organizationId: id, title: "Owner's bath shower", status: "scheduled", sector: who === "wood" ? "both" : null } }))).id;
      orgs[who] = { id, email, cookie: "", job };
    }
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const who of Object.keys(orgs)) {
      const r = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: orgs[who]!.email, password: "password12345", organizationId: orgs[who]!.id }),
        redirect: "manual",
      });
      orgs[who]!.cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    }
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await prisma.organization.deleteMany({ where: { id: { in: Object.values(orgs).map((o) => o.id) } } });
    await prisma.$disconnect();
  });

  it("a Tile company's new company catalog is the tile one", async () => {
    const { withTenantTransaction } = await import("../src/lib/tenant/prisma-tenant.js");
    const { seedDefaultPricingServices } = await import("../src/lib/pricing/default-services.js");
    const id = orgs.tile!.id;
    await withTenantTransaction(id, (tx) => tx.pricingItem.deleteMany({ where: { organizationId: id } }));
    const n = await withTenantTransaction(id, (tx) => seedDefaultPricingServices(tx as never, id, { trades: ["tile"] }));
    expect(n).toBe(tile.services.length);
  });

  it("Tile: phases appear on first read and close with order, evidence and cure waits", async () => {
    const job = orgs.tile!.job;
    const first = await call("tile", "GET", `/api/work-orders/${job}/phases`);
    expect(first.status).toBe(200);
    expect(first.json.data.trade).toBe("tile");
    expect(first.json.data.phases.map((p: any) => [p.key, p.status])).toEqual(tile.phases.map((p) => [p.key, "pending"]));
    expect(first.json.data.phases[0].requires[0]).toMatchObject({ key: "ready_checklist", done: false });

    // Order
    expect((await call("tile", "POST", `/api/work-orders/${job}/phases/prep/complete`)).json.code).toBe("previous_open");
    // Evidence
    const noEv = await call("tile", "POST", `/api/work-orders/${job}/phases/site_ready/complete`);
    expect(noEv.status).toBe(409);
    expect(noEv.json).toMatchObject({ code: "missing_evidence", missing: ["ready_checklist"] });
    expect((await call("tile", "POST", `/api/work-orders/${job}/phases/site_ready/evidence/membrane_photo`, { value: true })).status).toBe(400);
    expect((await call("tile", "POST", `/api/work-orders/${job}/phases/site_ready/evidence/ready_checklist`, { value: { plumbing: true, blocking: true, drain_height: true } })).status).toBe(200);
    const ok = await call("tile", "POST", `/api/work-orders/${job}/phases/site_ready/complete`);
    expect(ok.status).toBe(200);
    expect(ok.json.data.phases[0].status).toBe("done");
    expect(ok.json.data.status).toBe("in_progress");

    // Prep → waterproofing (24 h cure before the flood test)
    await call("tile", "POST", `/api/work-orders/${job}/phases/prep/evidence/flatness`, { value: { per_10ft_in: 0.125 } });
    expect((await call("tile", "POST", `/api/work-orders/${job}/phases/prep/complete`)).status).toBe(200);
    await call("tile", "POST", `/api/work-orders/${job}/phases/waterproofing/evidence/membrane_photo`, { value: "photo" });
    const wp = await call("tile", "POST", `/api/work-orders/${job}/phases/waterproofing/complete`);
    expect(wp.status).toBe(200);
    const flood = wp.json.data.phases.find((p: any) => p.key === "flood_test");
    expect(new Date(flood.ready_at).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);

    await call("tile", "POST", `/api/work-orders/${job}/phases/flood_test/evidence/flood_result`, { value: { depth_in: 2, hours: 24, passed: true } });
    await call("tile", "POST", `/api/work-orders/${job}/phases/flood_test/evidence/water_line_photo`, { value: "photo" });
    const waiting = await call("tile", "POST", `/api/work-orders/${job}/phases/flood_test/complete`);
    expect(waiting.status).toBe(409);
    expect(waiting.json.code).toBe("waiting");
    // The office (admin) may skip the wait.
    expect((await call("tile", "POST", `/api/work-orders/${job}/phases/flood_test/complete`, { force: true })).status).toBe(200);

    // A photo that isn't from this job is refused.
    const strange = await call("tile", "POST", `/api/work-orders/${job}/phases/setting/evidence/coverage_photo`, { media_id: "00000000-0000-4000-8000-000000000000" });
    expect(strange.status).toBe(404);
  });

  it("Hardwood: phases are read from Installation / Sand & Finish and can't be closed here", async () => {
    const job = orgs.wood!.job;
    const r = await call("wood", "GET", `/api/work-orders/${job}/phases`);
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ trade: "hardwood", storage: "columns" });
    expect(r.json.data.phases.map((p: any) => [p.key, p.label, p.status])).toEqual([
      ["installation", "Instalação", "scheduled"],
      ["sand_finish", "Lixa", "pending"],
    ]);
    const c = await call("wood", "POST", `/api/work-orders/${job}/phases/installation/complete`);
    expect(c.status).toBe(409);
    expect(c.json.code).toBe("columns_pack");
    const { withTenantTransaction } = await import("../src/lib/tenant/prisma-tenant.js");
    const rows = await withTenantTransaction(orgs.wood!.id, (tx) => tx.jobPhase.count({ where: { workOrderId: job } }));
    expect(rows).toBe(0);
  });

  it("one company cannot reach the other's job phases", async () => {
    const r = await call("wood", "GET", `/api/work-orders/${orgs.tile!.job}/phases`);
    expect(r.status).toBe(404);
    const w = await call("wood", "POST", `/api/work-orders/${orgs.tile!.job}/phases/setting/complete`);
    expect(w.status).toBe(404);
  });
});
