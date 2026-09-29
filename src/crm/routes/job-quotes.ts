/**
 * Job → customer proposal (Phase 4).
 * Reuses existing Quote + public accept/sign. No payment gateway.
 */
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth, requireCrmPermission, dec } from "../http.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { issuePublicAccessToken } from "../../lib/quotes/public-token.js";
import { applyQuoteTransition, defaultClientViewJson, defaultValidUntil } from "../../modules/quotes/service.js";
import { toDecimal } from "../../lib/quotes/totals.js";
import { mapJobMedia } from "../../lib/job-media/index.js";
import { aiChatJson, isAiConfigured } from "../../lib/ai/client.js";
import { env } from "../../config/env.js";
import { recordActivity } from "../../lib/activity/record.js";
import { syncLeadForQuoteStatus } from "../../lib/pipeline/move.js";
import { prisma } from "../../lib/prisma.js";

export const jobQuotesRouter = Router();

function canPropose(req: AuthedRequest): boolean {
  if (!req.user) return false;
  if (req.user.roleKey === "admin") return true;
  const p = req.user.permissions || [];
  return p.includes("quotes.edit") || p.includes("work_orders.manage");
}

function publicBase(req: AuthedRequest): string {
  const base = (env.APP_BASE_URL || "").replace(/\/$/, "");
  if (base) return base;
  const proto =
    (typeof req.get === "function" && (req.get("x-forwarded-proto") || "").split(",")[0]?.trim()) ||
    req.protocol ||
    "https";
  return `${proto}://${req.get("host") || "localhost"}`;
}

function mapQuoteSummary(q: {
  id: string;
  number: number;
  title: string;
  status: string;
  total: unknown;
  workOrderId?: string | null;
  validUntil?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: q.id,
    number: q.number,
    title: q.title,
    status: q.status,
    total: dec(q.total),
    work_order_id: q.workOrderId || null,
    valid_until: q.validUntil?.toISOString() ?? null,
    created_at: q.createdAt.toISOString(),
    updated_at: q.updatedAt.toISOString(),
    edit_url: `quote-builder.html?id=${q.id}`,
  };
}

async function nextQuoteNumber(tx: Parameters<Parameters<typeof withTenantTransaction>[1]>[0]) {
  const maxNumber = await tx.quote.aggregate({ _max: { number: true } });
  return (maxNumber._max.number ?? 0) + 1;
}

jobQuotesRouter.get(
  "/api/work-orders/:id/quotes",
  requireCrmAuth,
  requireCrmPermission("work_orders.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const jobId = String(req.params.id);
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const wo = await tx.workOrder.findFirst({ where: { id: jobId }, select: { id: true } });
        if (!wo) throw Object.assign(new Error("Job not found"), { status: 404 });
        const rows = await tx.quote.findMany({
          where: { workOrderId: jobId },
          orderBy: [{ createdAt: "desc" }],
          take: 40,
        });
        return rows.map(mapQuoteSummary);
      });
      res.json({ success: true, data });
    } catch (error: unknown) {
      const err = error as { status?: number; message?: string };
      if (err?.status) {
        res.status(err.status).json({ success: false, error: err.message || "Error" });
        return;
      }
      next(error);
    }
  },
);

jobQuotesRouter.post(
  "/api/work-orders/:id/quotes",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canPropose(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const jobId = String(req.params.id);
      const body = z
        .object({
          title: z.string().max(200).optional(),
          include_public_photos: z.boolean().optional(),
          suggest_with_ai: z.boolean().optional(),
          client_message: z.string().max(4000).optional(),
        })
        .safeParse(req.body || {});
      if (!body.success) {
        res.status(400).json({ success: false, error: "Invalid payload" });
        return;
      }

      const prepared = await withTenantTransaction(req.organizationId!, async (tx) => {
        const wo = await tx.workOrder.findFirst({
          where: { id: jobId },
          include: {
            customer: { select: { id: true, name: true, email: true, phone: true } },
            builder: { select: { id: true, firstName: true, lastName: true, company: true } },
            lineItems: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
            media: {
              where: { deletedAt: null, type: "photo" },
              orderBy: [{ createdAt: "desc" }],
              take: 40,
              include: { author: { select: { name: true } } },
            },
          },
        });
        if (!wo) throw Object.assign(new Error("Job not found"), { status: 404 });
        const org = await tx.organization.findFirst({
          where: { id: req.organizationId! },
          select: {
            name: true,
            quoteTaxRate: true,
            quoteValidityDays: true,
            defaultQuoteTerms: true,
            paymentInstructions: true,
            featureFlags: true,
          },
        });
        return { wo, org };
      });

      const { wo, org } = prepared;
      const client =
        wo.customer?.name ||
        wo.builder?.company ||
        [wo.builder?.firstName, wo.builder?.lastName].filter(Boolean).join(" ").trim() ||
        wo.sourceName ||
        "Customer";

      let lines = (wo.lineItems || []).map((li, i) => ({
        description: li.serviceName,
        quantity: dec(li.quantitySqft) || 1,
        unit: "sqft",
        unitPrice: dec(li.unitPrice),
        amount: dec(li.lineTotal) || dec(li.quantitySqft) * dec(li.unitPrice),
        sortOrder: i + 1,
      }));

      if ((!lines.length || body.data.suggest_with_ai) && isAiConfigured()) {
        const photos = (wo.media || []).slice(0, 8).map((m) => mapJobMedia(m));
        const ai = await aiChatJson({
          system: `You suggest flooring job proposal line items for US residential/commercial work.
Return ONLY JSON: { "items": [ { "description": string, "quantity": number, "unit": "sqft"|"each"|"lf", "unit_price": number } ] }
Use realistic USD unit prices. Prefer sqft. Max 8 items.`,
          user: [
            `Job: ${wo.title}`,
            `Client: ${client}`,
            `Address: ${wo.address || "n/a"}`,
            `Existing lines: ${JSON.stringify(lines)}`,
            `Photos: ${photos
              .map((p) => `${p.stage || "general"}: ${p.caption || "no caption"}`)
              .join("; ") || "none"}`,
          ].join("\n"),
          imageUrls: photos
            .map((p) => p.url)
            .filter((u) => u.startsWith("http") || u.startsWith("data:image/"))
            .slice(0, 4),
          timeoutMs: 60_000,
        });
        if (ai.ok) {
          try {
            const parsed = JSON.parse(ai.text) as { items?: unknown };
            if (Array.isArray(parsed.items) && parsed.items.length) {
              const suggested = parsed.items
                .map((it, i) => {
                  if (!it || typeof it !== "object") return null;
                  const row = it as Record<string, unknown>;
                  const description = String(row.description || "").trim();
                  if (!description) return null;
                  const quantity = Number(row.quantity) || 1;
                  const unitPrice = Number(row.unit_price ?? row.unitPrice) || 0;
                  return {
                    description: description.slice(0, 200),
                    quantity,
                    unit: String(row.unit || "sqft").slice(0, 20),
                    unitPrice,
                    amount: Math.round(quantity * unitPrice * 100) / 100,
                    sortOrder: i + 1,
                  };
                })
                .filter(Boolean) as typeof lines;
              if (suggested.length) {
                lines = body.data.suggest_with_ai || !lines.length ? suggested : lines;
              }
            }
          } catch {
            /* keep job lines */
          }
        }
      }

      if (!lines.length) {
        lines = [
          {
            description: wo.title || "Flooring service",
            quantity: 1,
            unit: "each",
            unitPrice: 0,
            amount: 0,
            sortOrder: 1,
          },
        ];
      }

      const areaSqft = lines
        .filter((l) => l.unit === "sqft")
        .reduce((s, l) => s + (Number(l.quantity) || 0), 0);
      const subtotal = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
      const taxRate = Number(org?.quoteTaxRate ?? 0) || 0;
      const taxTotal = Math.round(subtotal * (taxRate / 100) * 100) / 100;
      const total = Math.round((subtotal + taxTotal) * 100) / 100;

      const publicPhotos =
        body.data.include_public_photos === false
          ? []
          : (wo.media || []).filter((m) => m.isPublic).slice(0, 12);
      const photoNote = publicPhotos.length
        ? `\n\nSite photos (${publicPhotos.length}):\n` +
          publicPhotos.map((p, i) => `${i + 1}. ${p.stage || "photo"} — ${p.url}`).join("\n")
        : "";

      const title =
        body.data.title?.trim() ||
        `Proposal for ${client}${wo.number != null ? ` · Job #${wo.number}` : ""}`;

      const saved = await withTenantTransaction(req.organizationId!, async (tx) => {
        const number = await nextQuoteNumber(tx);
        const quote = await tx.quote.create({
          data: {
            organizationId: req.organizationId!,
            number,
            title,
            customerId: wo.customerId,
            builderId: wo.builderId,
            workOrderId: wo.id,
            salespersonId: req.user!.id,
            flooringType: "hardwood",
            areaSqft: toDecimal(areaSqft),
            taxRate: toDecimal(taxRate),
            taxTotal: toDecimal(taxTotal),
            subtotal: toDecimal(subtotal),
            total: toDecimal(total),
            laborCost: toDecimal(subtotal),
            notes: wo.notes || null,
            clientMessage:
              (body.data.client_message?.trim() ||
                `Please review this proposal for the work at ${wo.address || "your property"}.`) +
              photoNote,
            terms: org?.defaultQuoteTerms || null,
            clientView: defaultClientViewJson(),
            validUntil: defaultValidUntil(org?.quoteValidityDays ?? 30),
            status: "draft",
            payload: {
              source: "work_order",
              work_order_id: wo.id,
              photo_ids: publicPhotos.map((p) => p.id),
            } as Prisma.InputJsonValue,
          },
        });

        const group = await tx.quoteOptionGroup.create({
          data: {
            organizationId: req.organizationId!,
            quoteId: quote.id,
            name: "Option A",
            flooringType: "hardwood",
            sortOrder: 1,
          },
        });

        await tx.quote.update({
          where: { id: quote.id },
          data: { selectedOptionGroupId: group.id },
        });

        for (const line of lines) {
          await tx.quoteLineItem.create({
            data: {
              organizationId: req.organizationId!,
              quoteId: quote.id,
              optionGroupId: group.id,
              description: line.description,
              quantity: toDecimal(line.quantity),
              unit: line.unit,
              unitPrice: toDecimal(line.unitPrice),
              amount: toDecimal(line.amount),
              itemType: "service",
              sortOrder: line.sortOrder,
              isSelected: true,
            },
          });
        }

        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "work_order",
          entityId: wo.id,
          action: "job_quote.created",
          actorType: "user",
          actorId: req.user!.id,
          changes: { quote_id: { from: null, to: quote.id } },
        });

        return mapQuoteSummary({ ...quote, workOrderId: wo.id });
      });

      res.json({ success: true, data: saved });
    } catch (error: unknown) {
      const err = error as { status?: number; message?: string };
      if (err?.status) {
        res.status(err.status).json({ success: false, error: err.message || "Error" });
        return;
      }
      next(error);
    }
  },
);

jobQuotesRouter.post(
  "/api/work-orders/:jobId/quotes/:quoteId/send",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canPropose(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const jobId = String(req.params.jobId);
      const quoteId = String(req.params.quoteId);

      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        const quote = await tx.quote.findFirst({
          where: { id: quoteId, workOrderId: jobId },
          include: { customer: true, organization: true },
        });
        if (!quote) throw Object.assign(new Error("Proposal not found"), { status: 404 });

        await applyQuoteTransition(tx, {
          organizationId: req.organizationId!,
          quoteId: quote.id,
          event: quote.status === "changes_requested" ? "resend" : "send",
          actorType: "user",
          actorId: req.user!.id,
        });
        await syncLeadForQuoteStatus(tx, {
          organizationId: req.organizationId!,
          quoteId: quote.id,
          previousStatus: quote.status,
          nextStatus: "sent",
          actorId: req.user!.id,
        });

        const issued = await issuePublicAccessToken(tx, {
          organizationId: req.organizationId!,
          entityType: "quote",
          entityId: quote.id,
        });

        await tx.quote.update({
          where: { id: quote.id },
          data: { publicToken: null },
        });

        return { quote, issued };
      });

      const link = `${publicBase(req)}/public/quotes/${result.issued.rawToken}`;
      res.json({
        success: true,
        data: {
          ...mapQuoteSummary({ ...result.quote, workOrderId: jobId }),
          status: "sent",
          public_url: link,
          whatsapp_url: result.quote.customer?.phone
            ? `https://wa.me/${String(result.quote.customer.phone).replace(/\D/g, "").replace(/^(\d{10})$/, "1$1")}?text=${encodeURIComponent(`Please review and sign your proposal:\n${link}`)}`
            : null,
          sms_url: result.quote.customer?.phone
            ? `sms:${result.quote.customer.phone}?body=${encodeURIComponent(`Please review and sign your proposal: ${link}`)}`
            : null,
        },
      });
    } catch (error: unknown) {
      const err = error as { status?: number; message?: string };
      if (err?.status) {
        res.status(err.status).json({ success: false, error: err.message || "Error" });
        return;
      }
      next(error);
    }
  },
);

jobQuotesRouter.get(
  "/api/work-orders/:id/portfolio-preview",
  requireCrmAuth,
  requireCrmPermission("work_orders.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const jobId = String(req.params.id);
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const wo = await tx.workOrder.findFirst({
          where: { id: jobId },
          include: {
            customer: { select: { name: true } },
            builder: { select: { company: true, firstName: true, lastName: true } },
            media: {
              where: {
                deletedAt: null,
                type: "photo",
                OR: [{ stage: "before" }, { stage: "after" }, { isPublic: true }],
              },
              orderBy: [{ createdAt: "asc" }],
              take: 40,
              include: { author: { select: { name: true } } },
            },
          },
        });
        if (!wo) throw Object.assign(new Error("Job not found"), { status: 404 });
        const photos = (wo.media || []).map(mapJobMedia);
        const before = photos.filter((p) => p.stage === "before");
        const after = photos.filter((p) => p.stage === "after");
        const client =
          wo.customer?.name ||
          wo.builder?.company ||
          [wo.builder?.firstName, wo.builder?.lastName].filter(Boolean).join(" ").trim() ||
          "Customer";
        const caption = [
          `Before & after — ${wo.title}`,
          client ? `Client: ${client}` : null,
          wo.address ? `Location: ${wo.address}` : null,
          before.length || after.length
            ? `${before.length} before · ${after.length} after`
            : `${photos.length} site photo(s)`,
          "Completed with ObraMate field photo proof.",
        ]
          .filter(Boolean)
          .join("\n");
        return {
          job_id: wo.id,
          title: wo.title,
          client,
          address: wo.address,
          before,
          after,
          photos,
          social_caption: caption,
          export: {
            before_urls: before.map((p) => p.url),
            after_urls: after.map((p) => p.url),
          },
        };
      });
      res.json({ success: true, data });
    } catch (error: unknown) {
      const err = error as { status?: number; message?: string };
      if (err?.status) {
        res.status(err.status).json({ success: false, error: err.message || "Error" });
        return;
      }
      next(error);
    }
  },
);

jobQuotesRouter.get(
  "/api/work-orders/:id/review-request",
  requireCrmAuth,
  requireCrmPermission("work_orders.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const jobId = String(req.params.id);
      const org = await prisma.organization.findFirst({
        where: { id: req.organizationId! },
        select: { name: true, featureFlags: true },
      });
      const flags =
        org?.featureFlags && typeof org.featureFlags === "object" && !Array.isArray(org.featureFlags)
          ? (org.featureFlags as Record<string, unknown>)
          : {};
      const reviewUrl = String(flags.google_review_url || flags.googleReviewUrl || "").trim() || null;

      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const wo = await tx.workOrder.findFirst({
          where: { id: jobId },
          include: {
            customer: { select: { name: true, phone: true, email: true } },
          },
        });
        if (!wo) throw Object.assign(new Error("Job not found"), { status: 404 });
        const name = wo.customer?.name?.split(/\s+/)[0] || "there";
        const orgName = org?.name || "our team";
        const message = reviewUrl
          ? `Hi ${name}, thanks for choosing ${orgName}! If you were happy with the work at ${wo.address || "your home"}, would you leave us a quick Google review?\n${reviewUrl}`
          : `Hi ${name}, thanks for choosing ${orgName}! If you were happy with the work at ${wo.address || "your home"}, we'd love a quick Google review — reply and we'll send the link.`;
        const phone = wo.customer?.phone || "";
        const digits = phone.replace(/\D/g, "");
        const e164 = digits.length === 10 ? `1${digits}` : digits;
        return {
          customer_name: wo.customer?.name || null,
          customer_email: wo.customer?.email || null,
          customer_phone: phone || null,
          google_review_url: reviewUrl,
          message,
          whatsapp_url: e164
            ? `https://wa.me/${e164}?text=${encodeURIComponent(message)}`
            : null,
          sms_url: phone
            ? `sms:${phone}?body=${encodeURIComponent(message)}`
            : null,
          mailto_url: wo.customer?.email
            ? `mailto:${wo.customer.email}?subject=${encodeURIComponent(`Thanks from ${orgName}`)}&body=${encodeURIComponent(message)}`
            : null,
        };
      });
      res.json({ success: true, data });
    } catch (error: unknown) {
      const err = error as { status?: number; message?: string };
      if (err?.status) {
        res.status(err.status).json({ success: false, error: err.message || "Error" });
        return;
      }
      next(error);
    }
  },
);
