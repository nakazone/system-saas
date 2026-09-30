import { Router } from "express";
import { param } from "../../lib/http/params.js";
import { z } from "zod";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { storage } from "../../lib/storage/index.js";
import { email } from "../../lib/email/index.js";
import { recordActivity } from "../../lib/activity/record.js";
import {
  lookupPublicAccessToken,
  tokenNeedsLightVerify,
} from "../../lib/quotes/public-token.js";
import { buildQuotePdf, pdfLinesFromDbItems, pdfPaymentItemsFromSchedule } from "../../lib/quotes/pdf.js";
import { documentAddressLine, documentLicenseLine } from "../../lib/settings/organization.js";
import { parseQuoteSettings } from "../../lib/settings/quotes.js";
import { calculateQuoteTotals } from "../../lib/quotes/totals.js";
import { persistQuoteTotals, quoteDetailInclude, recomputeTotalsFromQuote } from "./service.js";
import { applyQuoteTransition } from "./service.js";
import { normalizeQuoteStatus } from "../../lib/quotes/transitions.js";
import { runScheduleTriggers } from "../../lib/payments/engine.js";
import { cancelPendingMessages } from "../../lib/automations/schedule.js";
import { moveLeadForQuoteEvent } from "../../lib/pipeline/move.js";

export const publicQuotesRouter = Router();

async function resolveQuoteFromToken(rawToken: string) {
  const ref = await lookupPublicAccessToken(rawToken);
  if (!ref || ref.entityType !== "quote") return null;
  return ref;
}

async function loadPublicQuote(organizationId: string, quoteId: string, tokenId: string | null) {
  return withTenantTransaction(organizationId, async (tx) => {
    const quote = await tx.quote.findFirst({
      where: { id: quoteId },
      include: {
        ...quoteDetailInclude,
        organization: {
          select: {
            name: true,
            logoUrl: true,
            primaryColor: true,
            accentColor: true,
            contactEmail: true,
            contactPhone: true,
            paymentInstructions: true,
            addressPrivate: true,
            addressLine1: true,
            addressLine2: true,
            city: true,
            state: true,
            postalCode: true,
            showLicenseOnDocuments: true,
            licenseNumber: true,
            licenseState: true,
          },
        },
      },
    });
    if (!quote) return null;

    const now = new Date();
    if (!quote.viewedAt) {
      await tx.quote.update({ where: { id: quote.id }, data: { viewedAt: now } });
    }
    if (tokenId) {
      await tx.publicAccessToken.update({
        where: { id: tokenId },
        data: {
          lastUsedAt: now,
          viewedAt: quote.viewedAt ?? now,
        },
      });
    }
    await recordActivity(tx, {
      organizationId,
      entityType: "quote",
      entityId: quote.id,
      actorType: "customer",
      action: "viewed",
    });

    return quote;
  });
}

function clientViewFlags(raw: unknown) {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    showQuantities: d.showQuantities !== false,
    showUnitPrices: d.showUnitPrices !== false,
    showLineTotals: d.showLineTotals !== false,
    showRoomBreakdown: d.showRoomBreakdown !== false,
  };
}

publicQuotesRouter.get("/quotes/:token", async (req, res, next) => {
  try {
    const token = String(param(req, "token"));
    const ref = await resolveQuoteFromToken(token);
    if (!ref) {
      res.status(404).render("errors/not-found", {
        title: "Quote not found",
        message: "This quote link is invalid, expired, or revoked.",
        organization: null,
      });
      return;
    }

    const tokenRow = ref.tokenId
      ? await prisma.publicAccessToken.findFirst({ where: { id: ref.tokenId } })
      : null;

    const needsVerify =
      tokenRow && tokenNeedsLightVerify(tokenRow.createdAt)
        ? !(
            req.session.publicQuoteVerify?.quoteId === ref.entityId &&
            Date.now() - (req.session.publicQuoteVerify?.verifiedAt ?? 0) < 60 * 60 * 1000
          )
        : false;

    if (needsVerify) {
      res.render("quotes/public-verify", {
        title: "Verify to view quote",
        token,
        error: null,
      });
      return;
    }

    const quote = await loadPublicQuote(ref.organizationId, ref.entityId, ref.tokenId);
    if (!quote) {
      res.status(404).render("errors/not-found", {
        title: "Quote not found",
        message: "This quote link is invalid.",
        organization: null,
      });
      return;
    }

    const status = normalizeQuoteStatus(quote.status);
    const readOnly = !["sent", "changes_requested"].includes(status);

    res.render("quotes/public", {
      title: quote.title,
      organization: quote.organization,
      organizationAddress: documentAddressLine(quote.organization),
      organizationLicense: documentLicenseLine(quote.organization),
      quote,
      token,
      clientView: clientViewFlags(quote.clientView),
      readOnly,
      error: typeof req.query.error === "string" ? req.query.error : null,
      success: typeof req.query.success === "string" ? req.query.success : null,
    });
  } catch (error) {
    next(error);
  }
});

publicQuotesRouter.post("/quotes/:token/verify", async (req, res, next) => {
  try {
    const token = String(param(req, "token"));
    const ref = await resolveQuoteFromToken(token);
    if (!ref) {
      res.status(404).send("Not found");
      return;
    }
    const quote = await withTenantTransaction(ref.organizationId, async (tx) =>
      tx.quote.findFirst({
        where: { id: ref.entityId },
        include: { customer: true },
      }),
    );
    if (!quote?.customer) {
      res.status(404).send("Not found");
      return;
    }
    const emailIn = String(req.body.email || "")
      .trim()
      .toLowerCase();
    const phoneLast4 = String(req.body.phoneLast4 || "").replace(/\D/g, "");
    const okEmail =
      emailIn && quote.customer.email && emailIn === quote.customer.email.toLowerCase();
    const custPhone = (quote.customer.phone || "").replace(/\D/g, "");
    const okPhone = phoneLast4.length === 4 && custPhone.endsWith(phoneLast4);
    if (!okEmail && !okPhone) {
      res.render("quotes/public-verify", {
        title: "Verify to view quote",
        token,
        error: "Verification failed. Try the customer email or last 4 digits of the phone.",
      });
      return;
    }
    req.session.publicQuoteVerify = { quoteId: quote.id, verifiedAt: Date.now() };
    res.redirect(`/public/quotes/${token}`);
  } catch (error) {
    next(error);
  }
});

publicQuotesRouter.post("/quotes/:token/recalculate", async (req, res, next) => {
  try {
    const token = String(param(req, "token"));
    const ref = await resolveQuoteFromToken(token);
    if (!ref) {
      res.status(404).json({ success: false, error: "Not found" });
      return;
    }
    const schema = z.object({
      selectedOptionGroupId: z.string().uuid().optional().nullable(),
      selectedOptionalIds: z.array(z.string().uuid()).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: "Invalid payload" });
      return;
    }

    const totals = await withTenantTransaction(ref.organizationId, async (tx) => {
      const quote = await tx.quote.findFirst({
        where: { id: ref.entityId },
        include: { lineItems: true },
      });
      if (!quote) return null;
      const selectedIds = new Set(parsed.data.selectedOptionalIds ?? []);
      const lines = quote.lineItems.map((li) => ({
        quantity: Number(li.quantity),
        unitPrice: Number(li.unitPrice),
        unitCost: Number(li.unitCost),
        amount: Number(li.amount),
        isOptional: li.isOptional,
        isSelected: li.isOptional ? selectedIds.has(li.id) : li.isSelected,
        optionGroupId: li.optionGroupId,
      }));
      return calculateQuoteTotals({
        lines,
        selectedOptionGroupId:
          parsed.data.selectedOptionGroupId ?? quote.selectedOptionGroupId,
        discountType: (quote.discountType as "percent" | "fixed" | null) ?? null,
        discountValue: Number(quote.discountValue),
        taxRate: Number(quote.taxRate),
      });
    });

    if (!totals) {
      res.status(404).json({ success: false, error: "Not found" });
      return;
    }
    res.json({ success: true, data: totals });
  } catch (error) {
    next(error);
  }
});

publicQuotesRouter.post("/quotes/:token/approve", async (req, res, _next) => {
  try {
    const token = String(param(req, "token"));
    const ref = await resolveQuoteFromToken(token);
    if (!ref) {
      res.status(404).send("Not found");
      return;
    }
    const schema = z.object({
      signedByName: z.string().min(1).max(120),
      signatureDataUrl: z.string().min(32),
      acceptTerms: z.string().optional(),
      selectedOptionGroupId: z.string().uuid().optional().or(z.literal("")),
      selectedOptionalIds: z.union([z.string(), z.array(z.string())]).optional(),
      approvedLat: z.union([z.string(), z.number()]).optional(),
      approvedLng: z.union([z.string(), z.number()]).optional(),
      approvedGpsAccuracyM: z.union([z.string(), z.number()]).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || parsed.data.acceptTerms !== "on") {
      res.redirect(`/public/quotes/${token}?error=invalid`);
      return;
    }

    const selectedOptionalIds = parsed.data.selectedOptionalIds
      ? Array.isArray(parsed.data.selectedOptionalIds)
        ? parsed.data.selectedOptionalIds
        : [parsed.data.selectedOptionalIds]
      : [];

    const match = /^data:([^;]+);base64,(.+)$/.exec(parsed.data.signatureDataUrl);
    if (!match) {
      res.redirect(`/public/quotes/${token}?error=signature`);
      return;
    }
    const contentType = match[1]!;
    const body = Buffer.from(match[2]!, "base64");
    const signedDocumentSha256 = createHash("sha256").update(body).digest("hex");
    const lat =
      parsed.data.approvedLat != null && parsed.data.approvedLat !== ""
        ? Number(parsed.data.approvedLat)
        : null;
    const lng =
      parsed.data.approvedLng != null && parsed.data.approvedLng !== ""
        ? Number(parsed.data.approvedLng)
        : null;
    const gps =
      parsed.data.approvedGpsAccuracyM != null && parsed.data.approvedGpsAccuracyM !== ""
        ? Number(parsed.data.approvedGpsAccuracyM)
        : null;
    const key = `orgs/${ref.organizationId}/quotes/${ref.entityId}/signature-${Date.now()}`;
    const stored = await storage.upload({ key, body, contentType });

    const result = await withTenantTransaction(ref.organizationId, async (tx) => {
      const quote = await tx.quote.findFirst({
        where: { id: ref.entityId },
        include: { lineItems: true, salesperson: true, organization: true, customer: true },
      });
      if (!quote) throw new Error("Quote not found");
      const status = normalizeQuoteStatus(quote.status);
      if (!["sent", "changes_requested"].includes(status)) {
        throw new Error("Quote cannot be approved in its current status");
      }

      const selectedSet = new Set(selectedOptionalIds);
      for (const li of quote.lineItems) {
        if (!li.isOptional) continue;
        await tx.quoteLineItem.update({
          where: { id: li.id },
          data: { isSelected: selectedSet.has(li.id) },
        });
      }

      const selectedGroup =
        parsed.data.selectedOptionGroupId || quote.selectedOptionGroupId || null;
      await tx.quote.update({
        where: { id: quote.id },
        data: { selectedOptionGroupId: selectedGroup },
      });

      const refreshed = await tx.quote.findFirst({
        where: { id: quote.id },
        include: { lineItems: true },
      });
      if (!refreshed) throw new Error("Quote not found");
      const totals = recomputeTotalsFromQuote(refreshed);
      await persistQuoteTotals(tx, quote.id, totals);

      await applyQuoteTransition(tx, {
        organizationId: ref.organizationId,
        quoteId: quote.id,
        event: "approve",
        actorType: "customer",
        note: "Approved via public link",
        extraData: {
          signatureUrl: stored.url,
          signedByName: parsed.data.signedByName,
          signedAt: new Date(),
          approvedIp: req.ip || null,
          approvedUserAgent: req.get("user-agent") || null,
          signedDocumentSha256,
          approvedLat:
            lat != null && Number.isFinite(lat) ? new Prisma.Decimal(lat) : null,
          approvedLng:
            lng != null && Number.isFinite(lng) ? new Prisma.Decimal(lng) : null,
          approvedGpsAccuracyM:
            gps != null && Number.isFinite(gps) ? new Prisma.Decimal(gps) : null,
          changeRequestNote: null,
        },
      });

      await runScheduleTriggers(tx, {
        organizationId: ref.organizationId,
        quoteId: quote.id,
        trigger: "on_approve",
        actorId: null,
      });

      await cancelPendingMessages(tx, {
        entityType: "quote",
        entityId: quote.id,
        triggerKey: "quote_follow_up",
      });

      await moveLeadForQuoteEvent(tx, {
        organizationId: ref.organizationId,
        quoteId: quote.id,
        slug: "won",
        actorType: "system",
      });

      return { quote, totals };
    });

    const notifyTo = [
      result.quote.salesperson?.email,
      result.quote.organization.contactEmail,
    ].filter(Boolean) as string[];
    for (const to of notifyTo) {
      await email.send({
        to,
        subject: `Quote approved: ${result.quote.title}`,
        text: `${parsed.data.signedByName} approved quote #${result.quote.number}. Total: $${result.totals.total.toFixed(2)}`,
      });
    }

    res.redirect(`/public/quotes/${token}?success=approved`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Approval failed";
    res.redirect(`/public/quotes/${param(req, "token")}?error=${encodeURIComponent(message)}`);
  }
});

publicQuotesRouter.post("/quotes/:token/request-changes", async (req, res, _next) => {
  try {
    const token = String(param(req, "token"));
    const note = String(req.body.note || "").trim();
    if (!note) {
      res.redirect(`/public/quotes/${token}?error=${encodeURIComponent("Note required")}`);
      return;
    }
    const ref = await resolveQuoteFromToken(token);
    if (!ref) {
      res.status(404).send("Not found");
      return;
    }

    const quote = await withTenantTransaction(ref.organizationId, async (tx) => {
      const q = await tx.quote.findFirst({
        where: { id: ref.entityId },
        include: { salesperson: true, organization: true },
      });
      if (!q) throw new Error("Quote not found");
      await applyQuoteTransition(tx, {
        organizationId: ref.organizationId,
        quoteId: q.id,
        event: "request_changes",
        actorType: "customer",
        note,
        extraData: { changeRequestNote: note },
      });
      return q;
    });

    const notifyTo = [quote.salesperson?.email, quote.organization.contactEmail].filter(
      Boolean,
    ) as string[];
    for (const to of notifyTo) {
      await email.send({
        to,
        subject: `Changes requested: ${quote.title}`,
        text: `Customer requested changes on quote #${quote.number}:\n\n${note}`,
      });
    }

    res.redirect(`/public/quotes/${token}?success=changes`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    res.redirect(`/public/quotes/${param(req, "token")}?error=${encodeURIComponent(message)}`);
  }
});

publicQuotesRouter.get("/quotes/:token/pdf", async (req, res, next) => {
  try {
    const token = String(param(req, "token"));
    const ref = await resolveQuoteFromToken(token);
    if (!ref) {
      res.status(404).send("Not found");
      return;
    }
    const quote = await withTenantTransaction(ref.organizationId, async (tx) =>
      tx.quote.findFirst({
        where: { id: ref.entityId },
        include: quoteDetailInclude,
      }),
    );
    if (!quote) {
      res.status(404).send("Not found");
      return;
    }
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: ref.organizationId },
    });
    const qs = parseQuoteSettings((org as Record<string, unknown>).quoteSettings);
    const total = Number(quote.total);
    const scheduleItems = pdfPaymentItemsFromSchedule(total, quote.paymentSchedule?.items);
    const publicQuoteUrl = `${req.protocol}://${req.get("host")}/public/quotes/${token}`;
    const pdf = await buildQuotePdf({
      organizationName: org.name,
      organizationContact: [org.contactPhone, org.contactEmail].filter(Boolean).join(" · "),
      organizationAddress: documentAddressLine(org as never),
      organizationLicense: documentLicenseLine(org as never),
      title: quote.title,
      number: quote.quoteNumber || quote.number,
      status: quote.status,
      issueDate: quote.createdAt,
      customerName: quote.customer?.name,
      customerEmail: quote.customer?.email ?? null,
      customerPhone: quote.customer?.phone ?? null,
      projectName: quote.property?.label || quote.title,
      projectAddress: quote.property
        ? [quote.property.line1, quote.property.line2].filter(Boolean).join(", ")
        : null,
      projectCityLine: quote.property
        ? [quote.property.city, quote.property.state, quote.property.postalCode]
            .filter(Boolean)
            .join(", ")
        : null,
      validUntil: quote.validUntil,
      terms: quote.terms,
      clientMessage: quote.clientMessage,
      notes: quote.notes,
      floorAreaSqft: Number(quote.areaSqft) || null,
      rooms: quote.rooms.map((r) => ({ name: r.name, areaSqft: Number(r.areaSqft) })),
      optionGroups: quote.optionGroups.map((g) => ({ id: g.id, name: g.name })),
      selectedOptionGroupId: quote.selectedOptionGroupId,
      lines: pdfLinesFromDbItems(quote.lineItems),
      clientView: quote.clientView as never,
      subtotal: Number(quote.subtotal),
      taxTotal: Number(quote.taxTotal),
      discountType: quote.discountType,
      discountValue: Number(quote.discountValue),
      total,
      depositAmount: scheduleItems[0]?.amount ?? null,
      paymentSchedule: scheduleItems,
      preparedBy: quote.salesperson
        ? { name: quote.salesperson.name, email: quote.salesperson.email }
        : {
            name: qs.owner_signature.name,
            title: qs.owner_signature.title,
            email: org.contactEmail,
          },
      publicQuoteUrl,
      signatureUrl: quote.signatureUrl,
      signedByName: quote.signedByName,
      signedAt: quote.signedAt,
      ownerSignature: {
        name: qs.owner_signature.name,
        title: qs.owner_signature.title,
        imageUrl: qs.owner_signature.image_url,
      },
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="quote-${quote.number}.pdf"`);
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});
