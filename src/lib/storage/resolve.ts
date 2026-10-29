import { env } from "../../config/env.js";
import { storage } from "./index.js";

/**
 * Turn a stored file URL back into its storage key, so the server can read the
 * bytes with `storage.getStream` instead of fetching a public URL. This keeps AI
 * vision and PDFs working with a private bucket and with the local fallback.
 */

/** Top-level folders the app writes to (see the `key:` values in the upload routes). */
export const STORAGE_KEY_PREFIXES = ["orgs/", "users/", "builders/", "virtual-office/", "exports/"] as const;

function decodePath(p: string): string {
  return p
    .split("/")
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    })
    .join("/");
}

function cleanKey(key: string): string | null {
  const k = decodePath(key.replace(/^\/+/, "").split(/[?#]/)[0] || "");
  if (!k || k.includes("..") || k.includes("\\")) return null;
  return k;
}

function stripBase(src: string, base: string | undefined): string | null {
  const b = String(base || "").trim().replace(/\/+$/, "");
  if (!b) return null;
  return src.startsWith(`${b}/`) ? src.slice(b.length + 1) : null;
}

/**
 * Key for a URL this app's storage produced: `S3_PUBLIC_URL/…`, `S3_ENDPOINT/bucket/…`
 * or `/api/local-files/…` (relative or on any host). Anything else returns null.
 */
export function storageKeyFromOwnUrl(src: string | null | undefined): string | null {
  const s = String(src || "").trim();
  if (!s || s.startsWith("data:")) return null;

  const fromPublic = stripBase(s, env.S3_PUBLIC_URL);
  if (fromPublic) return cleanKey(fromPublic);

  const endpoint = String(env.S3_ENDPOINT || "").trim().replace(/\/+$/, "");
  const fromEndpoint = endpoint ? stripBase(s, `${endpoint}/${env.S3_BUCKET}`) : null;
  if (fromEndpoint) return cleanKey(fromEndpoint);

  let pathname = s;
  if (/^https?:\/\//i.test(s)) {
    try {
      pathname = new URL(s).pathname;
    } catch {
      return null;
    }
  }
  if (pathname.startsWith("/api/local-files/")) return cleanKey(pathname.slice("/api/local-files/".length));
  return null;
}

/**
 * Like `storageKeyFromOwnUrl`, plus a looser fallback for URLs saved under an older
 * public address (e.g. a previous bucket domain): the path from the first known
 * top-level folder. Only for reading files the app itself recorded (PDF images).
 */
export function storageKeyFromAnyUrl(src: string | null | undefined): string | null {
  const own = storageKeyFromOwnUrl(src);
  if (own) return own;
  const s = String(src || "").trim();
  if (!s || s.startsWith("data:")) return null;
  let pathname = s;
  if (/^https?:\/\//i.test(s)) {
    try {
      pathname = new URL(s).pathname;
    } catch {
      return null;
    }
  }
  const decoded = decodePath(pathname);
  const hits = STORAGE_KEY_PREFIXES.map((p) => {
    const at = decoded.indexOf(`/${p}`);
    if (at >= 0) return at + 1;
    return decoded.startsWith(p) ? 0 : -1;
  }).filter((i) => i >= 0);
  if (!hits.length) return null;
  return cleanKey(decoded.slice(Math.min(...hits)));
}

/** Reads a stored object fully; null when missing, unreadable or larger than `maxBytes`. */
export async function readStoredObject(key: string, maxBytes = 20 * 1024 * 1024): Promise<Buffer | null> {
  try {
    const stream = await storage.getStream(key);
    if (!stream) return null;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      size += buf.length;
      if (size > maxBytes) {
        if (typeof (stream as { destroy?: () => void }).destroy === "function") stream.destroy();
        return null;
      }
      chunks.push(buf);
    }
    const out = Buffer.concat(chunks);
    return out.length ? out : null;
  } catch {
    return null;
  }
}

/** Image type from the first bytes (formats the AI vision API accepts); null otherwise. */
export function sniffImageType(buf: Buffer): "image/jpeg" | "image/png" | "image/webp" | "image/gif" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") {
    return "image/webp";
  }
  if (buf.length >= 4 && buf.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
  return null;
}

/**
 * Prepares image references for AI vision. Files from this app's storage are read
 * on the server and sent as data URLs (so the bucket can stay private and local
 * files work). `data:image/` URLs pass through; other public http(s) URLs pass
 * through as-is; anything else is dropped.
 *
 * `onlyKeyPrefix` restricts storage reads to one tenant folder (e.g. `orgs/<id>/`)
 * when the URL list came from client-editable data.
 */
export async function resolveImagesForAi(
  urls: Array<string | null | undefined>,
  opts: { onlyKeyPrefix?: string; maxBytesEach?: number } = {},
): Promise<string[]> {
  const out: string[] = [];
  for (const raw of urls) {
    const url = String(raw || "").trim();
    if (!url) continue;
    if (url.startsWith("data:")) {
      if (/^data:image\//i.test(url)) out.push(url);
      continue;
    }
    const key = storageKeyFromOwnUrl(url);
    if (key) {
      if (opts.onlyKeyPrefix && !key.startsWith(opts.onlyKeyPrefix)) continue;
      const buf = await readStoredObject(key, opts.maxBytesEach ?? 15 * 1024 * 1024);
      const type = buf ? sniffImageType(buf) : null;
      if (buf && type) {
        out.push(`data:${type};base64,${buf.toString("base64")}`);
        continue;
      }
      // Could not read it from storage: fall back to the public URL when there is one.
      if (/^https?:\/\//i.test(url)) out.push(url);
      continue;
    }
    if (/^https?:\/\//i.test(url)) out.push(url);
  }
  return out;
}
