/**
 * Samples de stain — sending a round to the client, the client's answer (signed approval or
 * "another sample"), the PDF, and telling the office and the builder.
 */
import { prisma } from "../prisma.js";
import { withTenantTransaction, type TenantPrisma } from "../tenant/prisma-tenant.js";
import { issuePublicAccessToken } from "../quotes/public-token.js";
import { storage } from "../storage/index.js";
import { readStoredObject, storageKeyFromAnyUrl } from "../storage/resolve.js";
import { email } from "../email/index.js";
import { publishAppNotification } from "../notifications/publish.js";
import { recordActivity } from "../activity/record.js";
import { postMessage } from "../jobs/partner-messages.js";
import { safeTimeZone } from "../time/zoned.js";
import { formatPersonName } from "../name.js";
import { approvalTerms, sampleDisplayName, sampleSubText } from "./catalog.js";
import { mediaIdsOf } from "./service.js";
import { buildStainPdf, pdfImage } from "./pdf.js";
import { stainApprovedEmail, stainRequestEmail } from "./email.js";

export const STAIN_TOKEN_TYPE = "stain_round";
export const STAIN_LINK_DAYS = 14;
/** Rounds the client can still answer. */
export const OPEN_STATUSES = new Set(["sent", "viewed"]);

export class StainError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function signedAtText(d: Date, timezone: string | null | undefined): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone(timezone),
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(d);
}

export function publicStainUrl(origin: string, rawToken: string): string {
  return `${origin.replace(/\/+$/, "")}/public/stain/${rawToken}`;
}

async function orgInfo(organizationId: string) {
  return prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, logoUrl: true, accentColor: true, primaryColor: true, contactPhone: true, contactEmail: true, timezone: true },
  });
}

/**
 * Opens the round to the client: a 14-day link (a new link replaces the old one) and, with an e-mail,
 * the "Choose your stain color" message. Returns the link.
 */
export async function sendRound(params: {
  organizationId: string;
  roundId: string;
  origin: string;
  emailTo?: string | null;
  /** "Cliente aprova agora": only the link, no e-mail */
  linkOnly?: boolean;
  actorId: string;
}): Promise<{ url: string; emailed: boolean }> {
  const { organizationId, roundId } = params;
  const prepared = await withTenantTransaction(organizationId, async (tx) => {
    const round = await tx.stainSampleRound.findFirst({
      where: { id: roundId, organizationId },
      include: { samples: true, workOrder: { select: { id: true, status: true, customer: { select: { name: true } } } } },
    });
    if (!round) throw new StainError("Rodada não encontrada.", 404);
    if (round.workOrder.status === "canceled") throw new StainError("O job está cancelado.");
    if (!["draft", "sent", "viewed"].includes(round.status)) throw new StainError("Esta rodada já foi respondida pela cliente.");
    if (round.samples.length === 0) throw new StainError("Adicione pelo menos um sample.");
    const missing = round.samples.filter((s) => mediaIdsOf(s.mediaIds).length === 0).map((s) => `#${s.number}`);
    if (missing.length) throw new StainError(`Falta a foto do sample ${missing.join(", ")}.`);
    const token = await issuePublicAccessToken(tx, {
      organizationId, entityType: STAIN_TOKEN_TYPE, entityId: round.id, ttlDays: STAIN_LINK_DAYS, tokenBytes: 24,
    });
    const to = params.linkOnly ? null : (params.emailTo ?? round.recipientEmail ?? "").trim() || null;
    await tx.stainSampleRound.update({
      where: { id: round.id },
      data: { status: round.status === "draft" ? "sent" : round.status, sentAt: new Date(), ...(to ? { recipientEmail: to } : {}) },
    });
    await recordActivity(tx, {
      organizationId, entityType: "work_order", entityId: round.workOrderId, action: "stain.round_sent",
      actorType: "user", actorId: params.actorId,
      changes: { stain_round: { from: null, to: round.number }, email: { from: null, to } },
    });
    return { token, to, count: round.samples.length, wood: round.woodSpecies, client: round.recipientName || round.workOrder.customer?.name || null };
  });
  const url = publicStainUrl(params.origin, prepared.token.rawToken);
  let emailed = false;
  if (prepared.to) {
    const org = await orgInfo(organizationId);
    const msg = stainRequestEmail({
      companyName: org?.name || "Your flooring company",
      clientName: prepared.client,
      sampleCount: prepared.count,
      woodSpecies: prepared.wood,
      url,
      phone: org?.contactPhone,
      accentColor: org?.accentColor,
    });
    await email.send({
      to: prepared.to, subject: msg.subject, text: msg.text, html: msg.html,
      replyTo: org?.contactEmail || undefined,
      meta: { category: "company", template: "stain_request", organizationId },
    });
    emailed = true;
  }
  return { url, emailed };
}

/** Marks the round as seen by the client the first time the page opens. */
export async function markViewed(tx: TenantPrisma, roundId: string): Promise<void> {
  await tx.stainSampleRound.updateMany({ where: { id: roundId, status: "sent" }, data: { status: "viewed", viewedAt: new Date() } });
}

function decodeSignature(dataUrl: string): { contentType: string; body: Buffer } {
  const m = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(dataUrl || "");
  if (!m) throw new StainError("Please sign in the box before approving.");
  const body = Buffer.from(m[2]!, "base64");
  if (body.length < 200 || body.length > 2 * 1024 * 1024) throw new StainError("Please sign in the box before approving.");
  return { contentType: m[1]!, body };
}

/** The client picked a sample and signed. */
export async function approveRound(params: {
  organizationId: string;
  roundId: string;
  sampleId: string;
  signerName: string;
  signatureDataUrl: string;
  ip: string | null;
  userAgent: string | null;
  /** the client's page (shown again with the confirmation) */
  pageUrl: string;
}): Promise<{ approvalId: string }> {
  const { organizationId, roundId } = params;
  const signerName = formatPersonName(params.signerName.trim()).slice(0, 120);
  if (!signerName) throw new StainError("Please type your full name.");
  const sig = decodeSignature(params.signatureDataUrl);
  const org = await orgInfo(organizationId);
  const terms = approvalTerms(org?.name || "");

  const head = await withTenantTransaction(organizationId, (tx) => tx.stainSampleRound.findFirst({
    where: { id: roundId, organizationId }, select: { workOrderId: true },
  }));
  if (!head) throw new StainError("This link is no longer valid.", 404);
  const sigStored = await storage.upload({
    key: `orgs/${organizationId}/jobs/${head.workOrderId}/stain/signature-${Date.now()}.${sig.contentType === "image/png" ? "png" : "jpg"}`,
    body: sig.body,
    contentType: sig.contentType,
  });

  const result = await withTenantTransaction(organizationId, async (tx) => {
    // one answer per round, even with two taps or two devices
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`stain:${roundId}`}))`;
    const round = await tx.stainSampleRound.findFirst({
      where: { id: roundId, organizationId },
      include: { samples: true, workOrder: { select: { id: true, number: true, title: true, builderId: true, status: true, approvedStainSampleId: true } } },
    });
    if (!round) throw new StainError("This link is no longer valid.", 404);
    if (!OPEN_STATUSES.has(round.status)) throw new StainError("This color choice was already answered.", 409);
    if (round.workOrder.status === "canceled") throw new StainError("This job was canceled.", 409);
    const sample = round.samples.find((s) => s.id === params.sampleId);
    if (!sample) throw new StainError("Please choose one of the samples.");

    const approval = await tx.stainApproval.create({
      data: {
        organizationId, roundId: round.id, workOrderId: round.workOrderId, sampleId: sample.id, decision: "approved",
        signerName, signatureKey: sigStored.key, termsText: terms,
        ip: params.ip?.slice(0, 80) || null, userAgent: params.userAgent?.slice(0, 400) || null,
      },
    });
    const now = new Date();
    await tx.stainSampleRound.update({ where: { id: round.id }, data: { status: "approved", decidedAt: now, recipientName: round.recipientName || signerName } });
    // an earlier approved round is replaced by this one
    await tx.stainSampleRound.updateMany({
      where: { organizationId, workOrderId: round.workOrderId, id: { not: round.id }, status: "approved" },
      data: { status: "superseded" },
    });
    await tx.workOrder.update({ where: { id: round.workOrderId }, data: { approvedStainSampleId: sample.id } });
    // the builder sees the sample photos in the job
    if (round.workOrder.builderId && round.sendToBuilder) {
      const ids = [...new Set([...round.samples.flatMap((s) => mediaIdsOf(s.mediaIds)), ...(round.boardMediaId ? [round.boardMediaId] : [])])];
      if (ids.length) await tx.jobMedia.updateMany({ where: { organizationId, id: { in: ids } }, data: { sharedWithPartners: true } });
    }
    await recordActivity(tx, {
      organizationId, entityType: "work_order", entityId: round.workOrderId, action: "stain.approved", actorType: "customer",
      changes: { stain_color: { from: round.workOrder.approvedStainSampleId, to: sampleDisplayName(sample) }, signed_by: { from: null, to: signerName } },
    });
    return { approvalId: approval.id, job: round.workOrder, sample, round };
  });

  // after the signature is saved: PDF, e-mails, office and builder. A failure here never undoes the approval.
  let pdf: Buffer | null = null;
  try {
    pdf = await renderApprovalPdf(organizationId, result.approvalId);
  } catch (error) {
    console.error("[stain] pdf", error);
  }
  const colorName = sampleDisplayName(result.sample);
  const when = signedAtText(new Date(), org?.timezone);
  if (result.round.recipientEmail) {
    try {
      const msg = stainApprovedEmail({
        companyName: org?.name || "Your flooring company", clientName: signerName, colorName, signedAtText: when,
        url: params.pageUrl, phone: org?.contactPhone, accentColor: org?.accentColor,
      });
      await email.send({
        to: result.round.recipientEmail, subject: msg.subject, text: msg.text, html: msg.html,
        replyTo: org?.contactEmail || undefined,
        attachments: pdf ? [{ filename: `stain-approval-job-${result.job.number ?? ""}.pdf`.replace("-.pdf", ".pdf"), content: pdf }] : undefined,
        meta: { category: "company", template: "stain_approved", organizationId },
      });
    } catch (error) {
      console.error("[stain] client email", error);
    }
  }
  void publishAppNotification({
    organizationId,
    type: "stain.approved",
    title: `Stain aprovado · Job #${result.job.number ?? ""}`,
    body: `${signerName} aprovou e assinou ${colorName}.`,
    url: `job-detail.html?id=${result.job.id}#stain`,
    dedupeKey: `stain-approved:${result.approvalId}`,
  }).catch(() => undefined);
  if (result.job.builderId && result.round.sendToBuilder) {
    await sendApprovalToBuilder(organizationId, result.round.id).catch((error) => console.error("[stain] builder", error));
  }
  return { approvalId: result.approvalId };
}

/** The client asked for another sample instead of approving. */
export async function requestAnotherSample(params: {
  organizationId: string;
  roundId: string;
  comment: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<void> {
  const comment = params.comment.trim().slice(0, 1000);
  if (!comment) throw new StainError("Tell us what you are looking for.");
  const job = await withTenantTransaction(params.organizationId, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`stain:${params.roundId}`}))`;
    const round = await tx.stainSampleRound.findFirst({
      where: { id: params.roundId, organizationId: params.organizationId },
      include: { workOrder: { select: { id: true, number: true } } },
    });
    if (!round) throw new StainError("This link is no longer valid.", 404);
    if (!OPEN_STATUSES.has(round.status)) throw new StainError("This color choice was already answered.", 409);
    await tx.stainApproval.create({
      data: {
        organizationId: params.organizationId, roundId: round.id, workOrderId: round.workOrderId, decision: "needs_sample",
        comment, ip: params.ip?.slice(0, 80) || null, userAgent: params.userAgent?.slice(0, 400) || null,
      },
    });
    await tx.stainSampleRound.update({ where: { id: round.id }, data: { status: "changes_requested", decidedAt: new Date() } });
    await recordActivity(tx, {
      organizationId: params.organizationId, entityType: "work_order", entityId: round.workOrderId, action: "stain.another_sample",
      actorType: "customer", changes: { comment: { from: null, to: comment } },
    });
    return round.workOrder;
  });
  void publishAppNotification({
    organizationId: params.organizationId,
    type: "stain.another_sample",
    title: `Cliente pediu outra amostra · Job #${job.number ?? ""}`,
    body: comment.slice(0, 200),
    url: `job-detail.html?id=${job.id}#stain`,
    dedupeKey: `stain-another:${params.roundId}`,
  }).catch(() => undefined);
}

async function mediaBuffer(organizationId: string, mediaId: string | null | undefined, tx: TenantPrisma): Promise<Buffer | null> {
  if (!mediaId) return null;
  const m = await tx.jobMedia.findFirst({ where: { id: mediaId, organizationId, deletedAt: null }, select: { storageKey: true, url: true } });
  if (!m) return null;
  return readStoredObject(m.storageKey || storageKeyFromAnyUrl(m.url) || "");
}

/** Builds the approval PDF and stores it once (the approval keeps its key). */
export async function renderApprovalPdf(organizationId: string, approvalId: string): Promise<Buffer> {
  const org = await orgInfo(organizationId);
  const data = await withTenantTransaction(organizationId, async (tx) => {
    const a = await tx.stainApproval.findFirst({
      where: { id: approvalId, organizationId, decision: "approved" },
      include: {
        round: { include: { samples: { orderBy: { number: "asc" } } } },
        workOrder: { select: { id: true, number: true, address: true, customer: { select: { name: true } } } },
      },
    });
    if (!a) throw new StainError("Aprovação não encontrada.", 404);
    const approvedSample = a.round.samples.find((s) => s.id === a.sampleId);
    if (!approvedSample) throw new StainError("Sample não encontrado.", 404);
    const approvedPhoto = await mediaBuffer(organizationId, mediaIdsOf(approvedSample.mediaIds)[0], tx);
    const others: Array<{ number: number; name: string; photo: Buffer | null }> = [];
    for (const s of a.round.samples) {
      if (s.id === approvedSample.id) continue;
      others.push({ number: s.number, name: sampleDisplayName(s), photo: await mediaBuffer(organizationId, mediaIdsOf(s.mediaIds)[0], tx) });
    }
    return { a, approvedSample, approvedPhoto, others };
  });
  const [logo, signature, approvedPhoto, ...otherPhotos] = await Promise.all([
    org?.logoUrl ? readStoredObject(storageKeyFromAnyUrl(org.logoUrl) || "").then((b) => pdfImage(b, 400)) : Promise.resolve(null),
    data.a.signatureKey ? readStoredObject(data.a.signatureKey).then((b) => pdfImage(b, 800)) : Promise.resolve(null),
    pdfImage(data.approvedPhoto),
    ...data.others.map((o) => pdfImage(o.photo, 600)),
  ]);
  const pdf = await buildStainPdf({
    companyName: org?.name || "Flooring company",
    companyContact: [org?.contactPhone, org?.contactEmail].filter(Boolean).join(" · ") || null,
    logo,
    jobNumber: data.a.workOrder.number,
    jobAddress: data.a.workOrder.address,
    clientName: data.a.workOrder.customer?.name || null,
    woodSpecies: data.a.round.woodSpecies,
    room: data.a.round.room,
    roundNumber: data.a.round.number,
    approved: { number: data.approvedSample.number, name: sampleDisplayName(data.approvedSample), sub: sampleSubText(data.approvedSample, "en"), photo: approvedPhoto },
    others: data.others.map((o, i) => ({ number: o.number, name: o.name, photo: otherPhotos[i] || null })),
    signerName: data.a.signerName || "Client",
    signedAtText: signedAtText(data.a.createdAt, org?.timezone),
    ip: data.a.ip,
    signature,
    terms: data.a.termsText || approvalTerms(org?.name || ""),
    approvalId: data.a.id,
  });
  if (!data.a.pdfKey) {
    const stored = await storage.upload({
      key: `orgs/${organizationId}/jobs/${data.a.workOrderId}/stain/approval-${data.a.id}.pdf`,
      body: pdf,
      contentType: "application/pdf",
    });
    await withTenantTransaction(organizationId, (tx) => tx.stainApproval.update({ where: { id: data.a.id }, data: { pdfKey: stored.key } }));
  }
  return pdf;
}

/** The stored PDF, or a fresh one when it was never stored. */
export async function approvalPdf(organizationId: string, approvalId: string): Promise<Buffer> {
  const row = await withTenantTransaction(organizationId, (tx) => tx.stainApproval.findFirst({ where: { id: approvalId, organizationId }, select: { pdfKey: true } }));
  if (!row) throw new StainError("Aprovação não encontrada.", 404);
  if (row.pdfKey) {
    const buf = await readStoredObject(row.pdfKey);
    if (buf) return buf;
  }
  return renderApprovalPdf(organizationId, approvalId);
}

/**
 * Sends the approval to the builder's job: a message in the job's builder channel (ObraBuilder bell +
 * push) with the photo of the approved sample and the signed PDF. Also used by "Reenviar ao builder".
 */
export async function sendApprovalToBuilder(organizationId: string, roundId: string): Promise<boolean> {
  const org = await orgInfo(organizationId);
  const data = await withTenantTransaction(organizationId, async (tx) => {
    const round = await tx.stainSampleRound.findFirst({
      where: { id: roundId, organizationId, status: { in: ["approved"] } },
      include: { samples: true, approvals: { where: { decision: "approved" }, orderBy: { createdAt: "desc" }, take: 1 }, workOrder: { select: { id: true, builderId: true } } },
    });
    if (!round || !round.workOrder.builderId || !round.approvals[0]) return null;
    const a = round.approvals[0];
    const sample = round.samples.find((s) => s.id === a.sampleId);
    if (!sample) return null;
    const photo = await mediaBuffer(organizationId, mediaIdsOf(sample.mediaIds)[0], tx);
    return { round, a, sample, photo };
  });
  if (!data) return false;
  const pdf = await approvalPdf(organizationId, data.a.id).catch(() => null);
  const photo = await pdfImage(data.photo, 1600);
  const name = sampleDisplayName(data.sample);
  const others = data.round.samples.length - 1;
  const body = [
    `Stain color approved: ${name}${data.sample.kind === "duraseal" ? " (DuraSeal)" : ""}${data.round.woodSpecies ? ` on ${data.round.woodSpecies}` : ""}.`,
    `Signed by ${data.a.signerName || "the client"} on ${signedAtText(data.a.createdAt, org?.timezone)}.`,
    others > 0 ? `${others} other sample${others === 1 ? " was" : "s were"} shown; all sample photos are in the job.` : "",
  ].filter(Boolean).join(" ");
  const files: Array<{ name: string; contentType: string; body: Buffer }> = [];
  if (photo) files.push({ name: `stain-${name.replace(/[^\w]+/g, "-").toLowerCase()}.jpg`, contentType: "image/jpeg", body: photo });
  if (pdf) files.push({ name: "stain-approval.pdf", contentType: "application/pdf", body: pdf });
  await postMessage({
    organizationId, workOrderId: data.round.workOrderId, side: "company", authorName: org?.name || "Office", body, files,
  });
  await withTenantTransaction(organizationId, (tx) => tx.stainSampleRound.update({ where: { id: data.round.id }, data: { builderNotifiedAt: new Date() } }));
  return true;
}
