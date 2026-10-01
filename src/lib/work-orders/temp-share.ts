import type { TenantPrisma } from "../tenant/prisma-tenant.js";
import { hashPublicToken, issuePublicAccessToken } from "../quotes/public-token.js";

export const TEMP_SHARE_TTL_DAYS = 60;
/** Reuse the current link while it still has at least this long to live. */
const REUSE_MIN_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

export type TempShare = { rawToken: string; expiresAt: Date; reused: boolean };

/**
 * Current ticket link of a temporary worker. Sending the link again returns the same URL
 * (the worker keeps one link that works), and only issues a new one when there is none,
 * it was revoked, or it is about to expire. `rotate` forces a new link and kills the old one.
 */
export async function ensureTempShareToken(
  tx: TenantPrisma,
  params: { organizationId: string; tempWorkerId: string; rotate?: boolean; now?: Date },
): Promise<TempShare> {
  const now = params.now ?? new Date();
  const temp = await tx.workOrderTempWorker.findFirst({
    where: { id: params.tempWorkerId },
    select: { id: true, shareToken: true, shareTokenExpiresAt: true },
  });
  if (!temp) throw new Error("temp worker not found");

  if (
    !params.rotate &&
    temp.shareToken &&
    temp.shareTokenExpiresAt &&
    temp.shareTokenExpiresAt.getTime() - now.getTime() > REUSE_MIN_DAYS * DAY
  ) {
    const active = await tx.publicAccessToken.findFirst({
      where: {
        tokenHash: hashPublicToken(temp.shareToken),
        entityType: "work_order_temp",
        entityId: temp.id,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: { id: true },
    });
    if (active) return { rawToken: temp.shareToken, expiresAt: temp.shareTokenExpiresAt, reused: true };
  }

  const issued = await issuePublicAccessToken(tx, {
    organizationId: params.organizationId,
    entityType: "work_order_temp",
    entityId: temp.id,
    ttlDays: TEMP_SHARE_TTL_DAYS,
    tokenBytes: 16,
  });
  await tx.workOrderTempWorker.update({
    where: { id: temp.id },
    data: { shareToken: issued.rawToken, shareTokenExpiresAt: issued.expiresAt },
  });
  return { rawToken: issued.rawToken, expiresAt: issued.expiresAt, reused: false };
}
