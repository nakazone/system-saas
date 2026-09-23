import { Prisma } from "@prisma/client";
import type { TenantPrisma } from "../tenant/prisma-tenant.js";
import { recordActivity } from "../activity/record.js";
import { transitionQuote } from "../quotes/transitions.js";
import { freezeProjectBudget } from "./costs.js";
import { moveLeadForQuoteEvent } from "../pipeline/move.js";

export async function nextProjectNumber(
  tx: TenantPrisma,
  organizationId: string,
): Promise<number> {
  await tx.$executeRaw`
    INSERT INTO "DocumentSequence" ("id", "organizationId", "kind", "nextValue")
    VALUES (gen_random_uuid(), ${organizationId}::uuid, 'project', 1)
    ON CONFLICT ("organizationId", "kind") DO NOTHING
  `;
  const rows = await tx.$queryRaw<{ nextValue: number }[]>`
    SELECT "nextValue" FROM "DocumentSequence"
    WHERE "organizationId" = ${organizationId}::uuid AND "kind" = 'project'
    FOR UPDATE
  `;
  const current = rows[0]?.nextValue ?? 1;
  await tx.$executeRaw`
    UPDATE "DocumentSequence"
    SET "nextValue" = ${current + 1}
    WHERE "organizationId" = ${organizationId}::uuid AND "kind" = 'project'
  `;
  return current;
}

/** Derived status: open invoices remaining after installation phase suggests needs_invoicing. */
export async function refreshProjectStatus(
  tx: TenantPrisma,
  projectId: string,
): Promise<string> {
  const project = await tx.project.findFirst({
    where: { id: projectId },
    include: {
      visits: { where: { status: { not: "canceled" } } },
      quote: { include: { invoices: { where: { status: { not: "void" } } } } },
    },
  });
  if (!project) throw new Error("Project not found");
  if (project.status === "canceled" || project.status === "completed") {
    return project.status;
  }

  const visits = project.visits;
  const hasScheduled = visits.some((v) => v.status === "scheduled" || v.status === "in_progress");
  const allDone = visits.length > 0 && visits.every((v) => v.status === "completed");
  const unpaid =
    project.quote?.invoices.some((i) => i.status !== "paid") ??
    false;

  let next = project.status;
  if (allDone && unpaid) next = "needs_invoicing";
  else if (allDone && !unpaid) next = "completed";
  else if (visits.some((v) => v.status === "in_progress")) next = "in_progress";
  else if (hasScheduled) next = "scheduled";
  else if (visits.length === 0) next = "planning";

  if (next !== project.status) {
    await tx.project.update({ where: { id: projectId }, data: { status: next } });
  }
  return next;
}

export async function convertQuoteToProject(
  tx: TenantPrisma,
  params: {
    organizationId: string;
    quoteId: string;
    actorId?: string | null;
  },
) {
  const quote = await tx.quote.findFirst({
    where: { id: params.quoteId },
    include: {
      customer: true,
      property: true,
      paymentSchedule: { include: { items: { orderBy: { sortOrder: "asc" } } } },
      project: true,
    },
  });
  if (!quote) throw new Error("Quote not found");
  if (quote.project) return quote.project;
  if (quote.status !== "approved" && quote.status !== "converted") {
    throw new Error("Only approved quotes can convert to a project");
  }

  const number = await nextProjectNumber(tx, params.organizationId);
  const address = quote.property
    ? [quote.property.line1, quote.property.city, quote.property.state, quote.property.postalCode]
        .filter(Boolean)
        .join(", ")
    : null;

  const project = await tx.project.create({
    data: {
      organizationId: params.organizationId,
      number,
      quoteId: quote.id,
      customerId: quote.customerId,
      propertyId: quote.propertyId,
      builderId: quote.builderId,
      name: quote.title || `Project #${number}`,
      status: "planning",
      address,
      notes: quote.notes,
    },
  });

  if (quote.paymentSchedule) {
    const copy = await tx.paymentSchedule.create({
      data: {
        organizationId: params.organizationId,
        projectId: project.id,
        lockedAt: new Date(),
        sourceTemplateId: quote.paymentSchedule.sourceTemplateId,
      },
    });
    for (const item of quote.paymentSchedule.items) {
      await tx.paymentScheduleItem.create({
        data: {
          organizationId: params.organizationId,
          scheduleId: copy.id,
          label: item.label,
          percent: item.percent,
          fixedAmount: item.fixedAmount,
          trigger: item.trigger,
          phaseKey: item.phaseKey,
          sortOrder: item.sortOrder,
        },
      });
    }
    if (!quote.paymentSchedule.lockedAt) {
      await tx.paymentSchedule.update({
        where: { id: quote.paymentSchedule.id },
        data: { lockedAt: new Date() },
      });
    }
  }

  await freezeProjectBudget(tx, {
    organizationId: params.organizationId,
    projectId: project.id,
    quoteId: quote.id,
  });

  if (quote.status === "approved") {
    const result = transitionQuote(quote.status, "convert");
    if (result.ok) {
      await tx.quote.update({
        where: { id: quote.id },
        data: { status: result.next },
      });
      await recordActivity(tx, {
        organizationId: params.organizationId,
        entityType: "quote",
        entityId: quote.id,
        actorType: params.actorId ? "user" : "system",
        actorId: params.actorId ?? null,
        action: "status_changed",
        changes: { status: { from: quote.status, to: result.next } },
      });
    }
  }

  await tx.projectEvent.create({
    data: {
      organizationId: params.organizationId,
      projectId: project.id,
      type: "converted",
      actorId: params.actorId ?? null,
      payload: { quoteId: quote.id } as Prisma.InputJsonValue,
    },
  });

  await recordActivity(tx, {
    organizationId: params.organizationId,
    entityType: "project",
    entityId: project.id,
    actorType: params.actorId ? "user" : "system",
    actorId: params.actorId ?? null,
    action: "created",
    changes: { fromQuote: { from: null, to: quote.id } },
  });

  await moveLeadForQuoteEvent(tx, {
    organizationId: params.organizationId,
    quoteId: quote.id,
    slug: "won",
    actorType: params.actorId ? "user" : "system",
    actorId: params.actorId,
  });

  return project;
}
