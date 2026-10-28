/**
 * When a quote is approved, ensure a Job (WorkOrder) exists and is linked via Quote.workOrderId.
 * Idempotent: re-approving / re-saving approved quotes returns the existing job.
 */
import { copyFieldQuoteToJob } from "../field-quote/job.js";
import { discountLineLabel, readQuoteDiscount, type DiscountKind } from "../quotes/discount.js";
import { calculateQuoteTotals } from "../quotes/totals.js";
import { Prisma } from "@prisma/client";
import type { TenantPrisma } from "../tenant/prisma-tenant.js";
import { recordActivity } from "../activity/record.js";
import { ensureJobChatChannel } from "../chat/job-channel.js";

export async function nextWorkOrderNumber(
  tx: TenantPrisma,
  organizationId: string,
): Promise<number> {
  await tx.$executeRaw`
    INSERT INTO "DocumentSequence" ("id", "organizationId", "kind", "nextValue")
    VALUES (gen_random_uuid(), ${organizationId}::uuid, 'work_order', 1)
    ON CONFLICT ("organizationId", "kind") DO NOTHING
  `;
  const rows = await tx.$queryRaw<{ nextValue: number }[]>`
    SELECT "nextValue" FROM "DocumentSequence"
    WHERE "organizationId" = ${organizationId}::uuid AND "kind" = 'work_order'
    FOR UPDATE
  `;
  const current = rows[0]?.nextValue ?? 1;
  await tx.$executeRaw`
    UPDATE "DocumentSequence"
    SET "nextValue" = ${current + 1}
    WHERE "organizationId" = ${organizationId}::uuid AND "kind" = 'work_order'
  `;
  return current;
}

function payloadOf(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return {};
}

function formatPropertyAddress(property: {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
} | null): string | null {
  if (!property) return null;
  const line = [property.line1, property.line2].filter(Boolean).join(", ");
  const cityLine = [property.city, property.state, property.postalCode].filter(Boolean).join(", ");
  const full = [line, cityLine].filter(Boolean).join(" — ");
  return full || null;
}

function resolveSourceType(quote: {
  builderId: string | null;
  payload: unknown;
}): string {
  const payload = payloadOf(quote.payload);
  const party = String(payload.quote_party || "").toLowerCase();
  if (["particular", "builder", "contractor", "loja", "internal", "other"].includes(party)) {
    return party;
  }
  if (quote.builderId) return "builder";
  return "particular";
}

const QUOTE_DISCOUNT_NOTE = "quote-discount";

/** Keep the job total aligned with the quote discount (including jobs created before the discount was stored). */
async function syncQuoteDiscountOntoJob(
  tx: TenantPrisma,
  organizationId: string,
  workOrderId: string,
  quote: { subtotal: unknown; discountType: string | null; discountValue: unknown; payload: unknown },
): Promise<boolean> {
  const discount = readQuoteDiscount(quote);
  const lines = await tx.workOrderLineItem.findMany({
    where: { workOrderId },
    orderBy: { sortOrder: "asc" },
  });
  const existing = lines.find((li) => li.notes === QUOTE_DISCOUNT_NOTE || /^discount\b/i.test(li.serviceName));
  if (!discount.amount || !discount.type) {
    if (existing) {
      await tx.workOrderLineItem.delete({ where: { id: existing.id } });
      return true;
    }
    return false;
  }
  const data = {
    serviceName: discountLineLabel(discount.type, discount.value).slice(0, 200),
    notes: QUOTE_DISCOUNT_NOTE,
    quantitySqft: new Prisma.Decimal(1),
    unitPrice: new Prisma.Decimal(-discount.amount),
    lineTotal: new Prisma.Decimal(-discount.amount),
  };
  if (existing) {
    const same =
      Math.round(Number(existing.lineTotal) * 100) === Math.round(-discount.amount * 100) &&
      existing.serviceName === data.serviceName;
    if (!same) {
      await tx.workOrderLineItem.update({ where: { id: existing.id }, data });
      return true;
    }
    return false;
  }
  await tx.workOrderLineItem.create({
    data: {
      organizationId,
      workOrderId,
      ...data,
      sortOrder: lines.length + 1,
    },
  });
  return true;
}

/** If this job came from a quote, copy that quote's discount onto the job lines. */
export async function ensureQuoteDiscountOnJob(
  tx: TenantPrisma,
  organizationId: string,
  workOrderId: string,
): Promise<boolean> {
  const quote = await tx.quote.findFirst({
    where: { workOrderId },
    select: { subtotal: true, discountType: true, discountValue: true, payload: true },
  });
  if (!quote) return false;
  return syncQuoteDiscountOntoJob(tx, organizationId, workOrderId, quote);
}

/** Same heal for a jobs list, so totals match the quote without opening each job. */
export async function ensureQuoteDiscountsOnJobs(
  tx: TenantPrisma,
  organizationId: string,
  workOrderIds: string[],
): Promise<string[]> {
  if (!workOrderIds.length) return [];
  const quotes = await tx.quote.findMany({
    where: { workOrderId: { in: workOrderIds } },
    select: { workOrderId: true, subtotal: true, discountType: true, discountValue: true, payload: true },
  });
  const changed: string[] = [];
  for (const quote of quotes) {
    if (!quote.workOrderId) continue;
    const did = await syncQuoteDiscountOntoJob(tx, organizationId, quote.workOrderId, quote);
    if (did) changed.push(quote.workOrderId);
  }
  return changed;
}

type QuoteForJob = NonNullable<Awaited<ReturnType<typeof loadQuoteForJob>>>;

async function loadQuoteForJob(tx: TenantPrisma, quoteId: string) {
  return tx.quote.findFirst({
    where: { id: quoteId },
    include: {
      property: true,
      customer: { select: { id: true, name: true, customerType: true } },
      builder: { select: { id: true, company: true, firstName: true, lastName: true, type: true } },
      lineItems: { orderBy: { sortOrder: "asc" } },
    },
  });
}

async function quotePersonName(tx: TenantPrisma, quote: QuoteForJob): Promise<string> {
  const builder =
    quote.builder?.company ||
    [quote.builder?.firstName, quote.builder?.lastName].filter(Boolean).join(" ");
  if (quote.customer?.name?.trim()) return quote.customer.name.trim();
  if (builder.trim()) return builder.trim();
  if (quote.leadId) {
    const lead = await tx.lead.findFirst({
      where: { id: quote.leadId },
      select: { name: true },
    });
    if (lead?.name?.trim()) return lead.name.trim();
  }
  return (quote.title || `Orçamento ${quote.quoteNumber || quote.number}`).trim();
}

function jobIdentityFromQuote(quote: QuoteForJob, personName: string) {
  const payload = payloadOf(quote.payload);
  const jobName = String(payload.job_name || "").trim();
  const jobAddress = String(payload.job_address || "").trim();
  const title = (personName || quote.title || `Quote ${quote.quoteNumber || quote.number}`).trim().slice(0, 200);
  let sourceType = resolveSourceType(quote);
  if (quote.builderId && sourceType === "particular") {
    const bt = String(quote.builder?.type || "builder").toLowerCase();
    sourceType = ["builder", "contractor", "loja"].includes(bt) ? bt : "builder";
  } else if (quote.customer?.customerType) {
    const ct = String(quote.customer.customerType).toLowerCase();
    if (["particular", "builder", "contractor", "loja"].includes(ct) && !quote.builderId) {
      sourceType = ct;
    }
  }
  const party = String(payload.quote_party || sourceType || "").toLowerCase();
  const siteFirst = party === "builder" || party === "contractor" || party === "loja";
  const property = formatPropertyAddress(quote.property);
  const address = siteFirst ? jobAddress || property : property || jobAddress || null;
  return {
    title: title || "Job",
    address,
    sourceType,
    sourceName: personName.slice(0, 200) || null,
    clientRef: jobName.slice(0, 120) || null,
  };
}

function quoteJobLineData(organizationId: string, quote: QuoteForJob) {
  const selectedLines = quote.lineItems.filter((li) => !li.isOptional || li.isSelected);
  const discount = readQuoteDiscount(quote);
  const rows = selectedLines.map((li, idx) => {
    const qty = Number(li.quantity) || 0;
    const unitPrice = Number(li.unitPrice) || 0;
    const amount = Number(li.amount) || qty * unitPrice;
    const meta =
      li.meta && typeof li.meta === "object" && !Array.isArray(li.meta)
        ? (li.meta as Record<string, unknown>)
        : {};
    const pricingRaw = meta.pricing_item_id ?? meta.pricingItemId ?? null;
    const pricingItemId =
      pricingRaw &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(pricingRaw))
        ? String(pricingRaw)
        : null;
    return {
      organizationId,
      pricingItemId,
      serviceName: String(li.name || li.description || "Serviço").slice(0, 200),
      notes: null as string | null,
      quantitySqft: new Prisma.Decimal(qty),
      unitPrice: new Prisma.Decimal(unitPrice),
      lineTotal: new Prisma.Decimal(amount),
      sortOrder: li.sortOrder ?? idx,
    };
  });
  if (discount.amount > 0 && discount.type) {
    rows.push({
      organizationId,
      pricingItemId: null,
      serviceName: discountLineLabel(discount.type, discount.value).slice(0, 200),
      notes: QUOTE_DISCOUNT_NOTE,
      quantitySqft: new Prisma.Decimal(1),
      unitPrice: new Prisma.Decimal(-discount.amount),
      lineTotal: new Prisma.Decimal(-discount.amount),
      sortOrder: selectedLines.length + 1,
    });
  }
  return rows;
}

function jobLineFingerprint(
  rows: { serviceName: string; quantitySqft: { toString(): string }; unitPrice: { toString(): string } }[],
) {
  return rows
    .map(
      (li) =>
        `${li.serviceName}|${Math.round(Number(li.quantitySqft) * 1000)}|${Math.round(Number(li.unitPrice) * 100)}`,
    )
    .join("\n");
}

/**
 * Keep the linked job findable and aligned with the current quote.
 * A later edit must not leave the job under the first client or the first total,
 * and must not cancel it. Lines are refreshed only while the job has not started
 * and nothing has been invoiced — including a canceled job, so reopening it
 * comes back with the quote as it is now.
 */
export async function syncLinkedJobFromQuote(
  tx: TenantPrisma,
  params: { organizationId: string; quoteId: string },
): Promise<{ id: string; status: string } | null> {
  const quote = await loadQuoteForJob(tx, params.quoteId);
  if (!quote?.workOrderId) return null;
  const job = await tx.workOrder.findFirst({
    where: { id: quote.workOrderId },
    include: { lineItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (!job) {
    await tx.quote.update({ where: { id: quote.id }, data: { workOrderId: null } });
    return null;
  }
  const ident = jobIdentityFromQuote(quote, await quotePersonName(tx, quote));
  const sameIdentity =
    job.title === ident.title &&
    (job.address || null) === ident.address &&
    (job.customerId || null) === (quote.customerId || null) &&
    (job.builderId || null) === (quote.builderId || null) &&
    job.sourceType === ident.sourceType &&
    (job.sourceName || null) === ident.sourceName &&
    (job.clientRef || null) === ident.clientRef;
  if (!sameIdentity) {
    await tx.workOrder.update({
      where: { id: job.id },
      data: {
        title: ident.title,
        address: ident.address,
        customerId: quote.customerId,
        builderId: quote.builderId,
        sourceType: ident.sourceType,
        sourceName: ident.sourceName,
        clientRef: ident.clientRef,
      },
    });
  }
  const invoiced = await tx.quoteInvoice.count({
    where: { workOrderId: job.id, status: { not: "void" } },
  });
  const canReplaceLines =
    invoiced === 0 &&
    (job.status === "draft" || job.status === "scheduled" || job.status === "canceled");
  if (canReplaceLines) {
    const next = quoteJobLineData(params.organizationId, quote);
    if (jobLineFingerprint(job.lineItems) !== jobLineFingerprint(next)) {
      const pricingIds = [...new Set(next.map((row) => row.pricingItemId).filter((id): id is string => Boolean(id)))];
      if (pricingIds.length) {
        const live = await tx.pricingItem.findMany({
          where: { id: { in: pricingIds } },
          select: { id: true },
        });
        const ok = new Set(live.map((row) => row.id));
        for (const row of next) {
          if (row.pricingItemId && !ok.has(row.pricingItemId)) row.pricingItemId = null;
        }
      }
      await tx.workOrderLineItem.deleteMany({ where: { workOrderId: job.id } });
      if (next.length) {
        await tx.workOrderLineItem.createMany({
          data: next.map((row) => ({ ...row, workOrderId: job.id })),
        });
      }
    }
  } else {
    await syncQuoteDiscountOntoJob(tx, params.organizationId, job.id, quote);
  }
  return { id: job.id, status: job.status };
}

/**
 * Create (or return) the WorkOrder for an approved quote. Links Quote.workOrderId.
 */
export async function ensureWorkOrderOnApprove(
  tx: TenantPrisma,
  params: {
    organizationId: string;
    quoteId: string;
    actorId?: string | null;
  },
): Promise<{ id: string; number: number | null; created: boolean } | null> {
  const quote = await loadQuoteForJob(tx, params.quoteId);
  if (!quote) return null;

  if (quote.workOrderId) {
    const existing = await tx.workOrder.findFirst({ where: { id: quote.workOrderId } });
    if (existing) {
      await syncLinkedJobFromQuote(tx, params);
      await linkQuoteInvoicesToWorkOrder(tx, quote.id, existing.id);
      const fresh = await tx.workOrder.findFirst({
        where: { id: existing.id },
        select: { id: true, number: true },
      });
      return { id: existing.id, number: fresh?.number ?? existing.number, created: false };
    }
  }

  const ident = jobIdentityFromQuote(quote, await quotePersonName(tx, quote));
  const number = await nextWorkOrderNumber(tx, params.organizationId);
  const lines = quoteJobLineData(params.organizationId, quote);

  const wo = await tx.workOrder.create({
    data: {
      organizationId: params.organizationId,
      number,
      title: ident.title || `Job #${number}`,
      status: "draft",
      sourceType: ident.sourceType,
      sourceName: ident.sourceName,
      clientRef: ident.clientRef,
      customerId: quote.customerId,
      builderId: quote.builderId,
      address: ident.address,
      // Notas internas and scheduling/team/campo are filled in the Job modal after conversion.
      notes: null,
      lineItems: { create: lines },
    },
  });

  await tx.quote.update({
    where: { id: quote.id },
    data: { workOrderId: wo.id },
  });

  try {
    // Photos and "Atenção" notes from the on-site visit (Field Quote) follow the job.
    await copyFieldQuoteToJob(tx, {
      organizationId: params.organizationId,
      quoteId: quote.id,
      workOrderId: wo.id,
    });
  } catch {
    /* best-effort */
  }

  try {
    await ensureJobChatChannel(tx, params.organizationId, wo.id);
  } catch {
    /* chat channel is best-effort */
  }

  await recordActivity(tx, {
    organizationId: params.organizationId,
    entityType: "work_order",
    entityId: wo.id,
    actorType: params.actorId ? "user" : "system",
    actorId: params.actorId ?? null,
    action: "work_order.created_from_quote",
    changes: {
      quoteId: { from: null, to: quote.id },
      number: { from: null, to: number },
    },
  });
  await recordActivity(tx, {
    organizationId: params.organizationId,
    entityType: "quote",
    entityId: quote.id,
    actorType: params.actorId ? "user" : "system",
    actorId: params.actorId ?? null,
    action: "quote.job_created",
    changes: {
      workOrderId: { from: null, to: wo.id },
    },
  });

  await linkQuoteInvoicesToWorkOrder(tx, quote.id, wo.id);
  return { id: wo.id, number: wo.number, created: true };
}

function isJobDiscountLine(li: { notes: string | null; serviceName: string }): boolean {
  return li.notes === QUOTE_DISCOUNT_NOTE || /^discount\b/i.test(li.serviceName);
}

/** Percent stays a percent (the dollar line on the job is stale after a service edit). A plain Discount line is a fixed amount. */
function discountFromJobLine(li: { serviceName: string; lineTotal: unknown }): { type: DiscountKind; value: number } | null {
  const pct = li.serviceName.match(/discount\s*\(\s*([\d.]+)\s*%\s*\)/i);
  if (pct) {
    const value = Math.min(100, Number(pct[1]) || 0);
    if (value > 0) return { type: "percent", value };
  }
  const amount = Math.round(Math.abs(Number(li.lineTotal) || 0) * 100) / 100;
  if (amount > 0) return { type: "fixed", value: amount };
  return null;
}

function takeMatch<T>(buckets: Map<string, T[]>, serviceName: string): T | undefined {
  const key = serviceName.trim().toLowerCase();
  const queue = buckets.get(key);
  if (!queue?.length) return undefined;
  return queue.shift();
}

/**
 * Job services are the contract. After they change, the linked quote must show the same
 * lines and total — invoices and the quote screen would otherwise keep the old price.
 */
export async function syncLinkedQuoteFromJob(
  tx: TenantPrisma,
  params: { organizationId: string; workOrderId: string },
): Promise<void> {
  const quote = await tx.quote.findFirst({
    where: { workOrderId: params.workOrderId },
    orderBy: { updatedAt: "desc" },
    include: { lineItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (!quote) return;

  const jobLines = await tx.workOrderLineItem.findMany({
    where: { workOrderId: params.workOrderId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const services = jobLines.filter((li) => !isJobDiscountLine(li));
  const discountLine = jobLines.find((li) => isJobDiscountLine(li));
  const discount = discountLine ? discountFromJobLine(discountLine) : null;

  const byName = new Map<string, (typeof quote.lineItems)[number][]>();
  for (const li of quote.lineItems) {
    const key = String(li.name || li.description || "").trim().toLowerCase();
    const queue = byName.get(key) || [];
    queue.push(li);
    byName.set(key, queue);
  }
  const payload = payloadOf(quote.payload);
  const prevItems = (Array.isArray(payload.items) ? payload.items : Array.isArray(payload.line_items) ? payload.line_items : [])
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
  const payloadByName = new Map<string, Record<string, unknown>[]>();
  for (const item of prevItems) {
    const key = String(item.name || item.description || "").trim().toLowerCase();
    const queue = payloadByName.get(key) || [];
    queue.push(item);
    payloadByName.set(key, queue);
  }

  const nextPayloadItems: Record<string, unknown>[] = [];
  const rows = services.map((li, idx) => {
    const prev = takeMatch(byName, li.serviceName);
    const prevItem = takeMatch(payloadByName, li.serviceName) || {};
    const meta =
      prev?.meta && typeof prev.meta === "object" && !Array.isArray(prev.meta)
        ? { ...(prev.meta as Record<string, unknown>) }
        : {};
    if (li.pricingItemId) meta.pricing_item_id = li.pricingItemId;
    const note = li.notes && li.notes !== QUOTE_DISCOUNT_NOTE ? li.notes : "";
    if (note) meta.notes = note;
    const qty = Number(li.quantitySqft) || 0;
    const unitPrice = Number(li.unitPrice) || 0;
    const amount = Math.round((Number(li.lineTotal) || qty * unitPrice) * 100) / 100;
    const name = li.serviceName.slice(0, 200);
    nextPayloadItems.push({
      ...prevItem,
      name,
      description: prev?.description || name,
      quantity: qty,
      unit: prev?.unit || prevItem.unit || "sqft",
      unit_price: unitPrice,
      rate: unitPrice,
      sell_price: unitPrice,
      amount,
      pricing_item_id: li.pricingItemId,
      notes: note || null,
    });
    return {
      organizationId: params.organizationId,
      quoteId: quote.id,
      name,
      description: (prev?.description || name).slice(0, 2000),
      quantity: new Prisma.Decimal(qty),
      unit: prev?.unit || "sqft",
      unitCost: prev?.unitCost ?? new Prisma.Decimal(0),
      unitPrice: new Prisma.Decimal(unitPrice),
      amount: new Prisma.Decimal(amount),
      isOptional: false,
      isSelected: true,
      itemType: prev?.itemType || "service",
      sortOrder: idx,
      ...(Object.keys(meta).length ? { meta: meta as Prisma.InputJsonValue } : {}),
    };
  });

  await tx.quoteLineItem.deleteMany({ where: { quoteId: quote.id } });
  if (rows.length) await tx.quoteLineItem.createMany({ data: rows });

  const totals = calculateQuoteTotals({
    lines: services.map((li) => ({
      quantity: Number(li.quantitySqft) || 0,
      unitPrice: Number(li.unitPrice) || 0,
      amount: Number(li.lineTotal) || 0,
    })),
    discountType: discount?.type ?? null,
    discountValue: discount?.value ?? 0,
    taxRate: Number(quote.taxRate) || 0,
  });
  const taxTotal =
    Number(quote.taxRate) > 0 ? totals.taxTotal : Math.round((Number(quote.taxTotal) || 0) * 100) / 100;
  const total = Math.round(Math.max(0, totals.subtotal - totals.discountAmount + taxTotal) * 100) / 100;
  payload.items = nextPayloadItems;
  payload.subtotal = totals.subtotal;
  payload.tax_total = taxTotal;
  payload.total = total;
  payload.discount_type = discount?.type === "fixed" ? "fixed" : discount?.type === "percent" ? "percentage" : null;
  payload.discount_value = discount?.value ?? 0;

  await tx.quote.update({
    where: { id: quote.id },
    data: {
      subtotal: new Prisma.Decimal(totals.subtotal),
      taxTotal: new Prisma.Decimal(taxTotal),
      total: new Prisma.Decimal(total),
      discountType: discount?.type ?? null,
      discountValue: new Prisma.Decimal(discount?.value ?? 0),
      payload: payload as Prisma.InputJsonValue,
    },
  });
}

/** Quote approval invoices the quote before the job exists. Attach those invoices to the job so Faturar does not issue a second one. */
export async function linkQuoteInvoicesToWorkOrder(tx: TenantPrisma, quoteId: string, workOrderId: string) {
  await tx.quoteInvoice.updateMany({
    where: { quoteId, workOrderId: null },
    data: { workOrderId },
  });
}
