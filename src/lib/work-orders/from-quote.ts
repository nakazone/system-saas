/**
 * When a quote is approved, ensure a Job (WorkOrder) exists and is linked via Quote.workOrderId.
 * Idempotent: re-approving / re-saving approved quotes returns the existing job.
 */
import { copyFieldQuoteToJob } from "../field-quote/job.js";
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
  const quote = await tx.quote.findFirst({
    where: { id: params.quoteId },
    include: {
      property: true,
      customer: { select: { id: true, name: true, customerType: true } },
      builder: { select: { id: true, company: true, firstName: true, lastName: true, type: true } },
      lineItems: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!quote) return null;

  if (quote.workOrderId) {
    const existing = await tx.workOrder.findFirst({ where: { id: quote.workOrderId } });
    if (existing) {
      return { id: existing.id, number: existing.number, created: false };
    }
  }

  const payload = payloadOf(quote.payload);
  const jobName = String(payload.job_name || "").trim();
  const jobAddress = String(payload.job_address || "").trim();
  const title = (jobName || quote.title || `Quote ${quote.quoteNumber || quote.number}`).trim();
  const address =
    formatPropertyAddress(quote.property) ||
    jobAddress ||
    null;

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

  const sourceName =
    quote.builder?.company ||
    [quote.builder?.firstName, quote.builder?.lastName].filter(Boolean).join(" ") ||
    quote.customer?.name ||
    `Orçamento ${quote.quoteNumber || quote.number}`;

  const number = await nextWorkOrderNumber(tx, params.organizationId);

  const selectedLines = quote.lineItems.filter((li) => !li.isOptional || li.isSelected);

  const wo = await tx.workOrder.create({
    data: {
      organizationId: params.organizationId,
      number,
      title: title.slice(0, 200) || `Job #${number}`,
      status: "draft",
      sourceType,
      sourceName: sourceName || null,
      customerId: quote.customerId,
      builderId: quote.builderId,
      address,
      notes: quote.notes,
      lineItems: {
        create: selectedLines.map((li, idx) => {
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
            organizationId: params.organizationId,
            pricingItemId,
            serviceName: String(li.name || li.description || "Serviço").slice(0, 200),
            quantitySqft: new Prisma.Decimal(qty),
            unitPrice: new Prisma.Decimal(unitPrice),
            lineTotal: new Prisma.Decimal(amount),
            sortOrder: li.sortOrder ?? idx,
          };
        }),
      },
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

  return { id: wo.id, number: wo.number, created: true };
}
