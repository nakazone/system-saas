import { Router } from "express";
import { param } from "../../lib/http/params.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { lookupPublicAccessToken } from "../../lib/quotes/public-token.js";
import { prisma } from "../../lib/prisma.js";

export const publicJobsRouter = Router();

publicJobsRouter.get("/:token", async (req, res, next) => {
  try {
    const rawToken = param(req, "token");
    const ref = await lookupPublicAccessToken(rawToken);
    if (!ref || ref.entityType !== "work_order_temp") {
      res.status(404).send("Link não encontrado ou expirado");
      return;
    }

    const data = await withTenantTransaction(ref.organizationId, async (tx) => {
      const temp = await tx.workOrderTempWorker.findFirst({
        where: { id: ref.entityId },
      });
      if (!temp) return null;
      const workOrder = await tx.workOrder.findFirst({
        where: { id: temp.workOrderId },
        include: {
          assignedUser: { select: { name: true } },
          customer: { select: { name: true } },
          builder: { select: { firstName: true, lastName: true, company: true } },
          members: { include: { user: { select: { name: true } } } },
          lineItems: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
        },
      });
      if (!workOrder || workOrder.status === "canceled") return null;
      if (ref.tokenId) {
        await tx.publicAccessToken.update({
          where: { id: ref.tokenId },
          data: { lastUsedAt: new Date(), viewedAt: new Date() },
        });
      }
      const organization = await prisma.organization.findUnique({
        where: { id: ref.organizationId },
        select: { name: true, primaryColor: true, logoUrl: true },
      });
      return { temp, workOrder, organization };
    });

    if (!data?.workOrder || !data.organization) {
      res.status(404).send("Trabalho não disponível");
      return;
    }

    const wo = data.workOrder;
    const client =
      wo.customer?.name ||
      wo.builder?.company ||
      [wo.builder?.firstName, wo.builder?.lastName].filter(Boolean).join(" ").trim() ||
      wo.sourceName ||
      "Cliente";

    const team = [
      wo.assignedUser?.name,
      ...wo.members.map((m) => m.user.name),
    ].filter((n, i, arr): n is string => Boolean(n) && arr.indexOf(n!) === i);

    const services = (wo.lineItems || []).map((li) => ({
      name: li.serviceName,
      quantitySqft: Number(li.quantitySqft) || 0,
    }));

    res.render("jobs/public", {
      title: wo.title,
      organization: data.organization,
      tempWorker: data.temp,
      job: {
        title: wo.title,
        number: wo.number,
        status: wo.status,
        address: wo.address,
        notes: wo.notes,
        client,
        scheduledStart: wo.scheduledStart,
        scheduledEnd: wo.scheduledEnd,
        team,
        services,
      },
    });
  } catch (error) {
    next(error);
  }
});
