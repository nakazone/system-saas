import { Router } from "express";
import { z } from "zod";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth } from "../http.js";

export const notificationsRouter = Router();

notificationsRouter.get("/api/notifications", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      const rows = await tx.staffNotification.findMany({
        where: { userId: req.user!.id },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      const unread = await tx.staffNotification.count({
        where: { userId: req.user!.id, readAt: null },
      });
      return {
        unread,
        items: rows.map((row) => ({
          id: row.id,
          type: row.type,
          title: row.title,
          body: row.body,
          url: row.url,
          readAt: row.readAt,
          createdAt: row.createdAt,
        })),
      };
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.post("/api/notifications/read", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const parsed = z
      .object({
        all: z.boolean().optional(),
        ids: z.array(z.string().uuid()).max(100).optional(),
      })
      .safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: "Invalid body" });
      return;
    }
    const now = new Date();
    const count = await withTenantTransaction(req.organizationId!, async (tx) => {
      const where = parsed.data.all
        ? { userId: req.user!.id, readAt: null }
        : { userId: req.user!.id, id: { in: parsed.data.ids || [] }, readAt: null };
      const result = await tx.staffNotification.updateMany({ where, data: { readAt: now } });
      return result.count;
    });
    res.json({ success: true, data: { updated: count } });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.delete("/api/notifications", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const count = await withTenantTransaction(req.organizationId!, async (tx) => {
      const result = await tx.staffNotification.deleteMany({ where: { userId: req.user!.id } });
      return result.count;
    });
    res.json({ success: true, data: { deleted: count } });
  } catch (error) {
    next(error);
  }
});
