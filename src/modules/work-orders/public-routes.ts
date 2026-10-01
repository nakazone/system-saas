import { Router } from "express";
import { param } from "../../lib/http/params.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { lookupPublicAccessToken } from "../../lib/quotes/public-token.js";
import { prisma } from "../../lib/prisma.js";

import { parseChecklist } from "../../crm/lib/campo-shared.js";
import {
  STAGE_PT,
  formatLongDate,
  formatQuantity,
  formatTicketWhen,
  mapsUrl,
  notesToHtml,
  parseLockbox,
  phoneDigits,
  stripLockbox,
  ticketStatus,
} from "./public-ticket.js";

export const publicJobsRouter = Router();

/** Token links: never indexed, never cached, never leaked through Referer. */
function privateHeaders(res: import("express").Response) {
  res.set("X-Robots-Tag", "noindex, nofollow");
  res.set("Cache-Control", "private, no-store");
  res.set("Referrer-Policy", "no-referrer");
}

function unavailable(res: import("express").Response, reason: "expired" | "gone") {
  privateHeaders(res);
  res.status(404).render("jobs/public-unavailable", { reason });
}

publicJobsRouter.get("/:token", async (req, res, next) => {
  try {
    const rawToken = param(req, "token");
    const ref = /^[A-Za-z0-9_-]{16,64}$/.test(rawToken) ? await lookupPublicAccessToken(rawToken) : null;
    if (!ref || ref.entityType !== "work_order_temp") {
      unavailable(res, "expired");
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
          lineItems: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            include: { pricingItem: { select: { unit: true } } },
          },
          media: {
            where: { deletedAt: null, isPublic: true, type: "photo" },
            orderBy: [{ createdAt: "desc" }],
            take: 60,
            select: {
              id: true,
              url: true,
              thumbUrl: true,
              caption: true,
              stage: true,
              takenAtDevice: true,
              createdAt: true,
            },
          },
          reports: {
            where: { status: "published", isPublic: true },
            orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
            take: 3,
            select: {
              id: true,
              title: true,
              summary: true,
              publishedAt: true,
            },
          },
        },
      });
      if (!workOrder || workOrder.status === "canceled") return null;
      let expiresAt: Date | null = null;
      if (ref.tokenId) {
        const tok = await tx.publicAccessToken.update({
          where: { id: ref.tokenId },
          data: { lastUsedAt: new Date(), viewedAt: new Date() },
          select: { expiresAt: true },
        });
        expiresAt = tok.expiresAt;
      }
      const organization = await prisma.organization.findUnique({
        where: { id: ref.organizationId },
        select: {
          name: true,
          primaryColor: true,
          accentColor: true,
          logoUrl: true,
          contactPhone: true,
          timezone: true,
        },
      });
      return { temp, workOrder, organization, expiresAt };
    });

    if (!data?.workOrder || !data.organization) {
      unavailable(res, "gone");
      return;
    }

    const wo = data.workOrder;
    const org = data.organization;
    const tz = org.timezone;
    const client =
      wo.customer?.name ||
      wo.builder?.company ||
      [wo.builder?.firstName, wo.builder?.lastName].filter(Boolean).join(" ").trim() ||
      wo.sourceName ||
      null;

    const team = [wo.assignedUser?.name, ...wo.members.map((m) => m.user.name)].filter(
      (n, i, arr): n is string => Boolean(n) && arr.indexOf(n!) === i,
    );

    const services = (wo.lineItems || []).map((li) => ({
      name: li.serviceName,
      qty: formatQuantity(Number(li.quantitySqft) || 0, li.pricingItem?.unit),
    }));

    const photos = (wo.media || []).map((m) => ({
      url: m.url,
      thumbUrl: m.thumbUrl || m.url,
      caption: m.caption || null,
      stageLabel: m.stage && STAGE_PT[m.stage] ? STAGE_PT[m.stage] : null,
    }));

    const reports = (wo.reports || []).map((r) => ({
      title: r.title,
      summary: r.summary || "",
      date: r.publishedAt ? formatLongDate(r.publishedAt, tz) : null,
    }));

    // Only a checklist set up for this job; the default template is office boilerplate.
    const hasChecklist = Array.isArray(wo.campoChecklist) && (wo.campoChecklist as unknown[]).length > 0;
    const checklist = hasChecklist
      ? parseChecklist(wo.campoChecklist).map((c) => ({ text: c.text, done: c.done, photo: Boolean(c.photo_required) }))
      : [];

    const notes = stripLockbox(wo.notes);
    const officeDigits = phoneDigits(org.contactPhone);
    const firstName = String(data.temp.name || "").trim().split(/\s+/)[0] || "";

    privateHeaders(res);
    res.render("jobs/public", {
      org: {
        name: org.name,
        logoUrl: org.logoUrl,
        ink: org.primaryColor || "#211d1a",
        accent: org.accentColor || "#e8792c",
        phone: org.contactPhone || null,
        tel: officeDigits ? `tel:+${officeDigits}` : null,
        whatsapp: officeDigits
          ? `https://wa.me/${officeDigits}?text=${encodeURIComponent(
              `Olá, aqui é ${data.temp.name}. Sobre o job #${wo.number ?? ""} (${wo.title}): `,
            )}`
          : null,
      },
      worker: { name: data.temp.name, firstName },
      job: {
        title: wo.title,
        number: wo.number,
        status: ticketStatus(wo.status, wo.fieldStatus),
        client,
        address: wo.address || null,
        mapsUrl: wo.address ? mapsUrl(wo.address) : null,
        when: formatTicketWhen(wo.scheduledStart, wo.scheduledEnd, tz),
        lockbox: parseLockbox(wo.notes),
        attention: (wo.campoAttention || "").trim() || null,
        notesHtml: notes ? notesToHtml(notes) : null,
        checklist,
        checklistDone: checklist.filter((c) => c.done).length,
        services,
        team,
        photos,
        reports,
      },
      validUntil: data.expiresAt ? formatLongDate(data.expiresAt, tz) : null,
    });
  } catch (error) {
    next(error);
  }
});
