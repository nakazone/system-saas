import { Prisma } from "@prisma/client";
import type { TenantPrisma } from "../tenant/prisma-tenant.js";
import { recordActivity } from "../activity/record.js";
import {
  DEFAULT_PAYMENT_TEMPLATES,
  type PaymentTemplateItemInput,
} from "./defaults.js";

const MONEY = 100; // cents

export function toCents(amount: number | Prisma.Decimal | string): number {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * MONEY);
}

export function fromCents(cents: number): number {
  return Math.round(cents) / MONEY;
}

export type ScheduleItemInput = {
  label: string;
  percent?: number | null;
  fixedAmount?: number | null;
  trigger?: string;
  phaseKey?: string | null;
  sortOrder?: number;
};

export type ScheduleValidation =
  | { ok: true; amountsCents: number[] }
  | { ok: false; error: string };

/**
 * Validate schedule against quote total.
 * - All percent: must sum to 100; last line absorbs rounding cents.
 * - All fixed: must sum to total; last line can absorb ±1 cent drift if within total.
 * - Mixed: reject.
 */
export function validatePaymentSchedule(
  items: ScheduleItemInput[],
  quoteTotal: number,
): ScheduleValidation {
  if (!items.length) return { ok: false, error: "Add at least one schedule item" };

  const totalCents = toCents(quoteTotal);
  if (totalCents < 0) return { ok: false, error: "Quote total cannot be negative" };

  const sorted = [...items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const hasPercent = sorted.some((i) => i.percent != null && i.percent !== undefined);
  const hasFixed = sorted.some((i) => i.fixedAmount != null && i.fixedAmount !== undefined);
  if (hasPercent && hasFixed) {
    return { ok: false, error: "Use either percent or fixed amounts, not both" };
  }

  for (const item of sorted) {
    if (!String(item.label || "").trim()) {
      return { ok: false, error: "Each item needs a label" };
    }
  }

  if (hasPercent || (!hasPercent && !hasFixed)) {
    const percents = sorted.map((i) => Number(i.percent ?? 0));
    if (percents.some((p) => !Number.isFinite(p) || p < 0)) {
      return { ok: false, error: "Percents must be non-negative numbers" };
    }
    const sum = percents.reduce((s, p) => s + p, 0);
    if (Math.abs(sum - 100) > 0.001) {
      return { ok: false, error: `Percents must sum to 100 (got ${sum})` };
    }
    const amounts: number[] = [];
    let allocated = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (i === sorted.length - 1) {
        amounts.push(totalCents - allocated);
      } else {
        const c = Math.round((totalCents * percents[i]!) / 100);
        amounts.push(c);
        allocated += c;
      }
    }
    return { ok: true, amountsCents: amounts };
  }

  const fixed = sorted.map((i) => toCents(Number(i.fixedAmount ?? 0)));
  if (fixed.some((c) => c < 0)) {
    return { ok: false, error: "Fixed amounts must be non-negative" };
  }
  const sumFixed = fixed.reduce((s, c) => s + c, 0);
  if (sumFixed !== totalCents) {
    // Allow last line to absorb: if user entered all but last matching, we still require exact sum.
    return {
      ok: false,
      error: `Fixed amounts must equal quote total ($${fromCents(totalCents).toFixed(2)}; got $${fromCents(sumFixed).toFixed(2)})`,
    };
  }
  return { ok: true, amountsCents: fixed };
}

export async function seedDefaultPaymentTemplates(
  tx: TenantPrisma,
  organizationId: string,
): Promise<void> {
  const existing = await tx.orgPaymentTemplate.count({ where: { organizationId } });
  if (existing > 0) return;
  for (const tpl of DEFAULT_PAYMENT_TEMPLATES) {
    await tx.orgPaymentTemplate.create({
      data: {
        organizationId,
        name: tpl.name,
        description: tpl.description,
        sortOrder: tpl.sortOrder,
        items: tpl.items as unknown as Prisma.InputJsonValue,
        active: true,
      },
    });
  }
}

/** Allocate next INV-0001 style number with row lock. */
export async function nextInvoiceNumber(
  tx: TenantPrisma,
  organizationId: string,
): Promise<string> {
  await tx.$executeRaw`
    INSERT INTO "DocumentSequence" ("id", "organizationId", "kind", "nextValue")
    VALUES (gen_random_uuid(), ${organizationId}::uuid, 'invoice', 1)
    ON CONFLICT ("organizationId", "kind") DO NOTHING
  `;

  const rows = await tx.$queryRaw<{ nextValue: number }[]>`
    SELECT "nextValue" FROM "DocumentSequence"
    WHERE "organizationId" = ${organizationId}::uuid AND "kind" = 'invoice'
    FOR UPDATE
  `;
  const current = rows[0]?.nextValue ?? 1;
  await tx.$executeRaw`
    UPDATE "DocumentSequence"
    SET "nextValue" = ${current + 1}
    WHERE "organizationId" = ${organizationId}::uuid AND "kind" = 'invoice'
  `;
  return `INV-${String(current).padStart(4, "0")}`;
}

export function paidTotalCents(
  receipts: { amount: Prisma.Decimal | number }[],
): number {
  return receipts.reduce((s, r) => s + toCents(r.amount), 0);
}

export function deriveInvoiceStatus(params: {
  status: string;
  amountCents: number;
  paidCents: number;
}): string {
  if (params.status === "void") return "void";
  if (params.paidCents <= 0) {
    return params.status === "sent" ? "sent" : params.status === "draft" ? "draft" : "sent";
  }
  if (params.paidCents >= params.amountCents) return "paid";
  return "partially_paid";
}

export async function createInvoiceFromScheduleItem(
  tx: TenantPrisma,
  params: {
    organizationId: string;
    quoteId: string;
    scheduleItemId: string;
    amountCents: number;
    actorId?: string | null;
    invoiceType?: string;
    dueDays?: number;
  },
) {
  const quote = await tx.quote.findFirst({
    where: { id: params.quoteId },
    include: { organization: true },
  });
  if (!quote) throw new Error("Quote not found");

  const item = await tx.paymentScheduleItem.findFirst({
    where: { id: params.scheduleItemId },
  });
  if (!item) throw new Error("Schedule item not found");

  const existing = await tx.quoteInvoice.findFirst({
    where: { scheduleItemId: params.scheduleItemId, status: { not: "void" } },
  });
  if (existing) return existing;

  const invoiceNumber = await nextInvoiceNumber(tx, params.organizationId);
  const amount = fromCents(params.amountCents);
  const dueDate =
    params.dueDays != null
      ? new Date(Date.now() + params.dueDays * 86400000)
      : new Date(Date.now() + 14 * 86400000);

  const type =
    params.invoiceType ||
    (item.label.toLowerCase().includes("deposit")
      ? "deposit"
      : item.label.toLowerCase().includes("final")
        ? "final"
        : item.trigger === "on_approve" && Number(item.percent) === 100
          ? "full"
          : "progress");

  const invoice = await tx.quoteInvoice.create({
    data: {
      organizationId: params.organizationId,
      quoteId: params.quoteId,
      customerId: quote.customerId,
      invoiceNumber,
      invoiceType: type,
      status: "draft",
      amount: new Prisma.Decimal(amount.toFixed(2)),
      dueDate,
      scheduleItemId: item.id,
      paymentInstructions: quote.organization.paymentInstructions,
      notes: item.label,
    },
  });

  await tx.invoiceLineItem.create({
    data: {
      organizationId: params.organizationId,
      invoiceId: invoice.id,
      description: item.label,
      quantity: new Prisma.Decimal(1),
      unitPrice: new Prisma.Decimal(amount.toFixed(2)),
      amount: new Prisma.Decimal(amount.toFixed(2)),
      sortOrder: 1,
    },
  });

  await recordActivity(tx, {
    organizationId: params.organizationId,
    entityType: "invoice",
    entityId: invoice.id,
    actorType: params.actorId ? "user" : "system",
    actorId: params.actorId ?? null,
    action: "created",
    changes: { fromScheduleItem: { from: null, to: item.id } },
  });

  return invoice;
}

export async function runScheduleTriggers(
  tx: TenantPrisma,
  params: {
    organizationId: string;
    quoteId: string;
    trigger: "on_send" | "on_approve";
    actorId?: string | null;
  },
): Promise<string[]> {
  const schedule = await tx.paymentSchedule.findFirst({
    where: { quoteId: params.quoteId },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!schedule) return [];

  const quote = await tx.quote.findFirst({ where: { id: params.quoteId } });
  if (!quote) return [];

  const validation = validatePaymentSchedule(
    schedule.items.map((i) => ({
      label: i.label,
      percent: i.percent != null ? Number(i.percent) : null,
      fixedAmount: i.fixedAmount != null ? Number(i.fixedAmount) : null,
      trigger: i.trigger,
      phaseKey: i.phaseKey,
      sortOrder: i.sortOrder,
    })),
    Number(quote.total),
  );
  if (!validation.ok) return [];

  if (params.trigger === "on_approve" && !schedule.lockedAt) {
    await tx.paymentSchedule.update({
      where: { id: schedule.id },
      data: { lockedAt: new Date() },
    });
  }

  const createdIds: string[] = [];
  for (let i = 0; i < schedule.items.length; i++) {
    const item = schedule.items[i]!;
    if (item.trigger !== params.trigger) continue;
    const inv = await createInvoiceFromScheduleItem(tx, {
      organizationId: params.organizationId,
      quoteId: params.quoteId,
      scheduleItemId: item.id,
      amountCents: validation.amountsCents[i]!,
      actorId: params.actorId,
    });
    createdIds.push(inv.id);
  }
  return createdIds;
}

export async function upsertQuotePaymentSchedule(
  tx: TenantPrisma,
  params: {
    organizationId: string;
    quoteId: string;
    items: ScheduleItemInput[];
    sourceTemplateId?: string | null;
    quoteTotal: number;
  },
) {
  const existing = await tx.paymentSchedule.findFirst({
    where: { quoteId: params.quoteId },
  });
  if (existing?.lockedAt) {
    throw new Error("Payment schedule is locked");
  }

  const validation = validatePaymentSchedule(params.items, params.quoteTotal);
  if (!validation.ok) throw new Error(validation.error);

  if (existing) {
    await tx.paymentScheduleItem.deleteMany({ where: { scheduleId: existing.id } });
    await tx.paymentSchedule.update({
      where: { id: existing.id },
      data: { sourceTemplateId: params.sourceTemplateId ?? existing.sourceTemplateId },
    });
    for (let i = 0; i < params.items.length; i++) {
      const item = params.items[i]!;
      await tx.paymentScheduleItem.create({
        data: {
          organizationId: params.organizationId,
          scheduleId: existing.id,
          label: item.label.trim(),
          percent:
            item.percent != null ? new Prisma.Decimal(Number(item.percent)) : null,
          fixedAmount:
            item.fixedAmount != null
              ? new Prisma.Decimal(Number(item.fixedAmount).toFixed(2))
              : null,
          trigger: item.trigger || "manual",
          phaseKey: item.phaseKey || null,
          sortOrder: item.sortOrder ?? i + 1,
        },
      });
    }
    return existing.id;
  }

  const schedule = await tx.paymentSchedule.create({
    data: {
      organizationId: params.organizationId,
      quoteId: params.quoteId,
      sourceTemplateId: params.sourceTemplateId ?? null,
    },
  });
  for (let i = 0; i < params.items.length; i++) {
    const item = params.items[i]!;
    await tx.paymentScheduleItem.create({
      data: {
        organizationId: params.organizationId,
        scheduleId: schedule.id,
        label: item.label.trim(),
        percent: item.percent != null ? new Prisma.Decimal(Number(item.percent)) : null,
        fixedAmount:
          item.fixedAmount != null
            ? new Prisma.Decimal(Number(item.fixedAmount).toFixed(2))
            : null,
        trigger: item.trigger || "manual",
        phaseKey: item.phaseKey || null,
        sortOrder: item.sortOrder ?? i + 1,
      },
    });
  }
  return schedule.id;
}

export async function applyTemplateToQuote(
  tx: TenantPrisma,
  params: {
    organizationId: string;
    quoteId: string;
    templateId: string;
    quoteTotal: number;
  },
) {
  const template = await tx.orgPaymentTemplate.findFirst({
    where: { id: params.templateId, active: true },
  });
  if (!template) throw new Error("Template not found");
  const items = (Array.isArray(template.items) ? template.items : []) as PaymentTemplateItemInput[];
  return upsertQuotePaymentSchedule(tx, {
    organizationId: params.organizationId,
    quoteId: params.quoteId,
    sourceTemplateId: template.id,
    quoteTotal: params.quoteTotal,
    items: items.map((i, idx) => ({
      label: i.label,
      percent: i.percent ?? null,
      fixedAmount: i.fixedAmount ?? null,
      trigger: i.trigger,
      phaseKey: i.phaseKey ?? null,
      sortOrder: i.sortOrder ?? idx + 1,
    })),
  });
}

export async function recordInvoicePayment(
  tx: TenantPrisma,
  params: {
    organizationId: string;
    invoiceId: string;
    amount: number;
    method?: string | null;
    referenceNumber?: string | null;
    notes?: string | null;
    paidAt?: Date;
    actorId?: string | null;
    externalPaymentId?: string | null;
    processor?: string | null;
  },
) {
  const invoice = await tx.quoteInvoice.findFirst({
    where: { id: params.invoiceId },
    include: { receipts: true },
  });
  if (!invoice) throw new Error("Invoice not found");
  if (invoice.status === "void") throw new Error("Invoice is void");

  const amountCents = toCents(params.amount);
  if (amountCents <= 0) throw new Error("Payment amount must be positive");

  const alreadyPaid = paidTotalCents(invoice.receipts);
  const invoiceCents = toCents(invoice.amount);
  if (alreadyPaid + amountCents > invoiceCents + 1) {
    throw new Error("Payment exceeds invoice balance");
  }

  const receipt = await tx.invoiceReceipt.create({
    data: {
      organizationId: params.organizationId,
      invoiceId: invoice.id,
      amount: new Prisma.Decimal(fromCents(amountCents).toFixed(2)),
      paidAt: params.paidAt ?? new Date(),
      method: params.method || null,
      referenceNumber: params.referenceNumber || null,
      notes: params.notes || null,
      externalPaymentId: params.externalPaymentId || null,
      processor: params.processor || null,
    },
  });

  const newPaid = alreadyPaid + amountCents;
  const status = deriveInvoiceStatus({
    status: invoice.status === "draft" ? "sent" : invoice.status,
    amountCents: invoiceCents,
    paidCents: newPaid,
  });

  await tx.quoteInvoice.update({
    where: { id: invoice.id },
    data: {
      status,
      paidAt: status === "paid" ? params.paidAt ?? new Date() : invoice.paidAt,
      issuedAt: invoice.issuedAt ?? new Date(),
    },
  });

  await recordActivity(tx, {
    organizationId: params.organizationId,
    entityType: "payment",
    entityId: receipt.id,
    actorType: params.actorId ? "user" : "system",
    actorId: params.actorId ?? null,
    action: "created",
    changes: {
      invoiceId: { from: null, to: invoice.id },
      amount: { from: null, to: fromCents(amountCents) },
    },
  });

  return receipt;
}
