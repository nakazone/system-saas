import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { hashPassword } from "../../lib/auth/password.js";
import {
  DEFAULT_ESTIMATE_RULES,
  DEFAULT_PIPELINE_STAGES,
  DEFAULT_ROLE_PERMISSIONS,
} from "../../lib/tenant/defaults.js";

export type SignupInput = {
  organizationName: string;
  slug: string;
  adminName: string;
  adminEmail: string;
  password: string;
  contactEmail?: string;
  contactPhone?: string;
};

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED_SLUGS = new Set(["admin", "www", "api", "app", "mail", "status", "static"]);

export function validateSlug(slug: string): string | null {
  if (!SLUG_REGEX.test(slug)) {
    return "Slug must be lowercase letters, numbers, and hyphens only";
  }
  if (slug.length < 2 || slug.length > 48) {
    return "Slug must be between 2 and 48 characters";
  }
  if (RESERVED_SLUGS.has(slug)) {
    return "This slug is reserved";
  }
  return null;
}

export async function createOrganizationWithAdmin(input: SignupInput) {
  const slugError = validateSlug(input.slug);
  if (slugError) {
    throw new Error(slugError);
  }

  const existing = await prisma.organization.findUnique({ where: { slug: input.slug } });
  if (existing) {
    throw new Error("This organization slug is already taken");
  }

  const passwordHash = await hashPassword(input.password);
  const permissions = await prisma.permission.findMany();
  const permissionByKey = new Map(permissions.map((p) => [p.key, p]));

  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: input.organizationName,
        slug: input.slug,
        status: "trial",
        plan: "starter",
        contactEmail: input.contactEmail ?? input.adminEmail,
        contactPhone: input.contactPhone,
        trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    // Required for FORCE RLS on tenant-scoped tables during bootstrap
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${organization.id}, true)`;

    const roleRecords: Record<string, string> = {};
    for (const [roleKey, permKeys] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      const role = await tx.role.create({
        data: {
          organizationId: organization.id,
          key: roleKey,
          name: roleKey
            .split("_")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" "),
          isSystem: true,
        },
      });
      roleRecords[roleKey] = role.id;

      for (const key of permKeys) {
        const permission = permissionByKey.get(key);
        if (!permission) continue;
        await tx.rolePermission.create({
          data: { roleId: role.id, permissionId: permission.id },
        });
      }
    }

    const admin = await tx.user.create({
      data: {
        organizationId: organization.id,
        email: input.adminEmail.toLowerCase(),
        name: input.adminName,
        passwordHash,
        roleId: roleRecords.admin,
        status: "active",
      },
    });

    for (const stage of DEFAULT_PIPELINE_STAGES) {
      await tx.pipelineStage.create({
        data: {
          organizationId: organization.id,
          name: stage.name,
          order: stage.order,
          color: stage.color,
        },
      });
    }

    for (const rule of DEFAULT_ESTIMATE_RULES) {
      await tx.estimateRule.create({
        data: {
          organizationId: organization.id,
          flooringType: rule.flooringType,
          wastePercent: new Prisma.Decimal(rule.wastePercent),
          materialMarkup: new Prisma.Decimal(rule.materialMarkup),
          laborMarkup: new Prisma.Decimal(rule.laborMarkup),
          defaultPricePerSqft: new Prisma.Decimal(rule.defaultPricePerSqft),
          defaultLaborPerSqft: new Prisma.Decimal(rule.defaultLaborPerSqft),
        },
      });
    }

    return { organization, admin };
  });
}
