/**
 * Samples de stain — reading and shaping a job's rounds for the CRM job page and the field app.
 */
import type { TenantPrisma } from "../tenant/prisma-tenant.js";
import { DURASEAL_COLORS, WOOD_SPECIES, parseBlend, sampleColorText, sampleDisplayName, sampleSubText } from "./catalog.js";

export const ROUND_STATUS_PT: Record<string, string> = {
  draft: "Rascunho",
  sent: "Enviado",
  viewed: "Visto pela cliente",
  approved: "Aprovado",
  changes_requested: "Pediu outra amostra",
  superseded: "Substituído",
};

export function mediaIdsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export const roundInclude = {
  samples: { orderBy: { number: "asc" as const } },
  approvals: { orderBy: { createdAt: "asc" as const } },
};

type RoundWithAll = Awaited<ReturnType<typeof loadRounds>>[number];

export async function loadRounds(tx: TenantPrisma, organizationId: string, workOrderId: string) {
  return tx.stainSampleRound.findMany({
    where: { organizationId, workOrderId },
    orderBy: { number: "asc" },
    include: roundInclude,
  });
}

export async function mediaMap(tx: TenantPrisma, organizationId: string, ids: string[]) {
  if (!ids.length) return new Map<string, { id: string; url: string; thumbUrl: string | null; storageKey: string; createdAt: Date }>();
  const rows = await tx.jobMedia.findMany({
    where: { organizationId, id: { in: ids }, deletedAt: null },
    select: { id: true, url: true, thumbUrl: true, storageKey: true, createdAt: true },
  });
  return new Map(rows.map((r) => [r.id, r]));
}

export function allMediaIds(rounds: Array<{ boardMediaId: string | null; samples: Array<{ mediaIds: unknown }> }>): string[] {
  const ids = new Set<string>();
  for (const r of rounds) {
    if (r.boardMediaId) ids.add(r.boardMediaId);
    for (const s of r.samples) for (const id of mediaIdsOf(s.mediaIds)) ids.add(id);
  }
  return [...ids];
}

export function serializeSample(
  s: RoundWithAll["samples"][number],
  media: Map<string, { id: string; url: string; thumbUrl: string | null }>,
) {
  const photos = mediaIdsOf(s.mediaIds)
    .map((id) => media.get(id))
    .filter(Boolean)
    .map((m) => ({ id: m!.id, url: m!.url, thumb_url: m!.thumbUrl || m!.url }));
  return {
    id: s.id,
    number: s.number,
    kind: s.kind,
    brand: s.brand,
    color_name: s.colorName,
    blend: parseBlend(s.blend),
    label: sampleColorText(s),
    display_name: sampleDisplayName(s),
    sub: sampleSubText(s, "pt"),
    photos,
  };
}

export function serializeRound(r: RoundWithAll, media: Map<string, { id: string; url: string; thumbUrl: string | null }>) {
  const board = r.boardMediaId ? media.get(r.boardMediaId) : null;
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    status_label: ROUND_STATUS_PT[r.status] || r.status,
    wood_species: r.woodSpecies,
    room: r.room,
    notes: r.notes,
    recipient_name: r.recipientName,
    recipient_email: r.recipientEmail,
    send_to_builder: r.sendToBuilder,
    created_by_name: r.createdByName,
    created_at: r.createdAt,
    sent_at: r.sentAt,
    viewed_at: r.viewedAt,
    decided_at: r.decidedAt,
    builder_notified_at: r.builderNotifiedAt,
    editable: r.status === "draft",
    board: board ? { id: board.id, url: board.url, thumb_url: board.thumbUrl || board.url } : null,
    samples: r.samples.map((s) => serializeSample(s, media)),
    answers: r.approvals.map((a) => ({
      id: a.id,
      decision: a.decision,
      sample_id: a.sampleId,
      signer_name: a.signerName,
      comment: a.comment,
      at: a.createdAt,
      has_pdf: Boolean(a.pdfKey),
    })),
  };
}

/** Everything the job page and the field app show about the job's stain. */
export async function jobStainState(tx: TenantPrisma, organizationId: string, workOrderId: string) {
  const job = await tx.workOrder.findFirst({
    where: { id: workOrderId, organizationId },
    select: {
      id: true, number: true, title: true, address: true, status: true, sector: true, approvedStainSampleId: true, builderId: true,
      builder: { select: { company: true, firstName: true, lastName: true } },
      customer: { select: { name: true, email: true } },
    },
  });
  if (!job) return null;
  const rounds = await loadRounds(tx, organizationId, workOrderId);
  const media = await mediaMap(tx, organizationId, allMediaIds(rounds));
  const serialized = rounds.map((r) => serializeRound(r, media));
  let approved: null | {
    sample: ReturnType<typeof serializeSample>;
    round_id: string;
    round_number: number;
    approval_id: string;
    signer_name: string | null;
    signed_at: Date;
    builder_notified_at: Date | null;
    has_pdf: boolean;
  } = null;
  if (job.approvedStainSampleId) {
    for (const r of rounds) {
      const s = r.samples.find((x) => x.id === job.approvedStainSampleId);
      if (!s) continue;
      const a = [...r.approvals].reverse().find((x) => x.decision === "approved" && x.sampleId === s.id);
      if (!a) continue;
      approved = {
        sample: serializeSample(s, media),
        round_id: r.id,
        round_number: r.number,
        approval_id: a.id,
        signer_name: a.signerName,
        signed_at: a.createdAt,
        builder_notified_at: r.builderNotifiedAt,
        has_pdf: Boolean(a.pdfKey),
      };
    }
  }
  const builderName = job.builder?.company || [job.builder?.firstName, job.builder?.lastName].filter(Boolean).join(" ") || null;
  return {
    job: {
      id: job.id,
      number: job.number,
      title: job.title,
      address: job.address,
      status: job.status,
      sector: job.sector,
      has_builder: Boolean(job.builderId),
      builder_name: builderName,
      customer_name: job.customer?.name || null,
      customer_email: job.customer?.email || null,
    },
    approved,
    rounds: serialized,
    history: historyOf(serialized),
    catalog: { duraseal: DURASEAL_COLORS, wood_species: WOOD_SPECIES },
  };
}

export function historyOf(rounds: ReturnType<typeof serializeRound>[]) {
  const out: Array<{ at: Date; text: string; strong?: boolean }> = [];
  for (const r of rounds) {
    const n = rounds.length > 1 ? ` (rodada ${r.number})` : "";
    out.push({ at: r.created_at, text: `${r.created_by_name || "Equipe"} criou a rodada com ${r.samples.length} sample${r.samples.length === 1 ? "" : "s"}${n}` });
    if (r.sent_at) out.push({ at: r.sent_at, text: r.recipient_email ? `Link enviado a ${r.recipient_email}` : "Link aberto para a cliente aprovar" });
    if (r.viewed_at) out.push({ at: r.viewed_at, text: "Cliente abriu o link" });
    for (const a of r.answers) {
      if (a.decision === "approved") {
        const s = r.samples.find((x) => x.id === a.sample_id);
        out.push({ at: a.at, text: `${a.signer_name || "Cliente"} aprovou e assinou ${s ? `#${s.number} ${s.label}` : "a cor"}`, strong: true });
      } else {
        out.push({ at: a.at, text: `Cliente pediu outra amostra${a.comment ? `: "${a.comment}"` : ""}` });
      }
    }
    if (r.builder_notified_at) out.push({ at: r.builder_notified_at, text: "Aprovação enviada ao builder (ObraBuilder)" });
  }
  return out.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}
