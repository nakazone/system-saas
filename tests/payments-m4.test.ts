import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import {
  fromCents,
  nextInvoiceNumber,
  validatePaymentSchedule,
  recordInvoicePayment,
  upsertQuotePaymentSchedule,
  runScheduleTriggers,
  toCents,
} from "../src/lib/payments/engine.js";

const prisma = new PrismaClient();

describe("payment schedule validation", () => {
  it("splits percents with last-line cent absorption", () => {
    const result = validatePaymentSchedule(
      [
        { label: "A", percent: 33.33, sortOrder: 1 },
        { label: "B", percent: 33.33, sortOrder: 2 },
        { label: "C", percent: 33.34, sortOrder: 3 },
      ],
      100,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.amountsCents.reduce((s, c) => s + c, 0)).toBe(10000);
    expect(fromCents(result.amountsCents[0]!)).toBe(33.33);
    expect(fromCents(result.amountsCents[2]!)).toBe(33.34);
  });

  it("requires fixed amounts to equal total", () => {
    const bad = validatePaymentSchedule(
      [
        { label: "A", fixedAmount: 40, sortOrder: 1 },
        { label: "B", fixedAmount: 50, sortOrder: 2 },
      ],
      100,
    );
    expect(bad.ok).toBe(false);

    const good = validatePaymentSchedule(
      [
        { label: "A", fixedAmount: 40, sortOrder: 1 },
        { label: "B", fixedAmount: 60, sortOrder: 2 },
      ],
      100,
    );
    expect(good.ok).toBe(true);
  });

  it("rejects mixed percent and fixed", () => {
    const result = validatePaymentSchedule(
      [
        { label: "A", percent: 50, sortOrder: 1 },
        { label: "B", fixedAmount: 50, sortOrder: 2 },
      ],
      100,
    );
    expect(result.ok).toBe(false);
  });
});

describe("invoice numbering + schedule triggers", () => {
  let orgId: string;
  let quoteId: string;

  beforeAll(async () => {
    for (const permission of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({
        where: { key: permission.key },
        create: {
          key: permission.key,
          group: permission.group,
          description: permission.description,
        },
        update: {},
      });
    }

    const suffix = Date.now().toString(36);
    const org = await createOrganizationWithAdmin({
      organizationName: `Pay Org ${suffix}`,
      slug: `pay-org-${suffix}`,
      adminName: "Admin",
      adminEmail: `pay-${suffix}@example.com`,
      password: "password12345",
    });
    orgId = org.organization.id;

    quoteId = await withTenantTransaction(orgId, async (tx) => {
      const customer = await tx.customer.create({
        data: { organizationId: orgId, name: "Pay Customer" },
      });
      const quote = await tx.quote.create({
        data: {
          organizationId: orgId,
          number: 1,
          title: "Payment quote",
          customerId: customer.id,
          status: "draft",
          total: 1000,
          subtotal: 1000,
        },
      });
      await upsertQuotePaymentSchedule(tx, {
        organizationId: orgId,
        quoteId: quote.id,
        quoteTotal: 1000,
        items: [
          { label: "Deposit", percent: 50, trigger: "on_approve", sortOrder: 1 },
          { label: "Final", percent: 50, trigger: "manual", sortOrder: 2 },
        ],
      });
      return quote.id;
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("allocates unique INV numbers under concurrent locks", async () => {
    const numbers = await Promise.all(
      [1, 2, 3, 4, 5].map(() =>
        withTenantTransaction(orgId, async (tx) => nextInvoiceNumber(tx, orgId)),
      ),
    );
    expect(new Set(numbers).size).toBe(5);
    expect(numbers.every((n) => /^INV-\d{4}$/.test(n))).toBe(true);
  });

  it("creates deposit invoice on approve trigger and records payment", async () => {
    const invoiceId = await withTenantTransaction(orgId, async (tx) => {
      const ids = await runScheduleTriggers(tx, {
        organizationId: orgId,
        quoteId,
        trigger: "on_approve",
      });
      expect(ids.length).toBe(1);
      const inv = await tx.quoteInvoice.findFirstOrThrow({ where: { id: ids[0] } });
      expect(Number(inv.amount)).toBe(500);
      expect(inv.status).toBe("draft");

      await recordInvoicePayment(tx, {
        organizationId: orgId,
        invoiceId: inv.id,
        amount: 200,
        method: "check",
      });
      const afterPartial = await tx.quoteInvoice.findFirstOrThrow({ where: { id: inv.id } });
      expect(afterPartial.status).toBe("partially_paid");

      await recordInvoicePayment(tx, {
        organizationId: orgId,
        invoiceId: inv.id,
        amount: 300,
        method: "card",
      });
      const afterPaid = await tx.quoteInvoice.findFirstOrThrow({
        where: { id: inv.id },
        include: { receipts: true },
      });
      expect(afterPaid.status).toBe("paid");
      expect(toCents(afterPaid.amount)).toBe(
        afterPaid.receipts.reduce((s, r) => s + toCents(r.amount), 0),
      );
      return inv.id;
    });
    expect(invoiceId).toBeTruthy();
  });

  it("locks schedule after approve trigger", async () => {
    await withTenantTransaction(orgId, async (tx) => {
      const schedule = await tx.paymentSchedule.findFirstOrThrow({ where: { quoteId } });
      expect(schedule.lockedAt).not.toBeNull();
      await expect(
        upsertQuotePaymentSchedule(tx, {
          organizationId: orgId,
          quoteId,
          quoteTotal: 1000,
          items: [{ label: "X", percent: 100, trigger: "manual", sortOrder: 1 }],
        }),
      ).rejects.toThrow(/locked/i);
    });
  });
});
