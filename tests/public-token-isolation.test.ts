import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import {
  generateRawPublicToken,
  hashPublicToken,
  lookupPublicAccessToken,
} from "../src/lib/quotes/public-token.js";

const prisma = new PrismaClient();

describe("public quote token isolation", () => {
  let orgAId: string;
  let orgBId: string;
  let quoteAId: string;
  let rawA: string;
  let rawB: string;

  beforeAll(async () => {
    for (const permission of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({
        where: { key: permission.key },
        create: {
          key: permission.key,
          group: permission.group,
          description: permission.description,
        },
        update: {},
      });
    }
    const suffix = Date.now().toString(36);
    const orgA = await createOrganizationWithAdmin({
      organizationName: `Tok A ${suffix}`,
      slug: `tok-a-${suffix}`,
      adminName: "Admin A",
      adminEmail: `tok-a-${suffix}@example.com`,
      password: "password12345",
    });
    const orgB = await createOrganizationWithAdmin({
      organizationName: `Tok B ${suffix}`,
      slug: `tok-b-${suffix}`,
      adminName: "Admin B",
      adminEmail: `tok-b-${suffix}@example.com`,
      password: "password12345",
    });
    orgAId = orgA.organization.id;
    orgBId = orgB.organization.id;

    rawA = generateRawPublicToken();
    rawB = generateRawPublicToken();

    quoteAId = (
      await withTenantTransaction(orgAId, async (tx) => {
        const q = await tx.quote.create({
          data: {
            organizationId: orgAId,
            number: 1,
            title: "Token quote A",
            status: "sent",
            flooringType: "lvp",
          },
        });
        await tx.publicAccessToken.create({
          data: {
            organizationId: orgAId,
            entityType: "quote",
            entityId: q.id,
            tokenHash: hashPublicToken(rawA),
            expiresAt: new Date(Date.now() + 7 * 86400000),
          },
        });
        return q;
      })
    ).id;

    await withTenantTransaction(orgBId, async (tx) => {
      const q = await tx.quote.create({
        data: {
          organizationId: orgBId,
          number: 1,
          title: "Token quote B",
          status: "sent",
          flooringType: "hardwood",
        },
      });
      await tx.publicAccessToken.create({
        data: {
          organizationId: orgBId,
          entityType: "quote",
          entityId: q.id,
          tokenHash: hashPublicToken(rawB),
          expiresAt: new Date(Date.now() + 7 * 86400000),
        },
      });
    });
  });

  afterAll(async () => {
    if (orgAId) await prisma.organization.delete({ where: { id: orgAId } }).catch(() => undefined);
    if (orgBId) await prisma.organization.delete({ where: { id: orgBId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("resolves token to the owning organization only", async () => {
    const hit = await lookupPublicAccessToken(rawA);
    expect(hit?.organizationId).toBe(orgAId);
    expect(hit?.entityId).toBe(quoteAId);

    const other = await lookupPublicAccessToken(rawB);
    expect(other?.organizationId).toBe(orgBId);
    expect(other?.organizationId).not.toBe(orgAId);
  });

  it("does not return another org quote when swapping tokens", async () => {
    const hit = await lookupPublicAccessToken(rawB);
    expect(hit?.entityId).not.toBe(quoteAId);
  });

  it("rejects revoked tokens", async () => {
    await withTenantTransaction(orgAId, async (tx) => {
      await tx.publicAccessToken.updateMany({
        where: { entityId: quoteAId },
        data: { revokedAt: new Date() },
      });
    });
    const hit = await lookupPublicAccessToken(rawA);
    expect(hit).toBeNull();
  });
});
