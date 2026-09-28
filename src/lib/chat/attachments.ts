import { env } from "../../config/env.js";

export const CHAT_ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
]);

export const CHAT_MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const CHAT_MAX_ATTACHMENTS_PER_MESSAGE = 8;

export function publicUrlForStorageKey(key: string): string {
  if (env.S3_PUBLIC_URL) {
    return `${env.S3_PUBLIC_URL.replace(/\/$/, "")}/${key}`;
  }
  if (env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) {
    return `${env.S3_ENDPOINT.replace(/\/$/, "")}/${env.S3_BUCKET}/${key}`;
  }
  return `/api/local-files/${key
    .split("/")
    .map((p) => encodeURIComponent(p))
    .join("/")}`;
}

export function parseDataUrl(dataUrl: string): { contentType: string; body: Buffer } | null {
  const m = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/i.exec(String(dataUrl || ""));
  if (!m) return null;
  const contentType = (m[1] || "application/octet-stream").trim().toLowerCase();
  const isBase64 = Boolean(m[2]);
  const data = m[3] || "";
  try {
    const body = isBase64 ? Buffer.from(data, "base64") : Buffer.from(decodeURIComponent(data), "utf8");
    if (!body.length) return null;
    return { contentType, body };
  } catch {
    return null;
  }
}

export function validateChatAttachment(params: {
  contentType: string;
  size: number;
}): { ok: true; mime: string } | { ok: false; error: string } {
  const mime = params.contentType.split(";")[0]!.trim().toLowerCase();
  if (mime.includes("heic") || mime.includes("heif")) {
    return { ok: false, error: "HEIC is not supported. Please upload JPG or PNG." };
  }
  const allowed =
    CHAT_ALLOWED_MIME.has(mime) ||
    mime === "image/jpg" ||
    ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mime) ||
    ["video/mp4", "video/webm", "video/quicktime"].includes(mime);
  if (!allowed) {
    return { ok: false, error: `File type not allowed: ${mime}` };
  }
  if (params.size <= 0 || params.size > CHAT_MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: `File too large (max ${CHAT_MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB)` };
  }
  return { ok: true, mime: mime === "image/jpg" ? "image/jpeg" : mime };
}
