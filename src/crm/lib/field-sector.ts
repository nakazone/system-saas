/**
 * Field visibility by Folha (PayrollEmployee) sector.
 *
 * Linked Folha staff see the whole sector calendar (not only jobs they are assigned to):
 * - Installation → installation + both (on install date)
 * - Sand / Lixa → sand_finish + both (on sand date; sandScheduledStart for both)
 * No Folha link → assignment-only (legacy).
 */
import type { Prisma } from "@prisma/client";
import { myJobAccessWhere } from "./campo-shared.js";

export type FieldPayrollSector = "installation" | "sand_finish" | null;

type SectorTx = {
  payrollEmployee: {
    findFirst: (args: {
      where: { userId: string; status: string; organizationId?: string };
      select: { sector: true };
    }) => Promise<{ sector: string | null } | null>;
  };
};

export async function fieldPayrollSector(
  tx: SectorTx,
  userId: string,
  organizationId?: string,
): Promise<FieldPayrollSector> {
  const emp = await tx.payrollEmployee.findFirst({
    where: { userId, status: "active", ...(organizationId ? { organizationId } : {}) },
    select: { sector: true },
  });
  if (!emp) return null;
  return emp.sector === "sand_finish" ? "sand_finish" : "installation";
}

/** Prisma filter: which work-order sectors this Folha sector may see. */
export function jobSectorMatchWhere(sector: FieldPayrollSector): Prisma.WorkOrderWhereInput {
  if (sector === "sand_finish") {
    // Lixa: jobs marked sand / both, or any job that already has a sand day on the calendar.
    return {
      OR: [{ sector: { in: ["sand_finish", "both"] } }, { sandScheduledStart: { not: null } }],
    };
  }
  if (sector === "installation") {
    return { OR: [{ sector: "installation" }, { sector: "both" }, { sector: null }] };
  }
  return {};
}

/**
 * Jobs the field user may open/list.
 * Folha sector set → every job in that sector for the company.
 * No Folha link → only jobs they are assigned to / crew / member.
 */
export function myFieldJobsWhere(userId: string, sector: FieldPayrollSector): Prisma.WorkOrderWhereInput {
  const sectorWhere = jobSectorMatchWhere(sector);
  if (Object.keys(sectorWhere).length) return sectorWhere;
  return myJobAccessWhere(userId);
}

type DatedJob = {
  sector?: string | null;
  scheduledStart?: Date | null;
  sandScheduledStart?: Date | null;
};

/** Calendar day that places this job on the field agenda for the viewer's Folha sector. */
export function fieldAgendaAt(wo: DatedJob, sector: FieldPayrollSector): Date | null {
  if (sector === "sand_finish") {
    if (wo.sandScheduledStart) return wo.sandScheduledStart;
    if (wo.sector === "sand_finish") return wo.scheduledStart ?? null;
    return null;
  }
  if (sector === "installation") {
    if (wo.sector === "sand_finish") return null;
    return wo.scheduledStart ?? null;
  }
  return wo.scheduledStart ?? wo.sandScheduledStart ?? null;
}

/** Whether a schedule-event slot belongs to this Folha sector. */
export function fieldSlotMatchesSector(
  role: "main" | "sand" | "delivery",
  woSector: string | null | undefined,
  sector: FieldPayrollSector,
): boolean {
  if (!sector) return true;
  if (role === "delivery") return true;
  if (sector === "sand_finish") {
    if (role === "sand") return true;
    // Sand-only jobs store their day on the main slot.
    return role === "main" && woSector === "sand_finish";
  }
  // installation
  if (role === "sand") return false;
  return woSector !== "sand_finish";
}

/**
 * Date window for listing / office-style agenda queries.
 * Sand staff match sand-only on scheduledStart and both-jobs on sandScheduledStart.
 */
export function fieldJobDateWindowWhere(
  from: Date,
  to: Date,
  sector: FieldPayrollSector,
): Prisma.WorkOrderWhereInput {
  const installOverlap: Prisma.WorkOrderWhereInput = {
    scheduledStart: { not: null, lte: to },
    OR: [{ scheduledEnd: null }, { scheduledEnd: { gte: from } }],
  };
  const sandInRange: Prisma.WorkOrderWhereInput = {
    sandScheduledStart: { gte: from, lte: to },
  };

  if (sector === "sand_finish") {
    return {
      OR: [
        { AND: [{ sector: "sand_finish" }, installOverlap] },
        sandInRange,
      ],
    };
  }
  if (sector === "installation") {
    return {
      AND: [jobSectorMatchWhere("installation"), installOverlap],
    };
  }
  return {
    OR: [installOverlap, sandInRange, { deliveryScheduledStart: { gte: from, lte: to } }],
  };
}

/** Jobs whose field day falls inside [start, end) for this Folha sector. */
export function fieldJobsOnDayWhere(
  start: Date,
  end: Date,
  userId: string,
  sector: FieldPayrollSector,
): Prisma.WorkOrderWhereInput {
  const scope = myFieldJobsWhere(userId, sector);
  const installDay: Prisma.WorkOrderWhereInput = {
    scheduledStart: { lt: end },
    OR: [{ scheduledEnd: { gte: start } }, { scheduledEnd: null, scheduledStart: { gte: start } }],
  };
  const sandDay: Prisma.WorkOrderWhereInput = {
    sector: "both",
    sandScheduledStart: { gte: start, lt: end },
  };

  if (sector === "sand_finish") {
    return {
      AND: [
        scope,
        {
          OR: [
            { AND: [{ sector: "sand_finish" }, installDay] },
            { sandScheduledStart: { gte: start, lt: end } },
          ],
        },
      ],
    };
  }
  if (sector === "installation") {
    return {
      AND: [scope, installDay],
    };
  }
  return {
    AND: [scope, { OR: [installDay, sandDay] }],
  };
}

/** Week bucket query for Campo agenda. */
export function fieldAgendaWeekWhere(
  weekStart: Date,
  weekEnd: Date,
  userId: string,
  sector: FieldPayrollSector,
): Prisma.WorkOrderWhereInput {
  const scope = myFieldJobsWhere(userId, sector);
  if (sector === "sand_finish") {
    return {
      AND: [
        scope,
        {
          OR: [
            { sector: "sand_finish", scheduledStart: { gte: weekStart, lt: weekEnd } },
            { sandScheduledStart: { gte: weekStart, lt: weekEnd } },
          ],
        },
      ],
    };
  }
  if (sector === "installation") {
    return {
      AND: [scope, { scheduledStart: { gte: weekStart, lt: weekEnd } }],
    };
  }
  return {
    AND: [
      scope,
      {
        OR: [
          { scheduledStart: { gte: weekStart, lt: weekEnd } },
          { sandScheduledStart: { gte: weekStart, lt: weekEnd } },
        ],
      },
    ],
  };
}
