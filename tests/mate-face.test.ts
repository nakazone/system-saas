import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import { MATE_PUSH_ICON } from "../src/lib/notifications/publish.js";

const root = path.resolve(import.meta.dirname, "..");
const mascot = (f: string) => path.join(root, "src/public/img/mascot", f);

/** The Mate's face (fox mascot): every expression and pose the front end asks for exists. */
describe("Mate face — assets", () => {
  const js = readFileSync(path.join(root, "crm/public/mate-face.js"), "utf8");
  const list = (name: string) =>
    JSON.parse(
      (js.match(new RegExp(`var ${name} = (\\[[^\\]]+\\])`)) || [])[1]!.replace(/'/g, '"'),
    ) as string[];

  it("has a head for every state and a body for every pose", () => {
    for (const s of list("STATES")) expect(existsSync(mascot(`mate-head-${s}.webp`)), s).toBe(true);
    for (const p of list("POSES")) expect(existsSync(mascot(`mate-${p}.webp`)), p).toBe(true);
  });

  it("push and e-mail icons exist and the service worker accepts the push icon path", () => {
    expect(existsSync(mascot("mate-icon-192.png"))).toBe(true);
    expect(existsSync(mascot("mate-icon-96.png"))).toBe(true);
    const sw = readFileSync(path.join(root, "crm/public/sw.js"), "utf8");
    expect(sw).toContain('typeof data.icon === "string"');
    expect(/^\/assets\/[\w./?=-]+$/.test(MATE_PUSH_ICON)).toBe(true);
    // offline page image is precached
    expect(sw).toContain("/assets/img/mascot/mate-sleeping.webp");
  });
});

const probe = new PrismaClient();
const privileged = await probe
  .$queryRawUnsafe("SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user")
  .then((rows) => Boolean((rows as Array<{ ok: boolean }>)[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

/** Milestones the Mate celebrates once: first approved quote / paid invoice / job done and round counts. */
describe.skipIf(!privileged)("Mate face — milestones (tenant database required)", () => {
  const prisma = new PrismaClient();
  const sfx = Date.now().toString(36);
  const email = "mate-face-" + sfx + "@example.com";
  let server: Server;
  let base = "";
  let org = "";
  let other = "";
  let cookie = "";

  beforeAll(async () => {
    for (const p of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    }
    const created = await createOrganizationWithAdmin({ organizationName: "Mate Face " + sfx, slug: "mate-face-" + sfx, adminName: "Doug", adminEmail: email, password: "password12345" });
    org = created.organization.id;
    const second = await createOrganizationWithAdmin({ organizationName: "Other " + sfx, slug: "mate-face-o-" + sfx, adminName: "Ana", adminEmail: "o-" + email, password: "password12345" });
    other = second.organization.id;
    const day = 864e5;
    await withTenantTransaction(org, async (tx) => {
      const c = await tx.customer.create({ data: { organizationId: org, name: "John Smith", customerType: "particular" } });
      for (let i = 0; i < 10; i++) {
        await tx.workOrder.create({ data: { organizationId: org, number: 9100 + i, title: "Job " + i, status: "completed", customerId: c.id } });
      }
      await tx.workOrder.create({ data: { organizationId: org, number: 9200, title: "Open", status: "scheduled", customerId: c.id } });
      await tx.quote.create({ data: { organizationId: org, number: 4001, quoteNumber: "Q-4001", title: "John", status: "approved", customerId: c.id, total: 1000, subtotal: 1000, signedAt: new Date(Date.now() - 2 * day) } });
      await tx.quote.create({ data: { organizationId: org, number: 4002, quoteNumber: "Q-4002", title: "John", status: "sent", customerId: c.id, total: 1000, subtotal: 1000 } });
      await tx.quoteInvoice.create({ data: { organizationId: org, customerId: c.id, invoiceNumber: "INV-9001", invoiceType: "full", status: "paid", amount: 500, paidAt: new Date(Date.now() - day), issuedAt: new Date() } });
    });
    // another company's 50 approved quotes must not count here
    await withTenantTransaction(other, async (tx) => {
      const c = await tx.customer.create({ data: { organizationId: other, name: "Other", customerType: "particular" } });
      for (let i = 0; i < 12; i++) {
        await tx.quote.create({ data: { organizationId: other, number: 5000 + i, quoteNumber: "Q-" + (5000 + i), title: "Other", status: "approved", customerId: c.id, total: 10, subtotal: 10 } });
      }
    });

    const app = createApp();
    await new Promise<void>((r) => {
      server = app.listen(0, () => r());
    });
    base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
    const r = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "password12345", organizationId: org }), redirect: "manual" });
    const h = r.headers as Headers & { getSetCookie?: () => string[] };
    cookie = (h.getSetCookie?.() ?? [r.headers.get("set-cookie") || ""]).flatMap((v) => v.split(/,\s*(?=[^;,]+=)/)).map((v) => v.split(";")[0]).join("; ");
  });

  afterAll(async () => {
    await new Promise<void>((r) => server?.close(() => r()));
    await prisma.$disconnect();
  });

  it("lists firsts and round counts of this company only, with the date reached", async () => {
    const r = await fetch(base + "/api/mate-ai/milestones", { headers: { Cookie: cookie } });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { data: { milestones: Array<{ key: string; at: string; count: number }>; welcome: { admin: boolean } | null } };
    const keys = j.data.milestones.map((m) => m.key).sort();
    expect(keys).toEqual(["first_invoice_paid", "first_job_done", "first_quote_approved", "jobs_10"]);
    const q = j.data.milestones.find((m) => m.key === "first_quote_approved")!;
    expect(Date.now() - Date.parse(q.at)).toBeGreaterThan(864e5); // signedAt, not updatedAt
    expect(j.data.milestones.find((m) => m.key === "jobs_10")!.count).toBe(10);
    // a person who just joined gets the Mate's welcome once (admin: set up the company)
    expect(j.data.welcome?.admin).toBe(true);
  });

  it("needs a session", async () => {
    const r = await fetch(base + "/api/mate-ai/milestones");
    expect(r.status).not.toBe(200);
  });
});
