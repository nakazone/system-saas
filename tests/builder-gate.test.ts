/**
 * The builder confirms on site that the kitchen is ready for template. The confirmation is the
 * evidence of the company's "Ready for template" phase, so the office closes it right away; the
 * builder can take back only their own confirmation, and never after the phase is closed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { builderGateView, builderPhaseSteps, setBuilderGate } from "../src/lib/trades/builder-gate.js";
import { getPack } from "../src/lib/trades/index.js";
import { closeJobPhase, ensureJobPhases, listJobPhases } from "../src/lib/trades/job-phases-db.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";

const tops = getPack("countertops");
const tile = getPack("tile");
const row = (phaseKey: string, sortOrder: number, status = "pending", evidence: unknown = {}) => ({ phaseKey, sortOrder, status, evidence });

describe("what the builder sees of the phases", () => {
  it("lists the phases with done, next up and after", () => {
    const rows = tops.phases.map((p, i) => row(p.key, i, i === 0 ? "done" : "pending"));
    const steps = builderPhaseSteps(tops, rows);
    expect(steps).toHaveLength(tops.phases.length);
    expect(steps[0]).toMatchObject({ key: "selection", status: "done" });
    expect(steps[1]).toMatchObject({ key: "site_ready", status: "current", label: "Ready for template" });
    expect(steps[2]!.status).toBe("next");
  });

  it("asks the builder until someone confirms, then shows who did", () => {
    const ask = builderGateView(tops, [row("selection", 0, "done"), row("site_ready", 1)]);
    expect(ask).toMatchObject({ phase: "site_ready", confirmed: null, phase_done: false, can_undo: false });
    expect(ask!.question).toMatch(/Cabinets set and level/);
    const by = builderGateView(tops, [row("site_ready", 1, "pending", { ready_checklist: { at: "2026-11-06T15:00:00Z", by: "Dana · Acme Homes", value: { source: "builder" } } })]);
    expect(by!.confirmed).toMatchObject({ by: "Dana · Acme Homes", by_builder: true });
    expect(by!.can_undo).toBe(true);
    // the company's own check is not the builder's to take back
    const office = builderGateView(tops, [row("site_ready", 1, "pending", { ready_checklist: { at: "2026-11-06T15:00:00Z", by: "Office" } })]);
    expect(office!.can_undo).toBe(false);
  });

  it("asks Tile builders about plumbing and blocking before the crew goes out", () => {
    const g = builderGateView(tile, tile.phases.map((p, i) => row(p.key, i)));
    expect(g).toMatchObject({ phase: "site_ready", title: "Ready for tile", confirmed: null });
    expect(g!.question).toMatch(/Plumbing roughed in/);
  });

  it("has nothing to confirm for hardwood", () => {
    expect(builderGateView(getPack("hardwood"), [])).toBeNull();
    expect(builderPhaseSteps(getPack("hardwood"), [])).toEqual([]);
  });

  it("is wired into the job page and its route", () => {
    const js = readFileSync("crm/public/partner-portal.js", "utf8");
    const route = readFileSync("src/crm/routes/partner-portal.ts", "utf8");
    expect(js).toContain("/gate`");
    expect(js).toContain("function jobProgressHtml");
    expect(route).toContain('"/api/partner-portal/jobs/:id/gate"');
    expect(route).toMatch(/if \(!req\.builderMember \|\| !canConfirmGate\(req\)\)/);
  });
});

const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("confirming on a countertops job", () => {
  const prisma = new PrismaClient();
  const suffix = `bg${Date.now().toString(36)}`;
  let org = "";
  let job = "";
  const who = { name: "Dana Reyes", company: "Acme Homes" };

  beforeAll(async () => {
    const a = await createOrganizationWithAdmin({ organizationName: `Gate ${suffix}`, slug: `gate-${suffix}`, adminName: "Admin", adminEmail: `adm-${suffix}@example.com`, password: "password12345" });
    org = a.organization.id;
    await prisma.organization.update({ where: { id: org }, data: { tradePacks: ["countertops"] } });
    job = await withTenantTransaction(org, async (tx) => {
      const wo = await tx.workOrder.create({ data: { organizationId: org, number: 7, title: "Kitchen tops", status: "scheduled" } });
      await ensureJobPhases(tx, org, wo.id, tops);
      return wo.id;
    });
  });
  afterAll(async () => {
    await prisma.organization.delete({ where: { id: org } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("records the builder's confirmation as the phase's evidence, once", async () => {
    const r = await withTenantTransaction(org, (tx) => setBuilderGate(tx, tops, job, true, who));
    expect(r.ok && r.changed).toBe(true);
    const again = await withTenantTransaction(org, (tx) => setBuilderGate(tx, tops, job, true, who));
    expect(again.ok && again.changed).toBe(false);
    const rows = await withTenantTransaction(org, (tx) => listJobPhases(tx, job));
    const ev = rows.find((x) => x.phaseKey === "site_ready")!.evidence as Record<string, any>;
    expect(ev.ready_checklist).toMatchObject({ by: "Dana Reyes · Acme Homes", value: { source: "builder" } });
  });

  it("can be taken back while the phase is open", async () => {
    const r = await withTenantTransaction(org, (tx) => setBuilderGate(tx, tops, job, false, who));
    expect(r.ok && r.view.confirmed).toBeNull();
    await withTenantTransaction(org, (tx) => setBuilderGate(tx, tops, job, true, who));
  });

  it("lets the office close the phase with it, and then it is locked", async () => {
    const closed = await withTenantTransaction(org, async (tx) => {
      await tx.jobPhase.update({ where: { workOrderId_phaseKey: { workOrderId: job, phaseKey: "selection" } }, data: { status: "done", doneAt: new Date() } });
      return closeJobPhase(tx, tops, job, "site_ready", { by: { name: "Office" } });
    });
    expect(closed).toMatchObject({ ok: true });
    const undo = await withTenantTransaction(org, (tx) => setBuilderGate(tx, tops, job, false, who));
    expect(undo).toEqual({ ok: false, error: "phase_done" });
  });

  it("does not take back the company's own check", async () => {
    const other = await withTenantTransaction(org, async (tx) => {
      const wo = await tx.workOrder.create({ data: { organizationId: org, number: 8, title: "Vanity", status: "scheduled" } });
      await ensureJobPhases(tx, org, wo.id, tops);
      await tx.jobPhase.update({ where: { workOrderId_phaseKey: { workOrderId: wo.id, phaseKey: "site_ready" } }, data: { evidence: { ready_checklist: { at: new Date().toISOString(), by: "Office" } } } });
      return wo.id;
    });
    const r = await withTenantTransaction(org, (tx) => setBuilderGate(tx, tops, other, false, who));
    expect(r).toEqual({ ok: false, error: "not_yours" });
  });
});
