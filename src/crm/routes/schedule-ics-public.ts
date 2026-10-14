/**
 * Public one-shot .ics for Apple Calendar (no session cookie).
 *   GET /feeds/lead-visit/:token.ics
 *   GET /feeds/meeting/:token.ics
 */
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import {
  buildLeadVisitIcs,
  buildMeetingCalendarDescription,
  buildMeetingCalendarSummary,
} from "../../lib/schedule/lead-visit-ics.js";
import { buildSingleEventIcs, meetingStatusToIcs } from "../../lib/schedule/ics.js";
import { verifyIcsAccessToken } from "../../lib/schedule/signed-ics-token.js";
import { safeTimeZone } from "../../lib/time/zoned.js";
import { formatUsPhone } from "../../lib/phone.js";

export const scheduleIcsPublicRouter = Router();

function metaStr(meta: Record<string, unknown>, key: string): string | null {
  const v = meta[key];
  return v != null && String(v).trim() ? String(v).trim() : null;
}

scheduleIcsPublicRouter.get("/lead-visit/:token.ics", async (req, res, next) => {
  try {
    const verified = verifyIcsAccessToken(String(req.params.token || "").trim());
    if (!verified || verified.kind !== "lead") {
      res.status(404).type("text/plain").send("Calendário não encontrado ou link expirado.");
      return;
    }
    const packed = await withTenantTransaction(verified.organizationId, async (tx) => {
      const [lead, org] = await Promise.all([
        tx.lead.findFirst({ where: { id: verified.entityId } }),
        tx.organization.findFirst({ select: { timezone: true } }),
      ]);
      return { lead, timezone: org?.timezone ?? null };
    });
    if (!packed.lead) {
      res.status(404).type("text/plain").send("Lead not found");
      return;
    }
    const meta =
      packed.lead.metadata && typeof packed.lead.metadata === "object" && !Array.isArray(packed.lead.metadata)
        ? (packed.lead.metadata as Record<string, unknown>)
        : {};
    const ics = buildLeadVisitIcs(
      {
        id: packed.lead.id,
        name: packed.lead.name,
        phone: formatUsPhone(packed.lead.phone),
        email: packed.lead.email,
        notes: packed.lead.notes,
        source: packed.lead.source,
        address: metaStr(meta, "address"),
        zipcode: metaStr(meta, "zipcode"),
        address_line1: metaStr(meta, "address_line1") || metaStr(meta, "address"),
        address_line2: metaStr(meta, "address_line2"),
        city: metaStr(meta, "city"),
        message: metaStr(meta, "message"),
        form_type: metaStr(meta, "form_type"),
        marketing_platform: metaStr(meta, "marketing_platform"),
        utm_source: metaStr(meta, "utm_source"),
        utm_medium: metaStr(meta, "utm_medium"),
        landing_page: metaStr(meta, "landing_page"),
        gclid: metaStr(meta, "gclid"),
        fbclid: metaStr(meta, "fbclid"),
      },
      { timezone: safeTimeZone(packed.timezone) },
    );
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'inline; filename="visita-lead.ics"');
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(200).send(ics);
  } catch (error) {
    next(error);
  }
});

scheduleIcsPublicRouter.get("/meeting/:token.ics", async (req, res, next) => {
  try {
    const verified = verifyIcsAccessToken(String(req.params.token || "").trim());
    if (!verified || verified.kind !== "meeting") {
      res.status(404).type("text/plain").send("Calendário não encontrado ou link expirado.");
      return;
    }
    const row = await prisma.meeting.findFirst({
      where: { id: verified.entityId, organizationId: verified.organizationId },
      include: {
        lead: { select: { id: true, name: true, phone: true, email: true, notes: true, metadata: true } },
      },
    });
    if (!row) {
      res.status(404).type("text/plain").send("Compromisso não encontrado");
      return;
    }
    const leadMeta =
      row.lead?.metadata && typeof row.lead.metadata === "object" && !Array.isArray(row.lead.metadata)
        ? (row.lead.metadata as Record<string, unknown>)
        : {};
    const leadForCal = row.lead
      ? {
          name: row.lead.name,
          phone: formatUsPhone(row.lead.phone),
          email: row.lead.email,
          notes: row.lead.notes,
          address: metaStr(leadMeta, "address"),
          address_line1: metaStr(leadMeta, "address_line1") || metaStr(leadMeta, "address"),
          address_line2: metaStr(leadMeta, "address_line2"),
          city: metaStr(leadMeta, "city"),
          zipcode: metaStr(leadMeta, "zipcode"),
          message: metaStr(leadMeta, "message"),
          form_type: metaStr(leadMeta, "form_type"),
          marketing_platform: metaStr(leadMeta, "marketing_platform"),
          utm_source: metaStr(leadMeta, "utm_source"),
          utm_medium: metaStr(leadMeta, "utm_medium"),
          landing_page: metaStr(leadMeta, "landing_page"),
          gclid: metaStr(leadMeta, "gclid"),
          fbclid: metaStr(leadMeta, "fbclid"),
        }
      : null;
    const summary = buildMeetingCalendarSummary({
      title: row.title,
      leadName: row.lead?.name,
      isVisit: Boolean(row.leadId),
    });
    const description = buildMeetingCalendarDescription({
      notes: row.notes,
      location: row.location,
      lead: leadForCal,
    });
    const ics = buildSingleEventIcs(
      {
        uid: `meeting-${row.id}@obramate.com`,
        summary,
        description: description || undefined,
        location: row.location || leadForCal?.address_line1 || leadForCal?.address || undefined,
        start: row.scheduledStart,
        end: row.scheduledEnd,
        stamp: row.updatedAt || new Date(),
        status: meetingStatusToIcs(row.status),
      },
      { name: summary || "ObraMate" },
    );
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'inline; filename="meeting.ics"');
    res.setHeader("Cache-Control", "private, max-age=300");
    res.status(200).send(ics);
  } catch (error) {
    next(error);
  }
});
