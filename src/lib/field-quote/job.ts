import { Prisma } from "@prisma/client";
import type { TenantPrisma } from "../tenant/prisma-tenant.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * When the quote made from a Field Quote becomes a job: photos go to the job's ObraCam
 * and the "Atenção" notes from the visit go to the job's field section.
 */
export async function copyFieldQuoteToJob(
  tx: TenantPrisma,
  params: { organizationId: string; quoteId: string; workOrderId: string },
): Promise<number> {
  const fq = await tx.fieldQuote.findFirst({ where: { organizationId: params.organizationId, quoteId: params.quoteId } });
  if (!fq) return 0;
  const data = fq.data && typeof fq.data === "object" && !Array.isArray(fq.data) ? (fq.data as Record<string, unknown>) : {};
  const photos = Array.isArray(data.photos) ? (data.photos as Array<Record<string, unknown>>) : [];
  const rooms = Array.isArray(data.rooms) ? (data.rooms as Array<Record<string, unknown>>) : [];
  let n = 0;
  for (const p of photos) {
    if (!p || !p.url || !p.key) continue;
    const room = rooms.find((r) => r && r.id === p.room_id);
    await tx.jobMedia.create({
      data: {
        organizationId: params.organizationId,
        workOrderId: params.workOrderId,
        authorId: p.author_id && UUID_RE.test(String(p.author_id)) ? String(p.author_id) : null,
        type: "photo",
        storageKey: String(p.key),
        url: String(p.url),
        sha256: String(p.sha256 || ""),
        takenAtDevice: p.taken_at ? new Date(String(p.taken_at)) : null,
        lat: p.lat != null ? new Prisma.Decimal(Number(p.lat)) : null,
        lng: p.lng != null ? new Prisma.Decimal(Number(p.lng)) : null,
        address: fq.address,
        caption: [room ? String(room.label || room.name || "") : "", p.caption ? String(p.caption) : "", "Visita (Field Quote)"].filter(Boolean).join(" · ").slice(0, 300),
        stage: "before",
        clientUploadId: `fq:${String(p.id)}`,
        deviceLabel: "Field Quote",
      },
    });
    n++;
  }
  const attention = typeof data.attention_summary === "string" ? data.attention_summary.trim() : "";
  if (attention) {
    const wo = await tx.workOrder.findFirst({ where: { id: params.workOrderId }, select: { campoAttention: true } });
    if (wo && !wo.campoAttention) {
      await tx.workOrder.update({ where: { id: params.workOrderId }, data: { campoAttention: attention.slice(0, 2000) } });
    }
  }
  return n;
}
