/**
 * Photos attached to a Mate AI request (a receipt, a problem on site). The browser sends the
 * image once with the request; actions get it by id when they run. Kept in memory for 20
 * minutes, per organization and user, a few at a time.
 */
import { randomUUID } from "node:crypto";

type Entry = { org: string; user: string; dataUrl: string; at: number };

const TTL_MS = 20 * 60 * 1000;
const PER_USER = 6;
const MAX_BYTES = 12 * 1024 * 1024;
const store = new Map<string, Entry>();

function sweep(now = Date.now()) {
  for (const [id, e] of store) if (now - e.at > TTL_MS) store.delete(id);
}

export function isImageDataUrl(v: unknown): v is string {
  return typeof v === "string" && /^data:image\/(jpeg|jpg|png|webp|heic|heif);base64,/i.test(v) && v.length < MAX_BYTES * 1.4;
}

export function putAttachment(org: string, user: string, dataUrl: string): string {
  sweep();
  const mine = [...store.entries()].filter(([, e]) => e.org === org && e.user === user).sort((a, b) => a[1].at - b[1].at);
  while (mine.length >= PER_USER) store.delete(mine.shift()![0]);
  const id = randomUUID();
  store.set(id, { org, user, dataUrl, at: Date.now() });
  return id;
}

export function getAttachment(org: string, user: string, id: unknown): string | null {
  if (typeof id !== "string") return null;
  const e = store.get(id);
  if (!e || e.org !== org || e.user !== user || Date.now() - e.at > TTL_MS) return null;
  return e.dataUrl;
}
