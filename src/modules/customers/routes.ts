import { Router } from "express";
import { param } from "../../lib/http/params.js";
import { z } from "zod";
import { requireAuth, requirePermission, type AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { diffFields, recordActivity } from "../../lib/activity/record.js";
import { canViewPricing } from "../../lib/pricing/visibility.js";

export const customersRouter = Router();

customersRouter.use(requireAuth);

const propertySchema = z.object({
  label: z.string().max(80).optional().or(z.literal("")),
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional().or(z.literal("")),
  city: z.string().max(100).optional().or(z.literal("")),
  state: z.string().max(40).optional().or(z.literal("")),
  postalCode: z.string().max(20).optional().or(z.literal("")),
  country: z.string().max(40).optional().or(z.literal("")),
  notes: z.string().max(5000).optional().or(z.literal("")),
});

customersRouter.get(
  "/",
  requirePermission("customers.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const customers = await withTenantTransaction(req.organizationId!, async (tx) => {
        return tx.customer.findMany({ orderBy: { createdAt: "desc" } });
      });
      res.render("customers/index", {
        title: "Customers",
        organization: req.organization,
        user: req.user,
        customers,
      });
    } catch (error) {
      next(error);
    }
  },
);

customersRouter.get(
  "/new",
  requirePermission("customers.create"),
  (req: AuthedRequest, res) => {
    res.render("customers/form", {
      title: "New customer",
      organization: req.organization,
      user: req.user,
      customer: null,
      error: null,
    });
  },
);

customersRouter.post(
  "/",
  requirePermission("customers.create"),
  async (req: AuthedRequest, res, next) => {
    try {
      const schema = z.object({
        name: z.string().min(1).max(200),
        email: z.string().email().optional().or(z.literal("")),
        phone: z.string().max(40).optional().or(z.literal("")),
        address: z.string().max(300).optional().or(z.literal("")),
        marketingConsent: z.string().optional(),
        transactionalOptOut: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect("/customers/new");
        return;
      }
      const customer = await withTenantTransaction(req.organizationId!, async (tx) => {
        const created = await tx.customer.create({
          data: {
            organizationId: req.organizationId!,
            name: parsed.data.name,
            email: parsed.data.email || null,
            phone: parsed.data.phone || null,
            address: parsed.data.address || null,
            marketingConsent: parsed.data.marketingConsent === "on",
            transactionalOptOut: parsed.data.transactionalOptOut === "on",
          },
        });
        if (parsed.data.address) {
          await tx.property.create({
            data: {
              organizationId: req.organizationId!,
              customerId: created.id,
              label: "Primary",
              line1: parsed.data.address,
              city: "",
              state: "",
              postalCode: "",
              country: "US",
            },
          });
        }
        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "customer",
          entityId: created.id,
          actorType: "user",
          actorId: req.user!.id,
          action: "created",
        });
        return created;
      });
      res.redirect(`/customers/${customer.id}`);
    } catch (error) {
      next(error);
    }
  },
);

customersRouter.get(
  "/:id/statement",
  requirePermission("invoices.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        const customer = await tx.customer.findFirst({ where: { id: param(req, "id") } });
        if (!customer) return null;
        const invoices = await tx.quoteInvoice.findMany({
          where: { customerId: customer.id, status: { not: "void" } },
          include: { receipts: true, quote: true },
          orderBy: { createdAt: "asc" },
        });
        return { customer, invoices };
      });
      if (!result) {
        res.status(404).send("Not found");
        return;
      }
      const rows = result.invoices.map((inv) => {
        const paid = inv.receipts.reduce((s, r) => s + Number(r.amount), 0);
        return {
          ...inv,
          paid,
          balance: Number(inv.amount) - paid,
        };
      });
      const totals = rows.reduce(
        (acc, r) => ({
          invoiced: acc.invoiced + Number(r.amount),
          paid: acc.paid + r.paid,
          balance: acc.balance + r.balance,
        }),
        { invoiced: 0, paid: 0, balance: 0 },
      );
      res.render("customers/statement", {
        title: `Statement — ${result.customer.name}`,
        organization: req.organization,
        user: req.user,
        customer: result.customer,
        rows,
        totals,
        canViewPricing: canViewPricing(req.user),
      });
    } catch (error) {
      next(error);
    }
  },
);

customersRouter.get(
  "/:id",
  requirePermission("customers.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        const customer = await tx.customer.findFirst({
          where: { id: param(req, "id") },
          include: {
            quotes: { orderBy: { createdAt: "desc" } },
            properties: { orderBy: { createdAt: "asc" } },
          },
        });
        if (!customer) return null;
        const activity = await tx.activityEvent.findMany({
          where: { entityType: "customer", entityId: customer.id },
          orderBy: { createdAt: "desc" },
          take: 50,
        });
        return { customer, activity };
      });
      if (!result) {
        res.status(404).render("errors/not-found", {
          title: "Customer not found",
          message: "Customer not found.",
          organization: req.organization,
          user: req.user,
        });
        return;
      }
      res.render("customers/show", {
        title: result.customer.name,
        organization: req.organization,
        user: req.user,
        customer: result.customer,
        activity: result.activity,
        canViewPricing: canViewPricing(req.user),
        propertyError: null,
      });
    } catch (error) {
      next(error);
    }
  },
);

customersRouter.post(
  "/:id/properties",
  requirePermission("customers.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = propertySchema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect(`/customers/${param(req, "id")}?propertyError=1`);
        return;
      }
      await withTenantTransaction(req.organizationId!, async (tx) => {
        const customer = await tx.customer.findFirst({ where: { id: param(req, "id") } });
        if (!customer) throw new Error("Customer not found");
        const property = await tx.property.create({
          data: {
            organizationId: req.organizationId!,
            customerId: customer.id,
            label: parsed.data.label || null,
            line1: parsed.data.line1,
            line2: parsed.data.line2 || null,
            city: parsed.data.city || "",
            state: parsed.data.state || "",
            postalCode: parsed.data.postalCode || "",
            country: parsed.data.country || "US",
            notes: parsed.data.notes || null,
          },
        });
        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "property",
          entityId: property.id,
          actorType: "user",
          actorId: req.user!.id,
          action: "created",
        });
        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "customer",
          entityId: customer.id,
          actorType: "user",
          actorId: req.user!.id,
          action: "updated",
          changes: { property: { from: null, to: property.id } },
        });
      });
      res.redirect(`/customers/${param(req, "id")}`);
    } catch (error) {
      next(error);
    }
  },
);

customersRouter.post(
  "/:id/properties/:propertyId",
  requirePermission("customers.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = propertySchema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect(`/customers/${param(req, "id")}?propertyError=1`);
        return;
      }
      await withTenantTransaction(req.organizationId!, async (tx) => {
        const before = await tx.property.findFirst({
          where: { id: param(req, "propertyId"), customerId: param(req, "id") },
        });
        if (!before) throw new Error("Property not found");
        const after = await tx.property.update({
          where: { id: before.id },
          data: {
            label: parsed.data.label || null,
            line1: parsed.data.line1,
            line2: parsed.data.line2 || null,
            city: parsed.data.city || "",
            state: parsed.data.state || "",
            postalCode: parsed.data.postalCode || "",
            country: parsed.data.country || "US",
            notes: parsed.data.notes || null,
          },
        });
        const changes = diffFields(
          before as unknown as Record<string, unknown>,
          after as unknown as Record<string, unknown>,
          ["label", "line1", "line2", "city", "state", "postalCode", "country", "notes"],
        );
        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "property",
          entityId: after.id,
          actorType: "user",
          actorId: req.user!.id,
          action: "updated",
          changes,
        });
      });
      res.redirect(`/customers/${param(req, "id")}`);
    } catch (error) {
      next(error);
    }
  },
);

customersRouter.get(
  "/:id/edit",
  requirePermission("customers.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const customer = await withTenantTransaction(req.organizationId!, async (tx) => {
        return tx.customer.findFirst({ where: { id: param(req, "id") } });
      });
      if (!customer) {
        res.status(404).send("Not found");
        return;
      }
      res.render("customers/form", {
        title: "Edit customer",
        organization: req.organization,
        user: req.user,
        customer,
        error: null,
      });
    } catch (error) {
      next(error);
    }
  },
);

customersRouter.post(
  "/:id",
  requirePermission("customers.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const schema = z.object({
        name: z.string().min(1).max(200),
        email: z.string().email().optional().or(z.literal("")),
        phone: z.string().max(40).optional().or(z.literal("")),
        address: z.string().max(300).optional().or(z.literal("")),
        marketingConsent: z.string().optional(),
        transactionalOptOut: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect(`/customers/${param(req, "id")}/edit`);
        return;
      }
      await withTenantTransaction(req.organizationId!, async (tx) => {
        const before = await tx.customer.findFirst({ where: { id: param(req, "id") } });
        if (!before) throw new Error("Customer not found");
        const after = await tx.customer.update({
          where: { id: param(req, "id") },
          data: {
            name: parsed.data.name,
            email: parsed.data.email || null,
            phone: parsed.data.phone || null,
            address: parsed.data.address || null,
            marketingConsent: parsed.data.marketingConsent === "on",
            transactionalOptOut: parsed.data.transactionalOptOut === "on",
          },
        });
        const changes = diffFields(
          before as unknown as Record<string, unknown>,
          after as unknown as Record<string, unknown>,
          ["name", "email", "phone", "address", "marketingConsent", "transactionalOptOut"],
        );
        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "customer",
          entityId: after.id,
          actorType: "user",
          actorId: req.user!.id,
          action: "updated",
          changes,
        });
      });
      res.redirect(`/customers/${param(req, "id")}`);
    } catch (error) {
      next(error);
    }
  },
);
