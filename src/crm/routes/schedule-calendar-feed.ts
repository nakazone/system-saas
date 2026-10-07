/**
 * Schedule → calendário externo (Apple Calendar / Google / Outlook).
 *
 *   POST /api/settings/schedule/calendar-feed   gera/rotaciona token (settings.manage | schedule.manage)
 *   GET  /api/settings/schedule/calendar-feed   status + lista de agendas (URLs só no POST)
 *   GET  /feeds/schedule/:token.ics                    todos os eventos (legado)
 *   GET  /feeds/schedule/:token/:calendarId.ics        uma agenda do Schedule
 */
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { publicBaseUrl } from "../../lib/http/public-url.js";
import { issuePublicAccessToken, lookupPublicAccessToken } from "../../lib/quotes/public-token.js";
import { buildScheduleIcsCalendar, type ScheduleIcsEvent } from "../../lib/schedule/ics.js";
import {
  parseScheduleSettings,
  resolveJobCalendar,
  resolveVisitCalendarId,
  type ScheduleCalendar,
  type ScheduleSettings,
} from "../../lib/settings/schedule.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth } from "../http.js";

export const scheduleCalendarFeedRouter = Router();
export const scheduleCalendarFeedPublicRouter = Router();

const ENTITY = "schedule_feed";
const FEED_PAST_DAYS = 30;
const FEED_FUTURE_DAYS = 180;
const CAL_ID_RE = /^(jobs|visits|meetings|[0-9a-f-]{36})$/i;

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

function feedUrls(
  req: { protocol?: string; get?: (h: string) => string | undefined } | AuthedRequest,
  rawToken: string,
  calendarId?: string | null,
) {
  const base = publicBaseUrl(req as AuthedRequest).replace(/\/$/, "");
  const path = calendarId
    ? `/feeds/schedule/${rawToken}/${encodeURIComponent(calendarId)}.ics`
    : `/feeds/schedule/${rawToken}.ics`;
  const https = `${base}${path}`;
  const webcal = https.replace(/^https:/i, "webcal:").replace(/^http:/i, "webcal:");
  return { https, webcal };
}

function buildFeedList(
  req: AuthedRequest,
  rawToken: string,
  settings: ScheduleSettings,
  orgName: string,
) {
  const feeds = settings.calendars.map((cal) => {
    const urls = feedUrls(req, rawToken, cal.id);
    return {
      id: cal.id,
      name: cal.name,
      color: cal.color,
      kind: cal.kind,
      sector: cal.sector || null,
      label: `${orgName} · ${cal.name}`,
      url: urls.https,
      webcal_url: urls.webcal,
    };
  });
  const all = feedUrls(req, rawToken, null);
  return {
    feeds,
    all: {
      id: "all",
      name: "Tudo junto",
      label: `${orgName} · Agenda`,
      url: all.https,
      webcal_url: all.webcal,
    },
  };
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
      const [row, org] = await Promise.all([
        prisma.publicAccessToken.findFirst({
          where: {
            organizationId: orgId,
            entityType: ENTITY,
            entityId: orgId,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          orderBy: { createdAt: "desc" },
          select: { id: true, expiresAt: true, createdAt: true },
        }),
        prisma.organization.findUnique({
          where: { id: orgId },
          select: { name: true, scheduleSettings: true },
        }),
      ]);
      const settings = parseScheduleSettings(org?.scheduleSettings);
      res.json({
        success: true,
        data: {
          active: Boolean(row),
          expires_at: row?.expiresAt?.toISOString() ?? null,
          created_at: row?.createdAt?.toISOString() ?? null,
          // Raw token is never stored — URLs only returned when creating.
          url: null,
          webcal_url: null,
          feeds: null,
          all: null,
          calendars: settings.calendars.map((c) => ({
            id: c.id,
            name: c.name,
            color: c.color,
            kind: c.kind,
            sector: c.sector || null,
          })),
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
      const [issued, org] = await Promise.all([
        withTenantTransaction(orgId, (tx) =>
          issuePublicAccessToken(tx, {
            organizationId: orgId,
            entityType: ENTITY,
            entityId: orgId,
            ttlDays: 365 * 2,
            tokenBytes: 24,
          }),
        ),
        prisma.organization.findUnique({
          where: { id: orgId },
          select: { name: true, scheduleSettings: true },
        }),
      ]);
      const settings = parseScheduleSettings(org?.scheduleSettings);
      const orgName = org?.name || "ObraMate";
      const list = buildFeedList(req, issued.rawToken, settings, orgName);
      res.status(201).json({
        success: true,
        data: {
          active: true,
          expires_at: issued.expiresAt.toISOString(),
          raw_token: issued.rawToken,
          ...list,
          // Keep legacy single-url fields pointing at "all" for older clients.
          url: list.all.url,
          webcal_url: list.all.webcal_url,
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

function meetingBelongsToCalendar(
  settings: ScheduleSettings,
  cal: ScheduleCalendar,
  m: { leadId: string | null; calendarId: string | null },
): boolean {
  const isVisit = Boolean(m.leadId);
  if (cal.kind === "visits") {
    return isVisit && resolveVisitCalendarId(settings) === cal.id;
  }
  if (isVisit) return false;
  if (cal.kind === "meetings") {
    const defaultMeetingsId =
      settings.calendars.find((c) => c.kind === "meetings")?.id || "meetings";
    if (!m.calendarId) return cal.id === defaultMeetingsId;
    return m.calendarId === cal.id;
  }
  if (cal.kind === "custom") {
    return m.calendarId === cal.id;
  }
  return false;
}

async function loadFeedEvents(
  organizationId: string,
  calendarId?: string | null,
): Promise<{ orgName: string; calName: string; events: ScheduleIcsEvent[] }> {
  const now = Date.now();
  const from = new Date(now - FEED_PAST_DAYS * 24 * 60 * 60 * 1000);
  const to = new Date(now + FEED_FUTURE_DAYS * 24 * 60 * 60 * 1000);

  const [org, workOrders, meetings] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, scheduleSettings: true },
    }),
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
        sector: true,
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
        calendarId: true,
        lead: { select: { name: true } },
      },
      orderBy: { scheduledStart: "asc" },
      take: 2000,
    }),
  ]);

  const settings = parseScheduleSettings(org?.scheduleSettings);
  const orgName = org?.name || "ObraMate";
  const filterCal = calendarId
    ? settings.calendars.find((c) => c.id === calendarId) || null
    : null;

  if (calendarId && !filterCal) {
    return { orgName, calName: "Agenda", events: [] };
  }

  const events: ScheduleIcsEvent[] = [];

  const includeJobs = !filterCal || filterCal.kind === "jobs";
  if (includeJobs) {
    for (const wo of workOrders) {
      if (!wo.scheduledStart) continue;
      if (filterCal && resolveJobCalendar(settings, wo.sector).id !== filterCal.id) continue;
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
        status: "CONFIRMED",
      });
    }
  }

  const includeMeetings = !filterCal || filterCal.kind !== "jobs";
  if (includeMeetings) {
    for (const m of meetings) {
      if (filterCal && !meetingBelongsToCalendar(settings, filterCal, m)) continue;
      const isVisit = Boolean(m.leadId);
      const title = isVisit && m.lead?.name ? `Visita: ${m.lead.name}` : m.title;
      const descParts = [
        isVisit ? "Tipo: visita" : "Tipo: reunião",
        m.status ? `Status: ${m.status}` : "",
        m.notes ? String(m.notes).slice(0, 800) : "",
      ].filter(Boolean);
      events.push({
        uid: `meeting-${m.id}@obramate.com`,
        summary: title,
        location: m.location || null,
        description: descParts.join("\n") || undefined,
        start: m.scheduledStart,
        end: m.scheduledEnd,
        status: "CONFIRMED",
      });
    }
  }

  events.sort((a, b) => a.start.getTime() - b.start.getTime());
  const calName = filterCal?.name || "Agenda";
  return { orgName, calName, events };
}

async function serveIcs(
  _req: import("express").Request,
  res: import("express").Response,
  rawToken: string,
  calendarId: string | null,
) {
  if (!rawToken || rawToken.length < 12) {
    res.status(404).type("text/plain").send("Calendário não encontrado.");
    return;
  }
  if (calendarId && !CAL_ID_RE.test(calendarId)) {
    res.status(404).type("text/plain").send("Agenda não encontrada.");
    return;
  }
  const tok = await lookupPublicAccessToken(rawToken);
  if (!tok || tok.entityType !== ENTITY) {
    res.status(404).type("text/plain").send("Calendário não encontrado ou link expirado.");
    return;
  }
  if (tok.entityId !== tok.organizationId) {
    res.status(404).type("text/plain").send("Calendário não encontrado.");
    return;
  }

  const { orgName, calName, events } = await loadFeedEvents(tok.organizationId, calendarId);
  const ics = buildScheduleIcsCalendar(events, {
    name: calendarId ? `${orgName} · ${calName}` : `${orgName} · Agenda`,
  });

  const file = calendarId ? `obramate-${calendarId}.ics` : "obramate-agenda.ics";
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `inline; filename="${file}"`);
  res.setHeader("Cache-Control", "private, max-age=300");
  res.send(ics);
}

// Per-calendar feed (must be registered before the catch-all :token.ics)
scheduleCalendarFeedPublicRouter.get("/:token/:calendarId.ics", async (req, res, next) => {
  try {
    await serveIcs(req, res, String(req.params.token || "").trim(), String(req.params.calendarId || "").trim());
  } catch (error) {
    next(error);
  }
});

scheduleCalendarFeedPublicRouter.get("/:token.ics", async (req, res, next) => {
  try {
    await serveIcs(req, res, String(req.params.token || "").trim(), null);
  } catch (error) {
    next(error);
  }
});
