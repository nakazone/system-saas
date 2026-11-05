/**
 * Slab yard (Countertops): slabs and remnants, reserved for a job when the customer picks one and
 * used when it goes to fabrication. Only for trades whose pack keeps slabs (inventory.slabs).
 *
 * Reading: work_orders.view. Changing: work_orders.manage (the office). The cost only for the office.
 */
import { Router, type NextFunction, type Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth } from "../http.js";
import { withTenantTransaction, type TenantPrisma } from "../../lib/tenant/prisma-tenant.js";
import { primaryPack } from "../../lib/trades/index.js";
import { storage } from "../../lib/storage/index.js";
import { recordActivity } from "../../lib/activity/record.js";
import { SLAB_KINDS, SLAB_STATUSES, createSlabSchema, mapSlab, parseFits, slabFits, updateSlabSchema, yardSummary } from "../../lib/trades/slabs.js";

export const slabsRouter = Router();

class SlabError extends Error {
  constructor(message: string, public status = 400, public code = "slab_error") {
    super(message);
  }
}

function perms(req: AuthedRequest) {
  const admin = req.user?.roleKey === "admin";
  const p = req.user?.permissions || [];
  return { manage: admin || p.includes("work_orders.manage"), view: admin || p.includes("work_orders.view") || p.includes("work_orders.manage") };
}

const JOB_SELECT = { select: { id: true, number: true, title: true, customer: { select: { name: true } } } } as const;

/** The yard exists only for trades that keep slabs; reading needs work_orders.view, changing the office. */
async function gate(tx: TenantPrisma, req: AuthedRequest, write: boolean) {
  const org = await tx.organization.findUnique({ where: { id: req.organizationId! }, select: { tradePacks: true } });
  if (!primaryPack(org?.tradePacks).inventory?.slabs) throw new SlabError("O estoque de slabs não existe neste ofício.", 404, "not_available");
  const p = perms(req);
  if (write ? !p.manage : !p.view) throw new SlabError("Sem permissão.", 403, "forbidden");
  return p;
}

async function findSlab(tx: TenantPrisma, req: AuthedRequest, id: string) {
  const row = await tx.slab.findFirst({ where: { id, organizationId: req.organizationId! }, include: { workOrder: JOB_SELECT } });
  if (!row) throw new SlabError("Slab não encontrado.", 404, "not_found");
  return row;
}

async function findJob(tx: TenantPrisma, req: AuthedRequest, jobId: string) {
  const job = await tx.workOrder.findFirst({ where: { id: jobId, organizationId: req.organizationId!, status: { not: "canceled" } }, select: { id: true, number: true } });
  if (!job) throw new SlabError("Job não encontrado.", 404, "job_not_found");
  return job;
}

const label = (s: { material: string; color: string; serial: string | null; kind: string }) =>
  `${s.kind === "remnant" ? "Sobra" : "Slab"} ${s.color}${s.serial ? ` · ${s.serial}` : ""}`;

async function logOnJob(tx: TenantPrisma, req: AuthedRequest, jobId: string, action: string, slab: { id: string; material: string; color: string; serial: string | null; kind: string }) {
  await recordActivity(tx, {
    organizationId: req.organizationId!,
    entityType: "work_order",
    entityId: jobId,
    action,
    actorType: "user",
    actorId: req.user!.id,
    changes: { slab_id: { from: null, to: slab.id }, slab: { from: null, to: label(slab) } },
  });
}

function fail(res: Response, next: NextFunction, e: unknown) {
  if (e instanceof SlabError) {
    res.status(e.status).json({ success: false, error: e.message, code: e.code });
    return;
  }
  const z = e as { issues?: unknown };
  if (z && Array.isArray(z.issues)) {
    res.status(400).json({ success: false, error: "Dados inválidos", code: "invalid", issues: z.issues });
    return;
  }
  next(e);
}

const toData = (b: z.infer<typeof createSlabSchema> | z.infer<typeof updateSlabSchema>) => {
  const d: Record<string, unknown> = {};
  if (b.kind !== undefined) d.kind = b.kind;
  if (b.material !== undefined) d.material = b.material;
  if (b.color !== undefined) d.color = b.color;
  if (b.brand !== undefined) d.brand = b.brand;
  if (b.finish !== undefined) d.finish = b.finish;
  if (b.thickness_cm !== undefined) d.thicknessCm = b.thickness_cm;
  if (b.length_in !== undefined) d.lengthIn = b.length_in;
  if (b.width_in !== undefined) d.widthIn = b.width_in;
  if (b.serial !== undefined) d.serial = b.serial;
  if (b.supplier !== undefined) d.supplier = b.supplier;
  if (b.location !== undefined) d.location = b.location;
  if (b.cost !== undefined) d.cost = b.cost;
  if (b.notes !== undefined) d.notes = b.notes;
  return d;
};

/** The yard: filters by status, kind, text and "fits a piece of L×W". */
slabsRouter.get("/api/slabs", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      const p = await gate(tx, req, false);
      const status = String(req.query.status || "");
      const kind = String(req.query.kind || "");
      const q = String(req.query.q || "").trim().toLowerCase();
      const fits = parseFits(req.query.fits);
      const all = await tx.slab.findMany({ where: { organizationId: req.organizationId! }, include: { workOrder: JOB_SELECT }, orderBy: [{ createdAt: "desc" }] });
      const rows = all
        .filter((r) => (status ? (SLAB_STATUSES as readonly string[]).includes(status) && r.status === status : r.status !== "scrapped" && r.status !== "used"))
        .filter((r) => (kind && (SLAB_KINDS as readonly string[]).includes(kind) ? r.kind === kind : true))
        .filter((r) => !q || [r.color, r.brand, r.serial, r.supplier, r.location, r.material, r.notes].filter(Boolean).join(" ").toLowerCase().includes(q))
        .filter((r) => !fits || slabFits({ lengthIn: Number(r.lengthIn), widthIn: Number(r.widthIn) }, fits[0], fits[1]));
      return { items: rows.map((r) => mapSlab(r, p.manage)), summary: yardSummary(all), can_manage: p.manage };
    });
    res.json({ success: true, data });
  } catch (e) {
    fail(res, next, e);
  }
});

/** Slabs held for or used on one job (shown on the job's phases). */
slabsRouter.get("/api/work-orders/:id/slabs", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      const p = await gate(tx, req, false);
      const jobId = String(req.params.id).replace(/:(sand|installation|main)$/i, "");
      await findJob(tx, req, jobId);
      const rows = await tx.slab.findMany({ where: { organizationId: req.organizationId!, workOrderId: jobId }, include: { workOrder: JOB_SELECT }, orderBy: { reservedAt: "asc" } });
      return { items: rows.map((r) => mapSlab(r, p.manage)), can_manage: p.manage };
    });
    res.json({ success: true, data });
  } catch (e) {
    fail(res, next, e);
  }
});

slabsRouter.post("/api/slabs", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = createSlabSchema.parse(req.body || {});
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      const p = await gate(tx, req, true);
      const row = await tx.slab.create({
        data: { organizationId: req.organizationId!, ...(toData(body) as { material: string; color: string; lengthIn: number; widthIn: number }), createdById: req.user!.id, createdByName: req.user!.name ?? null },
        include: { workOrder: JOB_SELECT },
      });
      return mapSlab(row, p.manage);
    });
    res.status(201).json({ success: true, data });
  } catch (e) {
    fail(res, next, e);
  }
});

slabsRouter.patch("/api/slabs/:id", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = updateSlabSchema.parse(req.body || {});
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      const p = await gate(tx, req, true);
      const cur = await findSlab(tx, req, String(req.params.id));
      const d = toData(body);
      if (body.status) {
        // Setting it aside as broken / back in the yard: a reservation ends with it.
        if (cur.status === "used" && body.status === "available") throw new SlabError("Slab já usado. Registre a sobra como uma peça nova.", 409, "used");
        d.status = body.status;
        if (cur.workOrderId) {
          d.workOrderId = null;
          d.reservedAt = null;
          await logOnJob(tx, req, cur.workOrderId, "slab.released", cur);
        }
      }
      const row = await tx.slab.update({ where: { id: cur.id }, data: d, include: { workOrder: JOB_SELECT } });
      return mapSlab(row, p.manage);
    });
    res.json({ success: true, data });
  } catch (e) {
    fail(res, next, e);
  }
});

const jobBody = z.object({ job_id: z.string().uuid() });

/** Hold a slab for a job (the customer picked it). A slab held for another job must be released first. */
slabsRouter.post("/api/slabs/:id/reserve", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const { job_id } = jobBody.parse(req.body || {});
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      const p = await gate(tx, req, true);
      const cur = await findSlab(tx, req, String(req.params.id));
      const job = await findJob(tx, req, job_id);
      if (cur.status === "reserved" && cur.workOrderId === job.id) return mapSlab(cur, p.manage);
      if (cur.status === "reserved") throw new SlabError(`Reservado para o job #${cur.workOrder?.number ?? "?"}. Libere antes.`, 409, "reserved");
      if (cur.status !== "available") throw new SlabError("Este slab não está disponível.", 409, "not_available");
      const row = await tx.slab.update({ where: { id: cur.id }, data: { status: "reserved", workOrderId: job.id, reservedAt: new Date() }, include: { workOrder: JOB_SELECT } });
      await logOnJob(tx, req, job.id, "slab.reserved", row);
      return mapSlab(row, p.manage);
    });
    res.json({ success: true, data });
  } catch (e) {
    fail(res, next, e);
  }
});

slabsRouter.post("/api/slabs/:id/release", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      const p = await gate(tx, req, true);
      const cur = await findSlab(tx, req, String(req.params.id));
      if (cur.status !== "reserved") throw new SlabError("Este slab não está reservado.", 409, "not_reserved");
      const row = await tx.slab.update({ where: { id: cur.id }, data: { status: "available", workOrderId: null, reservedAt: null }, include: { workOrder: JOB_SELECT } });
      if (cur.workOrderId) await logOnJob(tx, req, cur.workOrderId, "slab.released", cur);
      return mapSlab(row, p.manage);
    });
    res.json({ success: true, data });
  } catch (e) {
    fail(res, next, e);
  }
});

/** The slab went to fabrication for its job (or for the job given). */
slabsRouter.post("/api/slabs/:id/use", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = z.object({ job_id: z.string().uuid().optional() }).parse(req.body || {});
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      const p = await gate(tx, req, true);
      const cur = await findSlab(tx, req, String(req.params.id));
      if (cur.status === "used") return mapSlab(cur, p.manage);
      if (cur.status === "scrapped") throw new SlabError("Slab descartado.", 409, "scrapped");
      const jobId = body.job_id ?? cur.workOrderId;
      if (!jobId) throw new SlabError("Escolha o job onde o slab foi usado.", 400, "job_required");
      if (cur.status === "reserved" && cur.workOrderId && cur.workOrderId !== jobId) throw new SlabError(`Reservado para o job #${cur.workOrder?.number ?? "?"}.`, 409, "reserved");
      const job = await findJob(tx, req, jobId);
      const row = await tx.slab.update({
        where: { id: cur.id },
        data: { status: "used", workOrderId: job.id, usedAt: new Date(), reservedAt: cur.reservedAt ?? new Date() },
        include: { workOrder: JOB_SELECT },
      });
      await logOnJob(tx, req, job.id, "slab.used", row);
      return mapSlab(row, p.manage);
    });
    res.json({ success: true, data });
  } catch (e) {
    fail(res, next, e);
  }
});

/** What is left of a used slab comes back to the yard as a remnant (same stone, smaller size). */
slabsRouter.post("/api/slabs/:id/remnant", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = z
      .object({ length_in: z.coerce.number().positive().max(200), width_in: z.coerce.number().positive().max(200), location: z.string().trim().max(60).nullable().optional() })
      .parse(req.body || {});
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      const p = await gate(tx, req, true);
      const cur = await findSlab(tx, req, String(req.params.id));
      const [big, small] = [Math.max(Number(cur.lengthIn), Number(cur.widthIn)), Math.min(Number(cur.lengthIn), Number(cur.widthIn))];
      if (Math.max(body.length_in, body.width_in) > big || Math.min(body.length_in, body.width_in) > small) {
        throw new SlabError("A sobra não pode ser maior que o slab.", 400, "too_big");
      }
      const row = await tx.slab.create({
        data: {
          organizationId: req.organizationId!,
          kind: "remnant",
          material: cur.material,
          color: cur.color,
          brand: cur.brand,
          finish: cur.finish,
          thicknessCm: cur.thicknessCm,
          lengthIn: body.length_in,
          widthIn: body.width_in,
          serial: cur.serial,
          supplier: cur.supplier,
          location: body.location ?? cur.location,
          parentId: cur.id,
          photoUrl: null,
          createdById: req.user!.id,
          createdByName: req.user!.name ?? null,
        },
        include: { workOrder: JOB_SELECT },
      });
      return mapSlab(row, p.manage);
    });
    res.status(201).json({ success: true, data });
  } catch (e) {
    fail(res, next, e);
  }
});

/** Photo of the slab (the tag, the veining). JPG or PNG as a data URL. */
slabsRouter.post("/api/slabs/:id/photo", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const { data_url } = z.object({ data_url: z.string().max(20 * 1024 * 1024) }).parse(req.body || {});
    const m = /^data:([^;]+);base64,(.+)$/.exec(data_url);
    if (!m) throw new SlabError("Foto inválida.", 400, "invalid_photo");
    const contentType = m[1]!.toLowerCase();
    if (!contentType.startsWith("image/") || contentType.includes("heic") || contentType.includes("heif")) throw new SlabError("Use uma foto JPG ou PNG.", 400, "invalid_photo");
    const body = Buffer.from(m[2]!, "base64");
    if (body.length > 12 * 1024 * 1024) throw new SlabError("Foto grande demais (máx. 12 MB).", 400, "invalid_photo");
    const id = String(req.params.id);
    await withTenantTransaction(req.organizationId!, async (tx) => {
      await gate(tx, req, true);
      await findSlab(tx, req, id);
    });
    const stored = await storage.upload({ key: `orgs/${req.organizationId}/slabs/${id}/${Date.now()}-${randomUUID().slice(0, 8)}`, body, contentType });
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      const p = perms(req);
      const row = await tx.slab.update({ where: { id }, data: { photoUrl: stored.url, photoKey: stored.key }, include: { workOrder: JOB_SELECT } });
      return mapSlab(row, p.manage);
    });
    res.json({ success: true, data });
  } catch (e) {
    fail(res, next, e);
  }
});

/** Remove a slab entered by mistake (a used or reserved one stays, for the job's history). */
slabsRouter.delete("/api/slabs/:id", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    await withTenantTransaction(req.organizationId!, async (tx) => {
      await gate(tx, req, true);
      const cur = await findSlab(tx, req, String(req.params.id));
      if (cur.status === "reserved" || cur.status === "used") throw new SlabError("Slab ligado a um job. Libere ou descarte em vez de apagar.", 409, "linked");
      await tx.slab.delete({ where: { id: cur.id } });
    });
    res.json({ success: true });
  } catch (e) {
    fail(res, next, e);
  }
});
