/**
 * The job's channel between the company and the builder who sent it: short updates, questions and
 * photos / PDFs, both ways. Shown in the CRM job page and in the builder's portal job page; each new
 * message tells the other side (CRM bell + push / ObraBuilder bell + push).
 */
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { storage } from "../storage/index.js";
import { withTenantTransaction } from "../tenant/prisma-tenant.js";
import { publishAppNotification } from "../notifications/publish.js";
import { notifyBuilderAccounts } from "../builders/notifications.js";

export type MessageFile = { key: string; name: string; contentType: string; size: number };
export type IncomingFile = { name: string; data_url: string };

const MAX_FILES = 6;
const MAX_BYTES = 12 * 1024 * 1024;

function validSignature(contentType: string, body: Buffer): boolean {
  if (contentType === "application/pdf") return body.subarray(0, 5).toString("ascii") === "%PDF-";
  if (contentType === "image/jpeg") return body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  if (contentType === "image/png") return body.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  if (contentType === "image/webp") return body.subarray(0, 4).toString("ascii") === "RIFF" && body.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}
function safeName(value: string, fallback: string): string {
  return value.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || fallback;
}

export function messageFiles(value: unknown): MessageFile[] {
  if (!Array.isArray(value)) return [];
  return value.filter((f): f is MessageFile => Boolean(f && typeof f === "object" && typeof (f as MessageFile).key === "string" && typeof (f as MessageFile).name === "string"));
}

/** Checks and decodes attachments (JPG, PNG, WebP, PDF; up to 6, 12 MB together). */
export function decodeMessageFiles(files: IncomingFile[]): { ok: true; files: Array<{ name: string; contentType: string; body: Buffer }> } | { ok: false; error: string } {
  if (files.length > MAX_FILES) return { ok: false, error: `Send up to ${MAX_FILES} files.` };
  const out: Array<{ name: string; contentType: string; body: Buffer }> = [];
  let total = 0;
  for (const f of files) {
    const m = /^data:([^;]+);base64,(.+)$/.exec(f.data_url || "");
    const contentType = (m?.[1] || "").toLowerCase().replace("image/jpg", "image/jpeg");
    const body = m ? Buffer.from(m[2]!, "base64") : Buffer.alloc(0);
    if (!m || !validSignature(contentType, body)) return { ok: false, error: `${f.name}: use JPG, PNG, WebP or PDF.` };
    total += body.length;
    out.push({ name: f.name, contentType, body });
  }
  if (total > MAX_BYTES) return { ok: false, error: "Files must add up to less than 12 MB." };
  return { ok: true, files: out };
}

export function serializeMessage(row: { id: string; side: string; authorName: string; body: string; files: Prisma.JsonValue; createdAt: Date }, fileUrl: (messageId: string, index: number) => string) {
  return {
    id: row.id,
    side: row.side === "builder" ? "builder" : "company",
    author: row.authorName,
    body: row.body,
    created_at: row.createdAt,
    files: messageFiles(row.files).map((f, i) => ({ name: f.name, content_type: f.contentType, size: f.size, url: fileUrl(row.id, i) })),
  };
}

export async function listMessages(organizationId: string, workOrderId: string) {
  return withTenantTransaction(organizationId, (tx) => tx.jobPartnerMessage.findMany({
    where: { organizationId, workOrderId },
    orderBy: { createdAt: "asc" },
    take: 300,
  }));
}

/** Saves a message with its files, then tells the other side. */
export async function postMessage(input: {
  organizationId: string;
  workOrderId: string;
  side: "company" | "builder";
  authorName: string;
  authorUserId?: string | null;
  partnerUserId?: string | null;
  body: string;
  files: Array<{ name: string; contentType: string; body: Buffer }>;
  /** company side: CRM user who wrote it (not notified) */
  excludeUserId?: string;
}) {
  const id = randomUUID();
  const saved: MessageFile[] = [];
  try {
    for (const f of input.files) {
      const stored = await storage.upload({ key: `orgs/${input.organizationId}/jobs/${input.workOrderId}/messages/${id}/${randomUUID()}`, body: f.body, contentType: f.contentType });
      saved.push({ key: stored.key, name: safeName(f.name, `file-${saved.length + 1}`), contentType: f.contentType, size: stored.size });
    }
  } catch (error) {
    await Promise.all(saved.map((f) => storage.delete(f.key).catch(() => undefined)));
    throw error;
  }
  const { row, job, company } = await withTenantTransaction(input.organizationId, async (tx) => {
    const row = await tx.jobPartnerMessage.create({
      data: {
        id,
        organizationId: input.organizationId,
        workOrderId: input.workOrderId,
        side: input.side,
        authorName: input.authorName.slice(0, 120) || (input.side === "builder" ? "Builder" : "Office"),
        authorUserId: input.authorUserId || null,
        partnerUserId: input.partnerUserId || null,
        body: input.body,
        files: saved as unknown as Prisma.InputJsonValue,
      },
    });
    const job = await tx.workOrder.findFirst({ where: { id: input.workOrderId }, select: { id: true, number: true, title: true, builderId: true, builder: { select: { company: true } } } });
    const company = await tx.organization.findUnique({ where: { id: input.organizationId }, select: { name: true } });
    return { row, job, company };
  });
  const text = input.body.trim() || (saved.length ? `${saved.length} file${saved.length === 1 ? "" : "s"}` : "");
  if (input.side === "company" && job?.builderId) {
    await notifyBuilderAccounts(input.organizationId, job.builderId, {
      kind: "message",
      companyName: company?.name || "The company",
      title: `${company?.name || "The company"} · ${job.title}${job.number ? ` (#${job.number})` : ""}`,
      body: `${input.authorName}: ${text}`.slice(0, 300),
      url: `#jobs/${job.id}/messages`,
      workOrderId: job.id,
    }).catch(() => undefined);
  }
  if (input.side === "builder" && job) {
    await publishAppNotification({
      organizationId: input.organizationId,
      type: "builder_job_message",
      title: `Mensagem de ${job.builder?.company || input.authorName} · Job #${job.number ?? ""}`,
      body: `${input.authorName}: ${text}`.slice(0, 300),
      url: `job-detail.html?id=${job.id}#builder`,
      dedupeKey: `job-message:${row.id}`,
    }).catch(() => undefined);
  }
  return row;
}

/** Streams a file of a message (the caller checks access to the job). */
export async function sendMessageFile(
  res: import("express").Response,
  next: import("express").NextFunction,
  organizationId: string, workOrderId: string, messageId: string, index: number, download: boolean,
  /** images only: a WebP this many px wide (thumbnails in lists) */
  thumbWidth?: number,
): Promise<void> {
  const row = await withTenantTransaction(organizationId, (tx) => tx.jobPartnerMessage.findFirst({ where: { id: messageId, organizationId, workOrderId }, select: { files: true } }));
  const f = row && Number.isInteger(index) ? messageFiles(row.files)[index] : undefined;
  const stream = f ? await storage.getStream(f.key) : null;
  if (!f || !stream) {
    res.status(404).json({ success: false, error: "File not found." });
    return;
  }
  if (thumbWidth && /^image\//.test(f.contentType) && !download) {
    const small = await imageThumbnail(stream, thumbWidth).catch(() => null);
    if (small) {
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Type", "image/webp");
      res.end(small);
      return;
    }
    const again = await storage.getStream(f.key);
    if (!again) { res.status(404).json({ success: false, error: "File not found." }); return; }
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", f.contentType);
    again.on("error", next);
    again.pipe(res);
    return;
  }
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Type", f.contentType);
  res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${safeName(f.name, "file")}"`);
  stream.on("error", next);
  stream.pipe(res);
}

/** A photo resized to `width` px (WebP), for thumbnails. */
export async function imageThumbnail(stream: NodeJS.ReadableStream, width: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as unknown as Uint8Array));
  const sharp = (await import("sharp")).default;
  return sharp(Buffer.concat(chunks)).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
}

/** `?w=` on a file URL → a thumbnail width (120–1200 px), else undefined. */
export function thumbWidthOf(value: unknown): number | undefined {
  const w = Number(value);
  return Number.isFinite(w) && w > 0 ? Math.max(120, Math.min(1200, Math.round(w))) : undefined;
}
