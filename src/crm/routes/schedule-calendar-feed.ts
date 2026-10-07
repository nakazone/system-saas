/**
 * Schedule → calendário externo (Apple Calendar / Google / Outlook).
 *
 *   POST /api/settings/schedule/calendar-feed   gera/rotaciona token (settings.manage | schedule.manage)
 *   GET  /api/settings/schedule/calendar-feed   status (tem feed ativo?)
 *   GET  /feeds/schedule/:token.ics             feed público ICS (assinatura)
 */
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { publicBaseUrl } from "../../lib/http/public-url.js";
import { issuePublicAccessToken, lookupPublicAccessToken } from "../../lib/quotes/public-token.js";
import { buildScheduleIcsCalendar, type ScheduleIcsEvent } from "../../lib/schedule/ics.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth } from "../http.js";

export const scheduleCalendarFeedRouter = Router();
export const scheduleCalendarFeedPublicRouter = Router();

const ENTITY = "schedule_feed";
const FEED_PAST_DAYS = 30;
const FEED_FUTURE_DAYS = 180;

function canManageFeed(req: AuthedRequest): boolean {
  const perms = req.user?.permissions || [];
  if (req.user?.roleKey === "admin") return true;
  return perms.includes("settings.manage") || perms.includes("schedule.manage");
}

function canReadFeedStatus(req: AuthedRequest): boolean {
  const perms = req.user?.permissions || [];
  if (req.user?.roleKey === "admin") return true;
  return (
    perms.includes("settings.manage") ||
    perms.includes("schedule.manage") ||
    perms.includes("schedule.view")
  );
}

function feedUrls(req: { protocol?: string; get?: (h: string) => string | undefined } | AuthedRequest, rawToken: string) {
  const base = publicBaseUrl(req as AuthedRequest).replace(/\/$/, "");
  const https = `${base}/feeds/schedule/${rawToken}.ics`;
  const webcal = https.replace(/^https:/i, "webcal:").replace(/^http:/i, "webcal:");
  return { https, webcal };
}

scheduleCalendarFeedRouter.get(
  "/api/settings/schedule/calendar-feed",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canReadFeedStatus(req)) {
        res.status(403).json({ success: false, error: "Sem permissão" });
        return;
      }
      const orgId = req.organizationId!;
      const row = await prisma.publicAccessToken.findFirst({
        where: {
          organizationId: orgId,
          entityType: ENTITY,
          entityId: orgId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, expiresAt: true, createdAt: true },
      });
      res.json({
        success: true,
        data: {
          active: Boolean(row),
          expires_at: row?.expiresAt?.toISOString() ?? null,
          created_at: row?.createdAt?.toISOString() ?? null,
          // Raw token is never stored — only returned when creating.
          url: null,
          webcal_url: null,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

scheduleCalendarFeedRouter.post(
  "/api/settings/schedule/calendar-feed",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canManageFeed(req)) {
        res.status(403).json({ success: false, error: "Sem permissão para gerar o link." });
        return;
      }
      const orgId = req.organizationId!;
      const issued = await withTenantTransaction(orgId, (tx) =>
        issuePublicAccessToken(tx, {
          organizationId: orgId,
          entityType: ENTITY,
          entityId: orgId,
          ttlDays: 365 * 2,
          tokenBytes: 24,
        }),
      );
      const urls = feedUrls(req, issued.rawToken);
      res.status(201).json({
        success: true,
        data: {
          active: true,
          expires_at: issued.expiresAt.toISOString(),
          url: urls.https,
          webcal_url: urls.webcal,
          raw_token: issued.rawToken,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

scheduleCalendarFeedRouter.delete(
  "/api/settings/schedule/calendar-feed",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canManageFeed(req)) {
        res.status(403).json({ success: false, error: "Sem permissão" });
        return;
      }
      const orgId = req.organizationId!;
      await prisma.publicAccessToken.updateMany({
        where: { organizationId: orgId, entityType: ENTITY, entityId: orgId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      res.json({ success: true, data: { active: false } });
    } catch (error) {
      next(error);
    }
  },
);

async function loadFeedEvents(organizationId: string): Promise<{ orgName: string; events: ScheduleIcsEvent[] }> {
  const now = Date.now();
  const from = new Date(now - FEED_PAST_DAYS * 24 * 60 * 60 * 1000);
  const to = new Date(now + FEED_FUTURE_DAYS * 24 * 60 * 60 * 1000);

  const [org, workOrders, meetings] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
    prisma.workOrder.findMany({
      where: {
        organizationId,
        status: { not: "canceled" },
        scheduledStart: { not: null, lte: to },
        OR: [{ scheduledEnd: null }, { scheduledEnd: { gte: from } }],
      },
      select: {
        id: true,
        title: true,
        number: true,
        address: true,
        notes: true,
        status: true,
        scheduledStart: true,
        scheduledEnd: true,
      },
      orderBy: { scheduledStart: "asc" },
      take: 2000,
    }),
    prisma.meeting.findMany({
      where: {
        organizationId,
        status: { not: "canceled" },
        scheduledStart: { lte: to },
        scheduledEnd: { gte: from },
      },
      select: {
        id: true,
        title: true,
        location: true,
        notes: true,
        status: true,
        scheduledStart: true,
        scheduledEnd: true,
        leadId: true,
        lead: { select: { name: true, address: true } },
      },
      orderBy: { scheduledStart: "asc" },
      take: 2000,
    }),
  ]);

  const events: ScheduleIcsEvent[] = [];

  for (const wo of workOrders) {
    if (!wo.scheduledStart) continue;
    const start = wo.scheduledStart;
    const end = wo.scheduledEnd || new Date(start.getTime() + 60 * 60 * 1000);
    const ref = wo.number != null ? `#${wo.number} ` : "";
    const descParts = [
      wo.status ? `Status: ${wo.status}` : "",
      wo.notes ? String(wo.notes).slice(0, 800) : "",
    ].filter(Boolean);
    events.push({
      uid: `job-${wo.id}@obramate.com`,
      summary: `${ref}${wo.title}`.trim(),
      location: wo.address || null,
      description: descParts.join("\n") || undefined,
      start,
      end,
      status: wo.status === "completed" ? "CONFIRMED" : "CONFIRMED",
    });
  }

  for (const m of meetings) {
    const isVisit = Boolean(m.leadId);
    const title = isVisit && m.lead?.name ? `Visita: ${m.lead.name}` : m.title;
    const location = m.location || m.lead?.address || null;
    const descParts = [
      isVisit ? "Tipo: visita" : "Tipo: reunião",
      m.status ? `Status: ${m.status}` : "",
      m.notes ? String(m.notes).slice(0, 800) : "",
    ].filter(Boolean);
    events.push({
      uid: `meeting-${m.id}@obramate.com`,
      summary: title,
      location,
      description: descParts.join("\n") || undefined,
      start: m.scheduledStart,
      end: m.scheduledEnd,
      status: "CONFIRMED",
    });
  }

  events.sort((a, b) => a.start.getTime() - b.start.getTime());
  return { orgName: org?.name || "ObraMate", events };
}

scheduleCalendarFeedPublicRouter.get("/:token.ics", async (req, res, next) => {
  try {
    const raw = String(req.params.token || "").trim();
    if (!raw || raw.length < 12) {
      res.status(404).type("text/plain").send("Calendário não encontrado.");
      return;
    }
    const tok = await lookupPublicAccessToken(raw);
    if (!tok || tok.entityType !== ENTITY) {
      res.status(404).type("text/plain").send("Calendário não encontrado ou link expirado.");
      return;
    }
    // entityId must be the org that owns the feed
    if (tok.entityId !== tok.organizationId) {
      res.status(404).type("text/plain").send("Calendário não encontrado.");
      return;
    }

    const { orgName, events } = await loadFeedEvents(tok.organizationId);
    const ics = buildScheduleIcsCalendar(events, { name: `${orgName} · Agenda` });

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'inline; filename="obramate-agenda.ics"');
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(ics);
  } catch (error) {
    next(error);
  }
});
