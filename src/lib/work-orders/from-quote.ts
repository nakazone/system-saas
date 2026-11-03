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
  const quotes = await tx.quote.findMany({
    where: { workOrderId },
    select: { subtotal: true, discountType: true, discountValue: true, payload: true },
  });
  if (quotes.length !== 1) return false;
  return syncQuoteDiscountOntoJob(tx, organizationId, workOrderId, quotes[0]);
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
  const byWo = new Map<string, typeof quotes>();
  for (const quote of quotes) {
    if (!quote.workOrderId) continue;
    const list = byWo.get(quote.workOrderId) || [];
    list.push(quote);
    byWo.set(quote.workOrderId, list);
  }
  const changed: string[] = [];
  for (const [workOrderId, list] of byWo) {
    if (list.length !== 1) continue; // merged multi-quote jobs keep their own discount lines
    const did = await syncQuoteDiscountOntoJob(tx, organizationId, workOrderId, list[0]);
    if (did) changed.push(workOrderId);
  }
  return changed;
}

type QuoteForJob = NonNullable<Awaited<ReturnType<typeof loadQuoteForJob>>>;

function leadSiteAddressFromMeta(metadata: unknown): string | null {
  const meta =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  const direct = meta.address != null ? String(meta.address).trim() : "";
  if (direct) return direct;
  const full = meta.full_address != null ? String(meta.full_address).trim() : "";
  if (full) return full;
  const parts = [meta.address_line1, meta.address_line2, meta.city, meta.state, meta.zipcode || meta.address_zip]
    .map((x) => (x != null ? String(x).trim() : ""))
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

async function loadQuoteForJob(tx: TenantPrisma, quoteId: string) {
  return tx.quote.findFirst({
    where: { id: quoteId },
    include: {
      property: true,
      customer: { select: { id: true, name: true, customerType: true, address: true, leadId: true } },
      builder: { select: { id: true, company: true, firstName: true, lastName: true, type: true } },
      lineItems: { orderBy: { sortOrder: "asc" } },
    },
  });
}

/** Particular Clients created from leads used to miss address — copy from the lead site once. */
async function healCustomerAddressFromLead(
  tx: TenantPrisma,
  customer: { id: string; address: string | null; leadId: string | null } | null | undefined,
): Promise<string | null> {
  if (!customer) return null;
  const existing = String(customer.address || "").trim();
  if (existing) return existing;
  if (!customer.leadId) return null;
  const lead = await tx.lead.findFirst({
    where: { id: customer.leadId },
    select: { metadata: true },
  });
  const next = leadSiteAddressFromMeta(lead?.metadata);
  if (!next) return null;
  await tx.customer.update({ where: { id: customer.id }, data: { address: next } });
  customer.address = next;
  return next;
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
  // Particulars store the site on the customer (or property), not payload.job_address —
  // the quote builder only writes job_address for builder/contractor/loja parties.
  const customerAddress = String(quote.customer?.address || "").trim();
  const address = siteFirst
    ? jobAddress || property || null
    : property || customerAddress || jobAddress || null;
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
    const noteRaw = meta.notes != null ? String(meta.notes).trim() : "";
    return {
      organizationId,
      pricingItemId,
      serviceName: String(li.name || li.description || "Serviço").slice(0, 200),
      notes: noteRaw ? noteRaw.slice(0, 2000) : (null as string | null),
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
  rows: { serviceName: string; quantitySqft: { toString(): string }; unitPrice: { toString(): string }; notes?: string | null }[],
) {
  return rows
    .map(
      (li) =>
        `${li.serviceName.trim().toLowerCase()}|${Math.round(Number(li.quantitySqft) * 1000)}|${Math.round(Number(li.unitPrice) * 100)}|${String(li.notes || "").trim()}`,
    )
    .join("\n");
}

function invoicedFloorError(invoiced: number) {
  const err = new Error(
    `Já foram faturados $${invoiced.toFixed(2)} neste job — o total dos serviços não pode ficar abaixo disso.`,
  ) as Error & { statusCode?: number };
  err.statusCode = 409;
  return err;
}

/**
 * Keep the linked job findable and aligned with the current quote.
 * Services and prices always follow the quote, including after the job has started.
 * The only stop is an already-invoiced total: the job cannot drop below what was billed.
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
  // Jobs linked to multiple quotes were merged on purpose — do not overwrite from one quote.
  const linkedCount = await tx.quote.count({ where: { workOrderId: job.id } });
  if (linkedCount > 1) {
    return { id: job.id, status: job.status };
  }
  await healCustomerAddressFromLead(tx, quote.customer);
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
  const invoicedAgg = await tx.quoteInvoice.aggregate({
    where: { workOrderId: job.id, status: { not: "void" } },
    _sum: { amount: true },
  });
  const invoiced = Number(invoicedAgg._sum.amount ?? 0);
  const next = quoteJobLineData(params.organizationId, quote);
  // Keep job extras (post-quote add-ons) when re-syncing contract lines from the quote.
  const { parseJobExtraNote } = await import("../invoices/job.js");
  const keepExtras = job.lineItems.filter((li) => parseJobExtraNote(li.notes));
  const nextWithExtras = [
    ...next,
    ...keepExtras.map((li, idx) => ({
      organizationId: params.organizationId,
      pricingItemId: li.pricingItemId,
      serviceName: li.serviceName,
      notes: li.notes,
      quantitySqft: li.quantitySqft,
      unitPrice: li.unitPrice,
      lineTotal: li.lineTotal,
      sortOrder: next.length + idx + 1,
    })),
  ];
  const servicesTotal = nextWithExtras
    .filter((row) => row.notes !== QUOTE_DISCOUNT_NOTE && !/^discount\b/i.test(row.serviceName))
    .reduce((sum, row) => sum + Math.round(Number(row.lineTotal) * 100) / 100, 0);
  if (invoiced > 0.004 && servicesTotal + 0.004 < invoiced) throw invoicedFloorError(invoiced);
  const linesDiffer = jobLineFingerprint(job.lineItems) !== jobLineFingerprint(nextWithExtras);
  if (linesDiffer) {
      const pricingIds = [
        ...new Set(nextWithExtras.map((row) => row.pricingItemId).filter((id): id is string => Boolean(id))),
      ];
      if (pricingIds.length) {
        const live = await tx.pricingItem.findMany({
          where: { id: { in: pricingIds } },
          select: { id: true },
        });
        const ok = new Set(live.map((row) => row.id));
        for (const row of nextWithExtras) {
          if (row.pricingItemId && !ok.has(row.pricingItemId)) row.pricingItemId = null;
        }
      }
      await tx.workOrderLineItem.deleteMany({ where: { workOrderId: job.id } });
      if (nextWithExtras.length) {
        await tx.workOrderLineItem.createMany({
          data: nextWithExtras.map((row) => ({ ...row, workOrderId: job.id })),
        });
      }
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

  await healCustomerAddressFromLead(tx, quote.customer);
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
  const quoteDiscount = readQuoteDiscount(quote);
  const sig = (name: string, qty: number, price: number, notes: string) =>
    `${name.trim().toLowerCase()}|${Math.round(qty * 1000)}|${Math.round(price * 100)}|${notes.trim()}`;
  const jobSig = services
    .map((li) => sig(li.serviceName, Number(li.quantitySqft) || 0, Number(li.unitPrice) || 0, li.notes || ""))
    .join("\n");
  const quoteSig = quote.lineItems
    .map((li) => {
      const meta =
        li.meta && typeof li.meta === "object" && !Array.isArray(li.meta)
          ? (li.meta as Record<string, unknown>)
          : {};
      const notes = meta.notes != null ? String(meta.notes) : "";
      return sig(String(li.name || li.description || ""), Number(li.quantity) || 0, Number(li.unitPrice) || 0, notes);
    })
    .join("\n");
  const sameDiscount =
    (discount?.type ?? null) === (quoteDiscount.amount > 0 ? quoteDiscount.type : null) &&
    Math.round((discount?.value ?? 0) * 100) === Math.round((quoteDiscount.amount > 0 ? quoteDiscount.value : 0) * 100);
  if (jobSig === quoteSig && sameDiscount) return;

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
    else delete meta.notes;
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

/**
 * One linked pair. The side edited last wins, so opening the job or the quote
 * shows the same services and prices.
 */
export async function alignLinkedJobAndQuote(
  tx: TenantPrisma,
  params: { organizationId: string; workOrderId: string },
): Promise<void> {
  const quote = await tx.quote.findFirst({
    where: { workOrderId: params.workOrderId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, updatedAt: true },
  });
  if (!quote) return;
  const job = await tx.workOrder.findFirst({
    where: { id: params.workOrderId },
    select: { updatedAt: true, address: true },
  });
  if (!job) return;
  try {
    // Prefer quote→job when the quote is newer, or when the job still has no site address
    // (particulars used to convert without copying the customer address).
    if (quote.updatedAt.getTime() >= job.updatedAt.getTime() || !String(job.address || "").trim()) {
      await syncLinkedJobFromQuote(tx, { organizationId: params.organizationId, quoteId: quote.id });
    } else {
      await syncLinkedQuoteFromJob(tx, params);
    }
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode === 409) return;
    throw err;
  }
}

/** Quote approval invoices the quote before the job exists. Attach those invoices to the job so Faturar does not issue a second one. */
export async function linkQuoteInvoicesToWorkOrder(tx: TenantPrisma, quoteId: string, workOrderId: string) {
  await tx.quoteInvoice.updateMany({
    where: { quoteId, workOrderId: null },
    data: { workOrderId },
  });
}

function httpErr(message: string, statusCode: number): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

/**
 * Unify 2–5 approved quotes into a single draft job.
 * Rules: same customer or same builder; existing linked jobs must be draft (or already the same job).
 * Both quotes keep their own record and point at the shared WorkOrder.
 */
export async function mergeQuotesIntoJob(
  tx: TenantPrisma,
  params: {
    organizationId: string;
    quoteIds: string[];
    actorId?: string | null;
  },
): Promise<{ id: string; number: number | null; created: boolean; quoteIds: string[] }> {
  const ids = [...new Set((params.quoteIds || []).map(String).filter(Boolean))];
  if (ids.length < 2 || ids.length > 5) {
    throw httpErr("Selecione entre 2 e 5 orçamentos para unificar.", 400);
  }

  const quotes: QuoteForJob[] = [];
  for (const id of ids) {
    const q = await loadQuoteForJob(tx, id);
    if (!q) throw httpErr("Orçamento não encontrado.", 404);
    quotes.push(q);
  }

  for (const q of quotes) {
    const st = String(q.status || "").toLowerCase();
    const ok =
      ["approved", "converted", "accepted"].includes(st) ||
      Boolean(q.workOrderId);
    if (!ok) {
      throw httpErr(
        `O orçamento ${q.quoteNumber || `#${q.number}`} precisa estar aprovado para unificar.`,
        400,
      );
    }
  }

  const allSameCustomer =
    Boolean(quotes[0].customerId) && quotes.every((q) => q.customerId === quotes[0].customerId);
  const allSameBuilder =
    Boolean(quotes[0].builderId) && quotes.every((q) => q.builderId === quotes[0].builderId);
  if (!allSameCustomer && !allSameBuilder) {
    throw httpErr("Os orçamentos precisam ser do mesmo cliente ou do mesmo builder.", 400);
  }

  const woIds = [...new Set(quotes.map((q) => q.workOrderId).filter((id): id is string => Boolean(id)))];
  const draftJobs: { id: string; number: number | null; notes: string | null; address: string | null; customerId: string | null; builderId: string | null }[] = [];
  for (const woId of woIds) {
    const wo = await tx.workOrder.findFirst({
      where: { id: woId },
      select: {
        id: true,
        number: true,
        status: true,
        notes: true,
        address: true,
        customerId: true,
        builderId: true,
      },
    });
    if (!wo) continue;
    if (wo.status !== "draft" && wo.status !== "canceled") {
      if (woIds.length === 1 && quotes.every((q) => q.workOrderId === wo.id)) {
        return { id: wo.id, number: wo.number, created: false, quoteIds: ids };
      }
      throw httpErr(
        "Um dos orçamentos já tem um job em andamento. Não dá para unificar.",
        409,
      );
    }
    if (wo.status === "draft") {
      draftJobs.push(wo);
    }
  }

  const labels = quotes.map((q) => q.quoteNumber || `#${q.number}`);
  const nums = labels.join(" + ");
  const mergedLines: ReturnType<typeof quoteJobLineData> = [];
  let sort = 0;
  for (const q of quotes) {
    const label = q.quoteNumber || `#${q.number}`;
    const rows = quoteJobLineData(params.organizationId, q);
    for (const row of rows) {
      sort += 1;
      const tag = `Orçamento ${label}`;
      if (row.notes === QUOTE_DISCOUNT_NOTE) {
        mergedLines.push({
          ...row,
          serviceName: `${row.serviceName} (${label})`.slice(0, 200),
          sortOrder: sort,
        });
      } else {
        mergedLines.push({
          ...row,
          notes: row.notes ? `${tag} — ${row.notes}`.slice(0, 2000) : tag,
          sortOrder: sort,
        });
      }
    }
  }

  await healCustomerAddressFromLead(tx, quotes[0].customer);
  const person = await quotePersonName(tx, quotes[0]);
  const ident = jobIdentityFromQuote(quotes[0], person);
  const title = `${ident.title} · ${nums}`.slice(0, 200);
  const customerId =
    quotes.find((q) => q.customerId)?.customerId ?? draftJobs[0]?.customerId ?? null;
  const builderId = quotes.find((q) => q.builderId)?.builderId ?? draftJobs[0]?.builderId ?? null;

  let primary = draftJobs[0] || null;
  const orphans = draftJobs.slice(1);
  let created = false;

  if (!primary) {
    const number = await nextWorkOrderNumber(tx, params.organizationId);
    const wo = await tx.workOrder.create({
      data: {
        organizationId: params.organizationId,
        number,
        title,
        status: "draft",
        sourceType: ident.sourceType,
        sourceName: ident.sourceName,
        clientRef: ident.clientRef,
        customerId,
        builderId,
        address: ident.address,
        notes: `Unificado de ${nums}`,
        lineItems: { create: mergedLines },
      },
    });
    primary = {
      id: wo.id,
      number: wo.number,
      notes: wo.notes,
      address: wo.address,
      customerId: wo.customerId,
      builderId: wo.builderId,
    };
    created = true;
  } else {
    const pricingIds = [
      ...new Set(mergedLines.map((row) => row.pricingItemId).filter((id): id is string => Boolean(id))),
    ];
    if (pricingIds.length) {
      const live = await tx.pricingItem.findMany({
        where: { id: { in: pricingIds } },
        select: { id: true },
      });
      const ok = new Set(live.map((row) => row.id));
      for (const row of mergedLines) {
        if (row.pricingItemId && !ok.has(row.pricingItemId)) row.pricingItemId = null;
      }
    }
    await tx.workOrderLineItem.deleteMany({ where: { workOrderId: primary.id } });
    if (mergedLines.length) {
      await tx.workOrderLineItem.createMany({
        data: mergedLines.map((row) => ({ ...row, workOrderId: primary!.id })),
      });
    }
    const nextNotes = primary.notes
      ? /Unificado de/i.test(primary.notes)
        ? primary.notes
        : `${primary.notes}\nUnificado de ${nums}`
      : `Unificado de ${nums}`;
    await tx.workOrder.update({
      where: { id: primary.id },
      data: {
        title,
        notes: nextNotes.slice(0, 8000),
        customerId,
        builderId,
        address: primary.address || ident.address,
        sourceType: ident.sourceType,
        sourceName: ident.sourceName,
        clientRef: ident.clientRef,
      },
    });
  }

  for (const orphan of orphans) {
    await tx.quote.updateMany({
      where: { workOrderId: orphan.id },
      data: { workOrderId: null },
    });
    await tx.workOrder.update({
      where: { id: orphan.id },
      data: { status: "canceled" },
    });
  }

  for (const q of quotes) {
    await tx.quote.update({
      where: { id: q.id },
      data: { workOrderId: primary.id },
    });
    await linkQuoteInvoicesToWorkOrder(tx, q.id, primary.id);
    try {
      await copyFieldQuoteToJob(tx, {
        organizationId: params.organizationId,
        quoteId: q.id,
        workOrderId: primary.id,
      });
    } catch {
      /* best-effort */
    }
  }

  try {
    await ensureJobChatChannel(tx, params.organizationId, primary.id);
  } catch {
    /* best-effort */
  }

  await recordActivity(tx, {
    organizationId: params.organizationId,
    entityType: "work_order",
    entityId: primary.id,
    actorType: params.actorId ? "user" : "system",
    actorId: params.actorId ?? null,
    action: "work_order.merged_from_quotes",
    changes: {
      quoteIds: { from: null, to: ids },
      labels: { from: null, to: nums },
    },
  });
  for (const q of quotes) {
    await recordActivity(tx, {
      organizationId: params.organizationId,
      entityType: "quote",
      entityId: q.id,
      actorType: params.actorId ? "user" : "system",
      actorId: params.actorId ?? null,
      action: "quote.merged_into_job",
      changes: {
        workOrderId: { from: q.workOrderId, to: primary.id },
        with: { from: null, to: ids.filter((id) => id !== q.id) },
      },
    });
  }

  return { id: primary.id, number: primary.number, created, quoteIds: ids };
}
