import { Router } from "express";
import { param } from "../../lib/http/params.js";
import { z } from "zod";
import { requireAuth, requirePermission, type AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { calculateQuote, toDecimal } from "../../lib/quotes/calculate.js";
import { prisma } from "../../lib/prisma.js";
import { canViewPricing } from "../../lib/pricing/visibility.js";
import { email } from "../../lib/email/index.js";
import { recordActivity } from "../../lib/activity/record.js";
import { issuePublicAccessToken } from "../../lib/quotes/public-token.js";
import { buildQuotePdf } from "../../lib/quotes/pdf.js";
import { normalizeQuoteStatus } from "../../lib/quotes/transitions.js";
import { runScheduleTriggers, seedDefaultPaymentTemplates } from "../../lib/payments/engine.js";
import {
  cancelPendingMessages,
  scheduleQuoteFollowUp,
} from "../../lib/automations/schedule.js";
import {
  applyQuoteTransition,
  defaultClientViewJson,
  defaultValidUntil,
  persistQuoteTotals,
  quoteDetailInclude,
  rebuildEstimateLines,
  recomputeTotalsFromQuote,
} from "./service.js";
import { publicQuotesRouter } from "./public-routes.js";

export { publicQuotesRouter };

export const quotesRouter = Router();

quotesRouter.use(requireAuth);

function periodBounds(period?: string) {
  const now = new Date();
  const end = now;
  const start = new Date(now);
  if (period === "90d") start.setUTCDate(start.getUTCDate() - 90);
  else if (period === "365d") start.setUTCDate(start.getUTCDate() - 365);
  else start.setUTCDate(start.getUTCDate() - 30);
  const prevEnd = new Date(start);
  const prevStart = new Date(start);
  prevStart.setUTCDate(prevStart.getUTCDate() - (end.getTime() - start.getTime()) / 86400000);
  return { start, end, prevStart, prevEnd };
}

quotesRouter.get(
  "/",
  requirePermission("quotes.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : "";
      const salespersonId =
        typeof req.query.salespersonId === "string" ? req.query.salespersonId : "";
      const period = typeof req.query.period === "string" ? req.query.period : "30d";
      const { start, end, prevStart, prevEnd } = periodBounds(period);
      const showPricing = canViewPricing(req.user);

      const { quotes, metrics, salespeople } = await withTenantTransaction(
        req.organizationId!,
        async (tx) => {
          const where: {
            status?: string;
            salespersonId?: string;
          } = {};
          if (status) where.status = status;
          if (salespersonId) where.salespersonId = salespersonId;

          const quotesList = await tx.quote.findMany({
            where,
            include: { customer: true, salesperson: true },
            orderBy: { createdAt: "desc" },
          });

          const inPeriod = (from: Date, to: Date) =>
            tx.quote.findMany({
              where: { createdAt: { gte: from, lte: to } },
            });

          const [curr, prev] = await Promise.all([
            inPeriod(start, end),
            inPeriod(prevStart, prevEnd),
          ]);

          const sentCurr = curr.filter((q) =>
            ["sent", "changes_requested", "approved", "converted", "archived"].includes(
              normalizeQuoteStatus(q.status),
            ),
          );
          const approvedCurr = curr.filter((q) =>
            ["approved", "converted"].includes(normalizeQuoteStatus(q.status)),
          );
          const sentPrev = prev.filter((q) =>
            ["sent", "changes_requested", "approved", "converted", "archived"].includes(
              normalizeQuoteStatus(q.status),
            ),
          );
          const approvedPrev = prev.filter((q) =>
            ["approved", "converted"].includes(normalizeQuoteStatus(q.status)),
          );

          const sum = (rows: typeof curr) =>
            rows.reduce((s, q) => s + Number(q.total), 0);

          const conversion =
            sentCurr.length > 0 ? approvedCurr.length / sentCurr.length : 0;
          const conversionPrev =
            sentPrev.length > 0 ? approvedPrev.length / sentPrev.length : 0;

          const users = await tx.user.findMany({
            where: { status: "active" },
            orderBy: { name: "asc" },
          });

          return {
            quotes: quotesList,
            metrics: {
              sentCount: sentCurr.length,
              sentValue: sum(sentCurr),
              approvedCount: approvedCurr.length,
              approvedValue: sum(approvedCurr),
              conversionRate: conversion,
              conversionTrend: conversion - conversionPrev,
            },
            salespeople: users,
          };
        },
      );

      res.render("quotes/index", {
        title: "Quotes",
        organization: req.organization,
        user: req.user,
        quotes,
        metrics,
        salespeople,
        filters: { status, salespersonId, period },
        canViewPricing: showPricing,
      });
    } catch (error) {
      next(error);
    }
  },
);

quotesRouter.get(
  "/new",
  requirePermission("quotes.create"),
  async (req: AuthedRequest, res, next) => {
    try {
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const [customers, rules, users, org] = await Promise.all([
          tx.customer.findMany({
            include: { properties: true },
            orderBy: { name: "asc" },
          }),
          tx.estimateRule.findMany({ orderBy: { flooringType: "asc" } }),
          tx.user.findMany({ where: { status: "active" }, orderBy: { name: "asc" } }),
          prisma.organization.findUniqueOrThrow({ where: { id: req.organizationId! } }),
        ]);
        return { customers, rules, users, org };
      });
      res.render("quotes/form", {
        title: "New quote",
        organization: req.organization,
        user: req.user,
        quote: null,
        customers: data.customers,
        rules: data.rules,
        salespeople: data.users,
        orgSettings: data.org,
        preselectedCustomerId: req.query.customerId ?? null,
        canViewPricing: canViewPricing(req.user),
        error: null,
      });
    } catch (error) {
      next(error);
    }
  },
);

quotesRouter.post(
  "/",
  requirePermission("quotes.create"),
  async (req: AuthedRequest, res, next) => {
    try {
      const schema = z.object({
        title: z.string().min(1).max(200),
        customerId: z.string().uuid().optional().or(z.literal("")),
        propertyId: z.string().uuid().optional().or(z.literal("")),
        salespersonId: z.string().uuid().optional().or(z.literal("")),
        flooringType: z.enum(["hardwood", "lvp", "laminate", "tile", "carpet"]),
        areaSqft: z.coerce.number().positive(),
        pricePerSqft: z.coerce.number().min(0).optional(),
        laborPerSqft: z.coerce.number().min(0).optional(),
        notes: z.string().max(5000).optional().or(z.literal("")),
        clientMessage: z.string().max(5000).optional().or(z.literal("")),
        terms: z.string().max(20000).optional().or(z.literal("")),
        roomsJson: z.string().optional().or(z.literal("")),
        optionGroupsJson: z.string().optional().or(z.literal("")),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect("/quotes/new");
        return;
      }

      const quote = await withTenantTransaction(req.organizationId!, async (tx) => {
        const org = await prisma.organization.findUniqueOrThrow({
          where: { id: req.organizationId! },
        });
        const rule = await tx.estimateRule.findFirst({
          where: { flooringType: parsed.data.flooringType },
        });
        if (!rule) throw new Error("Estimate rule not found for flooring type");

        const pricePerSqft =
          parsed.data.pricePerSqft ?? Number(rule.defaultPricePerSqft ?? 0);
        const laborPerSqft =
          parsed.data.laborPerSqft ?? Number(rule.defaultLaborPerSqft ?? 0);
        const wastePercent = Number(rule.wastePercent);
        const materialMarkup = Number(rule.materialMarkup);
        const laborMarkup = Number(rule.laborMarkup);

        const calc = calculateQuote({
          areaSqft: parsed.data.areaSqft,
          wastePercent,
          pricePerSqft,
          laborPerSqft,
          materialMarkup,
          laborMarkup,
        });

        const maxNumber = await tx.quote.aggregate({ _max: { number: true } });
        const number = (maxNumber._max.number ?? 0) + 1;

        let rooms: { name: string; areaSqft: number; notes?: string }[] = [];
        try {
          rooms = parsed.data.roomsJson ? JSON.parse(parsed.data.roomsJson) : [];
        } catch {
          rooms = [];
        }
        if (!rooms.length) {
          rooms = [{ name: "Total area", areaSqft: parsed.data.areaSqft }];
        }

        let optionGroups: { name: string; flooringType?: string }[] = [];
        try {
          optionGroups = parsed.data.optionGroupsJson
            ? JSON.parse(parsed.data.optionGroupsJson)
            : [];
        } catch {
          optionGroups = [];
        }

        const created = await tx.quote.create({
          data: {
            organizationId: req.organizationId!,
            number,
            title: parsed.data.title,
            customerId: parsed.data.customerId || null,
            propertyId: parsed.data.propertyId || null,
            salespersonId: parsed.data.salespersonId || req.user!.id,
            flooringType: parsed.data.flooringType,
            areaSqft: toDecimal(parsed.data.areaSqft),
            wastePercent: toDecimal(wastePercent),
            materialCost: toDecimal(calc.materialCost),
            laborCost: toDecimal(calc.laborCost),
            materialMarkup: toDecimal(materialMarkup),
            laborMarkup: toDecimal(laborMarkup),
            taxRate: org.quoteTaxRate,
            subtotal: toDecimal(calc.subtotal),
            total: toDecimal(calc.total),
            notes: parsed.data.notes || null,
            clientMessage: parsed.data.clientMessage || null,
            terms: parsed.data.terms || org.defaultQuoteTerms || null,
            clientView: defaultClientViewJson(),
            validUntil: defaultValidUntil(org.quoteValidityDays),
            status: "draft",
          },
        });

        const createdRooms = [];
        for (let i = 0; i < rooms.length; i++) {
          const r = rooms[i]!;
          createdRooms.push(
            await tx.quoteRoom.create({
              data: {
                organizationId: req.organizationId!,
                quoteId: created.id,
                name: r.name || `Room ${i + 1}`,
                areaSqft: toDecimal(r.areaSqft),
                notes: r.notes || null,
                sortOrder: i + 1,
              },
            }),
          );
        }

        const createdGroups = [];
        if (optionGroups.length === 0) {
          createdGroups.push(
            await tx.quoteOptionGroup.create({
              data: {
                organizationId: req.organizationId!,
                quoteId: created.id,
                name: `Option A: ${parsed.data.flooringType}`,
                flooringType: parsed.data.flooringType,
                sortOrder: 1,
              },
            }),
          );
        } else {
          for (let i = 0; i < optionGroups.length; i++) {
            const g = optionGroups[i]!;
            createdGroups.push(
              await tx.quoteOptionGroup.create({
                data: {
                  organizationId: req.organizationId!,
                  quoteId: created.id,
                  name: g.name,
                  flooringType: g.flooringType || parsed.data.flooringType,
                  sortOrder: i + 1,
                },
              }),
            );
          }
        }

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
          quoteId: created.id,
          rooms: createdRooms.map((r) => ({
            id: r.id,
            name: r.name,
            areaSqft: Number(r.areaSqft),
          })),
          optionGroups: createdGroups.map((g) => ({
            id: g.id,
            flooringType: g.flooringType,
          })),
          rulesByType,
          fallbackFlooringType: parsed.data.flooringType,
        });

        await tx.quote.update({
          where: { id: created.id },
          data: { selectedOptionGroupId: createdGroups[0]?.id ?? null },
        });

        const full = await tx.quote.findFirst({
          where: { id: created.id },
          include: { lineItems: true },
        });
        if (full) {
          const totals = recomputeTotalsFromQuote(full);
          await persistQuoteTotals(tx, full.id, totals);
        }

        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "quote",
          entityId: created.id,
          actorType: "user",
          actorId: req.user!.id,
          action: "created",
        });

        return created;
      });

      res.redirect(`/quotes/${quote.id}`);
    } catch (error) {
      next(error);
    }
  },
);

quotesRouter.get(
  "/:id",
  requirePermission("quotes.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        const quote = await tx.quote.findFirst({
          where: { id: param(req, "id") },
          include: quoteDetailInclude,
        });
        if (!quote) return null;
        const activity = await tx.activityEvent.findMany({
          where: { entityType: "quote", entityId: quote.id },
          orderBy: { createdAt: "desc" },
          take: 50,
        });
        const addOns = await tx.quoteAddOn.findMany({
          where: { active: true },
          orderBy: { sortOrder: "asc" },
        });
        const paymentTemplates = await tx.orgPaymentTemplate.findMany({
          where: { active: true },
          orderBy: { sortOrder: "asc" },
        });
        await seedDefaultPaymentTemplates(tx, req.organizationId!);
        const paymentTemplatesFresh =
          paymentTemplates.length > 0
            ? paymentTemplates
            : await tx.orgPaymentTemplate.findMany({
                where: { active: true },
                orderBy: { sortOrder: "asc" },
              });
        return { quote, activity, addOns, paymentTemplates: paymentTemplatesFresh };
      });
      if (!result) {
        res.status(404).render("errors/not-found", {
          title: "Quote not found",
          message: "Quote not found.",
          organization: req.organization,
          user: req.user,
        });
        return;
      }
      res.render("quotes/show", {
        title: result.quote.title,
        organization: req.organization,
        user: req.user,
        quote: result.quote,
        activity: result.activity,
        addOns: result.addOns,
        paymentTemplates: result.paymentTemplates,
        canViewPricing: canViewPricing(req.user),
        canManageInvoices: req.user?.permissions.includes("invoices.manage"),
        error: typeof req.query.error === "string" ? req.query.error : null,
        success: typeof req.query.success === "string" ? req.query.success : null,
      });
    } catch (error) {
      next(error);
    }
  },
);

quotesRouter.post(
  "/:id/send",
  requirePermission("quotes.edit"),
  async (req: AuthedRequest, res, _next) => {
    try {
      const markOnly = req.body.markOnly === "1";
      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        const quote = await tx.quote.findFirst({
          where: { id: param(req, "id") },
          include: { customer: true, organization: true },
        });
        if (!quote) throw new Error("Quote not found");

        const event =
          normalizeQuoteStatus(quote.status) === "changes_requested" ? "resend" : "send";
        await applyQuoteTransition(tx, {
          organizationId: req.organizationId!,
          quoteId: quote.id,
          event,
          actorType: "user",
          actorId: req.user!.id,
        });

        await runScheduleTriggers(tx, {
          organizationId: req.organizationId!,
          quoteId: quote.id,
          trigger: "on_send",
          actorId: req.user!.id,
        });

        const issued = await issuePublicAccessToken(tx, {
          organizationId: req.organizationId!,
          entityType: "quote",
          entityId: quote.id,
        });

        // Clear legacy plaintext token once hashed token exists
        await tx.quote.update({
          where: { id: quote.id },
          data: { publicToken: null },
        });

        return { quote, issued, markOnly };
      });

      const link = `${req.protocol}://${req.get("host")}/public/quotes/${result.issued.rawToken}`;
      await withTenantTransaction(req.organizationId!, async (tx) => {
        await scheduleQuoteFollowUp(tx, {
          organizationId: req.organizationId!,
          quoteId: result.quote.id,
          customerId: result.quote.customerId,
          customerEmail: result.quote.customer?.email ?? null,
          customerName: result.quote.customer?.name ?? null,
          quoteTitle: result.quote.title,
          orgName: result.quote.organization.name,
          automationSettings: result.quote.organization.automationSettings,
          publicLink: link,
        });
      });

      if (!result.markOnly && result.quote.customer?.email) {
        await email.send({
          to: result.quote.customer.email,
          subject: `Quote from ${result.quote.organization.name}: ${result.quote.title}`,
          text: `Please review your quote:\n${link}\n\n${result.quote.clientMessage || ""}`,
        });
      }

      res.redirect(
        `/quotes/${param(req, "id")}?success=${encodeURIComponent(
          result.markOnly ? "Marked as sent" : `Sent. Link: ${link}`,
        )}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Send failed";
      res.redirect(`/quotes/${param(req, "id")}?error=${encodeURIComponent(message)}`);
    }
  },
);

quotesRouter.post(
  "/:id/approve",
  requirePermission("quotes.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const note = String(req.body.note || "").trim();
      if (!note) {
        res.redirect(`/quotes/${param(req, "id")}?error=${encodeURIComponent("Approval note required")}`);
        return;
      }
      await withTenantTransaction(req.organizationId!, async (tx) => {
        await applyQuoteTransition(tx, {
          organizationId: req.organizationId!,
          quoteId: param(req, "id"),
          event: "approve",
          actorType: "user",
          actorId: req.user!.id,
          note,
          extraData: {
            signedByName: req.user!.name,
            signedAt: new Date(),
            changeRequestNote: null,
          },
        });
        await runScheduleTriggers(tx, {
          organizationId: req.organizationId!,
          quoteId: param(req, "id"),
          trigger: "on_approve",
          actorId: req.user!.id,
        });
        await cancelPendingMessages(tx, {
          entityType: "quote",
          entityId: param(req, "id"),
          triggerKey: "quote_follow_up",
        });
      });
      res.redirect(`/quotes/${param(req, "id")}?success=${encodeURIComponent("Marked approved")}`);
    } catch (error) {
      next(error);
    }
  },
);

quotesRouter.post(
  "/:id/archive",
  requirePermission("quotes.edit"),
  async (req: AuthedRequest, res, _next) => {
    try {
      const reason = String(req.body.reason || "").trim() || "Archived";
      await withTenantTransaction(req.organizationId!, async (tx) => {
        await applyQuoteTransition(tx, {
          organizationId: req.organizationId!,
          quoteId: param(req, "id"),
          event: "archive",
          actorType: "user",
          actorId: req.user!.id,
          note: reason,
          extraData: { archiveReason: reason },
        });
        await cancelPendingMessages(tx, {
          entityType: "quote",
          entityId: param(req, "id"),
        });
      });
      res.redirect(`/quotes/${param(req, "id")}?success=${encodeURIComponent("Archived")}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Archive failed";
      res.redirect(`/quotes/${param(req, "id")}?error=${encodeURIComponent(message)}`);
    }
  },
);

quotesRouter.post(
  "/:id/renew",
  requirePermission("quotes.edit"),
  async (req: AuthedRequest, res, _next) => {
    try {
      await withTenantTransaction(req.organizationId!, async (tx) => {
        const org = await prisma.organization.findUniqueOrThrow({
          where: { id: req.organizationId! },
        });
        await applyQuoteTransition(tx, {
          organizationId: req.organizationId!,
          quoteId: param(req, "id"),
          event: "renew",
          actorType: "user",
          actorId: req.user!.id,
          extraData: { validUntil: defaultValidUntil(org.quoteValidityDays) },
        });
      });
      res.redirect(`/quotes/${param(req, "id")}?success=${encodeURIComponent("Renewed")}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Renew failed";
      res.redirect(`/quotes/${param(req, "id")}?error=${encodeURIComponent(message)}`);
    }
  },
);

quotesRouter.post(
  "/:id/duplicate",
  requirePermission("quotes.create"),
  async (req: AuthedRequest, res, next) => {
    try {
      const customerId = String(req.body.customerId || "") || null;
      const propertyId = String(req.body.propertyId || "") || null;
      const newId = await withTenantTransaction(req.organizationId!, async (tx) => {
        const src = await tx.quote.findFirst({
          where: { id: param(req, "id") },
          include: {
            rooms: true,
            optionGroups: true,
            lineItems: true,
          },
        });
        if (!src) throw new Error("Quote not found");
        const org = await prisma.organization.findUniqueOrThrow({
          where: { id: req.organizationId! },
        });
        const maxNumber = await tx.quote.aggregate({ _max: { number: true } });
        const created = await tx.quote.create({
          data: {
            organizationId: req.organizationId!,
            number: (maxNumber._max.number ?? 0) + 1,
            title: `${src.title} (copy)`,
            customerId: customerId || src.customerId,
            propertyId: propertyId || src.propertyId,
            salespersonId: req.user!.id,
            flooringType: src.flooringType,
            areaSqft: src.areaSqft,
            wastePercent: src.wastePercent,
            materialCost: src.materialCost,
            laborCost: src.laborCost,
            materialMarkup: src.materialMarkup,
            laborMarkup: src.laborMarkup,
            discountType: src.discountType,
            discountValue: src.discountValue,
            taxRate: src.taxRate,
            taxTotal: src.taxTotal,
            subtotal: src.subtotal,
            total: src.total,
            notes: src.notes,
            clientMessage: src.clientMessage,
            terms: src.terms,
            clientView: src.clientView ?? defaultClientViewJson(),
            validUntil: defaultValidUntil(org.quoteValidityDays),
            status: "draft",
          },
        });

        const roomMap = new Map<string, string>();
        for (const room of src.rooms) {
          const nr = await tx.quoteRoom.create({
            data: {
              organizationId: req.organizationId!,
              quoteId: created.id,
              name: room.name,
              areaSqft: room.areaSqft,
              notes: room.notes,
              sortOrder: room.sortOrder,
            },
          });
          roomMap.set(room.id, nr.id);
        }
        const groupMap = new Map<string, string>();
        for (const g of src.optionGroups) {
          const ng = await tx.quoteOptionGroup.create({
            data: {
              organizationId: req.organizationId!,
              quoteId: created.id,
              name: g.name,
              flooringType: g.flooringType,
              sortOrder: g.sortOrder,
            },
          });
          groupMap.set(g.id, ng.id);
        }
        for (const li of src.lineItems) {
          await tx.quoteLineItem.create({
            data: {
              organizationId: req.organizationId!,
              quoteId: created.id,
              roomId: li.roomId ? roomMap.get(li.roomId) ?? null : null,
              optionGroupId: li.optionGroupId
                ? groupMap.get(li.optionGroupId) ?? null
                : null,
              name: li.name,
              description: li.description,
              quantity: li.quantity,
              unit: li.unit,
              unitCost: li.unitCost,
              unitPrice: li.unitPrice,
              amount: li.amount,
              isOptional: li.isOptional,
              isSelected: li.isSelected,
              itemType: li.itemType,
              sortOrder: li.sortOrder,
              meta: li.meta ?? undefined,
            },
          });
        }
        if (src.selectedOptionGroupId && groupMap.has(src.selectedOptionGroupId)) {
          await tx.quote.update({
            where: { id: created.id },
            data: { selectedOptionGroupId: groupMap.get(src.selectedOptionGroupId)! },
          });
        }
        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "quote",
          entityId: created.id,
          actorType: "user",
          actorId: req.user!.id,
          action: "created",
          changes: { copiedFrom: { from: null, to: src.id } },
        });
        return created.id;
      });
      res.redirect(`/quotes/${newId}`);
    } catch (error) {
      next(error);
    }
  },
);

quotesRouter.post(
  "/:id/add-ons",
  requirePermission("quotes.edit"),
  async (req: AuthedRequest, res, _next) => {
    try {
      const addOnId = String(req.body.addOnId || "");
      await withTenantTransaction(req.organizationId!, async (tx) => {
        const quote = await tx.quote.findFirst({
          where: { id: param(req, "id") },
          include: { lineItems: true },
        });
        if (!quote) throw new Error("Quote not found");
        if (normalizeQuoteStatus(quote.status) !== "draft") {
          throw new Error("Only draft quotes can be edited");
        }
        const addOn = await tx.quoteAddOn.findFirst({ where: { id: addOnId } });
        if (!addOn) throw new Error("Add-on not found");
        const maxSort = Math.max(0, ...quote.lineItems.map((l) => l.sortOrder));
        await tx.quoteLineItem.create({
          data: {
            organizationId: req.organizationId!,
            quoteId: quote.id,
            name: addOn.name,
            description: addOn.description || addOn.name,
            quantity: toDecimal(1),
            unit: addOn.unit,
            unitCost: addOn.unitCost,
            unitPrice: addOn.unitPrice,
            amount: addOn.unitPrice,
            isOptional: true,
            isSelected: true,
            sortOrder: maxSort + 1,
          },
        });
        const full = await tx.quote.findFirst({
          where: { id: quote.id },
          include: { lineItems: true },
        });
        if (full) {
          await persistQuoteTotals(tx, quote.id, recomputeTotalsFromQuote(full));
        }
      });
      res.redirect(`/quotes/${param(req, "id")}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed";
      res.redirect(`/quotes/${param(req, "id")}?error=${encodeURIComponent(message)}`);
    }
  },
);

quotesRouter.get(
  "/:id/pdf",
  requirePermission("quotes.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canViewPricing(req.user)) {
        res.status(403).send("Pricing permission required");
        return;
      }
      const quote = await withTenantTransaction(req.organizationId!, async (tx) => {
        return tx.quote.findFirst({
          where: { id: param(req, "id") },
          include: quoteDetailInclude,
        });
      });
      if (!quote) {
        res.status(404).send("Not found");
        return;
      }
      const pdf = await buildQuotePdf({
        organizationName: req.organization!.name,
        organizationContact: [req.organization!.contactEmail, req.organization!.contactPhone]
          .filter(Boolean)
          .join(" · "),
        title: quote.title,
        number: quote.number,
        status: quote.status,
        customerName: quote.customer?.name,
        validUntil: quote.validUntil,
        terms: quote.terms,
        clientMessage: quote.clientMessage,
        rooms: quote.rooms.map((r) => ({ name: r.name, areaSqft: Number(r.areaSqft) })),
        optionGroups: quote.optionGroups.map((g) => ({ id: g.id, name: g.name })),
        selectedOptionGroupId: quote.selectedOptionGroupId,
        lines: quote.lineItems.map((li) => ({
          description: li.description,
          quantity: Number(li.quantity),
          unit: li.unit,
          unitPrice: Number(li.unitPrice),
          amount: Number(li.amount),
          isOptional: li.isOptional,
          isSelected: li.isSelected,
          optionGroupId: li.optionGroupId,
        })),
        clientView: quote.clientView as never,
        subtotal: Number(quote.subtotal),
        taxTotal: Number(quote.taxTotal),
        total: Number(quote.total),
        signatureUrl: quote.signatureUrl,
        signedByName: quote.signedByName,
        signedAt: quote.signedAt,
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="quote-${quote.number}.pdf"`,
      );
      res.send(pdf);
    } catch (error) {
      next(error);
    }
  },
);
