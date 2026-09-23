import { Prisma } from "@prisma/client";
import type { TenantPrisma } from "../tenant/prisma-tenant.js";
import {
  DEFAULT_CHECKLIST_TEMPLATES,
  type ChecklistField,
} from "./defaults.js";

export function isAssessmentOverdue(assessment: {
  status: string;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
}, now = new Date()): boolean {
  if (assessment.status !== "scheduled") return false;
  const due = assessment.scheduledEnd ?? assessment.scheduledStart;
  if (!due) return false;
  return due.getTime() < now.getTime();
}

function parseRoomRows(rooms: unknown): { name: string; areaSqft: number }[] {
  if (!Array.isArray(rooms)) return [];
  return rooms
    .map((r) => {
      if (!r || typeof r !== "object") return null;
      const row = r as Record<string, unknown>;
      const name = String(row.name || "").trim();
      const areaSqft = Number(row.areaSqft ?? row.area ?? 0);
      if (!name || !(areaSqft > 0)) return null;
      return { name, areaSqft };
    })
    .filter((r): r is { name: string; areaSqft: number } => Boolean(r));
}

/** Prefer answers.rooms; otherwise first answer value that looks like room rows. */
export function extractMeasurementRooms(answers: unknown): { name: string; areaSqft: number }[] {
  if (!answers || typeof answers !== "object") return [];
  const map = answers as Record<string, unknown>;
  const fromRooms = parseRoomRows(map.rooms);
  if (fromRooms.length) return fromRooms;
  for (const value of Object.values(map)) {
    const parsed = parseRoomRows(value);
    if (parsed.length) return parsed;
  }
  return [];
}

export async function seedDefaultChecklistTemplates(
  tx: TenantPrisma,
  organizationId: string,
): Promise<void> {
  const existing = await tx.checklistTemplate.count({ where: { organizationId } });
  if (existing > 0) return;

  for (const tpl of DEFAULT_CHECKLIST_TEMPLATES) {
    await tx.checklistTemplate.create({
      data: {
        organizationId,
        name: tpl.name,
        appliesTo: tpl.appliesTo,
        visitPhase: tpl.visitPhase ?? null,
        fields: tpl.fields as unknown as Prisma.InputJsonValue,
        sortOrder: tpl.sortOrder,
        active: true,
      },
    });
  }
}

export function snapshotFields(fields: unknown): ChecklistField[] {
  if (!Array.isArray(fields)) return [];
  return fields.map((f) => ({ ...(f as ChecklistField) }));
}

export async function ensureAssessmentResponse(
  tx: TenantPrisma,
  params: {
    organizationId: string;
    assessmentId: string;
    userId?: string | null;
  },
) {
  const assessment = await tx.siteAssessment.findFirst({
    where: { id: params.assessmentId },
  });
  if (!assessment) throw new Error("Assessment not found");

  if (assessment.checklistResponseId) {
    const existing = await tx.checklistResponse.findFirst({
      where: { id: assessment.checklistResponseId },
    });
    if (existing) return existing;
  }

  const template = await tx.checklistTemplate.findFirst({
    where: { appliesTo: "site_assessment", active: true },
    orderBy: { sortOrder: "asc" },
  });
  if (!template) throw new Error("No site assessment checklist template found");

  const response = await tx.checklistResponse.create({
    data: {
      organizationId: params.organizationId,
      templateId: template.id,
      templateSnapshot: {
        name: template.name,
        appliesTo: template.appliesTo,
        visitPhase: template.visitPhase,
        fields: snapshotFields(template.fields),
      } as Prisma.InputJsonValue,
      entityType: "site_assessment",
      entityId: assessment.id,
      answers: {},
    },
  });

  await tx.siteAssessment.update({
    where: { id: assessment.id },
    data: { checklistResponseId: response.id },
  });

  return response;
}
