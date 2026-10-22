import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import { runLookup } from "../src/lib/mate-ai/lookups.js";

const probe = new PrismaClient();
const privileged = await probe
  .$queryRawUnsafe("SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user")
  .then((rows) => Boolean((rows as Array<{ ok: boolean }>)[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

/** "Tem mais alguma invoice além dessas?" needs every open invoice, not just the latest six. */
describe.skipIf(!privileged)("Mate AI — find_invoices by status (tenant database required)", () => {
  const prisma = new PrismaClient();
  const sfx = Date.now().toString(36);
  let org = "";

  beforeAll(async () => {
    for (const p of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    }
    const created = await createOrganizationWithAdmin({ organizationName: "Lookup " + sfx, slug: "lookup-" + sfx, adminName: "Doug", adminEmail: "lookup-" + sfx + "@example.com", password: "password12345" });
    org = created.organization.id;
    await withTenantTransaction(org, async (tx) => {
      const c = await tx.customer.create({ data: { organizationId: org, name: "Ortiz Homes", customerType: "builder" } });
      const day = (n: number) => new Date(Date.now() + n * 864e5);
      await tx.quoteInvoice.create({ data: { organizationId: org, customerId: c.id, invoiceNumber: "INV-1", invoiceType: "full", status: "sent", amount: 2400, dueDate: day(-8), issuedAt: day(-20) } });
      await tx.quoteInvoice.create({ data: { organizationId: org, customerId: c.id, invoiceNumber: "INV-2", invoiceType: "full", status: "sent", amount: 900, dueDate: day(10), issuedAt: day(-2) } });
      await tx.quoteInvoice.create({ data: { organizationId: org, customerId: c.id, invoiceNumber: "INV-3", invoiceType: "full", status: "draft", amount: 500, dueDate: day(-3) } });
      const paid = await tx.quoteInvoice.create({ data: { organizationId: org, customerId: c.id, invoiceNumber: "INV-4", invoiceType: "full", status: "paid", amount: 300, dueDate: day(-30), issuedAt: day(-40) } });
      await tx.invoiceReceipt.create({ data: { organizationId: org, invoiceId: paid.id, amount: 300, paidAt: day(-25) } });
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lists open and overdue invoices with count and total", async () => {
    const lookup = (status: string) => withTenantTransaction(org, (tx) => runLookup({ tx, timezone: "America/Denver", catalog: [] }, "find_invoices", { status }));
    const open = (await lookup("open")) as { count: number; total_balance: number; rows: Array<{ number: string }> };
    expect(open.rows.map((r) => r.number).sort()).toEqual(["INV-1", "INV-2"]);
    expect(open.count).toBe(2);
    expect(open.total_balance).toBe(3300);
    const overdue = (await lookup("overdue")) as { count: number; rows: Array<{ number: string }> };
    expect(overdue.rows.map((r) => r.number)).toEqual(["INV-1"]);
  });
});
