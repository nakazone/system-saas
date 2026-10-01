import { Router } from "express";
import { param } from "../../lib/http/params.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { lookupPublicAccessToken } from "../../lib/quotes/public-token.js";
import { prisma } from "../../lib/prisma.js";

import { randomUUID } from "node:crypto";
import { parseChecklist } from "../../crm/lib/campo-shared.js";
import {
  TEMP_DEVICE_PREFIX,
  isJobMediaEnabled,
  parsePhotoUploadMeta,
  sha256Buffer,
} from "../../lib/job-media/index.js";
import { storage } from "../../lib/storage/index.js";
import { recordActivity } from "../../lib/activity/record.js";
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

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
/** Per temporary worker, rolling 24h — a ticket link is not an unlimited upload bucket. */
const TEMP_PHOTOS_PER_DAY = 120;
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

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
    const ref = TOKEN_RE.test(rawToken) ? await lookupPublicAccessToken(rawToken) : null;
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
            // The worker is part of the crew: every job photo, not only the ones shared with the client.
            where: { deletedAt: null, type: "photo" },
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
          featureFlags: true,
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
      notes: li.notes || null,
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
      defaultStage: wo.status === "in_progress" || wo.fieldStatus === "on_site" ? "during" : "before",
      canUpload: isJobMediaEnabled(org.featureFlags) && wo.status !== "completed",
      uploadUrl: `${req.baseUrl}/${encodeURIComponent(rawToken)}/photos`,
    });
  } catch (error) {
    next(error);
  }
});

function parseDataUrl(dataUrl: string): { contentType: string; body: Buffer } | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) return null;
  return { contentType: match[1]!.toLowerCase(), body: Buffer.from(match[2]!, "base64") };
}

/**
 * Temporary worker adds a photo from the ticket. Lands in the same JobMedia table as
 * Campo/office uploads, so it shows up in ObraCam and on the job page right away.
 */
publicJobsRouter.post("/:token/photos", async (req, res, next) => {
  try {
    privateHeaders(res);
    const rawToken = param(req, "token");
    const ref = TOKEN_RE.test(rawToken) ? await lookupPublicAccessToken(rawToken) : null;
    if (!ref || ref.entityType !== "work_order_temp") {
      res.status(404).json({ success: false, error: "Link não está mais ativo" });
      return;
    }
    const raw = (req.body || {}) as Record<string, unknown>;
    const parsed = parseDataUrl(String(raw.data_url || ""));
    if (!parsed || !/^image\/(jpeg|jpg|png|webp)$/.test(parsed.contentType)) {
      res.status(400).json({ success: false, error: "Envie uma foto (JPG ou PNG)." });
      return;
    }
    if (parsed.body.length > MAX_PHOTO_BYTES) {
      res.status(400).json({ success: false, error: "Foto muito grande (máx. 12 MB)." });
      return;
    }
    const org = await prisma.organization.findUnique({
      where: { id: ref.organizationId },
      select: { featureFlags: true },
    });
    if (!isJobMediaEnabled(org?.featureFlags)) {
      res.status(403).json({ success: false, error: "Fotos desativadas para esta empresa." });
      return;
    }
    const meta = parsePhotoUploadMeta(raw);

    const ctx = await withTenantTransaction(ref.organizationId, async (tx) => {
      const temp = await tx.workOrderTempWorker.findFirst({ where: { id: ref.entityId } });
      if (!temp) return null;
      const wo = await tx.workOrder.findFirst({
        where: { id: temp.workOrderId, status: { notIn: ["canceled", "completed"] } },
        select: { id: true, address: true },
      });
      if (!wo) return null;
      const deviceLabel = `${TEMP_DEVICE_PREFIX}${temp.name}`.slice(0, 120);
      // Retry of the same photo (flaky signal) → same row, no duplicate.
      const clientUploadId = meta.clientUploadId ? `tmp-${temp.id.slice(0, 8)}-${meta.clientUploadId}`.slice(0, 80) : null;
      if (clientUploadId) {
        const dup = await tx.jobMedia.findFirst({
          where: { clientUploadId, workOrderId: wo.id, deletedAt: null },
          select: { id: true, url: true, thumbUrl: true, stage: true },
        });
        if (dup) return { temp, wo, deviceLabel, clientUploadId, dup };
      }
      const recent = await tx.jobMedia.count({
        where: { workOrderId: wo.id, deviceLabel, createdAt: { gt: new Date(Date.now() - 86_400_000) } },
      });
      if (recent >= TEMP_PHOTOS_PER_DAY) throw Object.assign(new Error("Limite de fotos de hoje atingido."), { status: 429 });
      return { temp, wo, deviceLabel, clientUploadId, dup: null };
    });
    if (!ctx) {
      res.status(404).json({ success: false, error: "Este job não aceita mais fotos." });
      return;
    }
    if (ctx.dup) {
      res.json({ success: true, data: { id: ctx.dup.id, url: ctx.dup.url, thumb_url: ctx.dup.thumbUrl || ctx.dup.url, stage: ctx.dup.stage }, deduped: true });
      return;
    }

    const ext = parsed.contentType.includes("png") ? "png" : parsed.contentType.includes("webp") ? "webp" : "jpg";
    const stored = await storage.upload({
      key: `orgs/${ref.organizationId}/jobs/${ctx.wo.id}/${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`,
      body: parsed.body,
      contentType: parsed.contentType === "image/jpg" ? "image/jpeg" : parsed.contentType,
    });
    const row = await withTenantTransaction(ref.organizationId, async (tx) => {
      const created = await tx.jobMedia.create({
        data: {
          organizationId: ref.organizationId,
          workOrderId: ctx.wo.id,
          authorId: null,
          type: "photo",
          storageKey: stored.key,
          url: stored.url,
          thumbUrl: stored.url,
          sha256: sha256Buffer(parsed.body),
          takenAtDevice: meta.takenAtDevice,
          receivedAtServer: new Date(),
          address: ctx.wo.address || null,
          caption: meta.caption,
          stage: meta.stage,
          isPublic: false,
          clientUploadId: ctx.clientUploadId,
          deviceLabel: ctx.deviceLabel,
        },
      });
      await recordActivity(tx, {
        organizationId: ref.organizationId,
        entityType: "work_order",
        entityId: ctx.wo.id,
        action: "job_media.created",
        actorType: "system",
        actorId: null,
        changes: { by: { from: null, to: ctx.deviceLabel }, stage: { from: null, to: meta.stage } },
      });
      return created;
    });
    res.status(201).json({
      success: true,
      data: { id: row.id, url: row.url, thumb_url: row.thumbUrl || row.url, stage: row.stage },
    });
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    if (err?.status) {
      res.status(err.status).json({ success: false, error: err.message || "Erro" });
      return;
    }
    next(error);
  }
});
