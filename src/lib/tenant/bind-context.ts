import type { NextFunction, Response } from "express";
import type { TenantRequest } from "./resolve-tenant.js";
import { runWithTenant } from "./prisma-tenant.js";
import { prisma } from "../prisma.js";

/**
 * For tenant requests: set RLS session variable and ALS context
 * before any business queries run.
 */
export async function bindTenantContext(
  req: TenantRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.organizationId) {
    next();
    return;
  }

  const organizationId = req.organizationId;
  try {
    await prisma.$executeRaw`SELECT set_config('app.current_tenant_id', ${organizationId}, false)`;
    runWithTenant(organizationId, () => {
      next();
    });
  } catch (error) {
    next(error);
  }
}
