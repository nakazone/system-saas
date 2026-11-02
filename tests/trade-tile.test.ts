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

describe("Tile quote on screen groups lines like the PDF (delivery 2)", () => {
  const LINES = [
    { name: "Floor Tile Installation", serviceType: "installation", description: "Owner's bath floor", amount: 576 },
    { name: "Shower Walls Installation", serviceType: "installation", description: "To the ceiling", amount: 1248 },
    { name: "Shower Niche", serviceType: "installation", description: "12x24", amount: 250 },
    { name: "Tile Demo & Haul Away", serviceType: "custom", description: "Existing tile floor and shower walls", amount: 490 },
    { name: "Cement Backer Board", serviceType: "custom", description: "Shower walls", amount: 216 },
    { name: "Supply: Tile", serviceType: "supply", description: "Porcelain", amount: 630 },
    { name: "Porcelain 12x24", itemType: "product", serviceType: "", description: "", amount: 600 },
    { name: "Metal Edge Profile / Trim", serviceType: "installation", description: "Brushed nickel", amount: 216 },
    { name: "Add on grout sealing", serviceType: "add on", description: "", amount: 40 },
  ];
  const pdfKeys = (pack: typeof tile) => {
    const out: Record<string, string> = {};
    for (const g of groupItemsForPdf(LINES as never, pack)) for (const it of g.items) out[it.name!] = g.key;
    return out;
  };
  async function loadPaper(win: Record<string, unknown>, src?: string) {
    const fs = await import("node:fs");
    const code = src ?? fs.readFileSync("crm/public/quote-paper.js", "utf8");
    new Function("window", code)(win);
    return (win as { OmQuotePaper: { SECTIONS: { key: string; label: string }[]; sectionOf: (...a: unknown[]) => string } }).OmQuotePaper;
  }

  it("quotes / builder screen (quote-paper.js): Tile sections and the PDF's line sorting", async () => {
    const paper = await loadPaper({ __OM_TRADE: boot(["tile"]) });
    expect(paper.SECTIONS.map((s) => [s.key, s.label])).toEqual(tile.quote.sections.map((s) => [s.key, s.label]));
    const screen = Object.fromEntries(LINES.map((l) => [l.name, paper.sectionOf(l.itemType, l.serviceType, l.name, l.description)]));
    expect(screen).toEqual(pdfKeys(tile));
  });

  it("quotes / builder screen: Hardwood sorts exactly like the version on main", async () => {
    const { execSync } = await import("node:child_process");
    const before = execSync("git show origin/main:crm/public/quote-paper.js", { encoding: "utf8" });
    const oldPaper = await loadPaper({}, before);
    const newPaper = await loadPaper({ __OM_TRADE: boot(["hardwood"]) });
    const wood = [
      ...LINES,
      { name: "Sand & finish (3 coats)", serviceType: "Sand & Finishing", description: "", amount: 1 },
      { name: "Lixa extra", serviceType: "Lixamento", description: "", amount: 1 },
      { name: "Add-on stain", serviceType: "finish", description: "", amount: 1 },
      { name: "Delivery Fee", serviceType: "", description: "", amount: 1 },
    ];
    for (const l of wood) {
      expect(newPaper.sectionOf(l.itemType, l.serviceType, l.name, l.description), l.name).toBe(oldPaper.sectionOf(l.itemType, l.serviceType, l.name));
    }
    expect(newPaper.SECTIONS.map((s) => s.key)).toEqual(oldPaper.SECTIONS.map((s) => s.key));
  });

  it("customer page (quote-public.js): Tile sections and the PDF's line sorting", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("crm/public/quote-public.js", "utf8");
    // Two pieces of the page: the sections (with the pack's relabeling) and the line grouping.
    const a0 = src.indexOf("  const COMPANY = {");
    const a1 = src.indexOf("\n  const money = ", a0);
    const b0 = src.indexOf("  /** Same section logic / order as the PDF");
    const b1 = src.indexOf("  function isClientSigned(q)");
    expect(Math.min(a0, a1, b0, b1)).toBeGreaterThan(0);
    const code = `${src.slice(a0, a1)}\n${src.slice(b0, b1)}`;
    const fn = new Function("window", "location", "document", `${code}\nreturn { groupItems, SECTION_DEFS, COMPANY };`);
    const run = (win: Record<string, unknown>) => fn(win, { pathname: "/", search: "", origin: "http://x" }, { getElementById: () => null, querySelector: () => null });
    const items = LINES.map((l) => ({ name: l.name, service_type: l.serviceType, item_type: l.itemType, description: l.description, amount: l.amount }));
    const t = run({ __OM_TRADE: boot(["tile"]) });
    const groups = t.groupItems(items) as { label: string; items: { name: string }[] }[];
    const byLabel = Object.fromEntries(tile.quote.sections.map((s) => [s.label, s.key]));
    const screen: Record<string, string> = {};
    for (const g of groups) for (const it of g.items) screen[it.name] = byLabel[g.label]!;
    expect(screen).toEqual(pdfKeys(tile));
    expect(t.COMPANY.tagline).toBe("Tile · Showers · Backsplashes");
    // Hardwood: no rules sent, so the page keeps its own sections.
    const h = run({ __OM_TRADE: boot(["hardwood"]) });
    expect(h.SECTION_DEFS.map((d: { key: string }) => d.key)).toEqual(["supply", "installation", "sand_finish", "add_on"]);
  });

  it("default “what's included”: Tile has its own list, Hardwood keeps the old one", async () => {
    const { DEFAULT_QUOTE_INCLUSIONS } = await import("../src/lib/quotes/client-document.js");
    expect(hardwood.quote.inclusions).toEqual(DEFAULT_QUOTE_INCLUSIONS);
    expect(tile.quote.inclusions.join(" ")).not.toMatch(/hardwood|sanding/i);
    expect(tile.quote.inclusions.join(" ")).toMatch(/flood test/i);
  });
});

describe("customer quote page rendered by the server (quotes/public.ejs)", () => {
  async function render(file: string, locals: Record<string, unknown>) {
    const { createRequire } = await import("node:module");
    const ejs = createRequire(import.meta.url)("ejs") as { renderFile: (f: string, d: object) => Promise<string> };
    return ejs.renderFile(file, locals);
  }
  const quote = {
    title: "Owner's bath", number: 42, status: "sent", total: 1316, subtotal: 1316, taxTotal: 0, discountTotal: 0, serviceType: "",
    lineItems: [
      { name: "Tile Demo & Haul Away", description: "Existing tile floor and shower walls", amount: 490, quantity: 140, unit: "sq ft", unitPrice: 3.5, meta: { service_type: "custom" } },
      { name: "Shower Niche", description: "12x24", amount: 250, quantity: 1, unit: "unit", unitPrice: 250, meta: { service_type: "installation" } },
      { name: "Floor Tile Installation", description: "", amount: 576, quantity: 64, unit: "sq ft", unitPrice: 9, meta: { service_type: "installation" } },
      { name: "Sand & finish", description: "", amount: 100, quantity: 1, unit: "fixed", unitPrice: 100, meta: { service_type: "sand_finish" } },
    ],
    customer: { name: "Jane" }, property: null, paymentSchedule: null, organization: { name: "Peak Line" },
  };
  const base = {
    tour: null, title: "x", organization: { name: "Peak Line" }, organizationAddress: null, organizationLicense: null, organizationWebsite: null,
    ownerSignature: null, quote, token: "t", clientView: { showQuantities: true, showUnitPrices: true, showLineTotals: true }, readOnly: false,
  };
  const titles = (html: string) => [...html.matchAll(/class="qp-section-title"[^>]*>([^<]+)</g)].map((m) => m[1]!.trim());

  it("a Tile company's page uses the Tile sections and inclusions", async () => {
    const t = tile.quote;
    const html = await render("src/views/quotes/public.ejs", {
      ...base,
      inclusions: [...t.inclusions],
      quoteRules: { sections: t.sections, match: t.match, fallback: t.fallbackSection },
    });
    expect(titles(html)).toEqual(["PREP &amp; DEMO", "INSTALLATION", "SHOWERS", "Optional add-ons"]);
    expect(html).toContain("Waterproofing and flood test before tile");
  });

  it("a Hardwood company's page is byte-for-byte what main renders", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { execSync } = await import("node:child_process");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ejs-main-"));
    const oldFile = path.join(dir, "public.ejs");
    fs.writeFileSync(oldFile, execSync("git show origin/main:src/views/quotes/public.ejs", { encoding: "utf8" }));
    for (const p of execSync("git ls-tree --name-only origin/main src/views/quotes/", { encoding: "utf8" }).split("\n").filter((f) => f.endsWith(".ejs"))) {
      fs.writeFileSync(path.join(dir, path.basename(p)), execSync(`git show origin/main:${p}`, { encoding: "utf8" }));
    }
    const locals = { ...base, inclusions: [...hardwood.quote.inclusions], quoteRules: null };
    const now = await render("src/views/quotes/public.ejs", locals);
    const before = await render(oldFile, locals);
    expect(titles(now)).toEqual(["INSTALLATION", "SAND &amp; FINISH", "Optional add-ons"]);
    expect(now).toBe(before);
  });
});

describe("Mate describes the product by the company's trade", () => {
  it("agent and interpreter prompts", async () => {
    const { buildAgentPrompt } = await import("../src/lib/mate-ai/agent.js");
    const { buildInterpretSystemPrompt } = await import("../src/lib/mate-ai/interpret.js");
    const base = { actions: [], catalog: [], today: "2026-11-02", weekday: "Monday", timezone: "America/Denver", screen: null, memory: [] };
    expect(buildAgentPrompt({ ...base, trades: ["tile"] })).toContain("ObraMate, a CRM for tile installation companies in the USA");
    expect(buildAgentPrompt(base)).toContain("ObraMate, a CRM for flooring installation companies in the USA");
    expect(buildAgentPrompt(base)).toBe(buildAgentPrompt({ ...base, trades: ["hardwood"] }));
    const persona = { name: "Marina", title: "Gerente financeira", department: "Financeiro", company: "Peak Line Tile", colleagues: [], desk: [] } as never;
    expect(buildAgentPrompt({ ...base, persona, trades: ["tile"] })).toContain("ObraMate is a CRM for tile installation companies in the USA.");
    const ip = { today: "2026-11-02", weekday: "Monday", timezone: "America/Denver", refs: [] };
    expect(buildInterpretSystemPrompt({ ...ip, trades: ["tile"] })).toContain("CRM for tile installation companies");
    expect(buildInterpretSystemPrompt(ip)).toBe(buildInterpretSystemPrompt({ ...ip, trades: ["hardwood"] }));
  });
});
