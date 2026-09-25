/**
 * Campo · Minhas horas — week rollup, manual entry, submit for approval.
 */
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { requireCrmAuth } from "../http.js";
import {
  canUseCampo,
  clientLabel,
  dec,
  myJobAccessWhere,
  shortClient,
  type Tx,
} from "../lib/campo-shared.js";

export const campoHorasRouter = Router();

const ACTIVITY = ["on_site", "travel", "shopping"] as const;

function ymdLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfWeekMon(d: Date) {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function workDateUtcFromYmd(ymd: string) {
  const [y, m, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, day!));
}

function workDateUtcFromLocal(d: Date) {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function formatDuration(ms: number) {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

const MON_SHORT = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];
const DOW_LONG = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const DOW_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function dayLabel(d: Date, todayYmd: string) {
  const ymd = ymdLocal(d);
  const base = `${DOW_LONG[d.getDay()]}, ${d.getDate()} ${MON_SHORT[d.getMonth()]}`;
  return ymd === todayYmd ? `Hoje · ${base}` : base;
}

async function resolveEmployee(tx: Tx, userId: string, email?: string | null) {
  let emp = await tx.payrollEmployee.findFirst({ where: { userId } });
  if (emp) return emp;
  const em = email ? String(email).trim().toLowerCase() : "";
  if (!em) return null;
  emp = await tx.payrollEmployee.findFirst({
    where: { email: { equals: em, mode: "insensitive" }, userId: null },
  });
  if (!emp) return null;
  return tx.payrollEmployee.update({
    where: { id: emp.id },
    data: { userId },
  });
}

type DayBucket = {
  ymd: string;
  ms_obra: number;
  ms_travel: number;
  ms_shop: number;
  labels: string[];
  open: boolean;
  production_sqft: number;
};

function emptyBucket(ymd: string): DayBucket {
  return {
    ymd,
    ms_obra: 0,
    ms_travel: 0,
    ms_shop: 0,
    labels: [],
    open: false,
    production_sqft: 0,
  };
}

function segmentMs(
  kind: string,
  startedAt: Date,
  endedAt: Date | null,
  now: Date,
): { key: "obra" | "travel" | "shop" | null; ms: number } {
  if (kind === "break") return { key: null, ms: 0 };
  const end = endedAt ? endedAt.getTime() : now.getTime();
  const ms = Math.max(0, end - startedAt.getTime());
  if (kind === "on_site") return { key: "obra", ms };
  if (kind === "travel") return { key: "travel", ms };
  if (kind === "shopping") return { key: "shop", ms };
  return { key: null, ms: 0 };
}

async function buildWeekPayload(
  tx: Tx,
  req: AuthedRequest,
  weekStart: Date,
  now = new Date(),
) {
  const userId = req.user!.id;
  const weekEnd = addDays(weekStart, 7);
  const weekStartUtc = workDateUtcFromLocal(weekStart);
  const weekEndUtc = workDateUtcFromLocal(addDays(weekStart, 6));
  const todayYmd = ymdLocal(now);

  const [shifts, manuals, submission, jobs, employee] = await Promise.all([
    tx.campoShift.findMany({
      where: {
        userId,
        workDate: { gte: weekStartUtc, lte: weekEndUtc },
      },
      include: {
        segments: {
          orderBy: { startedAt: "asc" },
          include: {
            workOrder: {
              select: {
                id: true,
                number: true,
                customer: { select: { name: true } },
                builder: { select: { firstName: true, lastName: true, company: true } },
                sourceName: true,
              },
            },
          },
        },
      },
      orderBy: { workDate: "asc" },
    }),
    tx.campoManualEntry.findMany({
      where: {
        userId,
        workDate: { gte: weekStartUtc, lte: weekEndUtc },
      },
      include: {
        workOrder: {
          select: {
            id: true,
            number: true,
            customer: { select: { name: true } },
            builder: { select: { firstName: true, lastName: true, company: true } },
            sourceName: true,
          },
        },
      },
      orderBy: { workDate: "asc" },
    }),
    tx.campoWeekSubmission.findUnique({
      where: {
        organizationId_userId_weekStart: {
          organizationId: req.organizationId!,
          userId,
          weekStart: weekStartUtc,
        },
      },
    }),
    tx.workOrder.findMany({
      where: {
        status: { not: "canceled" },
        ...myJobAccessWhere(userId),
        OR: [
          { scheduledStart: { gte: weekStart, lt: weekEnd } },
          {
            fieldStatus: "completed",
            updatedAt: { gte: weekStart, lt: weekEnd },
          },
        ],
      },
      include: {
        customer: { select: { name: true } },
        builder: { select: { firstName: true, lastName: true, company: true } },
        lineItems: { select: { quantitySqft: true, serviceName: true } },
      },
      take: 100,
    }),
    resolveEmployee(tx, userId, req.user!.email),
  ]);

  const daysMap = new Map<string, DayBucket>();
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    daysMap.set(ymdLocal(d), emptyBucket(ymdLocal(d)));
  }

  for (const shift of shifts) {
    const ymd = ymdLocal(
      new Date(
        shift.workDate.getUTCFullYear(),
        shift.workDate.getUTCMonth(),
        shift.workDate.getUTCDate(),
      ),
    );
    const bucket = daysMap.get(ymd) || emptyBucket(ymd);
    if (shift.status === "open") bucket.open = true;
    for (const seg of shift.segments) {
      const { key, ms } = segmentMs(seg.activityKind, seg.startedAt, seg.endedAt, now);
      if (key === "obra") bucket.ms_obra += ms;
      if (key === "travel") bucket.ms_travel += ms;
      if (key === "shop") bucket.ms_shop += ms;
      if (seg.workOrder) {
        const client = shortClient(clientLabel(seg.workOrder));
        const label = `#${seg.workOrder.number ?? "—"} ${client}`;
        if (!bucket.labels.includes(label)) bucket.labels.push(label);
      }
    }
    daysMap.set(ymd, bucket);
  }

  for (const m of manuals) {
    const ymd = ymdLocal(
      new Date(m.workDate.getUTCFullYear(), m.workDate.getUTCMonth(), m.workDate.getUTCDate()),
    );
    const bucket = daysMap.get(ymd) || emptyBucket(ymd);
    if (m.entryType === "hours" && m.hours != null) {
      const ms = dec(m.hours) * 3600_000;
      if (m.activityKind === "on_site") bucket.ms_obra += ms;
      else if (m.activityKind === "travel") bucket.ms_travel += ms;
      else if (m.activityKind === "shopping") bucket.ms_shop += ms;
      else bucket.ms_obra += ms;
    }
    if (m.entryType === "production" && m.sqft != null) {
      bucket.production_sqft += dec(m.sqft);
    }
    if (m.workOrder) {
      const client = shortClient(clientLabel(m.workOrder));
      const label = `#${m.workOrder.number ?? "—"} ${client}`;
      if (!bucket.labels.includes(label)) bucket.labels.push(label);
    }
    daysMap.set(ymd, bucket);
  }

  const prodByJob = new Map<string, number>();
  for (const wo of jobs) {
    if (wo.fieldStatus !== "completed" && wo.status !== "completed") continue;
    const sqft = (wo.lineItems || []).reduce((s, li) => s + dec(li.quantitySqft), 0);
    if (sqft <= 0) continue;
    prodByJob.set(wo.id, sqft);
    const daySrc = wo.scheduledStart || wo.updatedAt;
    const ymd = ymdLocal(daySrc);
    const bucket = daysMap.get(ymd);
    if (bucket) {
      bucket.production_sqft += sqft;
      const client = shortClient(clientLabel(wo));
      const label = `#${wo.number ?? "—"} ${client}`;
      if (!bucket.labels.includes(label)) bucket.labels.push(label);
    }
  }

  let totalMs = 0;
  let totalProd = 0;
  const dayCards = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(weekStart, i);
    const ymd = ymdLocal(d);
    const b = daysMap.get(ymd)!;
    const paidMs = b.ms_obra + b.ms_travel + b.ms_shop;
    totalMs += paidMs;
    totalProd += b.production_sqft;
    if (paidMs <= 0 && b.production_sqft <= 0 && !b.open) continue;
    const barTotal = paidMs || 1;
    const subParts = [];
    if (b.open) subParts.push("Em andamento");
    if (b.labels[0]) subParts.push(b.labels[0]);
    dayCards.push({
      ymd,
      label: dayLabel(d, todayYmd),
      total: formatDuration(paidMs),
      total_ms: paidMs,
      sub: subParts.join(" · ") || "—",
      bar: {
        obra: Math.round((b.ms_obra / barTotal) * 100),
        travel: Math.round((b.ms_travel / barTotal) * 100),
        shop: Math.round((b.ms_shop / barTotal) * 100),
      },
      production_sqft: Math.round(b.production_sqft * 100) / 100,
    });
  }

  const prodJobs = jobs
    .filter((wo) => prodByJob.has(wo.id))
    .map((wo) => ({
      id: wo.id,
      number: wo.number,
      title: wo.title,
      client: clientLabel(wo),
      sqft: Math.round((prodByJob.get(wo.id) || 0) * 100) / 100,
    }));

  const hourly = employee ? dec(employee.hourlyRate) : 0;
  const daily = employee ? dec(employee.dailyRate) : 0;
  const totalHours = totalMs / 3600_000;
  let payEstimate = 0;
  if (employee?.payType === "daily" && daily > 0) {
    const daysWorked = dayCards.filter((d) => d.total_ms > 0).length;
    payEstimate = daysWorked * daily;
  } else if (hourly > 0) {
    payEstimate = totalHours * hourly;
  } else if (daily > 0) {
    payEstimate = (totalHours / 8) * daily;
  }

  const end = addDays(weekStart, 6);
  const range_label = `${weekStart.getDate()} – ${end.getDate()} ${MON_SHORT[end.getMonth()]}`;
  const status = submission?.status || "draft";

  const dayOptions = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    const ymd = ymdLocal(d);
    if (ymd > todayYmd) break;
    dayOptions.push({
      ymd,
      label: ymd === todayYmd ? `Hoje ${d.getDate()}` : `${DOW_SHORT[d.getDay()]} ${d.getDate()}`,
    });
  }

  const jobOptions = [
    ...jobs.map((wo) => ({
      id: wo.id,
      label: `#${wo.number ?? "—"} ${shortClient(clientLabel(wo))}`,
    })),
    { id: "oficina", label: "Oficina" },
  ];

  return {
    week_start: ymdLocal(weekStart),
    week_end: ymdLocal(end),
    range_label,
    status,
    status_label: status === "submitted" ? "Enviada" : "Rascunho",
    can_submit: status === "draft" && (totalMs > 0 || totalProd > 0),
    can_edit: status === "draft",
    totals: {
      hours_ms: totalMs,
      hours_label: formatDuration(totalMs),
      production_sqft: Math.round(totalProd * 100) / 100,
      production_label:
        totalProd > 0 ? `${Math.round(totalProd).toLocaleString("en-US")} ft²` : "0 ft²",
      pay_estimate: Math.round(payEstimate),
      pay_label: payEstimate > 0 ? `$${Math.round(payEstimate)}` : "—",
    },
    days: dayCards,
    production_jobs: prodJobs,
    manual_entries: manuals.map((m) => ({
      id: m.id,
      work_date: ymdLocal(
        new Date(m.workDate.getUTCFullYear(), m.workDate.getUTCMonth(), m.workDate.getUTCDate()),
      ),
      entry_type: m.entryType,
      activity_kind: m.activityKind,
      hours: m.hours != null ? dec(m.hours) : null,
      sqft: m.sqft != null ? dec(m.sqft) : null,
      reason: m.reason,
      status: m.status,
      work_order_id: m.workOrderId,
    })),
    form: {
      days: dayOptions,
      jobs: jobOptions,
      activities: [
        { id: "on_site", label: "Na obra" },
        { id: "travel", label: "Deslocamento" },
        { id: "shopping", label: "Compras" },
      ],
    },
    employee_linked: Boolean(employee),
  };
}

campoHorasRouter.get(
  "/api/campo/horas",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const weekParam = String(req.query.week || "").trim();
      let weekStart: Date;
      if (/^\d{4}-\d{2}-\d{2}$/.test(weekParam)) {
        weekStart = startOfWeekMon(new Date(weekParam + "T12:00:00"));
      } else {
        weekStart = startOfWeekMon(new Date());
      }
      const data = await withTenantTransaction(req.organizationId!, async (tx) =>
        buildWeekPayload(tx, req, weekStart),
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

campoHorasRouter.post(
  "/api/campo/horas/manual",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const body = z
        .object({
          entry_type: z.enum(["hours", "production"]),
          work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          activity_kind: z.enum(ACTIVITY).optional().nullable(),
          work_order_id: z.string().optional().nullable(),
          hours: z.number().positive().max(24).optional(),
          duration_minutes: z.number().int().positive().max(24 * 60).optional(),
          sqft: z.number().positive().max(1_000_000).optional(),
          reason: z.string().max(500).optional().nullable(),
          week: z.string().optional(),
        })
        .safeParse(req.body || {});
      if (!body.success) {
        res.status(400).json({
          success: false,
          error: "Invalid payload",
          details: body.error.flatten(),
        });
        return;
      }
      const b = body.data;
      let hours = b.hours;
      if (hours == null && b.duration_minutes != null) {
        hours = b.duration_minutes / 60;
      }
      if (b.entry_type === "hours" && (hours == null || hours <= 0)) {
        res.status(400).json({ success: false, error: "Informe a duração" });
        return;
      }
      if (b.entry_type === "production" && (b.sqft == null || b.sqft <= 0)) {
        res.status(400).json({ success: false, error: "Informe a produção (ft²)" });
        return;
      }

      const weekStart = startOfWeekMon(
        b.week && /^\d{4}-\d{2}-\d{2}$/.test(b.week)
          ? new Date(b.week + "T12:00:00")
          : new Date(b.work_date + "T12:00:00"),
      );

      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const weekStartUtc = workDateUtcFromLocal(weekStart);
        const sub = await tx.campoWeekSubmission.findUnique({
          where: {
            organizationId_userId_weekStart: {
              organizationId: req.organizationId!,
              userId: req.user!.id,
              weekStart: weekStartUtc,
            },
          },
        });
        if (sub?.status === "submitted") {
          throw Object.assign(new Error("Semana já enviada — não é possível lançar"), {
            status: 409,
          });
        }

        let workOrderId: string | null = null;
        if (b.work_order_id && b.work_order_id !== "oficina") {
          const wo = await tx.workOrder.findFirst({
            where: { id: b.work_order_id, ...myJobAccessWhere(req.user!.id) },
            select: { id: true },
          });
          if (!wo) {
            throw Object.assign(new Error("Obra inválida"), { status: 400 });
          }
          workOrderId = wo.id;
        }

        const reasonParts = [
          b.reason?.trim() || "Lançamento manual Campo",
          b.entry_type === "hours" ? `atividade=${b.activity_kind || "on_site"}` : null,
          b.work_order_id === "oficina" ? "obra=Oficina" : null,
        ].filter(Boolean);

        let hourBankEntryId: string | null = null;
        if (b.entry_type === "hours") {
          const emp = await resolveEmployee(tx, req.user!.id, req.user!.email);
          if (emp && emp.status === "active") {
            const hb = await tx.payrollHourBankEntry.create({
              data: {
                organizationId: req.organizationId!,
                employeeId: emp.id,
                workDate: workDateUtcFromYmd(b.work_date),
                hours: new Prisma.Decimal(Math.round((hours || 0) * 100) / 100),
                notes: reasonParts.join(" · ").slice(0, 500),
                status: "pending",
              },
            });
            hourBankEntryId = hb.id;
          }
        }

        await tx.campoManualEntry.create({
          data: {
            organizationId: req.organizationId!,
            userId: req.user!.id,
            workDate: workDateUtcFromYmd(b.work_date),
            entryType: b.entry_type,
            activityKind: b.entry_type === "hours" ? b.activity_kind || "on_site" : null,
            workOrderId,
            hours:
              b.entry_type === "hours"
                ? new Prisma.Decimal(Math.round((hours || 0) * 100) / 100)
                : null,
            sqft:
              b.entry_type === "production"
                ? new Prisma.Decimal(Math.round((b.sqft || 0) * 100) / 100)
                : null,
            reason: reasonParts.join(" · ").slice(0, 500),
            status: "pending",
            hourBankEntryId,
          },
        });

        return buildWeekPayload(tx, req, weekStart);
      });

      res.status(201).json({ success: true, data });
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

campoHorasRouter.post(
  "/api/campo/horas/submit-week",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const body = z
        .object({
          week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          note: z.string().max(500).optional().nullable(),
        })
        .safeParse(req.body || {});
      if (!body.success) {
        res.status(400).json({ success: false, error: "Invalid payload" });
        return;
      }
      const weekStart = startOfWeekMon(
        body.data.week ? new Date(body.data.week + "T12:00:00") : new Date(),
      );
      const weekStartUtc = workDateUtcFromLocal(weekStart);
      const now = new Date();

      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.campoWeekSubmission.findUnique({
          where: {
            organizationId_userId_weekStart: {
              organizationId: req.organizationId!,
              userId: req.user!.id,
              weekStart: weekStartUtc,
            },
          },
        });
        if (existing?.status === "submitted") {
          throw Object.assign(new Error("Semana já foi enviada"), { status: 409 });
        }

        const payload = await buildWeekPayload(tx, req, weekStart, now);
        if (payload.totals.hours_ms <= 0 && payload.totals.production_sqft <= 0) {
          throw Object.assign(new Error("Nada para enviar nesta semana"), { status: 400 });
        }

        // Hour-bank line for clocked ponto only (manual entries already created their own pending rows)
        const emp = await resolveEmployee(tx, req.user!.id, req.user!.email);
        if (emp && emp.status === "active") {
          const shifts = await tx.campoShift.findMany({
            where: {
              userId: req.user!.id,
              workDate: {
                gte: weekStartUtc,
                lte: workDateUtcFromLocal(addDays(weekStart, 6)),
              },
            },
            include: { segments: true },
          });
          let pontoMs = 0;
          for (const sh of shifts) {
            for (const seg of sh.segments) {
              if (seg.activityKind === "break") continue;
              const end = seg.endedAt ? seg.endedAt.getTime() : now.getTime();
              pontoMs += Math.max(0, end - seg.startedAt.getTime());
            }
          }
          if (pontoMs > 0) {
            const hours = Math.round((pontoMs / 3600_000) * 100) / 100;
            await tx.payrollHourBankEntry.create({
              data: {
                organizationId: req.organizationId!,
                employeeId: emp.id,
                workDate: weekStartUtc,
                hours: new Prisma.Decimal(hours),
                notes: `Campo · ponto semana ${payload.range_label}`.slice(0, 500),
                status: "pending",
              },
            });
          }
        }

        await tx.campoManualEntry.updateMany({
          where: {
            userId: req.user!.id,
            workDate: {
              gte: weekStartUtc,
              lte: workDateUtcFromLocal(addDays(weekStart, 6)),
            },
            status: "pending",
          },
          data: { status: "submitted" },
        });

        if (existing) {
          await tx.campoWeekSubmission.update({
            where: { id: existing.id },
            data: {
              status: "submitted",
              submittedAt: now,
              note: body.data.note || null,
            },
          });
        } else {
          await tx.campoWeekSubmission.create({
            data: {
              organizationId: req.organizationId!,
              userId: req.user!.id,
              weekStart: weekStartUtc,
              status: "submitted",
              submittedAt: now,
              note: body.data.note || null,
            },
          });
        }

        return buildWeekPayload(tx, req, weekStart, now);
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
