/**
 * Job phases for every trade: Hardwood read from its WorkOrder columns (unchanged), and a
 * tile-like test pack stored in JobPhase rows with order, cure waits and required evidence.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { getPack } from "../src/lib/trades/index.js";
import type { TradePack } from "../src/lib/trades/types.js";
import { completePhase, planJobPhases, readJobPhases, recordEvidence, type JobPhaseRow } from "../src/lib/trades/job-phases.js";
import { sectorFinishPatch } from "../src/lib/work-orders/sector-finish.js";

const hardwood = getPack("hardwood");

/** A pack shaped like the future Tile pack, used only here. */
const tileLike: TradePack = {
  ...hardwood,
  id: "hardwood", // only the registry knows real ids; the rules don't care
  phaseStorage: "table",
  combinedPhaseKey: "all",
  phases: [
    { key: "prep", label: { "pt-BR": "Preparo", "en-US": "Prep" } },
    {
      key: "waterproofing",
      label: { "pt-BR": "Impermeabilização", "en-US": "Waterproofing" },
      waitAfterHours: 24,
      requires: [{ key: "membrane_photo", kind: "photo", label: { "pt-BR": "Foto da manta", "en-US": "Membrane photo" } }],
    },
    {
      key: "flood_test",
      label: { "pt-BR": "Teste de estanqueidade", "en-US": "Flood test" },
      requires: [
        { key: "flood_result", kind: "test", label: { "pt-BR": "Resultado do teste", "en-US": "Test result" } },
        { key: "water_line_photo", kind: "photo", label: { "pt-BR": "Foto da marca d'água", "en-US": "Water line photo" } },
      ],
    },
    { key: "setting", label: { "pt-BR": "Assentamento", "en-US": "Setting" }, waitAfterHours: 24 },
    { key: "grout", label: { "pt-BR": "Rejunte", "en-US": "Grout" } },
  ],
};

const T0 = new Date("2026-11-02T15:00:00Z");
const h = (n: number) => new Date(T0.getTime() + n * 3600_000);

function rowsFrom(pack: TradePack): JobPhaseRow[] {
  return planJobPhases(pack).map((p) => ({ ...p, evidence: {} }));
}
function apply(rows: JobPhaseRow[], r: ReturnType<typeof completePhase>) {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  const at = rows.find((x) => x.phaseKey === r.phase.phaseKey)!;
  at.status = "done";
  at.doneAt = r.phase.doneAt;
  if (r.next) rows.find((x) => x.phaseKey === r.next!.phaseKey)!.readyAt = r.next.readyAt;
}

describe("Hardwood phases are read from the WorkOrder columns, as today", () => {
  it("has no JobPhase rows to create", () => {
    expect(hardwood.phaseStorage).toBe("columns");
    expect(planJobPhases(hardwood)).toEqual([]);
  });

  it("a combined job walks Installation → Sand & Finish exactly as sectorFinishPatch closes it", () => {
    let job = { sector: "both", status: "scheduled", scheduledStart: h(0), sandScheduledStart: h(48), installationDoneAt: null as Date | null, sandDoneAt: null as Date | null };
    let view = readJobPhases(hardwood, job);
    expect(view.map((v) => [v.key, v.label, v.status])).toEqual([
      ["installation", "Instalação", "scheduled"],
      ["sand_finish", "Lixa", "scheduled"],
    ]);
    expect(view[1]!.scheduledStart).toEqual(h(48));

    // First "completed" save closes Installation only.
    job = { ...job, ...sectorFinishPatch(job, "completed", h(10)) } as typeof job;
    view = readJobPhases(hardwood, job);
    expect(view.map((v) => v.status)).toEqual(["done", "in_progress"]);
    expect(view[0]!.doneAt).toEqual(h(10));

    // Second closes Sand & Finish and the job.
    job = { ...job, ...sectorFinishPatch(job, "completed", h(60)) } as typeof job;
    expect(job.status).toBe("completed");
    expect(readJobPhases(hardwood, job).map((v) => v.status)).toEqual(["done", "done"]);
  });

  it("a single-sector job shows just that phase", () => {
    expect(readJobPhases(hardwood, { sector: "sand_finish", status: "in_progress" }).map((v) => [v.key, v.status])).toEqual([["sand_finish", "in_progress"]]);
    expect(readJobPhases(hardwood, { sector: "installation", status: "completed" }).map((v) => [v.key, v.status])).toEqual([["installation", "done"]]);
    // No sector: the first phase, like sectorKey() does in payroll.
    expect(readJobPhases(hardwood, { sector: null, status: "draft" }).map((v) => [v.key, v.status])).toEqual([["installation", "pending"]]);
  });
});

describe("Table phases: order, cure waits and evidence (tile-like pack)", () => {
  it("plans one row per phase in order", () => {
    expect(planJobPhases(tileLike).map((p) => [p.phaseKey, p.sortOrder, p.status])).toEqual([
      ["prep", 0, "pending"],
      ["waterproofing", 1, "pending"],
      ["flood_test", 2, "pending"],
      ["setting", 3, "pending"],
      ["grout", 4, "pending"],
    ]);
  });

  it("walks the whole job with every rule enforced", () => {
    const rows = rowsFrom(tileLike);

    // Order: cannot set tile before the flood test.
    expect(completePhase(tileLike, rows, "setting", { now: h(0) })).toEqual({ ok: false, error: "previous_open", phase: "prep" });

    apply(rows, completePhase(tileLike, rows, "prep", { now: h(1) }));

    // Evidence: waterproofing needs the membrane photo.
    expect(completePhase(tileLike, rows, "waterproofing", { now: h(2) })).toEqual({ ok: false, error: "missing_evidence", missing: ["membrane_photo"] });
    const ev = recordEvidence(tileLike, "waterproofing", rows[1]!.evidence, "membrane_photo", { at: h(2).toISOString(), mediaId: "m1" });
    expect(ev.ok).toBe(true);
    rows[1]!.evidence = ev.ok ? ev.evidence : {};
    const wp = completePhase(tileLike, rows, "waterproofing", { now: h(2) });
    expect(wp.ok && wp.next).toEqual({ phaseKey: "flood_test", readyAt: h(26) });
    apply(rows, wp);

    // Cure wait: flood test can't start until 24 h after the membrane.
    rows[2]!.evidence = { flood_result: { at: h(3).toISOString(), value: { depth_in: 2, hours: 24, passed: true } }, water_line_photo: { at: h(3).toISOString(), mediaId: "m2" } };
    expect(completePhase(tileLike, rows, "flood_test", { now: h(3) })).toEqual({ ok: false, error: "waiting", until: h(26) });
    // The office can override the wait, never the evidence.
    expect(completePhase(tileLike, rows, "flood_test", { now: h(3), force: true }).ok).toBe(true);
    apply(rows, completePhase(tileLike, rows, "flood_test", { now: h(27) }));

    const set = completePhase(tileLike, rows, "setting", { now: h(30) });
    expect(set.ok && set.jobStatus).toBe("in_progress");
    apply(rows, set);
    expect(completePhase(tileLike, rows, "grout", { now: h(40) })).toEqual({ ok: false, error: "waiting", until: h(54) });

    const last = completePhase(tileLike, rows, "grout", { now: h(55) });
    expect(last.ok && last.jobStatus).toBe("completed");
    expect(last.ok && last.next).toBeNull();
    apply(rows, last);

    expect(completePhase(tileLike, rows, "grout", { now: h(56) })).toEqual({ ok: false, error: "already_done" });
    const view = readJobPhases(tileLike, { status: "completed" }, rows);
    expect(view.map((v) => [v.key, v.status])).toEqual([
      ["prep", "done"],
      ["waterproofing", "done"],
      ["flood_test", "done"],
      ["setting", "done"],
      ["grout", "done"],
    ]);
  });

  it("a skipped phase doesn't block the next one", () => {
    const rows = rowsFrom(tileLike);
    rows[0]!.status = "skipped";
    expect(completePhase(tileLike, rows, "waterproofing", { now: h(0) })).toEqual({ ok: false, error: "missing_evidence", missing: ["membrane_photo"] });
  });

  it("refuses evidence for a requirement the phase doesn't have", () => {
    expect(recordEvidence(tileLike, "prep", {}, "membrane_photo", { at: T0.toISOString() })).toEqual({ ok: false, error: "unknown_requirement" });
    expect(recordEvidence(tileLike, "nope", {}, "x", { at: T0.toISOString() })).toEqual({ ok: false, error: "unknown_phase" });
  });

  it("shows what is still missing on open phases", () => {
    const rows = rowsFrom(tileLike);
    const view = readJobPhases(tileLike, { status: "scheduled" }, rows, "en-US");
    expect(view.find((v) => v.key === "flood_test")!.missing).toEqual(["flood_result", "water_line_photo"]);
    expect(view.find((v) => v.key === "flood_test")!.label).toBe("Flood test");
  });
});

/* ───────────── database: rows, RLS and tenant scoping ───────────── */

const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("JobPhase rows in the database", () => {
  const prisma = new PrismaClient();
  let orgA = "";
  let orgB = "";
  let jobA = "";

  beforeAll(async () => {
    const { createOrganizationWithAdmin } = await import("../src/modules/organizations/service.js");
    const { DEFAULT_PERMISSIONS } = await import("../src/lib/tenant/defaults.js");
    for (const p of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    }
    const s = Date.now().toString(36);
    const a = await createOrganizationWithAdmin({ organizationName: `Phases A ${s}`, slug: `phases-a-${s}`, adminName: "A", adminEmail: `pa-${s}@example.com`, password: "password12345" });
    const b = await createOrganizationWithAdmin({ organizationName: `Phases B ${s}`, slug: `phases-b-${s}`, adminName: "B", adminEmail: `pb-${s}@example.com`, password: "password12345" });
    orgA = a.organization.id;
    orgB = b.organization.id;
    const { withTenantTransaction } = await import("../src/lib/tenant/prisma-tenant.js");
    jobA = (await withTenantTransaction(orgA, (tx) => tx.workOrder.create({ data: { organizationId: orgA, title: "Master bath shower", status: "scheduled" } }))).id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB].filter(Boolean) } } });
    await prisma.$disconnect();
  });

  it("creates, closes with evidence and keeps the job status in step", async () => {
    const { withTenantTransaction } = await import("../src/lib/tenant/prisma-tenant.js");
    const { ensureJobPhases, listJobPhases, addPhaseEvidence, closeJobPhase } = await import("../src/lib/trades/job-phases-db.js");

    expect(await withTenantTransaction(orgA, (tx) => ensureJobPhases(tx, orgA, jobA, tileLike))).toBe(5);
    // Idempotent.
    expect(await withTenantTransaction(orgA, (tx) => ensureJobPhases(tx, orgA, jobA, tileLike))).toBe(0);
    // Hardwood never creates rows.
    expect(await withTenantTransaction(orgA, (tx) => ensureJobPhases(tx, orgA, jobA, hardwood))).toBe(0);

    const r1 = await withTenantTransaction(orgA, (tx) => closeJobPhase(tx, tileLike, jobA, "prep", { now: h(1), by: { name: "Crew lead" } }));
    expect(r1.ok).toBe(true);
    const blocked = await withTenantTransaction(orgA, (tx) => closeJobPhase(tx, tileLike, jobA, "waterproofing", { now: h(2) }));
    expect(blocked).toEqual({ ok: false, error: "missing_evidence", missing: ["membrane_photo"] });
    await withTenantTransaction(orgA, (tx) => addPhaseEvidence(tx, tileLike, jobA, "waterproofing", "membrane_photo", { at: h(2).toISOString(), mediaId: "m1" }));
    const r2 = await withTenantTransaction(orgA, (tx) => closeJobPhase(tx, tileLike, jobA, "waterproofing", { now: h(2) }));
    expect(r2.ok && r2.next).toEqual({ phaseKey: "flood_test", readyAt: h(26) });

    const rows = await withTenantTransaction(orgA, (tx) => listJobPhases(tx, jobA));
    expect(rows.map((r) => [r.phaseKey, r.status])).toEqual([
      ["prep", "done"],
      ["waterproofing", "done"],
      ["flood_test", "pending"],
      ["setting", "pending"],
      ["grout", "pending"],
    ]);
    expect(rows[2]!.readyAt).toEqual(h(26));
    const job = await withTenantTransaction(orgA, (tx) => tx.workOrder.findFirst({ where: { id: jobA }, select: { status: true } }));
    expect(job?.status).toBe("in_progress");
  });

  it("another company sees none of these phases (tenant client and RLS)", async () => {
    const { withTenantTransaction } = await import("../src/lib/tenant/prisma-tenant.js");
    const seen = await withTenantTransaction(orgB, (tx) => tx.jobPhase.findMany({ where: { workOrderId: jobA } }));
    expect(seen).toEqual([]);
    // RLS itself: as app_user (the role the app connects with), even a raw query finds nothing.
    // The test connection may be a superuser (needed to create companies), which bypasses RLS,
    // so the query runs under SET LOCAL ROLE app_user.
    const count = (org: string) =>
      withTenantTransaction(org, async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE app_user");
        const r = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "JobPhase" WHERE "workOrderId" = ${jobA}::uuid`;
        return Number(r[0]!.n);
      });
    expect(await count(orgB)).toBe(0);
    expect(await count(orgA)).toBe(5);
  });
});
