/**
 * A builder's AP matches invoices by their own PO / work order number. A job that came
 * through ObraBuilder carries that number on its invoice: PDF, public page and CRM.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { invoiceDetailInclude, invoicePdfInput, lotOf, poNumberOf, projectNameOf } from "../src/lib/invoices/service.js";
import { buildInvoicePdf } from "../src/lib/invoices/pdf.js";

describe("the builder's PO on the invoice (pure)", () => {
  it("lists each number once, in the order they were sent", () => {
    const inv = (refs: (string | null)[]) => ({ workOrder: { partnerRequests: refs.map((externalRef) => ({ externalRef })) } }) as never;
    expect(poNumberOf(inv(["PO-118", "WO-22", "PO-118", " "]))).toBe("PO-118, WO-22");
    expect(poNumberOf(inv([]))).toBeNull();
    expect(poNumberOf({ workOrder: null } as never)).toBeNull();
  });

  it("carries the lot and community from the latest request that has them", () => {
    const inv = (intakes: unknown[]) => ({ workOrder: { partnerRequests: intakes.map((intake) => ({ externalRef: null, intake })) } }) as never;
    expect(lotOf(inv([{ lot: "Lot #12", community: "Sunset Ridge" }]))).toBe("12 · Sunset Ridge");
    expect(lotOf(inv([{ lot: "7" }, { community: "Aspen Park" }]))).toBe("Aspen Park");
    expect(lotOf(inv([null, {}]))).toBeNull();
    // the portal sends them as their own fields, and the server keeps them
    expect(readFileSync("crm/public/partner-portal.js", "utf8")).toContain("lot: (f.lot || '').trim().slice(0, 20)");
    expect(readFileSync("src/crm/routes/partner-portal.ts", "utf8")).toContain("lot: z.string().trim().max(20).optional()");
  });

  it("does not print the address twice when the job title already has it", () => {
    const wo = (title: string, address: string) => ({ quote: null, workOrder: { title, address } }) as never;
    expect(projectNameOf(wo("Countertops · 1083 Golf Estates Point, Golden, CO", "1083 Golf Estates Point, Golden, CO"))).toBe("Countertops · 1083 Golf Estates Point, Golden, CO");
    expect(projectNameOf(wo("Lot 12 kitchen", "12 Elm St"))).toBe("Lot 12 kitchen · 12 Elm St");
  });

  it("is on the public page and the CRM invoice", () => {
    expect(readFileSync("src/views/invoices/public.ejs", "utf8")).toContain("PO / WO #");
    expect(readFileSync("crm/public/invoice-page.js", "utf8")).toContain("inv.po_number");
    expect(readFileSync("crm/public/invoice-page.js", "utf8")).toContain("inv.lot");
    expect(readFileSync("src/views/invoices/public.ejs", "utf8")).toContain("<dt>Lot</dt>");
  });
});

const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("an invoice for a job from ObraBuilder", () => {
  const prisma = new PrismaClient();
  const suffix = `po${Date.now().toString(36)}`;
  let org = "";
  let invoiceId = "";

  beforeAll(async () => {
    const a = await createOrganizationWithAdmin({ organizationName: `PO ${suffix}`, slug: `po-${suffix}`, adminName: "Admin", adminEmail: `po-${suffix}@example.com`, password: "password12345" });
    org = a.organization.id;
    invoiceId = await withTenantTransaction(org, async (tx) => {
      const wo = await tx.workOrder.create({ data: { organizationId: org, number: 41, title: "Lot 12 kitchen", address: "12 Elm St, Golden, CO", status: "completed" } });
      await tx.workOrderLineItem.create({ data: { organizationId: org, workOrderId: wo.id, serviceName: "Countertop – Level 2 (fabricate & install)", quantitySqft: 40, unitPrice: 70, lineTotal: 2800, sortOrder: 1 } });
      const pu = await tx.partnerUser.create({ data: { organizationId: org, email: `b-${suffix}@example.com`, passwordHash: "x", name: "Dana" } });
      await tx.partnerJobRequest.create({ data: { organizationId: org, partnerUserId: pu.id, workOrderId: wo.id, title: "Lot 12 kitchen", address: "12 Elm St", status: "accepted", externalRef: "PO-55018", intake: { source: "manual", lot: "12", community: "Sunset Ridge" } } });
      const inv = await tx.quoteInvoice.create({ data: { organizationId: org, workOrderId: wo.id, invoiceNumber: `INV-${suffix}`, invoiceType: "full", status: "sent", amount: 2800, issuedAt: new Date() } });
      return inv.id;
    });
  });
  afterAll(async () => {
    await prisma.organization.delete({ where: { id: org } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("prints the builder's PO next to the job number", async () => {
    const inv = await withTenantTransaction(org, (tx) => tx.quoteInvoice.findFirstOrThrow({ where: { id: invoiceId }, include: invoiceDetailInclude }));
    const orgRow = await prisma.organization.findUniqueOrThrow({ where: { id: org } });
    const input = invoicePdfInput(inv, orgRow as never);
    expect(input.poNumber).toBe("PO-55018");
    expect(input.jobNumber).toBe("#41");
    expect(input.lot).toBe("12 · Sunset Ridge");
    const pdf = await buildInvoicePdf(input);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });
});
