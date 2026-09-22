import { Router } from "express";
import { param } from "../../lib/http/params.js";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireAuth, requirePermission, type AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { calculateQuote, toDecimal } from "../../lib/quotes/calculate.js";
import { prisma } from "../../lib/prisma.js";

export const quotesRouter = Router();

quotesRouter.use(requireAuth);

quotesRouter.get(
  "/",
  requirePermission("quotes.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const quotes = await withTenantTransaction(req.organizationId!, async (tx) => {
        return tx.quote.findMany({
          include: { customer: true },
          orderBy: { createdAt: "desc" },
        });
      });
      res.render("quotes/index", {
        title: "Quotes",
        organization: req.organization,
        user: req.user,
        quotes,
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
      const [customers, rules] = await withTenantTransaction(req.organizationId!, async (tx) => {
        return Promise.all([
          tx.customer.findMany({ orderBy: { name: "asc" } }),
          tx.estimateRule.findMany({ orderBy: { flooringType: "asc" } }),
        ]);
      });
      res.render("quotes/form", {
        title: "New quote",
        organization: req.organization,
        user: req.user,
        quote: null,
        customers,
        rules,
        preselectedCustomerId: req.query.customerId ?? null,
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
        flooringType: z.enum(["hardwood", "lvp", "laminate", "tile", "carpet"]),
        areaSqft: z.coerce.number().positive(),
        pricePerSqft: z.coerce.number().min(0).optional(),
        laborPerSqft: z.coerce.number().min(0).optional(),
        notes: z.string().max(5000).optional().or(z.literal("")),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect("/quotes/new");
        return;
      }

      const quote = await withTenantTransaction(req.organizationId!, async (tx) => {
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

        const created = await tx.quote.create({
          data: {
            organizationId: req.organizationId!,
            number,
            title: parsed.data.title,
            customerId: parsed.data.customerId || null,
            flooringType: parsed.data.flooringType,
            areaSqft: toDecimal(parsed.data.areaSqft),
            wastePercent: toDecimal(wastePercent),
            materialCost: toDecimal(calc.materialCost),
            laborCost: toDecimal(calc.laborCost),
            materialMarkup: toDecimal(materialMarkup),
            laborMarkup: toDecimal(laborMarkup),
            subtotal: toDecimal(calc.subtotal),
            total: toDecimal(calc.total),
            notes: parsed.data.notes || null,
            publicToken: randomBytes(24).toString("hex"),
            status: "draft",
            lineItems: {
              create: [
                {
                  organizationId: req.organizationId!,
                  description: `${parsed.data.flooringType} material (${calc.billableArea} sqft incl. waste)`,
                  quantity: toDecimal(calc.billableArea),
                  unit: "sqft",
                  unitPrice: toDecimal(pricePerSqft * (1 + materialMarkup / 100)),
                  amount: toDecimal(calc.materialWithMarkup),
                  sortOrder: 1,
                },
                {
                  organizationId: req.organizationId!,
                  description: `${parsed.data.flooringType} labor`,
                  quantity: toDecimal(parsed.data.areaSqft),
                  unit: "sqft",
                  unitPrice: toDecimal(laborPerSqft * (1 + laborMarkup / 100)),
                  amount: toDecimal(calc.laborWithMarkup),
                  sortOrder: 2,
                },
              ],
            },
          },
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
      const quote = await withTenantTransaction(req.organizationId!, async (tx) => {
        return tx.quote.findFirst({
          where: { id: param(req, "id") },
          include: { customer: true, lineItems: { orderBy: { sortOrder: "asc" } } },
        });
      });
      if (!quote) {
        res.status(404).render("errors/not-found", {
          title: "Quote not found",
          message: "Quote not found.",
          organization: req.organization,
          user: req.user,
        });
        return;
      }
      res.render("quotes/show", {
        title: quote.title,
        organization: req.organization,
        user: req.user,
        quote,
      });
    } catch (error) {
      next(error);
    }
  },
);

/** Public quote view by token — no tenant subdomain required */
export const publicQuotesRouter = Router();

publicQuotesRouter.get("/quotes/:token", async (req, res, next) => {
  try {
    const token = String(req.params.token);
    const rows = await prisma.$queryRaw<{ quote_id: string; organization_id: string }[]>`
      SELECT * FROM get_quote_org_by_public_token(${token})
    `;
    const ref = rows[0];
    if (!ref) {
      res.status(404).render("errors/not-found", {
        title: "Quote not found",
        message: "This quote link is invalid.",
        organization: null,
      });
      return;
    }

    const quote = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${ref.organization_id}, true)`;
      return tx.quote.findUnique({
        where: { id: ref.quote_id },
        include: {
          customer: true,
          lineItems: { orderBy: { sortOrder: "asc" } },
          organization: {
            select: {
              name: true,
              logoUrl: true,
              primaryColor: true,
              contactEmail: true,
              contactPhone: true,
            },
          },
        },
      });
    });

    if (!quote) {
      res.status(404).render("errors/not-found", {
        title: "Quote not found",
        message: "This quote link is invalid.",
        organization: null,
      });
      return;
    }
    res.render("quotes/public", {
      title: quote.title,
      organization: quote.organization,
      quote,
    });
  } catch (error) {
    next(error);
  }
});
