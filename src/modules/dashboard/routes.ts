import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";

export const dashboardRouter = Router();

dashboardRouter.get("/", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const stats = await withTenantTransaction(req.organizationId!, async (tx) => {
      const stages = await tx.pipelineStage.findMany({
        where: { isActive: true },
        orderBy: { order: "asc" },
        include: { _count: { select: { leads: true } } },
      });
      const recentQuotes = await tx.quote.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        include: { customer: true },
      });
      const leadCount = await tx.lead.count();
      const customerCount = await tx.customer.count();
      const quoteCount = await tx.quote.count();
      return { stages, recentQuotes, leadCount, customerCount, quoteCount };
    });

    res.render("dashboard/index", {
      title: "Dashboard",
      organization: req.organization,
      user: req.user,
      stats,
    });
  } catch (error) {
    next(error);
  }
});
