import { Router } from "express";
import { param } from "../../lib/http/params.js";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireAuth, requirePermission, type AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { issuePublicAccessToken } from "../../lib/quotes/public-token.js";
import { recordActivity } from "../../lib/activity/record.js";
import { email } from "../../lib/email/index.js";
import {
  createInvoiceFromScheduleItem,
  nextInvoiceNumber,
  recordInvoicePayment,
  seedDefaultPaymentTemplates,
  toCents,
  paidTotalCents,
  validatePaymentSchedule,
  fromCents,
} from "../../lib/payments/engine.js";

export const invoicesRouter = Router();

invoicesRouter.use(requireAuth);

invoicesRouter.get(
  "/",
  requirePermission("invoices.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : "";
      const filter = typeof req.query.filter === "string" ? req.query.filter : "";
      const now = new Date();
      const invoices = await withTenantTransaction(req.organizationId!, async (tx) => {
        const where: Record<string, unknown> = {};
        if (status) where.status = status;
        if (filter === "overdue") {
          where.status = { in: ["sent", "partially_paid"] };
          where.dueDate = { lt: now };
        }
        return tx.quoteInvoice.findMany({
          where,
          include: {
            quote: true,
            customer: true,
            receipts: true,
          },
          orderBy: { createdAt: "desc" },
          take: 200,
        });
      });
      const mapped = invoices.map((inv) => ({
        ...inv,
        paid: fromCents(paidTotalCents(inv.receipts)),
        balance: fromCents(toCents(inv.amount) - paidTotalCents(inv.receipts)),
      }));
      const metrics = {
        total: mapped.length,
        openBalance: Number(
          mapped.reduce((s, i) => s + (i.status === "paid" || i.status === "void" ? 0 : i.balance), 0).toFixed(2),
        ),
        overdue: mapped.filter(
          (i) =>
            i.dueDate &&
            i.dueDate < now &&
            i.balance > 0 &&
            ["sent", "partially_paid"].includes(i.status),
        ).length,
      };
      res.render("invoices/index", {
        title: "Invoices",
        organization: req.organization,
        user: req.user,
        invoices: mapped,
        metrics,
        filters: { status, filter },
        canViewPricing:
          req.user?.permissions.includes("pricing.view") || req.user?.roleKey === "admin",
      });
    } catch (error) {
      next(error);
    }
  },
);

invoicesRouter.get(
  "/:id",
  requirePermission("invoices.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const invoice = await withTenantTransaction(req.organizationId!, async (tx) => {
        return tx.quoteInvoice.findFirst({
          where: { id: param(req, "id") },
          include: {
            quote: true,
            customer: true,
            lineItems: { orderBy: { sortOrder: "asc" } },
            receipts: { orderBy: { paidAt: "desc" } },
            scheduleItem: true,
          },
        });
      });
      if (!invoice) {
        res.status(404).send("Not found");
        return;
      }
      const paid = fromCents(paidTotalCents(invoice.receipts));
      res.render("invoices/show", {
        title: invoice.invoiceNumber || "Invoice",
        organization: req.organization,
        user: req.user,
        invoice,
        paid,
        balance: fromCents(toCents(invoice.amount) - paidTotalCents(invoice.receipts)),
        canViewPricing:
          req.user?.permissions.includes("pricing.view") || req.user?.roleKey === "admin",
        canRecordPayment: req.user?.permissions.includes("invoices.record_payment"),
        canManage: req.user?.permissions.includes("invoices.manage"),
        error: typeof req.query.error === "string" ? req.query.error : null,
        success: typeof req.query.success === "string" ? req.query.success : null,
        portalLink: typeof req.query.portal === "string" ? req.query.portal : null,
      });
    } catch (error) {
      next(error);
    }
  },
);

invoicesRouter.post(
  "/:id/send",
  requirePermission("invoices.manage"),
  async (req: AuthedRequest, res, _next) => {
    try {
      const markOnly = req.body.markOnly === "1";
      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        const invoice = await tx.quoteInvoice.findFirst({
          where: { id: param(req, "id") },
          include: { customer: true, organization: true },
        });
        if (!invoice) throw new Error("Invoice not found");
        if (invoice.status === "void") throw new Error("Invoice is void");

        const issued = await issuePublicAccessToken(tx, {
          organizationId: req.organizationId!,
          entityType: "invoice",
          entityId: invoice.id,
        });

        await tx.quoteInvoice.update({
          where: { id: invoice.id },
          data: {
            status: invoice.status === "draft" ? "sent" : invoice.status,
            issuedAt: invoice.issuedAt ?? new Date(),
          },
        });

        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "invoice",
          entityId: invoice.id,
          actorType: "user",
          actorId: req.user!.id,
          action: "status_changed",
          changes: { status: { from: invoice.status, to: "sent" } },
        });

        return { invoice, issued, markOnly };
      });

      const link = `${req.protocol}://${req.get("host")}/public/invoices/${result.issued.rawToken}`;
      if (!result.markOnly && result.invoice.customer?.email) {
        await email.send({
          to: result.invoice.customer.email,
          subject: `Invoice ${result.invoice.invoiceNumber} from ${result.invoice.organization.name}`,
          text: `Please review your invoice:\n${link}\n\n${result.invoice.paymentInstructions || ""}`,
        });
      }

      res.redirect(
        `/invoices/${param(req, "id")}?success=${encodeURIComponent(
          result.markOnly ? "Marked as sent" : "Sent",
        )}&portal=${encodeURIComponent(link)}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Send failed";
      res.redirect(`/invoices/${param(req, "id")}?error=${encodeURIComponent(message)}`);
    }
  },
);

invoicesRouter.post(
  "/:id/void",
  requirePermission("invoices.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      await withTenantTransaction(req.organizationId!, async (tx) => {
        const invoice = await tx.quoteInvoice.findFirst({ where: { id: param(req, "id") } });
        if (!invoice) throw new Error("Not found");
        if (invoice.status === "paid") throw new Error("Cannot void a paid invoice");
        await tx.quoteInvoice.update({
          where: { id: invoice.id },
          data: { status: "void" },
        });
      });
      res.redirect(`/invoices/${param(req, "id")}?success=voided`);
    } catch (error) {
      next(error);
    }
  },
);

invoicesRouter.post(
  "/:id/payments",
  requirePermission("invoices.record_payment"),
  async (req: AuthedRequest, res, _next) => {
    try {
      const schema = z.object({
        amount: z.coerce.number().positive(),
        method: z.string().max(40).optional().or(z.literal("")),
        referenceNumber: z.string().max(80).optional().or(z.literal("")),
        notes: z.string().max(2000).optional().or(z.literal("")),
        paidAt: z.string().optional().or(z.literal("")),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect(`/invoices/${param(req, "id")}?error=invalid`);
        return;
      }
      await withTenantTransaction(req.organizationId!, async (tx) => {
        await recordInvoicePayment(tx, {
          organizationId: req.organizationId!,
          invoiceId: param(req, "id"),
          amount: parsed.data.amount,
          method: parsed.data.method || null,
          referenceNumber: parsed.data.referenceNumber || null,
          notes: parsed.data.notes || null,
          paidAt: parsed.data.paidAt ? new Date(parsed.data.paidAt) : new Date(),
          actorId: req.user!.id,
        });
      });
      res.redirect(`/invoices/${param(req, "id")}?success=payment`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Payment failed";
      res.redirect(`/invoices/${param(req, "id")}?error=${encodeURIComponent(message)}`);
    }
  },
);

/** Manual draft invoice from a schedule item (or ad-hoc). */
invoicesRouter.post(
  "/from-schedule-item",
  requirePermission("invoices.manage"),
  async (req: AuthedRequest, res, _next) => {
    try {
      const schema = z.object({
        quoteId: z.string().uuid(),
        scheduleItemId: z.string().uuid(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect("/invoices?error=1");
        return;
      }
      const invoiceId = await withTenantTransaction(req.organizationId!, async (tx) => {
        const quote = await tx.quote.findFirst({
          where: { id: parsed.data.quoteId },
          include: {
            paymentSchedule: { include: { items: { orderBy: { sortOrder: "asc" } } } },
          },
        });
        if (!quote?.paymentSchedule) throw new Error("Schedule not found");
        const items = quote.paymentSchedule.items;
        const idx = items.findIndex((i) => i.id === parsed.data.scheduleItemId);
        if (idx < 0) throw new Error("Item not found");
        const validation = validatePaymentSchedule(
          items.map((i) => ({
            label: i.label,
            percent: i.percent != null ? Number(i.percent) : null,
            fixedAmount: i.fixedAmount != null ? Number(i.fixedAmount) : null,
            sortOrder: i.sortOrder,
          })),
          Number(quote.total),
        );
        if (!validation.ok) throw new Error(validation.error);
        const inv = await createInvoiceFromScheduleItem(tx, {
          organizationId: req.organizationId!,
          quoteId: quote.id,
          scheduleItemId: parsed.data.scheduleItemId,
          amountCents: validation.amountsCents[idx]!,
          actorId: req.user!.id,
        });
        return inv.id;
      });
      res.redirect(`/invoices/${invoiceId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed";
      res.redirect(`/quotes/${req.body.quoteId}?error=${encodeURIComponent(message)}`);
    }
  },
);

invoicesRouter.post(
  "/manual",
  requirePermission("invoices.manage"),
  async (req: AuthedRequest, res, _next) => {
    try {
      const schema = z.object({
        quoteId: z.string().uuid(),
        amount: z.coerce.number().positive(),
        invoiceType: z.string().max(40).optional(),
        notes: z.string().max(2000).optional().or(z.literal("")),
        dueDate: z.string().optional().or(z.literal("")),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect(`/quotes/${req.body.quoteId}?error=invalid`);
        return;
      }
      const id = await withTenantTransaction(req.organizationId!, async (tx) => {
        await seedDefaultPaymentTemplates(tx, req.organizationId!);
        const quote = await tx.quote.findFirst({
          where: { id: parsed.data.quoteId },
          include: { organization: true },
        });
        if (!quote) throw new Error("Quote not found");
        const invoiceNumber = await nextInvoiceNumber(tx, req.organizationId!);
        const inv = await tx.quoteInvoice.create({
          data: {
            organizationId: req.organizationId!,
            quoteId: quote.id,
            customerId: quote.customerId,
            invoiceNumber,
            invoiceType: parsed.data.invoiceType || "other",
            status: "draft",
            amount: new Prisma.Decimal(parsed.data.amount.toFixed(2)),
            dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
            notes: parsed.data.notes || null,
            paymentInstructions: quote.organization.paymentInstructions,
          },
        });
        await tx.invoiceLineItem.create({
          data: {
            organizationId: req.organizationId!,
            invoiceId: inv.id,
            description: parsed.data.notes || "Invoice",
            quantity: new Prisma.Decimal(1),
            unitPrice: new Prisma.Decimal(parsed.data.amount.toFixed(2)),
            amount: new Prisma.Decimal(parsed.data.amount.toFixed(2)),
            sortOrder: 1,
          },
        });
        return inv.id;
      });
      res.redirect(`/invoices/${id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed";
      res.redirect(`/quotes/${req.body.quoteId}?error=${encodeURIComponent(message)}`);
    }
  },
);
