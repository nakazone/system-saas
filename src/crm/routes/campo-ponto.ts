/**
 * Campo ponto — clock-in / activity segments / clock-out for field workers.
 */
import { Router } from "express";
import { z } from "zod";
import type { AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { requireCrmAuth } from "../http.js";
import { buildFolhaPayload } from "./campo-folha.js";

export const campoPontoRouter = Router();

type Tx = Parameters<Parameters<typeof withTenantTransaction>[1]>[0];

const ACTIVITY_KINDS = ["on_site", "travel", "shopping", "break"] as const;
type ActivityKind = (typeof ACTIVITY_KINDS)[number];

const switchBody = z.object({
  activity_kind: z.enum(ACTIVITY_KINDS),
  work_order_id: z.string().uuid().nullable().optional(),
});

function canUseCampo(req: AuthedRequest): boolean {
  if (!req.user) return false;
  if (req.user.roleKey === "admin") return true;
  const p = req.user.permissions || [];
  return (
    p.includes("work_orders.view") ||
    p.includes("payroll.self") ||
    p.includes("schedule.view") ||
    p.includes("visits.view")
  );
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function hhmm(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function workDateUtc(d = new Date()) {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function dayBoundsLocal(d = new Date()) {
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function initialsFromName(name: string) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  const a = parts[0]![0] || "";
  const b = parts[1]?.[0] || parts[0]![1] || "";
  return (a + b).toUpperCase();
}

function firstName(name: string) {
  return String(name || "")
    .trim()
    .split(/\s+/)[0] || "";
}

function clientLabel(wo: {
  customer?: { name: string } | null;
  builder?: { company?: string | null; firstName?: string | null; lastName?: string | null } | null;
  sourceName?: string | null;
}) {
  if (wo.customer?.name) return wo.customer.name;
  if (wo.builder?.company) return wo.builder.company;
  if (wo.builder?.firstName) {
    return `${wo.builder.firstName}${wo.builder.lastName ? ` ${wo.builder.lastName}` : ""}`.trim();
  }
  return wo.sourceName || "—";
}

function shortClient(name: string) {
  const p = String(name || "")
    .trim()
    .split(/\s+/)[0];
  return p || name || "—";
}

function visitStatusForUi(
  fieldStatus: string | null | undefined,
  officeStatus: string,
  isCurrentJob: boolean,
) {
  if (isCurrentJob && fieldStatus !== "completed") return "on_site";
  if (fieldStatus === "completed" || officeStatus === "completed") return "done";
  if (fieldStatus === "on_site") return "on_site";
  if (fieldStatus === "en_route") return "en_route";
  if (fieldStatus === "scheduled") return "scheduled";
  if (officeStatus === "in_progress") return "in_progress";
  if (officeStatus === "scheduled" || officeStatus === "draft") return "scheduled";
  return officeStatus;
}

function paidMsFromSegments(
  segments: { activityKind: string; startedAt: Date; endedAt: Date | null }[],
  now = new Date(),
) {
  let ms = 0;
  for (const s of segments) {
    if (s.activityKind === "break") continue;
    const end = s.endedAt ? s.endedAt.getTime() : now.getTime();
    ms += Math.max(0, end - s.startedAt.getTime());
  }
  return ms;
}

const woInclude = {
  customer: { select: { id: true, name: true } },
  builder: { select: { id: true, firstName: true, lastName: true, company: true } },
  crew: { select: { id: true, name: true } },
  assignedUser: { select: { id: true, name: true } },
  members: { select: { userId: true, user: { select: { id: true, name: true } } } },
} as const;

async function findMyJobsToday(tx: Tx, userId: string, now = new Date()) {
  const { start, end } = dayBoundsLocal(now);
  return tx.workOrder.findMany({
    where: {
      status: { not: "canceled" },
      AND: [
        {
          OR: [
            { assignedUserId: userId },
            { members: { some: { userId } } },
            { crew: { members: { some: { userId } } } },
          ],
        },
        {
          OR: [
            { scheduledStart: { gte: start, lt: end } },
            {
              status: "in_progress",
              OR: [
                { scheduledStart: null },
                { scheduledStart: { lt: end } },
              ],
            },
          ],
        },
      ],
    },
    include: woInclude,
    orderBy: [{ scheduledStart: "asc" }, { createdAt: "asc" }],
    take: 50,
  });
}

async function getOpenShift(tx: Tx, userId: string) {
  return tx.campoShift.findFirst({
    where: { userId, status: "open" },
    include: {
      segments: {
        orderBy: { startedAt: "asc" },
        include: {
          workOrder: {
            include: {
              customer: { select: { name: true } },
              builder: { select: { firstName: true, lastName: true, company: true } },
            },
          },
        },
      },
    },
  });
}

function currentSegment<T extends { endedAt: Date | null }>(segments: T[]) {
  return segments.find((s) => !s.endedAt) || null;
}

function mapSegment(
  s: {
    id: string;
    activityKind: string;
    workOrderId: string | null;
    startedAt: Date;
    endedAt: Date | null;
    workOrder?: {
      id: string;
      number: number | null;
      title: string;
      address: string | null;
      customer?: { name: string } | null;
      builder?: { firstName?: string | null; lastName?: string | null; company?: string | null } | null;
      sourceName?: string | null;
    } | null;
  } | null,
) {
  if (!s) return null;
  const wo = s.workOrder;
  const client = wo ? clientLabel(wo) : null;
  return {
    id: s.id,
    activity_kind: s.activityKind,
    work_order_id: s.workOrderId,
    started_at: s.startedAt.toISOString(),
    ended_at: s.endedAt?.toISOString() ?? null,
    since_label: hhmm(s.startedAt),
    label:
      s.activityKind === "on_site"
        ? "Na obra"
        : s.activityKind === "travel"
          ? "Deslocamento"
          : s.activityKind === "shopping"
            ? "Compra de material"
            : "Pausa · não paga",
    work_order: wo
      ? {
          id: wo.id,
          number: wo.number,
          title: wo.title,
          address: wo.address,
          client,
          client_short: shortClient(client || ""),
        }
      : null,
  };
}

function mapPonto(
  shift: Awaited<ReturnType<typeof getOpenShift>>,
  now = new Date(),
) {
  if (!shift) {
    return {
      open: false,
      shift: null,
      current: null,
      paid_ms: 0,
      clock_in_label: null,
      paused: false,
    };
  }
  const cur = currentSegment(shift.segments);
  const paid = paidMsFromSegments(shift.segments, now);
  return {
    open: shift.status === "open",
    shift: {
      id: shift.id,
      work_date: shift.workDate.toISOString().slice(0, 10),
      clock_in_at: shift.clockInAt.toISOString(),
      clock_out_at: shift.clockOutAt?.toISOString() ?? null,
      status: shift.status,
    },
    current: mapSegment(cur),
    paid_ms: paid,
    clock_in_label: hhmm(shift.clockInAt),
    paused: cur?.activityKind === "break",
  };
}

function mapJob(
  wo: Awaited<ReturnType<typeof findMyJobsToday>>[number],
  currentWoId: string | null,
) {
  const client = clientLabel(wo);
  const teamNames = [
    wo.assignedUser?.name,
    ...(wo.members || []).map((m) => m.user?.name),
  ].filter(Boolean);
  const unique = [...new Set(teamNames)];
  const team =
    (wo.crew?.name ? `${wo.crew.name}` : "") +
    (unique.length
      ? `${wo.crew?.name ? " · " : ""}${unique.slice(0, 3).join(", ")}`
      : "");

  return {
    id: wo.id,
    number: wo.number,
    title: wo.title,
    client,
    client_short: shortClient(client),
    address: wo.address || "",
    start: wo.scheduledStart ? hhmm(wo.scheduledStart) : null,
    end: wo.scheduledEnd ? hhmm(wo.scheduledEnd) : null,
    scheduled_start: wo.scheduledStart?.toISOString() ?? null,
    scheduled_end: wo.scheduledEnd?.toISOString() ?? null,
    status: visitStatusForUi(wo.fieldStatus, wo.status, currentWoId === wo.id),
    field_status: wo.fieldStatus || "scheduled",
    raw_status: wo.status,
    team: team || null,
    crew_name: wo.crew?.name || null,
  };
}

async function closeOpenSegment(tx: Tx, shiftId: string, at: Date) {
  await tx.campoSegment.updateMany({
    where: { shiftId, endedAt: null },
    data: { endedAt: at },
  });
}

async function openSegment(
  tx: Tx,
  organizationId: string,
  shiftId: string,
  kind: ActivityKind,
  workOrderId: string | null,
  at: Date,
) {
  if (kind === "on_site" && !workOrderId) {
    throw Object.assign(new Error("work_order_id required for on_site"), { status: 400 });
  }
  if (kind !== "on_site") workOrderId = null;
  if (workOrderId) {
    const wo = await tx.workOrder.findFirst({ where: { id: workOrderId } });
    if (!wo) {
      throw Object.assign(new Error("Work order not found"), { status: 404 });
    }
  }
  return tx.campoSegment.create({
    data: {
      organizationId,
      shiftId,
      activityKind: kind,
      workOrderId,
      startedAt: at,
    },
    include: {
      workOrder: {
        include: {
          customer: { select: { name: true } },
          builder: { select: { firstName: true, lastName: true, company: true } },
        },
      },
    },
  });
}

async function resolveTeamName(tx: Tx, userId: string) {
  const membership = await tx.crewMember.findFirst({
    where: { userId },
    include: { crew: { select: { name: true } } },
    orderBy: { role: "asc" },
  });
  return membership?.crew?.name || null;
}

async function buildHojePayload(tx: Tx, req: AuthedRequest, now = new Date()) {
  const userId = req.user!.id;
  const orgId = req.organizationId!;
  const name = req.user!.name || req.user!.email || "";
  const team = await resolveTeamName(tx, userId);
  let shift = await getOpenShift(tx, userId);
  if (!shift) {
    // closed shift today still useful for paid_ms display
    const today = await tx.campoShift.findFirst({
      where: { userId, workDate: workDateUtc(now) },
      include: {
        segments: {
          orderBy: { startedAt: "asc" },
          include: {
            workOrder: {
              include: {
                customer: { select: { name: true } },
                builder: { select: { firstName: true, lastName: true, company: true } },
              },
            },
          },
        },
      },
    });
    shift = today;
  }
  const ponto = mapPonto(shift, now);
  const currentWoId = ponto.current?.work_order_id ?? null;
  const jobs = (await findMyJobsToday(tx, userId, now)).map((j) =>
    mapJob(j, currentWoId),
  );

  const activities: {
    id: string;
    activity_kind: ActivityKind;
    label: string;
    title: string;
    sub: string;
    work_order_id: string | null;
  }[] = [];

  for (const j of jobs) {
    activities.push({
      id: `on_site:${j.id}`,
      activity_kind: "on_site",
      label: "Na obra",
      title: `Na obra · #${j.number ?? "—"} ${j.client_short}`,
      sub: j.address || "Sem endereço",
      work_order_id: j.id,
    });
  }
  activities.push(
    {
      id: "travel",
      activity_kind: "travel",
      label: "Deslocamento",
      title: "Deslocamento",
      sub: "Entre obras ou até o depósito",
      work_order_id: null,
    },
    {
      id: "shopping",
      activity_kind: "shopping",
      label: "Compra de material",
      title: "Compra de material",
      sub: "Loja ou distribuidor",
      work_order_id: null,
    },
    {
      id: "break",
      activity_kind: "break",
      label: "Pausa · não paga",
      title: "Pausa · não paga",
      sub: "Almoço ou intervalo, não conta",
      work_order_id: null,
    },
  );

  const folha = await buildFolhaPayload(tx, userId, now, req.user!.email);

  return {
    user: {
      id: userId,
      name,
      first_name: firstName(name),
      initials: initialsFromName(name),
      team: team || "Equipe",
      role: req.user!.roleKey,
    },
    organization_id: orgId,
    server_now: now.toISOString(),
    ponto,
    folha,
    payments: folha.payments || [],
    jobs,
    activities,
  };
}

// ---- Routes ------------------------------------------------------------------

campoPontoRouter.get(
  "/api/campo/hoje",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const data = await withTenantTransaction(req.organizationId!, async (tx) =>
        buildHojePayload(tx, req),
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

campoPontoRouter.get(
  "/api/campo/ponto",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const ponto = await withTenantTransaction(req.organizationId!, async (tx) => {
        const shift = await getOpenShift(tx, req.user!.id);
        return mapPonto(shift);
      });
      res.json({ success: true, data: ponto });
    } catch (error) {
      next(error);
    }
  },
);

campoPontoRouter.post(
  "/api/campo/ponto/clock-in",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const parsed = switchBody.safeParse(req.body || {});
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Invalid payload", details: parsed.error.flatten() });
        return;
      }
      const now = new Date();
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await getOpenShift(tx, req.user!.id);
        if (existing) {
          throw Object.assign(new Error("Já existe um turno aberto"), { status: 409 });
        }
        const wd = workDateUtc(now);
        const prior = await tx.campoShift.findFirst({
          where: { userId: req.user!.id, workDate: wd },
        });
        if (prior) {
          throw Object.assign(new Error("Turno de hoje já foi encerrado"), { status: 409 });
        }
        let kind = parsed.data.activity_kind;
        let woId = parsed.data.work_order_id ?? null;
        if (!woId && kind === "on_site") {
          const jobs = await findMyJobsToday(tx, req.user!.id, now);
          woId = jobs[0]?.id ?? null;
          if (!woId) kind = "travel";
        }
        const shift = await tx.campoShift.create({
          data: {
            organizationId: req.organizationId!,
            userId: req.user!.id,
            workDate: wd,
            clockInAt: now,
            status: "open",
          },
        });
        await openSegment(tx, req.organizationId!, shift.id, kind, woId, now);
        return buildHojePayload(tx, req, now);
      });
      res.json({ success: true, data });
    } catch (error: unknown) {
      const err = error as { status?: number; message?: string };
      if (err?.status) {
        res.status(err.status).json({ success: false, error: err.message || "Error" });
        return;
      }
      next(error);
    }
  },
);

campoPontoRouter.post(
  "/api/campo/ponto/switch",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const parsed = switchBody.safeParse(req.body || {});
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Invalid payload", details: parsed.error.flatten() });
        return;
      }
      const now = new Date();
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const shift = await getOpenShift(tx, req.user!.id);
        if (!shift) {
          throw Object.assign(new Error("Nenhum turno aberto — inicie o dia"), { status: 409 });
        }
        await closeOpenSegment(tx, shift.id, now);
        await openSegment(
          tx,
          req.organizationId!,
          shift.id,
          parsed.data.activity_kind,
          parsed.data.work_order_id ?? null,
          now,
        );
        return buildHojePayload(tx, req, now);
      });
      res.json({ success: true, data });
    } catch (error: unknown) {
      const err = error as { status?: number; message?: string };
      if (err?.status) {
        res.status(err.status).json({ success: false, error: err.message || "Error" });
        return;
      }
      next(error);
    }
  },
);

campoPontoRouter.post(
  "/api/campo/ponto/pause",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const now = new Date();
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const shift = await getOpenShift(tx, req.user!.id);
        if (!shift) {
          throw Object.assign(new Error("Nenhum turno aberto"), { status: 409 });
        }
        const cur = currentSegment(shift.segments);
        if (cur?.activityKind === "break") {
          return buildHojePayload(tx, req, now);
        }
        await closeOpenSegment(tx, shift.id, now);
        await openSegment(tx, req.organizationId!, shift.id, "break", null, now);
        return buildHojePayload(tx, req, now);
      });
      res.json({ success: true, data });
    } catch (error: unknown) {
      const err = error as { status?: number; message?: string };
      if (err?.status) {
        res.status(err.status).json({ success: false, error: err.message || "Error" });
        return;
      }
      next(error);
    }
  },
);

campoPontoRouter.post(
  "/api/campo/ponto/resume",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const now = new Date();
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const shift = await getOpenShift(tx, req.user!.id);
        if (!shift) {
          throw Object.assign(new Error("Nenhum turno aberto"), { status: 409 });
        }
        const cur = currentSegment(shift.segments);
        if (!cur || cur.activityKind !== "break") {
          return buildHojePayload(tx, req, now);
        }
        // Resume to last non-break segment if possible
        const prior = [...shift.segments]
          .reverse()
          .find((s) => s.activityKind !== "break" && s.endedAt);
        const kind = (prior?.activityKind as ActivityKind) || "travel";
        const woId = prior?.workOrderId ?? null;
        const resumeKind = kind === "on_site" && !woId ? "travel" : kind;
        await closeOpenSegment(tx, shift.id, now);
        await openSegment(tx, req.organizationId!, shift.id, resumeKind, woId, now);
        return buildHojePayload(tx, req, now);
      });
      res.json({ success: true, data });
    } catch (error: unknown) {
      const err = error as { status?: number; message?: string };
      if (err?.status) {
        res.status(err.status).json({ success: false, error: err.message || "Error" });
        return;
      }
      next(error);
    }
  },
);

campoPontoRouter.post(
  "/api/campo/ponto/clock-out",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const now = new Date();
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const shift = await getOpenShift(tx, req.user!.id);
        if (!shift) {
          throw Object.assign(new Error("Nenhum turno aberto"), { status: 409 });
        }
        await closeOpenSegment(tx, shift.id, now);
        await tx.campoShift.update({
          where: { id: shift.id },
          data: { clockOutAt: now, status: "closed" },
        });
        return buildHojePayload(tx, req, now);
      });
      res.json({ success: true, data });
    } catch (error: unknown) {
      const err = error as { status?: number; message?: string };
      if (err?.status) {
        res.status(err.status).json({ success: false, error: err.message || "Error" });
        return;
      }
      next(error);
    }
  },
);
