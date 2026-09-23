import { Router } from "express";
import { requireAuth, requirePermission, type AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import {
  addDays,
  endOfDay,
  startOfDay,
  startOfWeek,
} from "../../lib/schedule/conflicts.js";
import type { Prisma } from "@prisma/client";

export const scheduleRouter = Router();
scheduleRouter.use(requireAuth);

function isInstallerOnly(user: AuthedRequest["user"]): boolean {
  return user?.roleKey === "installer" && !user.permissions.includes("visits.manage");
}

scheduleRouter.get(
  "/",
  requirePermission("visits.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const mode = req.query.mode === "month" ? "month" : "week";
      const anchor = req.query.date ? new Date(String(req.query.date)) : new Date();
      const rangeStart =
        mode === "week" ? startOfWeek(anchor) : startOfDay(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
      const rangeEnd =
        mode === "week"
          ? endOfDay(addDays(rangeStart, 6))
          : endOfDay(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0));

      const visits = await withTenantTransaction(req.organizationId!, async (tx) => {
        const where: Prisma.VisitWhereInput = {
          status: { not: "canceled" },
          scheduledStart: { lte: rangeEnd },
          scheduledEnd: { gte: rangeStart },
        };
        if (isInstallerOnly(req.user)) {
          const memberships = await tx.crewMember.findMany({
            where: { userId: req.user!.id },
            select: { crewId: true },
          });
          const crewIds = memberships.map((m) => m.crewId);
          where.OR = [
            { assignedUserId: req.user!.id },
            ...(crewIds.length ? [{ crewId: { in: crewIds } }] : []),
          ];
        }
        return tx.visit.findMany({
          where,
          include: {
            project: { include: { customer: true } },
            crew: true,
            assignedUser: true,
          },
          orderBy: { scheduledStart: "asc" },
        });
      });

      const days: { date: Date; label: string; visits: typeof visits }[] = [];
      const cursor = new Date(rangeStart);
      while (cursor <= rangeEnd) {
        const dayStart = startOfDay(cursor);
        const dayEnd = endOfDay(cursor);
        days.push({
          date: new Date(dayStart),
          label: dayStart.toLocaleDateString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
          }),
          visits: visits.filter(
            (v) => v.scheduledStart <= dayEnd && v.scheduledEnd >= dayStart,
          ),
        });
        cursor.setDate(cursor.getDate() + 1);
        if (mode === "month" && days.length > 37) break;
      }

      res.render("schedule/index", {
        title: "Schedule",
        organization: req.organization,
        user: req.user,
        mode,
        rangeStart,
        rangeEnd,
        days: mode === "week" ? days.slice(0, 7) : days,
        prevDate: addDays(rangeStart, mode === "week" ? -7 : -28).toISOString().slice(0, 10),
        nextDate: addDays(rangeStart, mode === "week" ? 7 : 28).toISOString().slice(0, 10),
        canManage: req.user?.permissions.includes("visits.manage"),
      });
    } catch (error) {
      next(error);
    }
  },
);

scheduleRouter.get(
  "/my-day",
  requirePermission("visits.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const day = req.query.date ? new Date(String(req.query.date)) : new Date();
      const from = startOfDay(day);
      const to = endOfDay(day);

      const visits = await withTenantTransaction(req.organizationId!, async (tx) => {
        const memberships = await tx.crewMember.findMany({
          where: { userId: req.user!.id },
          select: { crewId: true },
        });
        const crewIds = memberships.map((m) => m.crewId);
        return tx.visit.findMany({
          where: {
            status: { not: "canceled" },
            scheduledStart: { lte: to },
            scheduledEnd: { gte: from },
            OR: [
              { assignedUserId: req.user!.id },
              ...(crewIds.length ? [{ crewId: { in: crewIds } }] : []),
            ],
          },
          include: {
            project: { include: { customer: true, property: true } },
            crew: true,
            checklistResponse: true,
          },
          orderBy: { scheduledStart: "asc" },
        });
      });

      res.render("schedule/my-day", {
        title: "My Day",
        organization: req.organization,
        user: req.user,
        day: from,
        visits,
        prevDate: addDays(from, -1).toISOString().slice(0, 10),
        nextDate: addDays(from, 1).toISOString().slice(0, 10),
      });
    } catch (error) {
      next(error);
    }
  },
);
