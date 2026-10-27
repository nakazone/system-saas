/**
 * Builder edits on a job (applies right away). Every change is listed so the office gets
 * one notification and the job keeps an activity row saying who changed what.
 */
import { z } from "zod";
import type { TenantPrisma } from "../tenant/prisma-tenant.js";
import { recordActivity } from "../activity/record.js";
import { safeTimeZone, zonedParts, zonedWallTimeToUtc } from "../time/zoned.js";
import { parseLockbox, stripLockbox } from "../../modules/work-orders/public-ticket.js";

export const jobEditSchema = z.object({
  title: z.string().trim().min(3).max(160).optional(),
  address: z.string().trim().min(4).max(300).optional(),
  /** YYYY-MM-DD; "" clears the date. */
  start_date: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional(),
  /** HH:MM; "" = all day. */
  start_time: z.union([z.string().regex(/^\d{2}:\d{2}$/), z.literal("")]).optional(),
  end_date: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional(),
  instructions: z.string().max(5000).optional(),
  lockbox: z.string().trim().max(40).optional(),
  attention: z.string().max(2000).optional(),
  services: z.array(z.object({
    id: z.string().uuid().optional(),
    pricing_item_id: z.string().uuid().optional(),
    quantity: z.number().min(0).max(1_000_000),
    notes: z.string().max(500).optional(),
    remove: z.boolean().optional(),
  })).max(60).optional(),
});

export type JobEditInput = z.infer<typeof jobEditSchema>;

/** Rebuilds the notes with the lockbox code on the first line (the format the crew ticket reads). */
export function notesWithLockbox(instructions: string, lockbox: string): string {
  const body = stripLockbox(instructions).trim();
  const code = lockbox.trim();
  if (!code) return body;
  return body ? `/lockbox ${code}\n${body}` : `/lockbox ${code}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export class JobEditError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function applyBuilderJobEdit(
  tx: TenantPrisma,
  params: {
    organizationId: string;
    jobId: string;
    scope: { OR: Array<{ builderId?: string; customerId?: string }> };
    input: JobEditInput;
    timezone: string | null | undefined;
    actor: { partnerUserId: string; name: string; builder: string };
  },
): Promise<{ changes: string[]; job: { id: string; number: number | null; title: string } }> {
  const { organizationId, input } = params;
  const job = await tx.workOrder.findFirst({
    where: { id: params.jobId, organizationId, ...params.scope, status: { not: "canceled" } },
    select: { id: true, number: true, title: true, status: true, address: true, notes: true, campoAttention: true, scheduledStart: true, scheduledEnd: true, allDay: true },
  });
  if (!job) throw new JobEditError(404, "Job não encontrado.");
  if (["completed", "needs_invoicing"].includes(job.status)) throw new JobEditError(409, "Job concluído não pode mais ser alterado pelo portal. Fale com a empresa.");

  const tz = safeTimeZone(params.timezone);
  const data: Record<string, unknown> = {};
  const changes: string[] = [];
  const diff: Record<string, { from: unknown; to: unknown }> = {};

  if (input.title !== undefined && input.title !== job.title) {
    data.title = input.title;
    changes.push(`Título: ${input.title}`);
    diff.title = { from: job.title, to: input.title };
  }
  if (input.address !== undefined && input.address !== (job.address || "")) {
    data.address = input.address;
    data.geoLat = null;
    data.geoLng = null;
    data.geoCheckedAt = null;
    changes.push(`Endereço: ${input.address}`);
    diff.address = { from: job.address, to: input.address };
  }

  if (input.start_date !== undefined) {
    if (!input.start_date) {
      if (job.scheduledStart) {
        data.scheduledStart = null;
        data.scheduledEnd = null;
        changes.push("Data: removida (sem data)");
        diff.scheduledStart = { from: job.scheduledStart, to: null };
      }
    } else {
      const [y, m, d] = input.start_date.split("-").map(Number) as [number, number, number];
      const allDay = !input.start_time;
      const [hh, mm] = allDay ? [8, 0] : (input.start_time!.split(":").map(Number) as [number, number]);
      const start = zonedWallTimeToUtc(tz, y, m, d, hh, mm);
      let end: Date | null = null;
      const endKey = input.end_date && input.end_date >= input.start_date ? input.end_date : input.start_date;
      const [ey, em, ed] = endKey.split("-").map(Number) as [number, number, number];
      // Keep the end time the job had; default to 4 PM.
      const prevEnd = job.scheduledEnd ? zonedParts(job.scheduledEnd, tz) : null;
      end = zonedWallTimeToUtc(tz, ey, em, ed, prevEnd ? prevEnd.hour : 16, prevEnd ? prevEnd.minute : 0);
      if (end <= start) end = new Date(start.getTime() + 8 * 3600_000);
      const sameStart = job.scheduledStart && job.scheduledStart.getTime() === start.getTime() && job.allDay === allDay;
      const sameEnd = job.scheduledEnd && end && job.scheduledEnd.getTime() === end.getTime();
      if (!sameStart || !sameEnd) {
        data.scheduledStart = start;
        data.scheduledEnd = end;
        data.allDay = allDay;
        if (job.status === "draft") data.status = "scheduled";
        // The start reminder should go out again for the new date.
        data.startReminderSentAt = null;
        data.startNudgeSentAt = null;
        const label = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, weekday: "short", day: "numeric", month: "short", ...(allDay ? {} : { hour: "2-digit", minute: "2-digit" }) }).format(start);
        const endLabel = endKey !== input.start_date ? ` até ${new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "numeric", month: "short" }).format(end)}` : "";
        changes.push(`Data: ${label}${allDay ? " (dia todo)" : ""}${endLabel}`);
        diff.scheduledStart = { from: job.scheduledStart, to: start };
        diff.scheduledEnd = { from: job.scheduledEnd, to: end };
      }
    }
  }

  if (input.instructions !== undefined || input.lockbox !== undefined) {
    const nextNotes = notesWithLockbox(
      input.instructions !== undefined ? input.instructions : stripLockbox(job.notes),
      input.lockbox !== undefined ? input.lockbox : parseLockbox(job.notes) || "",
    );
    if (nextNotes !== (job.notes || "").trim()) {
      data.notes = nextNotes || null;
      if (input.lockbox !== undefined && input.lockbox !== (parseLockbox(job.notes) || "")) changes.push(input.lockbox ? `Código da caixa: ${input.lockbox}` : "Código da caixa removido");
      if (input.instructions !== undefined && stripLockbox(input.instructions).trim() !== stripLockbox(job.notes).trim()) changes.push("Instruções alteradas");
      diff.notes = { from: job.notes, to: nextNotes };
    }
  }
  if (input.attention !== undefined && input.attention.trim() !== (job.campoAttention || "").trim()) {
    data.campoAttention = input.attention.trim() || null;
    changes.push(input.attention.trim() ? `Atenção: ${input.attention.trim().slice(0, 120)}` : "Atenção removida");
    diff.campoAttention = { from: job.campoAttention, to: input.attention.trim() || null };
  }

  if (Object.keys(data).length) {
    await tx.workOrder.update({ where: { id: job.id }, data });
  }

  if (input.services) {
    const lines = await tx.workOrderLineItem.findMany({ where: { organizationId, workOrderId: job.id } });
    const byId = new Map(lines.map((l) => [l.id, l]));
    let order = lines.reduce((max, l) => Math.max(max, l.sortOrder), 0);
    for (const s of input.services) {
      if (s.id) {
        const line = byId.get(s.id);
        if (!line) continue;
        if (s.remove) {
          await tx.workOrderLineItem.delete({ where: { id: line.id } });
          changes.push(`Serviço removido: ${line.serviceName}`);
          continue;
        }
        const qty = round2(s.quantity);
        const notes = s.notes !== undefined ? s.notes.trim() || null : line.notes;
        if (qty !== Number(line.quantitySqft) || notes !== line.notes) {
          await tx.workOrderLineItem.update({
            where: { id: line.id },
            data: { quantitySqft: qty, notes, lineTotal: round2(qty * Number(line.unitPrice)) },
          });
          if (qty !== Number(line.quantitySqft)) changes.push(`${line.serviceName}: ${Number(line.quantitySqft)} → ${qty}`);
          if (notes !== line.notes) changes.push(`${line.serviceName}: nota alterada`);
        }
      } else if (s.pricing_item_id && !s.remove) {
        const item = await tx.pricingItem.findFirst({ where: { id: s.pricing_item_id, organizationId, active: true, isVisible: true } });
        if (!item) throw new JobEditError(400, "Esse serviço não está na tabela da empresa.");
        const unit = Number(item.priceBuilder) || Number(item.partnerPrice ?? 0) || Number(item.price) || 0;
        const qty = round2(s.quantity);
        order += 1;
        await tx.workOrderLineItem.create({
          data: {
            organizationId,
            workOrderId: job.id,
            pricingItemId: item.id,
            serviceName: item.name,
            quantitySqft: qty,
            unitPrice: unit,
            lineTotal: round2(qty * unit),
            notes: s.notes?.trim() || null,
            sortOrder: order,
          },
        });
        changes.push(`Serviço adicionado: ${item.name} (${qty})`);
      }
    }
    if (changes.some((c) => /^Serviço|: .* → |nota alterada/.test(c))) diff.services = { from: null, to: "alterados pelo builder" };
  }

  if (changes.length) {
    await recordActivity(tx, {
      organizationId,
      entityType: "work_order",
      entityId: job.id,
      actorType: "partner",
      actorId: params.actor.partnerUserId,
      action: "builder_edit",
      changes: { ...diff, summary: { from: null, to: `${params.actor.name} (${params.actor.builder}): ${changes.join("; ")}` } },
    });
  }
  return { changes, job: { id: job.id, number: job.number, title: (data.title as string) || job.title } };
}
