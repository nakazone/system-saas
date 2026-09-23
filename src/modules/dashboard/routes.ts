import type { Response, NextFunction } from "express";
import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { canViewPricing } from "../../lib/pricing/visibility.js";
import { buildActionHome } from "../../lib/home/actions.js";

export const dashboardRouter = Router();

async function renderActionHome(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (req.user?.roleKey === "installer") {
      res.redirect("/schedule/my-day");
      return;
    }

    const home = await withTenantTransaction(req.organizationId!, async (tx) => {
      const action = await buildActionHome(tx);
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
      return { action, stages, recentQuotes };
    });

    res.render("dashboard/index", {
      title: "Home",
      organization: req.organization,
      user: req.user,
      blocks: home.action.blocks,
      todayVisitsByCrew: home.action.todayVisitsByCrew,
      stages: home.stages,
      recentQuotes: home.recentQuotes,
      canViewPricing: canViewPricing(req.user),
    });
  } catch (error) {
    next(error);
  }
}

/** CRM mounts `/` → dashboard.html; action home lives at `/home`. */
dashboardRouter.get("/", requireAuth, renderActionHome);
dashboardRouter.get("/home", requireAuth, renderActionHome);
