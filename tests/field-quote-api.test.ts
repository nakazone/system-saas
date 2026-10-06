import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import { ensureWorkOrderOnApprove } from "../src/lib/work-orders/from-quote.js";

/** Login reads `User` outside a tenant transaction — needs a privileged DB role. */
const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

// 1x1 JPEG
const PIXEL =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

describe.skipIf(!privileged)("Field Quote — medição no local vira orçamento e job", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  let orgId = "";
  let leadId = "";
  let cookie = "";
  const suffix = `fq${Date.now().toString(36)}`;
  const email = `fq-${suffix}@example.com`;

  async function call(method: string, path: string, body?: unknown) {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> };
  }

  beforeAll(async () => {
    for (const p of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    }
    const a = await createOrganizationWithAdmin({ organizationName: `FQ ${suffix}`, slug: `fq-${suffix}`, adminName: "Admin", adminEmail: email, password: "password12345" });
    orgId = a.organization.id;
    leadId = await withTenantTransaction(orgId, async (tx) =>
      (await tx.lead.create({ data: { organizationId: orgId, name: "Dana Whitfield", phone: "(303) 555-0142", status: "new", metadata: { address: "410 Elm St, Golden, CO", zipcode: "80401" } } })).id,
    );
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password12345", organizationId: orgId }),
      redirect: "manual",
    });
    cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await prisma.$disconnect();
  });

  it("começa pela visita da agenda, reaproveita o rascunho e vira orçamento + job com fotos", async () => {
    const visit = await call("POST", "/api/visits", { lead_id: leadId, scheduled_at: new Date(Date.now() + 3600e3).toISOString(), address: "410 Elm St, Golden, CO 80401" });
    expect(visit.status).toBe(201);
    const meetingId = visit.json.data.meeting_id;

    // From the agenda visit: client comes from the lead, address from the visit.
    const created = await call("POST", "/api/field-quotes", { meeting_id: meetingId });
    expect(created.status).toBe(201);
    const fq = created.json.data;
    expect(fq).toMatchObject({ lead_id: leadId, meeting_id: meetingId, client_name: "Dana Whitfield", client_phone: "(303) 555-0142", address: "410 Elm St, Golden, CO 80401", status: "draft" });

    // Opening it again from the lead reuses the same draft.
    const again = await call("POST", "/api/field-quotes", { lead_id: leadId });
    expect(again.json.data.id).toBe(fq.id);
    expect(again.json.reused).toBe(true);

    const room = { id: "r1", label: "Living room", en: "Living room", mode: "dims", l_ft: 18, l_in: 6, w_ft: 14, w_in: 0, services: ["installation"] };
    const put = await call("PUT", `/api/field-quotes/${fq.id}`, {
      customer_type: "builder",
      total: 1295,
      total_sqft: 259,
      data: { services: ["installation"], rooms: [room], answers: { general: { pets: true } }, attention_summary: "Pets na casa: sim", photos: [{ id: "fake", url: "https://evil.example/x.jpg", key: "x" }] },
    });
    expect(put.status).toBe(200);
    expect(put.json.data.customer_type).toBe("builder");
    // Photos only come from uploads, never from the client payload.
    expect(put.json.data.data.photos).toEqual([]);

    const photo = await call("POST", `/api/field-quotes/${fq.id}/photos`, { data_url: PIXEL, room_id: "r1", caption: "Old carpet" });
    expect(photo.status).toBe(201);
    expect(photo.json.data).toMatchObject({ room_id: "r1", caption: "Old carpet" });
    expect(photo.json.data.url).toBeTruthy();

    // An autosave built before the upload finished doesn't drop the photo; removal is explicit.
    await call("PUT", `/api/field-quotes/${fq.id}`, { data: { services: ["installation"], rooms: [room], photos: [] } });
    const got = await call("GET", `/api/field-quotes/${fq.id}`);
    expect(got.json.data.data.photos).toHaveLength(1);
    const extra = await call("POST", `/api/field-quotes/${fq.id}/photos`, { data_url: PIXEL, room_id: "r1" });
    const removed = await call("PUT", `/api/field-quotes/${fq.id}`, { data: { services: ["installation"], rooms: [room], attention_summary: "Pets na casa: sim", photos_removed: [extra.json.data.id] } });
    expect(removed.json.data.data.photos.map((p: any) => p.id)).toEqual([photo.json.data.id]);
    expect(removed.json.data.data.photos_removed).toBeUndefined();

    const list = await call("GET", `/api/field-quotes?lead_id=${leadId}`);
    expect(list.json.data.map((r: any) => r.id)).toContain(fq.id);

    // Review → real quote.
    const q = await call("POST", "/api/quotes/full", {
      lead_id: leadId,
      status: "draft",
      job_name: "Dana Whitfield",
      job_address: "410 Elm St, Golden, CO 80401",
      items: [{ name: "LVP installation — straight pattern", quantity: 259, rate: 5, unit_type: "sq_ft", item_type: "service", service_type: "installation" }],
      tax_total: 0,
      total: 1295,
    });
    expect(q.status).toBe(201);
    const quoteId = q.json.data.id;
    const linked = await call("POST", `/api/field-quotes/${fq.id}/link-quote`, { quote_id: quoteId, lead_id: leadId });
    expect(linked.status).toBe(200);
    expect(linked.json.data).toMatchObject({ status: "quoted", quote_id: quoteId });

    // Once quoted, opening from the lead starts a new draft rather than reopening the quoted one.
    const fresh = await call("POST", "/api/field-quotes", { lead_id: leadId });
    expect(fresh.json.data.id).not.toBe(fq.id);
    await call("DELETE", `/api/field-quotes/${fresh.json.data.id}`);

    // Approval → job gets the visit photos in ObraCam and the attention notes.
    const wo = await withTenantTransaction(orgId, async (tx) => {
      await tx.quote.update({ where: { id: quoteId }, data: { status: "approved" } });
      return ensureWorkOrderOnApprove(tx, { organizationId: orgId, quoteId });
    });
    expect(wo?.id).toBeTruthy();
    const media = await withTenantTransaction(orgId, (tx) => tx.jobMedia.findMany({ where: { workOrderId: wo!.id } }));
    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({ stage: "before", deviceLabel: "Field Quote" });
    expect(media[0].caption).toContain("Living room");
    const order = await withTenantTransaction(orgId, (tx) => tx.workOrder.findFirst({ where: { id: wo!.id } }));
    expect(order?.campoAttention).toContain("Pets");
  });

  it("respeita o módulo desligado", async () => {
    await prisma.organization.update({ where: { id: orgId }, data: { featureFlags: { field_quote: false } } });
    const r = await call("GET", "/api/field-quotes");
    expect(r.status).toBe(403);
    await prisma.organization.update({ where: { id: orgId }, data: { featureFlags: {} } });
  });
});
