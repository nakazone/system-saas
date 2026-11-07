import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { gateAskState, setBuilderGate, shouldAskBuilder } from "../src/lib/trades/builder-gate.js";
import { getPack } from "../src/lib/trades/index.js";
import { ensureJobPhases } from "../src/lib/trades/job-phases-db.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { diffJob, sweepAccount } from "../src/lib/builders/notifications.js";

const d = (s: string) => new Date(s);
const base = { status: "scheduled", scheduledStart: d("2026-11-02T15:00:00Z"), photos: 0, reports: 0 };

describe("builder job watcher", () => {
  it("says nothing the first time it sees a job", () => {
    expect(diffJob(null, base)).toEqual([]);
  });
  it("notices a new date, a change of date, the crew on site and photos", () => {
    expect(diffJob({ ...base, scheduledStart: null, status: "draft" }, base)).toEqual(["scheduled"]);
    expect(diffJob(base, { ...base, scheduledStart: d("2026-11-03T15:00:00Z") })).toEqual(["rescheduled"]);
    expect(diffJob(base, { ...base, status: "in_progress" })).toEqual(["started"]);
    expect(diffJob(base, { ...base, photos: 3 })).toEqual(["photos"]);
  });
  it("reports completion once, not a reschedule after it", () => {
    expect(diffJob({ ...base, status: "in_progress" }, { ...base, status: "completed", photos: 2 })).toEqual(["completed", "photos"]);
    expect(diffJob({ ...base, status: "completed" }, { ...base, status: "needs_invoicing" })).toEqual([]);
  });
});

// ── The site check the builder owes (Countertops: kitchen ready for template) ──

const tops = getPack("countertops");
const tile = getPack("tile");
const prow = (phaseKey: string, sortOrder: number, status = "pending", evidence: unknown = {}) => ({ phaseKey, sortOrder, status, evidence });
const okEv = { ready_checklist: { at: "2026-11-06T15:00:00Z", by: "Dana · Acme", value: { source: "builder" } } };

describe("asking the builder to confirm the site", () => {
  it("asks only when the builder's step is the job's open phase", () => {
    // slab still being chosen: not yet
    expect(gateAskState(tops, tops.phases.map((p, i) => prow(p.key, i)))).toBe("idle");
    expect(gateAskState(tops, tops.phases.map((p, i) => prow(p.key, i, i === 0 ? "done" : "pending")))).toBe("ask");
    expect(gateAskState(tops, tops.phases.map((p, i) => prow(p.key, i, i === 0 ? "done" : "pending", p.key === "site_ready" ? okEv : {})))).toBe("confirmed");
    expect(gateAskState(tops, tops.phases.map((p, i) => prow(p.key, i, i <= 1 ? "done" : "pending")))).toBe("done");
    // a Tile job nobody opened yet: its first phase is the site check
    expect(gateAskState(tile, [])).toBe("ask");
    expect(gateAskState(tops, [])).toBe("idle");
    expect(gateAskState(getPack("hardwood"), [])).toBeNull();
  });

  it("tells once, on the way in, and not after a confirmation is taken back", () => {
    expect(shouldAskBuilder("idle", "ask", false)).toBe(true);
    expect(shouldAskBuilder("ask", "ask", false)).toBe(false);
    expect(shouldAskBuilder("confirmed", "ask", false)).toBe(false);
    expect(shouldAskBuilder(null, "ask", true)).toBe(true);
    // jobs that were already waiting before the watcher knew them
    expect(shouldAskBuilder(null, "ask", false)).toBe(false);
    expect(shouldAskBuilder("idle", "confirmed", false)).toBe(false);
  });

  it("marks the jobs waiting on the builder in the ObraBuilder list", () => {
    const route = readFileSync("src/crm/routes/partner-portal.ts", "utf8");
    expect(route).toMatch(/needs_confirm: asks\.has\(job\.id\)/);
    const js = readFileSync("crm/public/partner-portal.js", "utf8");
    expect(js).toMatch(/pp-jstat--ask[^`]*Confirm site/);
    expect(js).toMatch(/confirm: 'check'/);
  });
});

const dbOk = await (async () => {
  const p = new PrismaClient();
  try { await p.$queryRaw`select 1`; return true; } catch { return false; } finally { await p.$disconnect(); }
})();

describe.skipIf(!dbOk)("the watcher asks the builder for the site check", () => {
  const prisma = new PrismaClient();
  const suffix = `ga${Date.now().toString(36)}`;
  let org = "";
  let account = "";
  let job = "";

  beforeAll(async () => {
    const a = await createOrganizationWithAdmin({ organizationName: `Ask ${suffix}`, slug: `ask-${suffix}`, adminName: "Admin", adminEmail: `adm-${suffix}@example.com`, password: "password12345" });
    org = a.organization.id;
    await prisma.organization.update({ where: { id: org }, data: { tradePacks: ["countertops"] } });
    const acct = await prisma.builderAccount.create({ data: { name: "Acme Homes" } });
    account = acct.id;
    job = await withTenantTransaction(org, async (tx) => {
      const b = await tx.builder.create({ data: { organizationId: org, firstName: "Acme", company: "Acme Homes" } });
      await prisma.builderLink.create({ data: { builderAccountId: account, organizationId: org, tenantBuilderId: b.id, status: "active", companyName: "Summit Tops" } });
      const wo = await tx.workOrder.create({ data: { organizationId: org, number: 12, title: "Kitchen tops", status: "scheduled", builderId: b.id, address: "12 Sunset Ridge" } });
      await ensureJobPhases(tx, org, wo.id, tops);
      return wo.id;
    });
  });
  afterAll(async () => {
    await prisma.builderAccount.delete({ where: { id: account } }).catch(() => undefined);
    await prisma.organization.delete({ where: { id: org } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  const asks = () => prisma.builderNotification.count({ where: { builderAccountId: account, kind: "confirm" } });
  const setPhase = (key: string, status: string) =>
    withTenantTransaction(org, (tx) => tx.jobPhase.updateMany({ where: { workOrderId: job, phaseKey: key }, data: { status } }));

  it("waits while the slab is chosen, then asks once when the kitchen is next", async () => {
    await sweepAccount(account);
    expect(await asks()).toBe(0);
    await setPhase("selection", "done");
    await sweepAccount(account);
    expect(await asks()).toBe(1);
    const n = await prisma.builderNotification.findFirst({ where: { builderAccountId: account, kind: "confirm" } });
    expect(n!.title).toBe("Ready for template? · Kitchen tops (#12)");
    expect(n!.body).toMatch(/^Summit Tops asks you to confirm before they go out: Cabinets set and level/);
    expect(n!.url).toBe(`#jobs/${job}`);
    await sweepAccount(account);
    expect(await asks()).toBe(1);
  });

  it("does not ask again after the builder confirms and takes it back", async () => {
    await withTenantTransaction(org, (tx) => setBuilderGate(tx, tops, job, true, { name: "Dana", company: "Acme Homes" }));
    await sweepAccount(account);
    await withTenantTransaction(org, (tx) => setBuilderGate(tx, tops, job, false, { name: "Dana", company: "Acme Homes" }));
    await sweepAccount(account);
    expect(await asks()).toBe(1);
  });
});
