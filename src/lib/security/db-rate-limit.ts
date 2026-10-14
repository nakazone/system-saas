import { createHash, randomBytes } from "node:crypto";
import type { Request } from "express";
import { prisma } from "../prisma.js";

/**
 * Rate limit stored in Postgres (RateEvent), so it survives deploys and is shared between instances.
 * Use for low-volume public endpoints (signup, password reset), not for hot paths.
 */
export type Limit = { key: string; max: number; windowMs: number };

/** Records one attempt for every limit unless any of them is already full. Returns false when blocked. */
export async function takeRate(limits: Limit[], now = new Date()): Promise<boolean> {
  for (const l of limits) {
    const used = await prisma.rateEvent.count({ where: { key: l.key, createdAt: { gte: new Date(now.getTime() - l.windowMs) } } });
    if (used >= l.max) return false;
  }
  await prisma.rateEvent.createMany({ data: limits.map((l) => ({ key: l.key, createdAt: now })) });
  // Housekeeping: occasionally drop rows older than 2 days.
  if (Math.random() < 0.02) {
    await prisma.rateEvent.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 2 * 86400e3) } } }).catch(() => undefined);
  }
  return true;
}

/** Client IP as seen by Express (`trust proxy` is set to the Railway hop, so this cannot be spoofed by the client). */
export function requestIp(req: Request): string {
  return (req.ip || req.socket.remoteAddress || "").replace(/^::ffff:/, "") || "unknown";
}

export const HOUR = 3600e3;
export const DAY = 24 * HOUR;

/** URL-safe random token and its sha256 (only the hash is stored). */
export function newToken(bytes = 32): { token: string; hash: string } {
  const token = randomBytes(bytes).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(String(token)).digest("hex");
}
