import { Prisma } from "@prisma/client";
import type { TenantPrisma } from "../tenant/prisma-tenant.js";
import { snapshotFields } from "../checklists/engine.js";
import type { ChecklistField } from "../checklists/defaults.js";

export async function ensureVisitChecklistResponse(
  tx: TenantPrisma,
  params: {
    organizationId: string;
    visitId: string;
    phase: string;
  },
) {
  const visit = await tx.visit.findFirst({ where: { id: params.visitId } });
  if (!visit) throw new Error("Visit not found");

  if (visit.checklistResponseId) {
    const existing = await tx.checklistResponse.findFirst({
      where: { id: visit.checklistResponseId },
    });
    if (existing) return existing;
  }

  const template = await tx.checklistTemplate.findFirst({
    where: {
      appliesTo: "visit",
      active: true,
      OR: [{ visitPhase: params.phase }, { visitPhase: null }],
    },
    orderBy: [{ visitPhase: "desc" }, { sortOrder: "asc" }],
  });

  // Prefer exact phase match
  const exact = await tx.checklistTemplate.findFirst({
    where: { appliesTo: "visit", active: true, visitPhase: params.phase },
    orderBy: { sortOrder: "asc" },
  });
  const chosen = exact || template;
  if (!chosen) return null;

  const response = await tx.checklistResponse.create({
    data: {
      organizationId: params.organizationId,
      templateId: chosen.id,
      templateSnapshot: {
        name: chosen.name,
        appliesTo: chosen.appliesTo,
        visitPhase: chosen.visitPhase,
        fields: snapshotFields(chosen.fields),
      } as Prisma.InputJsonValue,
      entityType: "visit",
      entityId: visit.id,
      answers: {},
    },
  });

  await tx.visit.update({
    where: { id: visit.id },
    data: { checklistResponseId: response.id },
  });

  return response;
}

export type VisitSnapshot = {
  fields: ChecklistField[];
  name?: string;
};
