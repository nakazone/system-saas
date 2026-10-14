import { prisma } from "../prisma.js";
import { storage } from "../storage/index.js";
import { KEEP_ON_DELETE, countRows, hasSessionTable, inTenant, orgTables, quoteIdent } from "./tables.js";

/**
 * Excluir uma empresa de vez.
 * Rules: the company must be canceled; and canceled for 90+ days OR have an open formal deletion
 * request; and have a finished export (or the operator records why there is none). Everything
 * with its organizationId goes (database rows and every file under orgs/<id>/). What stays:
 * the deletion receipt, the privacy request, the export (until it expires) and the audit log.
 */

export const CANCELED_DAYS = 90;
const DAY = 86400e3;

export type DeletionCheck = {
  canDelete: boolean;
  canceled: boolean;
  canceledDays: number | null;
  daysLeft: number | null;
  request: { id: string; receivedAt: Date } | null;
  exportReady: { id: string; createdAt: Date; status: string } | null;
  blockers: string[];
};

export async function deletionCheck(organizationId: string, now = new Date()): Promise<DeletionCheck> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { status: true, canceledAt: true } });
  if (!org) return { canDelete: false, canceled: false, canceledDays: null, daysLeft: null, request: null, exportReady: null, blockers: ["Empresa não encontrada."] };
  const canceled = org.status === "canceled";
  const canceledDays = canceled && org.canceledAt ? Math.floor((now.getTime() - org.canceledAt.getTime()) / DAY) : canceled ? 0 : null;
  const request = await prisma.privacyRequest.findFirst({
    where: { organizationId, kind: "deletion", subjectType: "company", status: { in: ["received", "in_progress"] } },
    orderBy: { receivedAt: "asc" },
    select: { id: true, receivedAt: true },
  });
  const exportReady = await prisma.dataExport.findFirst({
    where: { organizationId, status: { in: ["ready", "expired"] }, createdAt: { gte: new Date(now.getTime() - 90 * DAY) } },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, status: true },
  });
  const blockers: string[] = [];
  if (!canceled) blockers.push("A empresa precisa estar cancelada.");
  else if ((canceledDays ?? 0) < CANCELED_DAYS && !request) blockers.push(`Cancelada há ${canceledDays} dia(s). Só depois de ${CANCELED_DAYS} dias, ou com pedido formal de exclusão registrado.`);
  const daysLeft = canceled && canceledDays != null ? Math.max(0, CANCELED_DAYS - canceledDays) : null;
  return { canDelete: blockers.length === 0, canceled, canceledDays, daysLeft, request, exportReady, blockers };
}

export async function deleteCompany(input: {
  organizationId: string;
  confirmSlug: string;
  reason: string;
  exportSkippedWhy?: string | null;
  performedById: string | null;
  performedByName: string;
}) {
  const org = await prisma.organization.findUnique({ where: { id: input.organizationId }, select: { id: true, name: true, slug: true } });
  if (!org) throw new Error("Empresa não encontrada.");
  if (input.confirmSlug.trim().toLowerCase() !== org.slug) throw new Error(`Digite exatamente o endereço da empresa: ${org.slug}`);
  const check = await deletionCheck(org.id);
  if (!check.canDelete) throw new Error(check.blockers.join(" "));
  if (!check.exportReady && !input.exportSkippedWhy?.trim()) throw new Error("Gere a exportação antes, ou diga por que não vai gerar.");
  if (!input.reason.trim()) throw new Error("Escreva o motivo.");

  const counts = await countRows(org.id, { skip: KEEP_ON_DELETE });
  counts.Organization = 1;
  const userIds = (await inTenant(org.id, (tx) => tx.user.findMany({ where: { organizationId: org.id }, select: { id: true } }))).map((u) => u.id);

  await inTenant(
    org.id,
    async (tx) => {
      // Rows with a foreign key to Organization go with it (ON DELETE CASCADE).
      await tx.$executeRaw`DELETE FROM "Organization" WHERE id = ${org.id}::uuid`;
      // The rest (logs and counters without a foreign key).
      for (const t of await orgTables()) {
        if (KEEP_ON_DELETE.has(t.name)) continue;
        await tx.$executeRawUnsafe(`DELETE FROM ${quoteIdent(t.name)} WHERE "organizationId" = $1::uuid`, org.id);
      }
      await tx.$executeRaw`UPDATE "PlatformAnnouncement" SET "organizationIds" = array_remove("organizationIds", ${org.id}::uuid) WHERE ${org.id}::uuid = ANY("organizationIds")`;
      await tx.$executeRaw`UPDATE "ErrorGroup" SET "lastOrgId" = NULL, "lastUserId" = NULL WHERE "lastOrgId" = ${org.id}::uuid`;
      if (await hasSessionTable(tx)) await tx.$executeRaw`DELETE FROM "session" WHERE sess->>'organizationId' = ${org.id} OR sess->>'userId' = ANY(${userIds}::text[])`;
    },
    600_000,
  );

  let filesDeleted = 0;
  let filesError: string | null = null;
  try {
    filesDeleted = await storage.deletePrefix(`orgs/${org.id}/`);
  } catch (error) {
    filesError = error instanceof Error ? error.message : String(error);
  }

  const receipt = await prisma.dataDeletion.create({
    data: {
      kind: "company",
      organizationId: org.id,
      orgName: org.name,
      orgSlug: org.slug,
      counts,
      filesDeleted,
      reason: input.reason.trim(),
      privacyRequestId: check.request?.id ?? null,
      exportId: check.exportReady?.id ?? null,
      exportSkippedWhy: check.exportReady ? null : input.exportSkippedWhy?.trim() || null,
      performedById: input.performedById,
      performedByName: input.performedByName,
    },
  });
  return { receipt, filesError };
}

/** Totals for the receipt and the confirmation dialog. */
export function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}
