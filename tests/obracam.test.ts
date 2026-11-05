import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { obraCamHtml } from "../src/crm/mount.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { hashPassword } from "../src/lib/auth/password.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";

describe("obraCamHtml", () => {
  const page = `<html><head><meta name="theme-color" content="#f7f4ee" /><title>ObraCam | ObraMate</title><link rel="apple-touch-icon" href="/old.png" /></head><body></body></html>`;
  const out = obraCamHtml(page);

  it("dresses the ObraCam page as its own app", () => {
    expect(out).toContain("<title>ObraCam</title>");
    expect(out).toContain('href="/obracam.webmanifest?v=1"');
    expect(out).toContain("/assets/obracam/apple-touch-icon.png");
    expect(out).toContain("window.__OM_FOCUS_APP=true");
    expect(out).toContain("/obracam-app.js");
    expect(out).not.toContain("/old.png");
  });

  it("sets the app flag before the page scripts run", () => {
    expect(out.indexOf("__OM_FOCUS_APP")).toBeLessThan(out.indexOf("/obracam-app.js"));
  });
});

const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("GET /obracam", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  let adminCookie = "";
  let salesCookie = "";
  let managerCookie = "";
  let officeCookie = "";
  const suffix = `ocm${Date.now().toString(36)}`;

  async function login(email: string, organizationId: string) {
    const r = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password12345", organizationId }),
      redirect: "manual",
    });
    return (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  }

  beforeAll(async () => {
    for (const p of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    }
    const adminEmail = `admin-${suffix}@example.com`;
    const a = await createOrganizationWithAdmin({ organizationName: `Cam ${suffix}`, slug: `cam-${suffix}`, adminName: "Admin", adminEmail, password: "password12345" });
    const orgId = a.organization.id;
    for (const key of ["general_manager", "office"]) {
      const role = await prisma.role.findFirst({ where: { organizationId: orgId, key } });
      await prisma.user.create({ data: { organizationId: orgId, email: `${key}-${suffix}@example.com`, name: key, passwordHash: await hashPassword("password12345"), roleId: role!.id, status: "active" } });
    }
    const salesRole = await prisma.role.findFirst({ where: { organizationId: orgId, key: "sales" } });
    const salesEmail = `sales-${suffix}@example.com`;
    await prisma.user.create({ data: { organizationId: orgId, email: salesEmail, name: "Sales", passwordHash: await hashPassword("password12345"), roleId: salesRole!.id, status: "active" } });
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    adminCookie = await login(adminEmail, orgId);
    salesCookie = await login(salesEmail, orgId);
    managerCookie = await login(`general_manager-${suffix}@example.com`, orgId);
    officeCookie = await login(`office-${suffix}@example.com`, orgId);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await prisma.$disconnect();
  });

  it("opens the app for an admin", async () => {
    const r = await fetch(`${base}/obracam`, { headers: { Cookie: adminCookie } });
    const html = await r.text();
    expect(r.status).toBe(200);
    expect(html).toContain("window.__OM_FOCUS_APP=true");
    expect(html).toContain('id="camRows"');
  });

  it("opens the app for a general manager and for the office", async () => {
    for (const cookie of [managerCookie, officeCookie]) {
      const r = await fetch(`${base}/obracam`, { headers: { Cookie: cookie } });
      expect(await r.text()).toContain("window.__OM_FOCUS_APP=true");
    }
  });

  it("explains to other roles that the app is for admins", async () => {
    const r = await fetch(`${base}/obracam`, { headers: { Cookie: salesCookie } });
    const html = await r.text();
    expect(r.status).toBe(200);
    expect(html).toContain("é para administradores, gerentes e escritório");
    expect(html).not.toContain("camRows");
  });

  it("serves the manifest", async () => {
    const r = await fetch(`${base}/obracam.webmanifest`);
    const m = (await r.json()) as { name: string; scope: string };
    expect(m.name).toBe("ObraCam");
    expect(m.scope).toBe("/obracam");
  });

  it("lets an admin reclassify a photo's stage", async () => {
    const json = { "Content-Type": "application/json", Cookie: adminCookie };
    const wo = await fetch(`${base}/api/work-orders`, { method: "POST", headers: json, body: JSON.stringify({ title: "Stage test" }) }).then((r) => r.json());
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const up = await fetch(`${base}/api/work-orders/${wo.data.id}/media`, { method: "POST", headers: json, body: JSON.stringify({ data_url: png, stage: "during" }) }).then((r) => r.json());
    expect(up.success).toBe(true);
    const url = `${base}/api/work-orders/${wo.data.id}/media/${up.data.id}/stage`;

    const after = await fetch(url, { method: "PATCH", headers: json, body: JSON.stringify({ stage: "after" }) }).then((r) => r.json());
    expect(after.data.stage).toBe("after");
    const general = await fetch(url, { method: "PATCH", headers: json, body: JSON.stringify({ stage: null }) }).then((r) => r.json());
    expect(general.data.stage).toBeNull();
    const bad = await fetch(url, { method: "PATCH", headers: json, body: JSON.stringify({ stage: "someday" }) });
    expect(bad.status).toBe(400);
  });

  it("stores capture metadata, a note, markup and who took the photo", async () => {
    const json = { "Content-Type": "application/json", Cookie: adminCookie };
    const wo = await fetch(`${base}/api/work-orders`, { method: "POST", headers: json, body: JSON.stringify({ title: "Edit test" }) }).then((r) => r.json());
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const people = await fetch(`${base}/api/job-media/people`, { headers: json }).then((r) => r.json());
    const other = people.data.find((u: { name: string }) => u.name === "Sales");
    expect(other).toBeTruthy();
    const up = await fetch(`${base}/api/work-orders/${wo.data.id}/media`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        data_url: png,
        taken_at_device: "2026-10-28T16:15:30.000Z",
        taken_at_source: "exif",
        lat: 33.4255,
        lng: -111.94,
        location_source: "exif",
        camera_model: "Apple iPhone 15 Pro",
        taken_by_id: other.id,
      }),
    }).then((r) => r.json());
    expect(up.data).toMatchObject({ taken_at_source: "exif", location_source: "exif", camera_model: "Apple iPhone 15 Pro", taken_by_name: "Sales", uploaded_by_name: "Admin" });

    const url = `${base}/api/work-orders/${wo.data.id}/media/${up.data.id}`;
    const shapes = [{ type: "arrow", color: "#FF3B30", width: 3, x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5 }];
    const ed = await fetch(url, { method: "PATCH", headers: json, body: JSON.stringify({ caption: "  Rodapé solto  ", annotations: { version: 1, shapes }, taken_by_id: null }) }).then((r) => r.json());
    expect(ed.data.caption).toBe("Rodapé solto");
    expect(ed.data.annotations.shapes).toHaveLength(1);
    expect(ed.data.annotations.shapes[0].id).toBeTruthy();
    expect(ed.data.taken_by_name).toBe("Admin");

    const cleared = await fetch(url, { method: "PATCH", headers: json, body: JSON.stringify({ caption: "", annotations: null }) }).then((r) => r.json());
    expect(cleared.data.caption).toBeNull();
    expect(cleared.data.annotations).toBeNull();
    const empty = await fetch(url, { method: "PATCH", headers: json, body: JSON.stringify({}) });
    expect(empty.status).toBe(400);
  });

  it("creates default stickers, tags old stain photos with Samples, and lets managers edit them", async () => {
    const json = { "Content-Type": "application/json", Cookie: adminCookie };
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const wo = await fetch(`${base}/api/work-orders`, { method: "POST", headers: json, body: JSON.stringify({ title: "Sticker test" }) }).then((r) => r.json());
    // a stain sample photo saved before stickers existed
    const old = await fetch(`${base}/api/work-orders/${wo.data.id}/media`, { method: "POST", headers: json, body: JSON.stringify({ data_url: png, caption: "Stain sample #1 · Jacobean" }) }).then((r) => r.json());

    const first = await fetch(`${base}/api/job-media/stickers`, { headers: json }).then((r) => r.json());
    expect(first.data.map((x: { name: string }) => x.name)).toEqual(["Samples"]);
    const samples = first.data.find((x: { system: boolean }) => x.system);
    const media = await fetch(`${base}/api/work-orders/${wo.data.id}/media`, { headers: json }).then((r) => r.json());
    expect(media.data.find((m: { id: string }) => m.id === old.data.id).sticker_ids).toEqual([samples.id]);

    const created = await fetch(`${base}/api/job-media/stickers`, { method: "POST", headers: json, body: JSON.stringify({ name: "Medição", color: "#8A6A00" }) }).then((r) => r.json());
    expect(created.data).toMatchObject({ name: "Medição", color: "#8A6A00", archived: false });
    const dup = await fetch(`${base}/api/job-media/stickers`, { method: "POST", headers: json, body: JSON.stringify({ name: "medição", color: "#1D6FB8" }) });
    expect(dup.status).toBe(409);
    const badColor = await fetch(`${base}/api/job-media/stickers`, { method: "POST", headers: json, body: JSON.stringify({ name: "X", color: "red" }) });
    expect(badColor.status).toBe(400);

    const delivery = (await fetch(`${base}/api/job-media/stickers`, { method: "POST", headers: json, body: JSON.stringify({ name: "Rodapé", color: "#1D6FB8" }) }).then((r) => r.json())).data;
    const url = `${base}/api/work-orders/${wo.data.id}/media/${old.data.id}`;
    const tagged = await fetch(url, { method: "PATCH", headers: json, body: JSON.stringify({ sticker_ids: [samples.id, delivery.id, created.data.id, "00000000-0000-0000-0000-000000000000"] }) }).then((r) => r.json());
    expect(tagged.data.sticker_ids).toEqual([samples.id, delivery.id, created.data.id]);

    // an archived sticker stays on photos that have it but can't be newly applied
    const arch = await fetch(`${base}/api/job-media/stickers/${created.data.id}`, { method: "PATCH", headers: json, body: JSON.stringify({ archived: true }) }).then((r) => r.json());
    expect(arch.data.archived).toBe(true);
    const again = await fetch(url, { method: "PATCH", headers: json, body: JSON.stringify({ sticker_ids: [created.data.id] }) }).then((r) => r.json());
    expect(again.data.sticker_ids).toEqual([]);

  });

  it("returns each photo's phase from the job dates, lets it be corrected, and turns old Delivery stickers into the phase", async () => {
    const json = { "Content-Type": "application/json", Cookie: adminCookie };
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const day = (n: number) => new Date(Date.now() + n * 86400e3).toISOString();
    const wo = await fetch(`${base}/api/work-orders`, { method: "POST", headers: json, body: JSON.stringify({ title: "Phase test", scheduled_start: day(-3) }) }).then((r) => r.json());
    const before = await fetch(`${base}/api/work-orders/${wo.data.id}/media`, { method: "POST", headers: json, body: JSON.stringify({ data_url: png, taken_at_device: day(-6) }) }).then((r) => r.json());
    const during = await fetch(`${base}/api/work-orders/${wo.data.id}/media`, { method: "POST", headers: json, body: JSON.stringify({ data_url: png, taken_at_device: day(-1) }) }).then((r) => r.json());
    expect(before.data).toMatchObject({ phase: "scan", phase_source: "auto" });
    expect(during.data).toMatchObject({ phase: "installation", phase_source: "auto" });

    const list = await fetch(`${base}/api/work-orders/${wo.data.id}/media`, { headers: json }).then((r) => r.json());
    expect(list.meta.phases).toEqual(["scan", "installation", "walkthrough"]);

    const url = `${base}/api/work-orders/${wo.data.id}/media/${during.data.id}`;
    const fixed = await fetch(url, { method: "PATCH", headers: json, body: JSON.stringify({ phase: "walkthrough" }) }).then((r) => r.json());
    expect(fixed.data).toMatchObject({ phase: "walkthrough", phase_source: "manual" });
    const auto = await fetch(url, { method: "PATCH", headers: json, body: JSON.stringify({ phase: null }) }).then((r) => r.json());
    expect(auto.data).toMatchObject({ phase: "installation", phase_source: "auto" });

    // an org that still has the old Delivery sticker: its photos become Delivery and the sticker is archived and removed
    const orgId = (await prisma.workOrder.findFirst({ where: { id: wo.data.id }, select: { organizationId: true } }))!.organizationId;
    const legacy = await prisma.mediaSticker.create({ data: { organizationId: orgId, key: "delivery", name: "Delivery", color: "#1D6FB8" } });
    await prisma.jobMedia.update({ where: { id: before.data.id }, data: { stickerIds: [legacy.id] } });
    await fetch(`${base}/api/job-media/stickers`, { headers: json });
    const row = await prisma.jobMedia.findUnique({ where: { id: before.data.id }, select: { phase: true, stickerIds: true } });
    expect(row).toEqual({ phase: "delivery", stickerIds: [] });
    expect((await prisma.mediaSticker.findUnique({ where: { id: legacy.id } }))!.archivedAt).not.toBeNull();
  });
});
