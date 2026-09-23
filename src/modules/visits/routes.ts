import { Router } from "express";
import { param } from "../../lib/http/params.js";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireAuth, requirePermission, type AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { findScheduleConflicts } from "../../lib/schedule/conflicts.js";
import { refreshProjectStatus } from "../../lib/projects/convert.js";
import { ensureVisitChecklistResponse } from "../../lib/projects/visit-checklist.js";
import { runScheduleTriggers } from "../../lib/payments/engine.js";
import { email } from "../../lib/email/index.js";
import {
  cancelPendingMessages,
  scheduleVisitReminder,
} from "../../lib/automations/schedule.js";
import { prisma } from "../../lib/prisma.js";
import { seedDefaultChecklistTemplates } from "../../lib/checklists/engine.js";
import type { ChecklistField } from "../../lib/checklists/defaults.js";

export const visitsRouter = Router();
visitsRouter.use(requireAuth);

function isInstallerOnly(user: AuthedRequest["user"]): boolean {
  return user?.roleKey === "installer" && !user.permissions.includes("visits.manage");
}

async function crewIdsForUser(tx: Parameters<Parameters<typeof withTenantTransaction>[1]>[0], userId: string) {
  const rows = await tx.crewMember.findMany({ where: { userId }, select: { crewId: true } });
  return rows.map((r) => r.crewId);
}

visitsRouter.get(
  "/",
  requirePermission("visits.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const visits = await withTenantTransaction(req.organizationId!, async (tx) => {
        const where: Prisma.VisitWhereInput = { status: { not: "canceled" } };
        if (isInstallerOnly(req.user)) {
          const crewIds = await crewIdsForUser(tx, req.user!.id);
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
          take: 200,
        });
      });
      res.render("visits/index", {
        title: "Visits",
        organization: req.organization,
        user: req.user,
        visits,
        canManage: req.user?.permissions.includes("visits.manage"),
      });
    } catch (error) {
      next(error);
    }
  },
);

visitsRouter.get(
  "/:id",
  requirePermission("visits.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const visit = await withTenantTransaction(req.organizationId!, async (tx) => {
        await seedDefaultChecklistTemplates(tx, req.organizationId!);
        const row = await tx.visit.findFirst({
          where: { id: param(req, "id") },
          include: {
            project: { include: { customer: true, property: true } },
            crew: true,
            assignedUser: true,
            checklistResponse: true,
          },
        });
        if (!row) return null;
        if (isInstallerOnly(req.user)) {
          const crewIds = await crewIdsForUser(tx, req.user!.id);
          const allowed =
            row.assignedUserId === req.user!.id ||
            (row.crewId != null && crewIds.includes(row.crewId));
          if (!allowed) return null;
        }
        return row;
      });
      if (!visit) {
        res.status(404).send("Not found");
        return;
      }
      res.render("visits/show", {
        title: visit.title || "Visit",
        organization: req.organization,
        user: req.user,
        visit,
        canManage: req.user?.permissions.includes("visits.manage"),
        error: typeof req.query.error === "string" ? req.query.error : null,
        success: typeof req.query.success === "string" ? req.query.success : null,
      });
    } catch (error) {
      next(error);
    }
  },
);

visitsRouter.post(
  "/",
  requirePermission("visits.manage"),
  async (req: AuthedRequest, res, _next) => {
    try {
      const schema = z.object({
        projectId: z.string().uuid(),
        title: z.string().max(200).optional().or(z.literal("")),
        phase: z.string().min(1).max(40),
        scheduledStart: z.string().min(1),
        scheduledEnd: z.string().min(1),
        crewId: z.string().uuid().optional().or(z.literal("")),
        assignedUserId: z.string().uuid().optional().or(z.literal("")),
        instructions: z.string().max(5000).optional().or(z.literal("")),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect(`/projects/${req.body.projectId}?error=invalid`);
        return;
      }
      const start = new Date(parsed.data.scheduledStart);
      const end = new Date(parsed.data.scheduledEnd);
      if (!(end > start)) {
        res.redirect(`/projects/${parsed.data.projectId}?error=${encodeURIComponent("End must be after start")}`);
        return;
      }

      const visitId = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.visit.findMany({
          where: {
            status: { not: "canceled" },
            scheduledEnd: { gt: start },
            scheduledStart: { lt: end },
          },
        });
        const conflicts = findScheduleConflicts(
          {
            start,
            end,
            crewId: parsed.data.crewId || null,
            assignedUserId: parsed.data.assignedUserId || null,
          },
          existing.map((v) => ({
            id: v.id,
            start: v.scheduledStart,
            end: v.scheduledEnd,
            crewId: v.crewId,
            assignedUserId: v.assignedUserId,
            status: v.status,
          })),
        );
        if (conflicts.length) {
          throw new Error(`Schedule conflict (${conflicts[0]!.reason})`);
        }

        const visit = await tx.visit.create({
          data: {
            organizationId: req.organizationId!,
            projectId: parsed.data.projectId,
            title: parsed.data.title || null,
            phase: parsed.data.phase,
            scheduledStart: start,
            scheduledEnd: end,
            crewId: parsed.data.crewId || null,
            assignedUserId: parsed.data.assignedUserId || null,
            instructions: parsed.data.instructions || null,
            status: "scheduled",
          },
        });
        await ensureVisitChecklistResponse(tx, {
          organizationId: req.organizationId!,
          visitId: visit.id,
          phase: visit.phase,
        });
        await tx.projectEvent.create({
          data: {
            organizationId: req.organizationId!,
            projectId: visit.projectId,
            visitId: visit.id,
            type: "visit_created",
            actorId: req.user!.id,
            payload: { phase: visit.phase },
          },
        });
        await refreshProjectStatus(tx, visit.projectId);

        const project = await tx.project.findFirst({
          where: { id: visit.projectId },
          include: { customer: true },
        });
        if (project?.customer?.email) {
          await email.send({
            to: project.customer.email,
            subject: `Visit scheduled — ${project.name}`,
            text: `A visit (${visit.phase}) is scheduled for ${start.toLocaleString()} – ${end.toLocaleString()}.`,
          });
        }
        const org = await prisma.organization.findUniqueOrThrow({
          where: { id: req.organizationId! },
        });
        await scheduleVisitReminder(tx, {
          organizationId: req.organizationId!,
          visitId: visit.id,
          projectId: visit.projectId,
          projectName: project?.name || "your project",
          phase: visit.phase,
          scheduledStart: start,
          customerId: project?.customerId ?? null,
          customerEmail: project?.customer?.email ?? null,
          customerName: project?.customer?.name ?? null,
          orgName: org.name,
          timezone: org.timezone,
          automationSettings: org.automationSettings,
        });
        return visit.id;
      });

      res.redirect(`/visits/${visitId}?success=created`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed";
      res.redirect(`/projects/${req.body.projectId}?error=${encodeURIComponent(message)}`);
    }
  },
);

visitsRouter.post(
  "/:id/status",
  requirePermission("visits.manage"),
  async (req: AuthedRequest, res, _next) => {
    try {
      const status = String(req.body.status || "");
      if (!["scheduled", "in_progress", "completed", "canceled"].includes(status)) {
        res.redirect(`/visits/${param(req, "id")}?error=invalid`);
        return;
      }
      await withTenantTransaction(req.organizationId!, async (tx) => {
        const visit = await tx.visit.findFirst({ where: { id: param(req, "id") } });
        if (!visit) throw new Error("Not found");
        const prev = visit.status;
        await tx.visit.update({ where: { id: visit.id }, data: { status } });

        let eventType = "visit_updated";
        if (status === "canceled") eventType = "visit_canceled";
        if (status === "in_progress" && prev !== "in_progress") eventType = "phase_started";
        if (status === "completed" && prev !== "completed") eventType = "phase_completed";

        if (status === "canceled") {
          await cancelPendingMessages(tx, {
            entityType: "visit",
            entityId: visit.id,
            triggerKey: "visit_reminder",
          });
        }

        await tx.projectEvent.create({
          data: {
            organizationId: req.organizationId!,
            projectId: visit.projectId,
            visitId: visit.id,
            type: eventType,
            actorId: req.user!.id,
            payload: { from: prev, to: status, phase: visit.phase },
          },
        });

        if (eventType === "phase_started") {
          await runScheduleTriggers(tx, {
            organizationId: req.organizationId!,
            projectId: visit.projectId,
            trigger: "on_phase_start",
            phaseKey: visit.phase,
            actorId: req.user!.id,
          });
        }
        if (eventType === "phase_completed") {
          await runScheduleTriggers(tx, {
            organizationId: req.organizationId!,
            projectId: visit.projectId,
            trigger: "on_phase_complete",
            phaseKey: visit.phase,
            actorId: req.user!.id,
          });
        }

        await refreshProjectStatus(tx, visit.projectId);

        if (status === "canceled" || (prev !== status && (status === "scheduled" || status === "in_progress"))) {
          const project = await tx.project.findFirst({
            where: { id: visit.projectId },
            include: { customer: true },
          });
          if (project?.customer?.email) {
            await email.send({
              to: project.customer.email,
              subject: `Visit ${status} — ${project.name}`,
              text: `Your visit (${visit.phase}) is now ${status}. Window: ${visit.scheduledStart.toLocaleString()} – ${visit.scheduledEnd.toLocaleString()}.`,
            });
          }
        }
      });
      res.redirect(`/visits/${param(req, "id")}?success=updated`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed";
      res.redirect(`/visits/${param(req, "id")}?error=${encodeURIComponent(message)}`);
    }
  },
);

visitsRouter.get(
  "/:id/fill",
  requirePermission("visits.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        await seedDefaultChecklistTemplates(tx, req.organizationId!);
        let visit = await tx.visit.findFirst({
          where: { id: param(req, "id") },
          include: { project: true, checklistResponse: true },
        });
        if (!visit) return null;
        if (!visit.checklistResponse) {
          await ensureVisitChecklistResponse(tx, {
            organizationId: req.organizationId!,
            visitId: visit.id,
            phase: visit.phase,
          });
          visit = await tx.visit.findFirst({
            where: { id: visit.id },
            include: { project: true, checklistResponse: true },
          });
        }
        return visit;
      });
      if (!result?.checklistResponse) {
        res.status(404).send("Checklist not available for this visit phase");
        return;
      }
      const snapshot = result.checklistResponse.templateSnapshot as {
        fields?: ChecklistField[];
        name?: string;
      };
      res.render("assessments/fill", {
        title: "Visit checklist",
        organization: req.organization,
        user: req.user,
        assessment: {
          id: result.id,
          lead: null,
          customer: result.project ? { name: result.project.name } : null,
        },
        fields: snapshot.fields ?? [],
        templateName: snapshot.name ?? "Visit checklist",
        answers: (result.checklistResponse.answers as Record<string, unknown>) ?? {},
        error: null,
        success: typeof req.query.success === "string" ? req.query.success : null,
        fillAction: `/visits/${result.id}/save`,
        backHref: `/visits/${result.id}`,
      });
    } catch (error) {
      next(error);
    }
  },
);

visitsRouter.post(
  "/:id/save",
  requirePermission("visits.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const complete = req.body.complete === "1";
      await withTenantTransaction(req.organizationId!, async (tx) => {
        const visit = await tx.visit.findFirst({
          where: { id: param(req, "id") },
          include: { checklistResponse: true },
        });
        if (!visit?.checklistResponse) throw new Error("Not found");
        const snapshot = visit.checklistResponse.templateSnapshot as {
          fields?: ChecklistField[];
        };
        const fields = snapshot.fields ?? [];
        const prev = (visit.checklistResponse.answers as Record<string, unknown>) ?? {};
        const answers: Record<string, unknown> = { ...prev };
        for (const field of fields) {
          if (field.type === "checkbox") {
            answers[field.id] = req.body[`field_${field.id}`] === "on";
          } else if (field.type === "measurement_rooms") {
            try {
              answers[field.id] = JSON.parse(String(req.body[`field_${field.id}`] || "[]"));
            } catch {
              answers[field.id] = [];
            }
          } else if (req.body[`field_${field.id}`] !== undefined) {
            const val = req.body[`field_${field.id}`];
            answers[field.id] =
              field.type === "number" ? (val === "" ? null : Number(val)) : String(val);
          }
        }
        await tx.checklistResponse.update({
          where: { id: visit.checklistResponse.id },
          data: {
            answers: answers as Prisma.InputJsonValue,
            ...(complete
              ? { completedAt: new Date(), completedById: req.user!.id }
              : {}),
          },
        });
        if (complete && visit.status !== "completed") {
          await tx.visit.update({
            where: { id: visit.id },
            data: { status: "completed" },
          });
          await runScheduleTriggers(tx, {
            organizationId: req.organizationId!,
            projectId: visit.projectId,
            trigger: "on_phase_complete",
            phaseKey: visit.phase,
            actorId: req.user!.id,
          });
          await refreshProjectStatus(tx, visit.projectId);
        }
      });
      res.redirect(
        complete
          ? `/visits/${param(req, "id")}?success=completed`
          : `/visits/${param(req, "id")}/fill?success=saved`,
      );
    } catch (error) {
      next(error);
    }
  },
);
