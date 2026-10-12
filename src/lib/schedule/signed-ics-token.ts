/**
 * Short-lived HMAC tokens so Apple Calendar can fetch .ics without a session cookie.
 * Path: /feeds/lead-visit/<token>.ics  |  /feeds/meeting/<token>.ics
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";

export type IcsAccessKind = "lead" | "meeting";

export type VerifiedIcsAccess = {
  kind: IcsAccessKind;
  organizationId: string;
  entityId: string;
};

/** Default 7 days — enough for Calendar to re-fetch after “Add Event”. */
const DEFAULT_TTL_SEC = 7 * 24 * 60 * 60;

export function signIcsAccessToken(
  kind: IcsAccessKind,
  organizationId: string,
  entityId: string,
  ttlSec: number = DEFAULT_TTL_SEC,
): string {
  const exp = Math.floor(Date.now() / 1000) + Math.max(60, ttlSec);
  const body = `${kind}.${organizationId}.${entityId}.${exp}`;
  const sig = createHmac("sha256", env.SESSION_SECRET).update(body).digest("base64url");
  return Buffer.from(`${body}.${sig}`, "utf8").toString("base64url");
}

export function verifyIcsAccessToken(token: string): VerifiedIcsAccess | null {
  try {
    const raw = Buffer.from(String(token || ""), "base64url").toString("utf8");
    const parts = raw.split(".");
    if (parts.length !== 5) return null;
    const [kind, organizationId, entityId, expStr, sig] = parts;
    if ((kind !== "lead" && kind !== "meeting") || !organizationId || !entityId || !sig) return null;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
    const body = `${kind}.${organizationId}.${entityId}.${expStr}`;
    const expected = createHmac("sha256", env.SESSION_SECRET).update(body).digest("base64url");
    const a = Buffer.from(String(sig));
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return { kind, organizationId, entityId };
  } catch {
    return null;
  }
}
