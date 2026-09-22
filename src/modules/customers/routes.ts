import { Router } from "express";
import { param } from "../../lib/http/params.js";
import { z } from "zod";
import { requireAuth, requirePermission, type AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";

export const customersRouter = Router();

customersRouter.use(requireAuth);

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
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect("/customers/new");
        return;
      }
      await withTenantTransaction(req.organizationId!, async (tx) => {
        await tx.customer.create({
          data: {
            organizationId: req.organizationId!,
            name: parsed.data.name,
            email: parsed.data.email || null,
            phone: parsed.data.phone || null,
            address: parsed.data.address || null,
          },
        });
      });
      res.redirect("/customers");
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
      const customer = await withTenantTransaction(req.organizationId!, async (tx) => {
        return tx.customer.findFirst({
          where: { id: param(req, "id") },
          include: { quotes: { orderBy: { createdAt: "desc" } } },
        });
      });
      if (!customer) {
        res.status(404).render("errors/not-found", {
          title: "Customer not found",
          message: "Customer not found.",
          organization: req.organization,
          user: req.user,
        });
        return;
      }
      res.render("customers/show", {
        title: customer.name,
        organization: req.organization,
        user: req.user,
        customer,
      });
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
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect(`/customers/${param(req, "id")}/edit`);
        return;
      }
      await withTenantTransaction(req.organizationId!, async (tx) => {
        await tx.customer.update({
          where: { id: param(req, "id") },
          data: {
            name: parsed.data.name,
            email: parsed.data.email || null,
            phone: parsed.data.phone || null,
            address: parsed.data.address || null,
          },
        });
      });
      res.redirect(`/customers/${param(req, "id")}`);
    } catch (error) {
      next(error);
    }
  },
);
