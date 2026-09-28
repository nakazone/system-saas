/**
 * Public org portfolio — before/after photos marked inPortfolio.
 * Mounted at /public/portfolio
 */
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { param } from "../../lib/http/params.js";

export const publicPortfolioRouter = Router();

publicPortfolioRouter.get("/:slug", async (req, res, next) => {
  try {
    const slug = param(req, "slug").toLowerCase();
    const org = await prisma.organization.findFirst({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        primaryColor: true,
        featureFlags: true,
      },
    });
    if (!org) {
      res.status(404).send("Portfolio not found");
      return;
    }
    const flags =
      org.featureFlags && typeof org.featureFlags === "object" && !Array.isArray(org.featureFlags)
        ? (org.featureFlags as Record<string, unknown>)
        : {};
    if (flags.public_portfolio === false || flags.publicPortfolio === false) {
      res.status(404).send("Portfolio not available");
      return;
    }

    const photos = await withTenantTransaction(org.id, async (tx) => {
      return tx.jobMedia.findMany({
        where: {
          deletedAt: null,
          inPortfolio: true,
          type: "photo",
        },
        orderBy: [{ createdAt: "desc" }],
        take: 60,
        select: {
          id: true,
          url: true,
          thumbUrl: true,
          caption: true,
          stage: true,
          workOrder: { select: { title: true, number: true, address: true } },
        },
      });
    });

    const items = photos.map((p) => ({
      id: p.id,
      url: p.url,
      thumbUrl: p.thumbUrl || p.url,
      caption: p.caption,
      stage: p.stage,
      jobTitle: p.workOrder?.title || null,
      jobNumber: p.workOrder?.number ?? null,
      address: p.workOrder?.address || null,
    }));

    res.render("portfolio/public", {
      title: `${org.name} · Portfolio`,
      organization: org,
      items,
      embed: String(req.query.embed || "") === "1",
    });
  } catch (error) {
    next(error);
  }
});
