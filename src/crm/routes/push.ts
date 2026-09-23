import { Router } from "express";
import { z } from "zod";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { ensureWebPushConfigured, getVapidKeys } from "../../lib/push/vapid.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth } from "../http.js";

export const pushRouter = Router();

pushRouter.get("/api/push/vapid-public-key", requireCrmAuth, async (_req, res, next) => {
  try {
    const keys = await getVapidKeys();
    res.json({ success: true, data: { publicKey: keys.publicKey } });
  } catch (error) {
    next(error);
  }
});

pushRouter.get("/api/push/status", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const count = await withTenantTransaction(req.organizationId!, async (tx) =>
      tx.pushSubscription.count({ where: { userId: req.user!.id } }),
    );
    res.json({
      success: true,
      data: {
        subscribed: count > 0,
        deviceCount: count,
      },
    });
  } catch (error) {
    next(error);
  }
});

pushRouter.post("/api/push/subscribe", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    await ensureWebPushConfigured();
    const parsed = z
      .object({
        endpoint: z.string().url(),
        keys: z.object({
          p256dh: z.string().min(1),
          auth: z.string().min(1),
        }),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ success: false, error: "Invalid push subscription" });
      return;
    }

    const ua = String(req.headers["user-agent"] || "").slice(0, 400) || null;
    const row = await withTenantTransaction(req.organizationId!, async (tx) => {
      const existing = await tx.pushSubscription.findFirst({
        where: { endpoint: parsed.data.endpoint },
        select: { id: true },
      });
      if (existing) {
        return tx.pushSubscription.update({
          where: { id: existing.id },
          data: {
            userId: req.user!.id,
            p256dh: parsed.data.keys.p256dh,
            auth: parsed.data.keys.auth,
            userAgent: ua,
          },
          select: { id: true },
        });
      }
      return tx.pushSubscription.create({
        data: {
          organizationId: req.organizationId!,
          userId: req.user!.id,
          endpoint: parsed.data.endpoint,
          p256dh: parsed.data.keys.p256dh,
          auth: parsed.data.keys.auth,
          userAgent: ua,
        },
        select: { id: true },
      });
    });

    res.status(201).json({ success: true, data: { id: row.id } });
  } catch (error) {
    next(error);
  }
});

pushRouter.delete("/api/push/subscribe", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint : null;
    await withTenantTransaction(req.organizationId!, async (tx) => {
      if (endpoint) {
        await tx.pushSubscription.deleteMany({
          where: { userId: req.user!.id, endpoint },
        });
      } else {
        await tx.pushSubscription.deleteMany({ where: { userId: req.user!.id } });
      }
    });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
