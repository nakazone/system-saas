/**
 * Countertops quote: each line remembers the countertop item it came from (meta.top_key), and the
 * measured tops travel with the quote (payload.tops), so the quote editor can rebuild the lines.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";

const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("countertop lines keep their item through save and load", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  let cookie = "";
  const suffix = `ctq${Date.now().toString(36)}`;

  beforeAll(async () => {
    for (const p of DEFAULT_PERMISSIONS) await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    const a = await createOrganizationWithAdmin({ organizationName: `Tops ${suffix}`, slug: `tops-${suffix}`, adminName: "Admin", adminEmail: `adm-${suffix}@example.com`, password: "password12345" });
    await prisma.organization.update({ where: { id: a.organization.id }, data: { tradePacks: ["countertops"] } });
    const app = createApp();
    await new Promise<void>((resolve) => (server = app.listen(0, () => resolve())));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `adm-${suffix}@example.com`, password: "password12345", organizationId: a.organization.id }), redirect: "manual" });
    cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await prisma.$disconnect();
  });

  it("saves top_key on each line and the tops on the quote; a bad key is dropped", async () => {
    const tops = { spec: { level: 2 }, pieces: [{ id: "ct1", kind: "run", length: 120 }] };
    const items = [
      { name: "Countertop – Level 2 (fabricate & install)", quantity: 21.3, rate: 68, unit_type: "sq_ft", item_type: "service", service_type: "Countertops", top_key: "ct_top_l2@ct1" },
      { name: "Undermount Sink Cutout", quantity: 1, rate: 275, unit_type: "fixed", item_type: "service", service_type: "Countertops", top_key: "ct_sink_undermount" },
      { name: "Template Visit", quantity: 1, rate: 150, unit_type: "fixed", item_type: "service", service_type: "Countertops", top_key: "<script>" },
    ];
    const r = await fetch(`${base}/api/quotes/full`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ status: "draft", title: "Bennett", flooring_type: "countertops", items, tops, total: 1873.4 }) });
    expect(r.status).toBeLessThan(300);
    const id = ((await r.json()) as any).data.id;
    const q = ((await (await fetch(`${base}/api/quotes/${id}`, { headers: { Cookie: cookie } })).json()) as any).data;
    expect(q.items.map((i: any) => i.top_key)).toEqual(["ct_top_l2@ct1", "ct_sink_undermount", null]);
    expect(q.payload.tops.pieces[0].id).toBe("ct1");
  });
});
