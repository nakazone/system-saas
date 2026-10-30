/**
 * Samples de stain — CRM / field app API. The crew registers the samples (photo + color) of a job,
 * sends the round to the client and the office follows it on the job page (aba Stain).
 */
import { Router, type Response } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth } from "../http.js";
import { withTenantTransaction, type TenantPrisma } from "../../lib/tenant/prisma-tenant.js";
import { myJobAccessWhere } from "../lib/campo-shared.js";
import { storage } from "../../lib/storage/index.js";
import { checkLimit } from "../../lib/features/index.js";
import { parsePhotoUploadMeta, sha256Buffer } from "../../lib/job-media/index.js";
import { recordActivity } from "../../lib/activity/record.js";
import { DURASEAL_COLORS, SAMPLE_KINDS, parseBlend, sampleColorText } from "../../lib/stain/catalog.js";
import { jobStainState, mediaIdsOf } from "../../lib/stain/service.js";
import { StainError, approvalPdf, sendApprovalToBuilder, sendRound } from "../../lib/stain/flow.js";

export const stainRouter = Router();

const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

function perms(req: AuthedRequest): { admin: boolean; manage: boolean; view: boolean } {
  const admin = req.user?.roleKey === "admin";
  const p = req.user?.permissions || [];
  return { admin, manage: admin || p.includes("work_orders.manage"), view: admin || p.includes("work_orders.view") || p.includes("work_orders.manage") };
}

/** Office (work_orders.manage) reaches any job; the crew only their jobs. Reading also works with work_orders.view. */
async function reachJob(tx: TenantPrisma, req: AuthedRequest, jobId: string, write: boolean) {
  const p = perms(req);
  const open = p.manage || (!write && p.view);
  const job = await tx.workOrder.findFirst({
    where: { id: jobId, organizationId: req.organizationId!, status: { not: "canceled" }, ...(open ? {} : myJobAccessWhere(req.user!.id)) },
    select: { id: true, number: true, builderId: true, approvedStainSampleId: true, customer: { select: { name: true, email: true } } },
  });
  if (!job) throw new StainError("Job não encontrado ou sem acesso.", 404);
  return job;
}

async function reachRound(tx: TenantPrisma, req: AuthedRequest, roundId: string, write: boolean) {
  const round = await tx.stainSampleRound.findFirst({ where: { id: roundId, organizationId: req.organizationId! }, include: { samples: true } });
  if (!round) throw new StainError("Rodada não encontrada.", 404);
  const job = await reachJob(tx, req, round.workOrderId, write);
  return { round, job };
}

async function reachSample(tx: TenantPrisma, req: AuthedRequest, sampleId: string, write: boolean) {
  const sample = await tx.stainSample.findFirst({ where: { id: sampleId, organizationId: req.organizationId! } });
  if (!sample) throw new StainError("Sample não encontrado.", 404);
  const { round, job } = await reachRound(tx, req, sample.roundId, write);
  return { sample, round, job };
}

function draftOnly(round: { status: string }) {
  if (round.status !== "draft") throw new StainError("A rodada já foi enviada à cliente. Para mudar, abra uma nova rodada.", 409);
}

function fail(res: Response, next: (e: unknown) => void, error: unknown) {
  if (error instanceof StainError) {
    res.status(error.status).json({ success: false, error: error.message });
    return;
  }
  next(error);
}

async function state(req: AuthedRequest, jobId: string) {
  const data = await withTenantTransaction(req.organizationId!, (tx) => jobStainState(tx, req.organizationId!, jobId));
  return { ...data, can_manage: perms(req).manage };
}

function origin(req: AuthedRequest): string {
  return `${req.protocol}://${req.get("host")}`;
}

function decodePhoto(raw: Record<string, unknown>): { contentType: string; body: Buffer } {
  const m = /^data:(image\/(?:jpeg|jpg|png|webp|heic|heif));base64,(.+)$/i.exec(String(raw.data_url || ""));
  if (!m) throw new StainError("Envie a foto do sample (JPG, PNG ou WebP).");
  const body = Buffer.from(m[2]!, "base64");
  if (!body.length) throw new StainError("Foto vazia.");
  if (body.length > MAX_PHOTO_BYTES) throw new StainError("Foto muito grande (máx. 12 MB).");
  return { contentType: m[1]!.toLowerCase().replace("image/jpg", "image/jpeg"), body };
}

/** Saves a sample photo as an ObraCam photo of the job (stage Durante) and returns its id. */
async function savePhoto(req: AuthedRequest, workOrderId: string, raw: Record<string, unknown>, caption: string): Promise<string> {
  const meta = parsePhotoUploadMeta(raw);
  if (meta.clientUploadId) {
    const existing = await withTenantTransaction(req.organizationId!, (tx) => tx.jobMedia.findFirst({
      where: { organizationId: req.organizationId!, workOrderId, clientUploadId: meta.clientUploadId!, deletedAt: null },
      select: { id: true },
    }));
    if (existing) return existing.id;
  }
  const photo = decodePhoto(raw);
  const limit = await checkLimit(req.organizationId!, "photos_month", 1);
  if (!limit.ok) throw new StainError(limit.message || "Limite de fotos do plano atingido.", 403);
  const stored = await storage.upload({
    key: `orgs/${req.organizationId}/jobs/${workOrderId}/stain/${Date.now()}-${randomUUID().slice(0, 8)}`,
    body: photo.body,
    contentType: photo.contentType,
  });
  const row = await withTenantTransaction(req.organizationId!, (tx) => tx.jobMedia.create({
    data: {
      organizationId: req.organizationId!,
      workOrderId,
      authorId: req.user!.id,
      type: "photo",
      storageKey: stored.key,
      url: stored.url,
      thumbUrl: stored.url,
      sha256: sha256Buffer(photo.body),
      takenAtDevice: meta.takenAtDevice,
      receivedAtServer: new Date(),
      lat: meta.lat != null ? new Prisma.Decimal(meta.lat) : null,
      lng: meta.lng != null ? new Prisma.Decimal(meta.lng) : null,
      gpsAccuracyM: meta.gpsAccuracyM != null ? new Prisma.Decimal(meta.gpsAccuracyM) : null,
      caption: caption.slice(0, 500),
      stage: "during",
      clientUploadId: meta.clientUploadId,
      deviceLabel: meta.deviceLabel,
    },
    select: { id: true },
  }));
  return row.id;
}

stainRouter.get("/api/stain/catalog", requireCrmAuth, (_req, res) => {
  res.json({ success: true, data: { duraseal: DURASEAL_COLORS } });
});

stainRouter.get("/api/work-orders/:id/stain", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const jobId = String(req.params.id);
    await withTenantTransaction(req.organizationId!, (tx) => reachJob(tx, req, jobId, false));
    res.json({ success: true, data: await state(req, jobId) });
  } catch (error) {
    fail(res, next, error);
  }
});

const roundBody = z.object({
  wood_species: z.string().trim().max(60).optional().nullable(),
  room: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  recipient_name: z.string().trim().max(120).optional().nullable(),
  recipient_email: z.union([z.string().trim().email().max(200), z.literal(""), z.null()]).optional(),
  send_to_builder: z.boolean().optional(),
});

/** New round. With a color already approved and signed, only the office can open a change. */
stainRouter.post("/api/work-orders/:id/stain/rounds", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = roundBody.safeParse(req.body || {});
    if (!body.success) throw new StainError("Dados inválidos.");
    const jobId = String(req.params.id);
    const round = await withTenantTransaction(req.organizationId!, async (tx) => {
      const job = await reachJob(tx, req, jobId, true);
      if (job.approvedStainSampleId && !perms(req).manage) {
        throw new StainError("A cor já foi aprovada e assinada pela cliente. Peça ao escritório para abrir uma mudança.", 403);
      }
      const open = await tx.stainSampleRound.findFirst({
        where: { organizationId: req.organizationId!, workOrderId: jobId, status: { in: ["draft", "sent", "viewed"] } },
        orderBy: { number: "desc" },
      });
      if (open?.status === "draft") return open;
      if (open) throw new StainError("Já existe uma rodada esperando a resposta da cliente.", 409);
      const last = await tx.stainSampleRound.findFirst({ where: { organizationId: req.organizationId!, workOrderId: jobId }, orderBy: { number: "desc" }, select: { number: true, woodSpecies: true } });
      const created = await tx.stainSampleRound.create({
        data: {
          organizationId: req.organizationId!,
          workOrderId: jobId,
          number: (last?.number || 0) + 1,
          woodSpecies: body.data.wood_species || last?.woodSpecies || null,
          room: body.data.room || null,
          notes: body.data.notes || null,
          recipientName: job.customer?.name || null,
          recipientEmail: job.customer?.email || null,
          sendToBuilder: Boolean(job.builderId),
          createdById: req.user!.id,
          createdByName: req.user!.name || req.user!.email || null,
        },
      });
      await recordActivity(tx, {
        organizationId: req.organizationId!, entityType: "work_order", entityId: jobId, action: "stain.round_created",
        actorType: "user", actorId: req.user!.id, changes: { stain_round: { from: null, to: created.number } },
      });
      return created;
    });
    res.status(201).json({ success: true, data: { round_id: round.id, ...(await state(req, jobId)) } });
  } catch (error) {
    fail(res, next, error);
  }
});

stainRouter.patch("/api/stain/rounds/:roundId", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = roundBody.safeParse(req.body || {});
    if (!body.success) throw new StainError("Confira o e-mail da cliente.");
    const jobId = await withTenantTransaction(req.organizationId!, async (tx) => {
      const { round } = await reachRound(tx, req, String(req.params.roundId), true);
      const decided = !["draft", "sent", "viewed"].includes(round.status);
      if (decided) throw new StainError("A cliente já respondeu esta rodada.", 409);
      const d = body.data;
      const content = d.wood_species !== undefined || d.room !== undefined || d.notes !== undefined;
      if (content) draftOnly(round);
      await tx.stainSampleRound.update({
        where: { id: round.id },
        data: {
          ...(d.wood_species !== undefined ? { woodSpecies: d.wood_species || null } : {}),
          ...(d.room !== undefined ? { room: d.room || null } : {}),
          ...(d.notes !== undefined ? { notes: d.notes || null } : {}),
          ...(d.recipient_name !== undefined ? { recipientName: d.recipient_name || null } : {}),
          ...(d.recipient_email !== undefined ? { recipientEmail: d.recipient_email || null } : {}),
          ...(d.send_to_builder !== undefined ? { sendToBuilder: d.send_to_builder } : {}),
        },
      });
      return round.workOrderId;
    });
    res.json({ success: true, data: await state(req, jobId) });
  } catch (error) {
    fail(res, next, error);
  }
});

stainRouter.delete("/api/stain/rounds/:roundId", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const jobId = await withTenantTransaction(req.organizationId!, async (tx) => {
      const { round } = await reachRound(tx, req, String(req.params.roundId), true);
      draftOnly(round);
      await tx.stainSampleRound.delete({ where: { id: round.id } });
      return round.workOrderId;
    });
    res.json({ success: true, data: await state(req, jobId) });
  } catch (error) {
    fail(res, next, error);
  }
});

const sampleBody = z.object({
  kind: z.enum(SAMPLE_KINDS),
  color_name: z.string().trim().max(80).optional().default(""),
  brand: z.string().trim().max(60).optional().nullable(),
  blend: z.array(z.object({ color: z.string().trim().min(1).max(60), percent: z.number().int().min(1).max(100) })).max(3).optional(),
  number: z.number().int().min(1).max(99).optional(),
});

function normalizeSample(d: z.infer<typeof sampleBody>) {
  if (d.kind === "blend") {
    const blend = parseBlend(d.blend);
    if (blend.length < 2) throw new StainError("Escolha pelo menos duas cores para a mistura.");
    return { kind: d.kind, brand: "DuraSeal", colorName: sampleColorText({ kind: "blend", colorName: "", blend }), blend };
  }
  if (d.kind === "natural") return { kind: d.kind, brand: null, colorName: "Natural", blend: null };
  if (!d.color_name) throw new StainError("Escolha a cor do sample.");
  if (d.kind === "duraseal") {
    const hit = DURASEAL_COLORS.find((c) => c.toLowerCase() === d.color_name.toLowerCase());
    if (!hit) throw new StainError("Cor DuraSeal não encontrada. Use Outra marca para cores fora da lista.");
    return { kind: d.kind, brand: "DuraSeal", colorName: hit, blend: null };
  }
  if (!d.brand) throw new StainError("Digite a marca.");
  return { kind: d.kind, brand: d.brand, colorName: d.color_name, blend: null };
}

stainRouter.post("/api/stain/rounds/:roundId/samples", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = sampleBody.safeParse(req.body || {});
    if (!body.success) throw new StainError("Dados do sample inválidos.");
    const values = normalizeSample(body.data);
    const out = await withTenantTransaction(req.organizationId!, async (tx) => {
      const { round } = await reachRound(tx, req, String(req.params.roundId), true);
      draftOnly(round);
      if (round.samples.length >= 12) throw new StainError("No máximo 12 samples por rodada.");
      const used = new Set(round.samples.map((s) => s.number));
      let number = body.data.number && !used.has(body.data.number) ? body.data.number : 1;
      if (!body.data.number || used.has(body.data.number)) while (used.has(number)) number += 1;
      const sample = await tx.stainSample.create({
        data: { organizationId: req.organizationId!, roundId: round.id, number, kind: values.kind, brand: values.brand, colorName: values.colorName, blend: values.blend ?? Prisma.JsonNull },
      });
      return { sample, jobId: round.workOrderId };
    });
    res.status(201).json({ success: true, data: { sample_id: out.sample.id, ...(await state(req, out.jobId)) } });
  } catch (error) {
    fail(res, next, error);
  }
});

stainRouter.patch("/api/stain/samples/:sampleId", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = sampleBody.safeParse(req.body || {});
    if (!body.success) throw new StainError("Dados do sample inválidos.");
    const values = normalizeSample(body.data);
    const jobId = await withTenantTransaction(req.organizationId!, async (tx) => {
      const { sample, round } = await reachSample(tx, req, String(req.params.sampleId), true);
      draftOnly(round);
      await tx.stainSample.update({ where: { id: sample.id }, data: { kind: values.kind, brand: values.brand, colorName: values.colorName, blend: values.blend ?? Prisma.JsonNull } });
      return round.workOrderId;
    });
    res.json({ success: true, data: await state(req, jobId) });
  } catch (error) {
    fail(res, next, error);
  }
});

stainRouter.delete("/api/stain/samples/:sampleId", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const jobId = await withTenantTransaction(req.organizationId!, async (tx) => {
      const { sample, round } = await reachSample(tx, req, String(req.params.sampleId), true);
      draftOnly(round);
      await tx.stainSample.delete({ where: { id: sample.id } });
      return round.workOrderId;
    });
    res.json({ success: true, data: await state(req, jobId) });
  } catch (error) {
    fail(res, next, error);
  }
});

/** Photo of one sample on the floor (camera straight away in the field app). */
stainRouter.post("/api/stain/samples/:sampleId/photos", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const raw = (req.body || {}) as Record<string, unknown>;
    const pre = await withTenantTransaction(req.organizationId!, async (tx) => {
      const { sample, round } = await reachSample(tx, req, String(req.params.sampleId), true);
      draftOnly(round);
      if (mediaIdsOf(sample.mediaIds).length >= 6) throw new StainError("No máximo 6 fotos por sample.");
      return { sample, round };
    });
    const caption = `Stain sample #${pre.sample.number} · ${sampleColorText(pre.sample)}`;
    const mediaId = await savePhoto(req, pre.round.workOrderId, raw, caption);
    await withTenantTransaction(req.organizationId!, async (tx) => {
      const fresh = await tx.stainSample.findFirst({ where: { id: pre.sample.id, organizationId: req.organizationId! }, select: { mediaIds: true } });
      const ids = mediaIdsOf(fresh?.mediaIds);
      if (!ids.includes(mediaId)) await tx.stainSample.update({ where: { id: pre.sample.id }, data: { mediaIds: [...ids, mediaId] } });
    });
    res.status(201).json({ success: true, data: { media_id: mediaId, ...(await state(req, pre.round.workOrderId)) } });
  } catch (error) {
    fail(res, next, error);
  }
});

stainRouter.delete("/api/stain/samples/:sampleId/photos/:mediaId", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const jobId = await withTenantTransaction(req.organizationId!, async (tx) => {
      const { sample, round } = await reachSample(tx, req, String(req.params.sampleId), true);
      draftOnly(round);
      const mediaId = String(req.params.mediaId);
      await tx.stainSample.update({ where: { id: sample.id }, data: { mediaIds: mediaIdsOf(sample.mediaIds).filter((id) => id !== mediaId) } });
      return round.workOrderId;
    });
    res.json({ success: true, data: await state(req, jobId) });
  } catch (error) {
    fail(res, next, error);
  }
});

/** Photo with every sample side by side (opens the client's e-mail and page). */
stainRouter.post("/api/stain/rounds/:roundId/board-photo", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const raw = (req.body || {}) as Record<string, unknown>;
    const pre = await withTenantTransaction(req.organizationId!, async (tx) => {
      const { round } = await reachRound(tx, req, String(req.params.roundId), true);
      draftOnly(round);
      return round;
    });
    const mediaId = await savePhoto(req, pre.workOrderId, raw, `Stain samples · round ${pre.number}`);
    await withTenantTransaction(req.organizationId!, (tx) => tx.stainSampleRound.update({ where: { id: pre.id }, data: { boardMediaId: mediaId } }));
    res.status(201).json({ success: true, data: await state(req, pre.workOrderId) });
  } catch (error) {
    fail(res, next, error);
  }
});

/** Sends the round: e-mail to the client with the link, or only the link ("Cliente aprova agora"). */
stainRouter.post("/api/stain/rounds/:roundId/send", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const parsed = z.object({
      email: z.union([z.string().trim().email().max(200), z.literal("")]).optional(),
      link_only: z.boolean().optional(),
    }).safeParse(req.body || {});
    if (!parsed.success) throw new StainError("Confira o e-mail da cliente.");
    const round = await withTenantTransaction(req.organizationId!, async (tx) => (await reachRound(tx, req, String(req.params.roundId), true)).round);
    const linkOnly = Boolean(parsed.data.link_only);
    const emailTo = linkOnly ? null : (parsed.data.email ?? round.recipientEmail ?? "").trim() || null;
    if (!linkOnly && !emailTo) throw new StainError("Digite o e-mail da cliente ou use “Cliente aprova agora”.");
    const out = await sendRound({ organizationId: req.organizationId!, roundId: round.id, origin: origin(req), emailTo, linkOnly, actorId: req.user!.id });
    res.json({ success: true, data: { url: out.url, emailed: out.emailed, ...(await state(req, round.workOrderId)) } });
  } catch (error) {
    fail(res, next, error);
  }
});

/** Office: send (again) the approval to the builder's job in ObraBuilder. */
stainRouter.post("/api/stain/rounds/:roundId/builder", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!perms(req).manage) throw new StainError("Só o escritório reenvia ao builder.", 403);
    const round = await withTenantTransaction(req.organizationId!, async (tx) => (await reachRound(tx, req, String(req.params.roundId), true)).round);
    const ok = await sendApprovalToBuilder(req.organizationId!, round.id);
    if (!ok) throw new StainError("Este job não tem builder ou a rodada ainda não foi aprovada.");
    res.json({ success: true, data: await state(req, round.workOrderId) });
  } catch (error) {
    fail(res, next, error);
  }
});

stainRouter.get("/api/stain/approvals/:approvalId/pdf", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const approval = await withTenantTransaction(req.organizationId!, async (tx) => {
      const a = await tx.stainApproval.findFirst({ where: { id: String(req.params.approvalId), organizationId: req.organizationId!, decision: "approved" }, select: { id: true, workOrderId: true } });
      if (!a) throw new StainError("Aprovação não encontrada.", 404);
      const job = await reachJob(tx, req, a.workOrderId, false);
      return { ...a, number: job.number };
    });
    const pdf = await approvalPdf(req.organizationId!, approval.id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `inline; filename="stain-approval-job-${approval.number ?? "x"}.pdf"`);
    res.send(pdf);
  } catch (error) {
    fail(res, next, error);
  }
});
