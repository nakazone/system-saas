import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../prisma.js";
import type { TenantPrisma } from "../tenant/prisma-tenant.js";

const DEFAULT_TTL_DAYS = 90;

export function hashPublicToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function generateRawPublicToken(): string {
  return randomBytes(32).toString("base64url");
}

export type IssuedToken = {
  rawToken: string;
  tokenId: string;
  expiresAt: Date;
};

/**
 * Issue a hashed public access token. Returns the raw token once (never stored).
 */
export async function issuePublicAccessToken(
  tx: TenantPrisma,
  params: {
    organizationId: string;
    entityType: string;
    entityId: string;
    ttlDays?: number;
  },
): Promise<IssuedToken> {
  const rawToken = generateRawPublicToken();
  const tokenHash = hashPublicToken(rawToken);
  const expiresAt = new Date(
    Date.now() + (params.ttlDays ?? DEFAULT_TTL_DAYS) * 24 * 60 * 60 * 1000,
  );

  // Revoke prior active tokens for same entity
  await tx.publicAccessToken.updateMany({
    where: {
      entityType: params.entityType,
      entityId: params.entityId,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });

  const row = await tx.publicAccessToken.create({
    data: {
      organizationId: params.organizationId,
      entityType: params.entityType,
      entityId: params.entityId,
      tokenHash,
      expiresAt,
    },
  });

  return { rawToken, tokenId: row.id, expiresAt };
}

export type PublicTokenLookup = {
  organizationId: string;
  entityType: string;
  entityId: string;
  tokenId: string | null;
};

/** Lookup via SECURITY DEFINER (no tenant context required). */
export async function lookupPublicAccessToken(rawToken: string): Promise<PublicTokenLookup | null> {
  const hashed = await prisma.$queryRaw<
    { organization_id: string; entity_type: string; entity_id: string; token_id: string }[]
  >`SELECT * FROM get_public_access_by_token(${rawToken})`;

  if (hashed[0]) {
    return {
      organizationId: hashed[0].organization_id,
      entityType: hashed[0].entity_type,
      entityId: hashed[0].entity_id,
      tokenId: hashed[0].token_id,
    };
  }

  // Legacy plaintext Quote.publicToken dual-read
  const legacy = await prisma.$queryRaw<{ quote_id: string; organization_id: string }[]>`
    SELECT * FROM get_quote_org_by_public_token(${rawToken})
  `;
  if (legacy[0]) {
    return {
      organizationId: legacy[0].organization_id,
      entityType: "quote",
      entityId: legacy[0].quote_id,
      tokenId: null,
    };
  }
  return null;
}

export function tokenNeedsLightVerify(createdAt: Date, now = new Date()): boolean {
  const ageMs = now.getTime() - createdAt.getTime();
  return ageMs > 14 * 24 * 60 * 60 * 1000;
}
