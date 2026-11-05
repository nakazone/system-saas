/**
 * ObraCam photo phases for trades with per-job phases (Tile, Countertops): a photo takes the
 * phase it proves, else the phase that was open when it was taken; a hand correction must be one
 * of the trade's phases. Hardwood keeps its date rules (tests/obracam.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import { getPack } from "../src/lib/trades/index.js";
import { packAutoPhase, packPhaseContext, phaseCatalog, photoPhaseFields } from "../src/lib/job-media/phases.js";

const tops = getPack("countertops");
const tile = getPack("tile");
const t = (iso: string) => new Date(iso);

describe("ObraCam phases of a per-job-phase trade", () => {
  const rows = tops.phases.map((p, i) => ({ phaseKey: p.key, sortOrder: i, status: "pending", doneAt: null as Date | null, evidence: {} as unknown }));
  rows[0] = { ...rows[0], status: "done", doneAt: t("2026-11-02T15:00:00Z") };
  rows[1] = { ...rows[1], status: "done", doneAt: t("2026-11-03T15:00:00Z"), evidence: { site_ready_photo: { at: "2026-11-03T14:00:00Z", mediaId: "m-proof" } } };

  it("uses the phase open when the photo was taken, and the proof's phase for evidence photos", () => {
    const ctx = packPhaseContext(tops, rows);
    expect(ctx.phases).toEqual(tops.phases.map((p) => p.key));
    expect(packAutoPhase(ctx, "2026-11-01T12:00:00Z")).toBe(tops.phases[0].key);
    expect(packAutoPhase(ctx, "2026-11-02T18:00:00Z")).toBe(tops.phases[1].key);
    expect(packAutoPhase(ctx, "2026-11-04T10:00:00Z")).toBe(tops.phases[2].key);
    // taken during phase 3, but attached as phase 2's proof
    expect(packAutoPhase(ctx, "2026-11-04T10:00:00Z", "m-proof")).toBe(tops.phases[1].key);
  });

  it("puts photos after the last phase closed in the last phase", () => {
    const done = rows.map((r, i) => ({ ...r, status: "done", doneAt: t(`2026-11-${String(2 + i).padStart(2, "0")}T15:00:00Z`) }));
    const ctx = packPhaseContext(tops, done);
    expect(packAutoPhase(ctx, "2026-12-01T10:00:00Z")).toBe(tops.phases[tops.phases.length - 1].key);
  });

  it("leaves skipped phases out (Tile without natural stone)", () => {
    const ctx = packPhaseContext(tile, []);
    const variantKeys = tile.phases.filter((p) => p.variant).map((p) => p.key);
    expect(variantKeys.length).toBeGreaterThan(0);
    for (const k of variantKeys) expect(ctx.phases).not.toContain(k);
    expect(ctx.phases[0]).toBe(tile.phases.find((p) => !p.variant)!.key);
  });

  it("gives the trade's labels, keeps a hand correction only when it is a trade phase", () => {
    const ctx = packPhaseContext(tops, rows);
    const key = tops.phases[4].key;
    const manual = photoPhaseFields(ctx, { id: "x", phase: key, createdAt: t("2026-11-01T12:00:00Z") });
    expect(manual).toMatchObject({ phase: key, phase_label: tops.phases[4].label["pt-BR"], phase_source: "manual", phase_mode: "phases" });
    // a Hardwood phase on a countertops job is ignored
    const stale = photoPhaseFields(ctx, { id: "x", phase: "sand_finish", createdAt: t("2026-11-01T12:00:00Z") });
    expect(stale).toMatchObject({ phase: tops.phases[0].key, phase_source: "auto" });
    const proof = photoPhaseFields(ctx, { id: "m-proof", phase: null, createdAt: t("2026-11-04T10:00:00Z") });
    expect(proof).toMatchObject({ phase: tops.phases[1].key, phase_source: "proof" });
  });

  it("lists the company's phases for filters: the trade's, or Hardwood's", () => {
    expect(phaseCatalog(tops).map(([k]) => k)).toEqual(tops.phases.map((p) => p.key));
    expect(phaseCatalog(getPack("hardwood")).map(([k]) => k)).toEqual(["delivery", "scan", "installation", "sand_finish", "walkthrough"]);
  });
});

const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("ObraCam API on a countertops company", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const suffix = `cp${Date.now().toString(36)}`;
  let orgId = "";
  let job = "";
  let cookie = "";
  const media: Record<string, string> = {};

  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> };
  };

  beforeAll(async () => {
    for (const p of DEFAULT_PERMISSIONS) await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    const a = await createOrganizationWithAdmin({ organizationName: `Cam Tops ${suffix}`, slug: `camtops-${suffix}`, adminName: "Admin", adminEmail: `adm-${suffix}@example.com`, password: "password12345" });
    orgId = a.organization.id;
    await prisma.organization.update({ where: { id: orgId }, data: { tradePacks: ["countertops"] } });
    const admin = await prisma.user.findFirst({ where: { organizationId: orgId } });
    job = await withTenantTransaction(orgId, async (tx) => (await tx.workOrder.create({ data: { organizationId: orgId, number: 7, title: "Kitchen tops", status: "in_progress" } })).id);
    const app = createApp();
    await new Promise<void>((resolve) => (server = app.listen(0, () => resolve())));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `adm-${suffix}@example.com`, password: "password12345", organizationId: orgId }), redirect: "manual" });
    cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    // Creates the job's phase rows, then close the first one yesterday.
    expect((await call("GET", `/api/work-orders/${job}/phases`)).status).toBe(200);
    const yesterday = new Date(Date.now() - 86400_000);
    await prisma.jobPhase.updateMany({ where: { workOrderId: job, phaseKey: tops.phases[0].key }, data: { status: "done", doneAt: yesterday } });
    await withTenantTransaction(orgId, async (tx) => {
      const mk = async (name: string, at: Date) =>
        (media[name] = (await tx.jobMedia.create({ data: { organizationId: orgId, workOrderId: job, authorId: admin!.id, type: "photo", storageKey: `k-${name}-${suffix}`, url: "https://x/p.jpg", sha256: name, createdAt: at } })).id);
      await mk("early", new Date(yesterday.getTime() - 3600_000));
      await mk("now", new Date());
    });
  });

  afterAll(async () => {
    server?.close();
    await prisma.$disconnect();
  });

  it("the job's photos carry the trade's phases and the catalog", async () => {
    const r = await call("GET", `/api/work-orders/${job}/media`);
    expect(r.status).toBe(200);
    expect(r.json.meta.phase_mode).toBe("phases");
    expect(r.json.meta.phase_catalog.map((x: string[]) => x[0])).toEqual(tops.phases.map((p) => p.key));
    const byId = Object.fromEntries(r.json.data.map((p: any) => [p.id, p]));
    expect(byId[media.early]).toMatchObject({ phase: tops.phases[0].key, phase_label: tops.phases[0].label["pt-BR"], phase_source: "auto" });
    expect(byId[media.now].phase).toBe(tops.phases[1].key);
  });

  it("the ObraCam board does too", async () => {
    const r = await call("GET", `/api/job-media/board?days=3`);
    expect(r.status).toBe(200);
    expect(r.json.meta.phase_mode).toBe("phases");
    const j = r.json.data.jobs.find((x: any) => x.id === job);
    expect(j.phases[0]).toBe(tops.phases[0].key);
    const f = r.json.data.feed.find((x: any) => x.id === media.now);
    expect(f.phase).toBe(tops.phases[1].key);
  });

  it("a hand correction takes a trade phase and refuses a Hardwood one", async () => {
    const key = tops.phases[4].key;
    const ok = await call("PATCH", `/api/work-orders/${job}/media/${media.now}`, { phase: key });
    expect(ok.status).toBe(200);
    expect(ok.json.data).toMatchObject({ phase: key, phase_source: "manual", phase_label: tops.phases[4].label["pt-BR"] });
    const bad = await call("PATCH", `/api/work-orders/${job}/media/${media.now}`, { phase: "sand_finish" });
    expect(bad.status).toBe(400);
    const back = await call("PATCH", `/api/work-orders/${job}/media/${media.now}`, { phase: null });
    expect(back.json.data).toMatchObject({ phase: tops.phases[1].key, phase_source: "auto" });
  });
});
