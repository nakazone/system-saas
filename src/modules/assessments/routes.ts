import { Router } from "express";
import { param } from "../../lib/http/params.js";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireAuth, requirePermission, type AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { prisma } from "../../lib/prisma.js";
import { storage } from "../../lib/storage/index.js";
import { recordActivity } from "../../lib/activity/record.js";
import {
  ensureAssessmentResponse,
  extractMeasurementRooms,
  isAssessmentOverdue,
  seedDefaultChecklistTemplates,
} from "../../lib/checklists/engine.js";
import type { ChecklistField } from "../../lib/checklists/defaults.js";
import {
  defaultClientViewJson,
  defaultValidUntil,
  rebuildEstimateLines,
  persistQuoteTotals,
  recomputeTotalsFromQuote,
} from "../quotes/service.js";
import { toDecimal } from "../../lib/quotes/calculate.js";
import { moveLeadToSystemStage } from "../../lib/pipeline/move.js";
import { overdueAssessmentWhere } from "../../lib/home/actions.js";

export const assessmentsRouter = Router();

assessmentsRouter.use(requireAuth);

const assessmentInclude = {
  lead: true,
  customer: true,
  property: true,
  assignedUser: true,
  checklistResponse: true,
} as const;

assessmentsRouter.get(
  "/",
  requirePermission("assessments.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : "";
      const filter = typeof req.query.filter === "string" ? req.query.filter : "";
      const now = new Date();
      const rows = await withTenantTransaction(req.organizationId!, async (tx) => {
        await seedDefaultChecklistTemplates(tx, req.organizationId!);
        const where: Record<string, unknown> = {};
        if (status) where.status = status;
        if (filter === "overdue") Object.assign(where, overdueAssessmentWhere(now));
        return tx.siteAssessment.findMany({
          where,
          include: assessmentInclude,
          orderBy: [{ scheduledStart: "asc" }, { createdAt: "desc" }],
        });
      });
      const now = new Date();
      const assessments = rows.map((a) => ({
        ...a,
        overdue: isAssessmentOverdue(a, now),
      }));
      res.render("assessments/index", {
        title: "Site assessments",
        organization: req.organization,
        user: req.user,
        assessments,
        filters: { status },
      });
    } catch (error) {
      next(error);
    }
  },
);

assessmentsRouter.get(
  "/new",
  requirePermission("assessments.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const [leads, customers, users] = await Promise.all([
          tx.lead.findMany({ orderBy: { updatedAt: "desc" }, take: 200 }),
          tx.customer.findMany({
            include: { properties: true },
            orderBy: { name: "asc" },
          }),
          tx.user.findMany({ where: { status: "active" }, orderBy: { name: "asc" } }),
        ]);
        return { leads, customers, users };
      });
      res.render("assessments/form", {
        title: "Schedule measurement",
        organization: req.organization,
        user: req.user,
        assessment: null,
        leads: data.leads,
        customers: data.customers,
        users: data.users,
        preselectedLeadId: req.query.leadId ?? null,
        preselectedCustomerId: req.query.customerId ?? null,
        error: null,
      });
    } catch (error) {
      next(error);
    }
  },
);

assessmentsRouter.post(
  "/",
  requirePermission("assessments.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const schema = z.object({
        leadId: z.string().uuid().optional().or(z.literal("")),
        customerId: z.string().uuid().optional().or(z.literal("")),
        propertyId: z.string().uuid().optional().or(z.literal("")),
        assignedUserId: z.string().uuid().optional().or(z.literal("")),
        scheduledStart: z.string().optional().or(z.literal("")),
        scheduledEnd: z.string().optional().or(z.literal("")),
        instructions: z.string().max(5000).optional().or(z.literal("")),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect("/assessments/new");
        return;
      }
      if (!parsed.data.leadId && !parsed.data.customerId) {
        res.redirect("/assessments/new?error=party");
        return;
      }

      const start = parsed.data.scheduledStart
        ? new Date(parsed.data.scheduledStart)
        : null;
      const end = parsed.data.scheduledEnd ? new Date(parsed.data.scheduledEnd) : null;
      const status = start ? "scheduled" : "unscheduled";

      const created = await withTenantTransaction(req.organizationId!, async (tx) => {
        await seedDefaultChecklistTemplates(tx, req.organizationId!);
        const row = await tx.siteAssessment.create({
          data: {
            organizationId: req.organizationId!,
            leadId: parsed.data.leadId || null,
            customerId: parsed.data.customerId || null,
            propertyId: parsed.data.propertyId || null,
            assignedUserId: parsed.data.assignedUserId || req.user!.id,
            scheduledStart: start,
            scheduledEnd: end,
            instructions: parsed.data.instructions || null,
            status,
          },
        });
        await ensureAssessmentResponse(tx, {
          organizationId: req.organizationId!,
          assessmentId: row.id,
          userId: req.user!.id,
        });
        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "lead",
          entityId: parsed.data.leadId || parsed.data.customerId!,
          actorType: "user",
          actorId: req.user!.id,
          action: "updated",
          changes: { siteAssessment: { from: null, to: row.id } },
        });
        if (status === "scheduled") {
          let leadId = parsed.data.leadId || null;
          if (!leadId && parsed.data.customerId) {
            const cust = await tx.customer.findFirst({
              where: { id: parsed.data.customerId },
            });
            leadId = cust?.leadId ?? null;
          }
          if (leadId) {
            await moveLeadToSystemStage(tx, {
              organizationId: req.organizationId!,
              leadId,
              slug: "assessment_scheduled",
              actorType: "user",
              actorId: req.user!.id,
            });
          }
        }
        return row;
      });
      res.redirect(`/assessments/${created.id}`);
    } catch (error) {
      next(error);
    }
  },
);

assessmentsRouter.get(
  "/:id",
  requirePermission("assessments.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        await seedDefaultChecklistTemplates(tx, req.organizationId!);
        let assessment = await tx.siteAssessment.findFirst({
          where: { id: param(req, "id") },
          include: assessmentInclude,
        });
        if (!assessment) return null;
        if (!assessment.checklistResponseId) {
          await ensureAssessmentResponse(tx, {
            organizationId: req.organizationId!,
            assessmentId: assessment.id,
            userId: req.user!.id,
          });
          assessment = await tx.siteAssessment.findFirst({
            where: { id: assessment.id },
            include: assessmentInclude,
          });
        }
        return assessment;
      });
      if (!result) {
        res.status(404).render("errors/not-found", {
          title: "Not found",
          message: "Assessment not found.",
          organization: req.organization,
          user: req.user,
        });
        return;
      }
      const snapshot = result.checklistResponse?.templateSnapshot as
        | { fields?: ChecklistField[]; name?: string }
        | null;
      res.render("assessments/show", {
        title: "Site assessment",
        organization: req.organization,
        user: req.user,
        assessment: result,
        overdue: isAssessmentOverdue(result),
        fields: snapshot?.fields ?? [],
        templateName: snapshot?.name ?? "Checklist",
        answers: (result.checklistResponse?.answers as Record<string, unknown>) ?? {},
        error: typeof req.query.error === "string" ? req.query.error : null,
        success: typeof req.query.success === "string" ? req.query.success : null,
      });
    } catch (error) {
      next(error);
    }
  },
);

assessmentsRouter.get(
  "/:id/fill",
  requirePermission("assessments.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        await ensureAssessmentResponse(tx, {
          organizationId: req.organizationId!,
          assessmentId: param(req, "id"),
          userId: req.user!.id,
        });
        return tx.siteAssessment.findFirst({
          where: { id: param(req, "id") },
          include: assessmentInclude,
        });
      });
      if (!result?.checklistResponse) {
        res.status(404).send("Not found");
        return;
      }
      const snapshot = result.checklistResponse.templateSnapshot as {
        fields?: ChecklistField[];
        name?: string;
      };
      res.render("assessments/fill", {
        title: "Fill measurement",
        organization: req.organization,
        user: req.user,
        assessment: result,
        fields: snapshot.fields ?? [],
        templateName: snapshot.name ?? "Checklist",
        answers: (result.checklistResponse.answers as Record<string, unknown>) ?? {},
        error: null,
        success: null,
      });
    } catch (error) {
      next(error);
    }
  },
);

assessmentsRouter.post(
  "/:id/save",
  requirePermission("assessments.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const complete = req.body.complete === "1";
      await withTenantTransaction(req.organizationId!, async (tx) => {
        const assessment = await tx.siteAssessment.findFirst({
          where: { id: param(req, "id") },
          include: { checklistResponse: true },
        });
        if (!assessment?.checklistResponse) throw new Error("Assessment not found");

        const snapshot = assessment.checklistResponse.templateSnapshot as {
          fields?: ChecklistField[];
        };
        const fields = snapshot.fields ?? [];
        const prev = (assessment.checklistResponse.answers as Record<string, unknown>) ?? {};
        const answers: Record<string, unknown> = { ...prev };

        for (const field of fields) {
          if (field.type === "measurement_rooms") {
            const raw = String(req.body[`field_${field.id}`] || "[]");
            try {
              answers[field.id] = JSON.parse(raw);
            } catch {
              answers[field.id] = [];
            }
            continue;
          }
          if (field.type === "checkbox") {
            answers[field.id] = req.body[`field_${field.id}`] === "on";
            continue;
          }
          if (field.type === "photo" || field.type === "signature") {
            const dataUrl = String(req.body[`field_${field.id}`] || "");
            if (dataUrl.startsWith("data:")) {
              const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
              if (match) {
                const contentType = match[1]!;
                const body = Buffer.from(match[2]!, "base64");
                const key = `orgs/${req.organizationId}/assessments/${assessment.id}/${field.id}-${Date.now()}`;
                const stored = await storage.upload({ key, body, contentType });
                const existing = Array.isArray(answers[field.id])
                  ? (answers[field.id] as string[])
                  : answers[field.id]
                    ? [String(answers[field.id])]
                    : [];
                if (field.type === "photo") {
                  answers[field.id] = [...existing, stored.url];
                } else {
                  answers[field.id] = stored.url;
                }
              }
            }
            continue;
          }
          if (req.body[`field_${field.id}`] !== undefined) {
            const val = req.body[`field_${field.id}`];
            answers[field.id] =
              field.type === "number" ? (val === "" ? null : Number(val)) : String(val);
          }
        }

        await tx.checklistResponse.update({
          where: { id: assessment.checklistResponse.id },
          data: {
            answers: answers as Prisma.InputJsonValue,
            ...(complete
              ? { completedAt: new Date(), completedById: req.user!.id }
              : {}),
          },
        });

        if (complete) {
          await tx.siteAssessment.update({
            where: { id: assessment.id },
            data: { status: "completed" },
          });
          await recordActivity(tx, {
            organizationId: req.organizationId!,
            entityType: "site_assessment",
            entityId: assessment.id,
            actorType: "user",
            actorId: req.user!.id,
            action: "status_changed",
            changes: { status: { from: assessment.status, to: "completed" } },
          });
        }
      });

      const dest = complete
        ? `/assessments/${param(req, "id")}?success=completed`
        : `/assessments/${param(req, "id")}/fill?success=saved`;
      res.redirect(dest);
    } catch (error) {
      next(error);
    }
  },
);

assessmentsRouter.post(
  "/:id/convert-quote",
  requirePermission("quotes.create"),
  async (req: AuthedRequest, res, _next) => {
    try {
      const quoteId = await withTenantTransaction(req.organizationId!, async (tx) => {
        const assessment = await tx.siteAssessment.findFirst({
          where: { id: param(req, "id") },
          include: { checklistResponse: true, lead: true, customer: true, property: true },
        });
        if (!assessment) throw new Error("Assessment not found");
        if (!assessment.checklistResponse) throw new Error("Complete the checklist first");

        const rooms = extractMeasurementRooms(assessment.checklistResponse.answers);
        if (!rooms.length) {
          throw new Error("Add at least one room with area in the measurement checklist");
        }

        let customerId = assessment.customerId;
        if (!customerId && assessment.lead) {
          const createdCustomer = await tx.customer.create({
            data: {
              organizationId: req.organizationId!,
              leadId: assessment.lead.id,
              name: assessment.lead.name,
              email: assessment.lead.email,
              phone: assessment.lead.phone,
            },
          });
          customerId = createdCustomer.id;
          await tx.lead.update({
            where: { id: assessment.lead.id },
            data: { status: "converted" },
          });
          await tx.siteAssessment.update({
            where: { id: assessment.id },
            data: { customerId },
          });
        }

        const org = await prisma.organization.findUniqueOrThrow({
          where: { id: req.organizationId! },
        });
        const flooringType = "hardwood";
        const rule = await tx.estimateRule.findFirst({ where: { flooringType } });
        if (!rule) throw new Error("Estimate rule missing");

        const totalArea = rooms.reduce((s, r) => s + r.areaSqft, 0);
        const maxNumber = await tx.quote.aggregate({ _max: { number: true } });
        const titleParty =
          assessment.customer?.name || assessment.lead?.name || "Measurement";

        const quote = await tx.quote.create({
          data: {
            organizationId: req.organizationId!,
            number: (maxNumber._max.number ?? 0) + 1,
            title: `Quote from measurement — ${titleParty}`,
            customerId,
            propertyId: assessment.propertyId,
            salespersonId: req.user!.id,
            leadId: assessment.leadId,
            flooringType,
            areaSqft: toDecimal(totalArea),
            wastePercent: rule.wastePercent,
            materialMarkup: rule.materialMarkup,
            laborMarkup: rule.laborMarkup,
            taxRate: org.quoteTaxRate,
            terms: org.defaultQuoteTerms,
            clientView: defaultClientViewJson(),
            validUntil: defaultValidUntil(org.quoteValidityDays),
            status: "draft",
            notes: `Converted from site assessment ${assessment.id}`,
          },
        });

        const createdRooms = [];
        for (let i = 0; i < rooms.length; i++) {
          const r = rooms[i]!;
          createdRooms.push(
            await tx.quoteRoom.create({
              data: {
                organizationId: req.organizationId!,
                quoteId: quote.id,
                name: r.name,
                areaSqft: toDecimal(r.areaSqft),
                sortOrder: i + 1,
              },
            }),
          );
        }

        const group = await tx.quoteOptionGroup.create({
          data: {
            organizationId: req.organizationId!,
            quoteId: quote.id,
            name: `Option A: ${flooringType}`,
            flooringType,
            sortOrder: 1,
          },
        });

        const rules = await tx.estimateRule.findMany();
        const rulesByType = new Map(
          rules.map((r) => [
            r.flooringType,
            {
              wastePercent: Number(r.wastePercent),
              materialMarkup: Number(r.materialMarkup),
              laborMarkup: Number(r.laborMarkup),
              defaultPricePerSqft: Number(r.defaultPricePerSqft ?? 0),
              defaultLaborPerSqft: Number(r.defaultLaborPerSqft ?? 0),
            },
          ]),
        );

        await rebuildEstimateLines(tx, {
          organizationId: req.organizationId!,
          quoteId: quote.id,
          rooms: createdRooms.map((r) => ({
            id: r.id,
            name: r.name,
            areaSqft: Number(r.areaSqft),
          })),
          optionGroups: [{ id: group.id, flooringType: group.flooringType }],
          rulesByType,
          fallbackFlooringType: flooringType,
        });

        await tx.quote.update({
          where: { id: quote.id },
          data: { selectedOptionGroupId: group.id },
        });

        const full = await tx.quote.findFirst({
          where: { id: quote.id },
          include: { lineItems: true },
        });
        if (full) {
          await persistQuoteTotals(tx, quote.id, recomputeTotalsFromQuote(full));
        }

        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "quote",
          entityId: quote.id,
          actorType: "user",
          actorId: req.user!.id,
          action: "created",
          changes: { fromAssessment: { from: null, to: assessment.id } },
        });

        return quote.id;
      });

      res.redirect(`/quotes/${quoteId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Convert failed";
      res.redirect(`/assessments/${param(req, "id")}?error=${encodeURIComponent(message)}`);
    }
  },
);

assessmentsRouter.post(
  "/:id/cancel",
  requirePermission("assessments.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      await withTenantTransaction(req.organizationId!, async (tx) => {
        await tx.siteAssessment.update({
          where: { id: param(req, "id") },
          data: { status: "canceled" },
        });
      });
      res.redirect(`/assessments/${param(req, "id")}`);
    } catch (error) {
      next(error);
    }
  },
);
