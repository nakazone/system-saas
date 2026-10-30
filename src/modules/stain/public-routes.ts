/** Samples de stain — the client's link: /public/stain/:token (no login, English). */
import { Router, type Response } from "express";
import { param } from "../../lib/http/params.js";
import { prisma } from "../../lib/prisma.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { lookupPublicAccessToken } from "../../lib/quotes/public-token.js";
import { storage } from "../../lib/storage/index.js";
import { imageThumbnail, thumbWidthOf } from "../../lib/jobs/partner-messages.js";
import { approvalTerms, sampleDisplayName, sampleSubText } from "../../lib/stain/catalog.js";
import { allMediaIds, mediaIdsOf } from "../../lib/stain/service.js";
import {
  STAIN_TOKEN_TYPE, StainError, approvalPdf, approveRound, markViewed, publicStainUrl, requestAnotherSample, signedAtText,
} from "../../lib/stain/flow.js";
import { renderStainPage } from "../../lib/stain/public-page.js";

export const publicStainRouter = Router();

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

function privateHeaders(res: Response) {
  res.set("X-Robots-Tag", "noindex, nofollow");
  res.set("Cache-Control", "private, no-store");
  res.set("Referrer-Policy", "no-referrer");
}

async function resolve(rawToken: string) {
  if (!TOKEN_RE.test(rawToken)) return null;
  const ref = await lookupPublicAccessToken(rawToken);
  if (!ref || ref.entityType !== STAIN_TOKEN_TYPE) return null;
  return ref;
}

function gone(res: Response) {
  privateHeaders(res);
  res.status(404).type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link not available</title></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:60px auto;padding:0 20px;color:#221E1A"><h1 style="font-size:24px">This link is not available</h1>
<p style="color:#475467;line-height:1.5">It may have expired or been replaced by a newer link. Please contact the company that sent it.</p></body></html>`);
}

function initials(name: string): string {
  return name.replace(/^the\s+/i, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "•";
}

publicStainRouter.get("/:token", async (req, res, next) => {
  try {
    const token = String(param(req, "token"));
    const ref = await resolve(token);
    if (!ref) { gone(res); return; }
    const org = await prisma.organization.findUnique({
      where: { id: ref.organizationId },
      select: { name: true, contactPhone: true, contactEmail: true, accentColor: true, timezone: true },
    });
    const data = await withTenantTransaction(ref.organizationId, async (tx) => {
      const round = await tx.stainSampleRound.findFirst({
        where: { id: ref.entityId, organizationId: ref.organizationId },
        include: {
          samples: { orderBy: { number: "asc" } },
          approvals: { orderBy: { createdAt: "desc" } },
          workOrder: { select: { number: true, address: true, status: true, customer: { select: { name: true } } } },
        },
      });
      if (!round || round.workOrder.status === "canceled") return null;
      if (round.status === "sent") await markViewed(tx, round.id);
      return round;
    });
    if (!data) { gone(res); return; }
    const photo = (id: string) => `/public/stain/${token}/photo/${id}`;
    const company = { name: org?.name || "Your flooring company", initials: initials(org?.name || ""), phone: org?.contactPhone, email: org?.contactEmail, accent: org?.accentColor };
    let state: "open" | "approved" | "another" | "closed" = "open";
    if (data.status === "approved") state = "approved";
    else if (data.status === "changes_requested") state = "another";
    else if (!["sent", "viewed"].includes(data.status)) state = "closed";
    const approval = data.approvals.find((a) => a.decision === "approved");
    const approvedSample = approval ? data.samples.find((s) => s.id === approval.sampleId) : null;
    const err = typeof req.query.error === "string" ? req.query.error.slice(0, 200) : null;
    privateHeaders(res);
    res.type("html").send(renderStainPage({
      token,
      company,
      jobNumber: data.workOrder.number,
      address: data.workOrder.address,
      woodSpecies: data.woodSpecies,
      sampledOn: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(data.createdAt),
      board: data.boardMediaId ? photo(data.boardMediaId) : null,
      samples: data.samples.map((s) => ({ id: s.id, number: s.number, name: sampleDisplayName(s), sub: sampleSubText(s, "en"), photos: mediaIdsOf(s.mediaIds).map(photo) })),
      terms: approvalTerms(company.name),
      state,
      approved: state === "approved" && approval && approvedSample ? {
        name: sampleDisplayName(approvedSample),
        sub: sampleSubText(approvedSample, "en"),
        number: approvedSample.number,
        photo: mediaIdsOf(approvedSample.mediaIds)[0] ? `${photo(mediaIdsOf(approvedSample.mediaIds)[0]!)}?w=300` : null,
        signer: approval.signerName || "Client",
        when: signedAtText(approval.createdAt, org?.timezone),
      } : null,
      error: err,
      signerDefault: data.recipientName || data.workOrder.customer?.name || null,
    }));
  } catch (error) {
    next(error);
  }
});

/** A photo of this round (only photos that belong to its samples or board). */
publicStainRouter.get("/:token/photo/:mediaId", async (req, res, next) => {
  try {
    const token = String(param(req, "token"));
    const ref = await resolve(token);
    if (!ref) { res.status(404).end(); return; }
    const mediaId = String(param(req, "mediaId"));
    const media = await withTenantTransaction(ref.organizationId, async (tx) => {
      const round = await tx.stainSampleRound.findFirst({ where: { id: ref.entityId, organizationId: ref.organizationId }, include: { samples: { select: { mediaIds: true } } } });
      if (!round || !allMediaIds([round]).includes(mediaId)) return null;
      return tx.jobMedia.findFirst({ where: { id: mediaId, organizationId: ref.organizationId, deletedAt: null }, select: { storageKey: true } });
    });
    const stream = media ? await storage.getStream(media.storageKey) : null;
    if (!stream) { res.status(404).end(); return; }
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    const w = thumbWidthOf(req.query.w);
    if (w) {
      const small = await imageThumbnail(stream, w).catch(() => null);
      if (small) { res.type("image/webp").end(small); return; }
      const again = await storage.getStream(media!.storageKey);
      if (!again) { res.status(404).end(); return; }
      again.on("error", next);
      again.pipe(res);
      return;
    }
    stream.on("error", next);
    stream.pipe(res);
  } catch (error) {
    next(error);
  }
});

publicStainRouter.post("/:token/approve", async (req, res) => {
  const token = String(param(req, "token"));
  try {
    const ref = await resolve(token);
    if (!ref) { gone(res); return; }
    const body = (req.body || {}) as Record<string, unknown>;
    if (body.accept_terms !== "on") throw new StainError("Please check the box to agree before approving.");
    await approveRound({
      organizationId: ref.organizationId,
      roundId: ref.entityId,
      sampleId: String(body.sample_id || ""),
      signerName: String(body.signer_name || ""),
      signatureDataUrl: String(body.signature_data_url || ""),
      ip: req.ip || null,
      userAgent: req.get("user-agent") || null,
      pageUrl: publicStainUrl(`${req.protocol}://${req.get("host")}`, token),
    });
    res.redirect(303, `/public/stain/${token}`);
  } catch (error) {
    const message = error instanceof StainError ? error.message : "Something went wrong. Please try again.";
    if (!(error instanceof StainError)) console.error("[stain] approve", error);
    res.redirect(303, `/public/stain/${token}?error=${encodeURIComponent(message)}`);
  }
});

publicStainRouter.post("/:token/another", async (req, res) => {
  const token = String(param(req, "token"));
  try {
    const ref = await resolve(token);
    if (!ref) { gone(res); return; }
    await requestAnotherSample({
      organizationId: ref.organizationId,
      roundId: ref.entityId,
      comment: String((req.body || {}).comment || ""),
      ip: req.ip || null,
      userAgent: req.get("user-agent") || null,
    });
    res.redirect(303, `/public/stain/${token}`);
  } catch (error) {
    const message = error instanceof StainError ? error.message : "Something went wrong. Please try again.";
    if (!(error instanceof StainError)) console.error("[stain] another", error);
    res.redirect(303, `/public/stain/${token}?error=${encodeURIComponent(message)}`);
  }
});

publicStainRouter.get("/:token/pdf", async (req, res, next) => {
  try {
    const token = String(param(req, "token"));
    const ref = await resolve(token);
    if (!ref) { gone(res); return; }
    const approval = await withTenantTransaction(ref.organizationId, (tx) => tx.stainApproval.findFirst({
      where: { organizationId: ref.organizationId, roundId: ref.entityId, decision: "approved" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }));
    if (!approval) { gone(res); return; }
    const pdf = await approvalPdf(ref.organizationId, approval.id);
    privateHeaders(res);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'inline; filename="stain-approval.pdf"');
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});
