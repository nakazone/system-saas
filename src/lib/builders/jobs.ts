import type { TenantPrisma } from "../tenant/prisma-tenant.js";

export type ApplyResult =
  | { kind: "missing" }
  | { kind: "closed" }
  | { kind: "accepted"; job_id: string; updated?: boolean };

/**
 * Turns a portal request into a job: a new WorkOrder (status draft, "Recebido"),
 * or — when the builder asked to update a job — an update appended to that job.
 * Used by the office "Aceitar" button and, for builder accounts, right when the builder sends.
 */
export async function applyPartnerRequest(
  tx: TenantPrisma,
  organizationId: string,
  requestId: string,
  reviewNote: string | null | undefined,
): Promise<ApplyResult> {
  const request = await tx.partnerJobRequest.findFirst({
    where: { id: requestId, organizationId: organizationId },
    include: { partnerUser: { select: { companyName: true, builder: { select: { company: true, type: true } }, customer: { select: { company: true, name: true, customerType: true } } } } },
  });
  if (!request) return { kind: "missing" as const };
  if (request.status === "accepted" && request.workOrderId) {
    return { kind: "accepted" as const, job_id: request.workOrderId };
  }
  if (request.status !== "pending") return { kind: "closed" as const };
  if (request.targetWorkOrderId) {
    const target = await tx.workOrder.findFirst({
      where: { id: request.targetWorkOrderId, organizationId: organizationId, status: { not: "canceled" } },
      select: { id: true, notes: true },
    });
    if (target) {
      const stamp = new Date().toISOString().slice(0, 10);
      const update = [
        `Atualização do builder pelo portal (${stamp}): ${request.title}`,
        request.externalRef ? `Nº do builder: ${request.externalRef}` : "",
        request.serviceType ? `Serviço: ${request.serviceType}` : "",
        request.preferredDate ? `Data solicitada: ${request.preferredDate.toISOString().slice(0, 10)}` : "",
        request.notes ? `Detalhes: ${request.notes}` : "",
      ].filter(Boolean).join("\n");
      await tx.workOrder.update({
        where: { id: target.id },
        data: { notes: [target.notes, update].filter(Boolean).join("\n\n") },
      });
      await tx.partnerJobRequest.update({
        where: { id: request.id },
        data: { status: "accepted", workOrderId: target.id, reviewedAt: new Date(), reviewNote: reviewNote || null },
      });
      return { kind: "accepted" as const, job_id: target.id, updated: true };
    }
  }
  const partnerType = (request.partnerUser.builder?.type || request.partnerUser.customer?.customerType || "builder").toLowerCase();
  const sourceType = partnerType === "contractor" ? "contractor" : "builder";
  const sourceName = request.partnerUser.companyName || request.partnerUser.builder?.company || request.partnerUser.customer?.company || request.partnerUser.customer?.name || "Builder";
  const notes = [
    `Pedido enviado pelo portal do parceiro (${request.contactName || sourceName}).`,
    request.contactEmail ? `E-mail: ${request.contactEmail}` : "",
    request.contactPhone ? `Telefone: ${request.contactPhone}` : "",
    request.serviceType ? `Serviço: ${request.serviceType}` : "",
    request.preferredDate ? `Data solicitada: ${request.preferredDate.toISOString().slice(0, 10)}` : "",
    request.externalRef ? `Nº do builder: ${request.externalRef}` : "",
    request.notes ? `Detalhes: ${request.notes}` : "",
  ].filter(Boolean).join("\n");
  await tx.$executeRaw`
    INSERT INTO "DocumentSequence" ("id", "organizationId", "kind", "nextValue")
    VALUES (gen_random_uuid(), ${organizationId}::uuid, 'work_order', 1)
    ON CONFLICT ("organizationId", "kind") DO NOTHING
  `;
  const sequence = await tx.$queryRaw<{ nextValue: number }[]>`
    SELECT "nextValue" FROM "DocumentSequence"
    WHERE "organizationId" = ${organizationId}::uuid AND "kind" = 'work_order'
    FOR UPDATE
  `;
  const number = sequence[0]?.nextValue ?? 1;
  await tx.$executeRaw`
    UPDATE "DocumentSequence"
    SET "nextValue" = ${number + 1}
    WHERE "organizationId" = ${organizationId}::uuid AND "kind" = 'work_order'
  `;
  const workOrder = await tx.workOrder.create({
    data: {
      organizationId: organizationId,
      number,
      title: request.title,
      status: "draft",
      sourceType,
      sourceName,
      customerId: request.customerId,
      builderId: request.builderId,
      address: request.address,
      notes,
    },
    select: { id: true },
  });
  await tx.partnerJobRequest.update({
    where: { id: request.id },
    data: { status: "accepted", workOrderId: workOrder.id, reviewedAt: new Date(), reviewNote: reviewNote || null },
  });
  return { kind: "accepted" as const, job_id: workOrder.id };
}
