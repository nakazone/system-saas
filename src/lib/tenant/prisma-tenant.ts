import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";

export type TenantContext = {
  organizationId: string;
};

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

export function getTenantContext(): TenantContext {
  const ctx = tenantStorage.getStore();
  if (!ctx?.organizationId) {
    throw new Error("Tenant context is required for this operation");
  }
  return ctx;
}

export function runWithTenant<T>(organizationId: string, fn: () => T): T {
  return tenantStorage.run({ organizationId }, fn);
}

/** Models that must always be scoped by organizationId */
const TENANT_MODELS = new Set([
  "User",
  "Role",
  "Invitation",
  "PipelineStage",
  "Lead",
  "Customer",
  "Property",
  "ActivityEvent",
  "EstimateRule",
  "Quote",
  "QuoteLineItem",
  "QuoteRoom",
  "QuoteOptionGroup",
  "QuoteAddOn",
  "PublicAccessToken",
  "PartnerUser",
  "Builder",
  "PricingItem",
  "Supplier",
  "Product",
  "CategoryMargin",
  "QuoteCatalogItem",
  "QuoteInvoice",
  "InvoiceReceipt",
  "Project",
  "PayrollEmployee",
  "PayrollPeriod",
  "PayrollTimesheet",
]);

type Operation =
  | "findFirst"
  | "findFirstOrThrow"
  | "findMany"
  | "create"
  | "createMany"
  | "update"
  | "updateMany"
  | "upsert"
  | "delete"
  | "deleteMany"
  | "count"
  | "aggregate"
  | "groupBy";

function assertNoClientOrgOverride(
  args: Record<string, unknown> | undefined,
  organizationId: string,
): void {
  if (!args) return;

  const data = args.data as Record<string, unknown> | undefined;
  if (data && "organizationId" in data && data.organizationId !== organizationId) {
    throw new Error("organizationId cannot be overridden from client input");
  }

  const where = args.where as Record<string, unknown> | undefined;
  if (where && "organizationId" in where && where.organizationId !== organizationId) {
    throw new Error("organizationId filter cannot target another tenant");
  }

  const create = args.create as Record<string, unknown> | undefined;
  if (create && "organizationId" in create && create.organizationId !== organizationId) {
    throw new Error("organizationId cannot be overridden from client input");
  }

  const update = args.update as Record<string, unknown> | undefined;
  if (update && "organizationId" in update && update.organizationId !== organizationId) {
    throw new Error("organizationId cannot be overridden from client input");
  }
}

function injectOrganizationId(
  operation: Operation,
  args: Record<string, unknown> | undefined,
  organizationId: string,
): Record<string, unknown> {
  const next = { ...(args ?? {}) };
  assertNoClientOrgOverride(next, organizationId);

  switch (operation) {
    case "findFirst":
    case "findFirstOrThrow":
    case "findMany":
    case "count":
    case "aggregate":
    case "groupBy":
    case "updateMany":
    case "deleteMany": {
      next.where = { ...(next.where as object | undefined), organizationId };
      return next;
    }
    case "create": {
      next.data = { ...(next.data as object), organizationId };
      return next;
    }
    case "createMany": {
      const data = next.data;
      if (Array.isArray(data)) {
        next.data = data.map((row) => ({ ...(row as object), organizationId }));
      } else if (data && typeof data === "object") {
        next.data = { ...(data as object), organizationId };
      }
      return next;
    }
    case "update":
    case "delete": {
      // Prisma allows extended where-unique: unique field + organizationId
      next.where = { ...(next.where as object), organizationId };
      return next;
    }
    case "upsert": {
      next.where = { ...(next.where as object), organizationId };
      next.create = { ...(next.create as object), organizationId };
      if (next.update && typeof next.update === "object") {
        const update = { ...(next.update as object) } as Record<string, unknown>;
        delete update.organizationId;
        next.update = update;
      }
      return next;
    }
    default:
      return next;
  }
}

/**
 * Prisma client extension that forces organizationId on all tenant-scoped models.
 * organizationId always comes from AsyncLocalStorage — never from the client.
 */
export const tenantExtension = Prisma.defineExtension({
  name: "tenantIsolation",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!model || !TENANT_MODELS.has(model)) {
          return query(args);
        }

        const { organizationId } = getTenantContext();

        // findUnique unique-input cannot always include organizationId — fetch then verify
        if (operation === "findUnique" || operation === "findUniqueOrThrow") {
          assertNoClientOrgOverride(args as Record<string, unknown>, organizationId);
          const result = (await query(args)) as { organizationId?: string } | null;
          if (result && result.organizationId && result.organizationId !== organizationId) {
            if (operation === "findUniqueOrThrow") {
              throw new Error("Record not found in current tenant");
            }
            return null;
          }
          return result;
        }

        const nextArgs = injectOrganizationId(
          operation as Operation,
          args as Record<string, unknown>,
          organizationId,
        );
        return query(nextArgs);
      },
    },
  },
});

export function getTenantPrisma() {
  return prisma.$extends(tenantExtension);
}

export type TenantPrisma = ReturnType<typeof getTenantPrisma>;

/**
 * Runs work inside a transaction with Postgres RLS tenant setting applied.
 * SET LOCAL ensures the setting is transaction-scoped.
 */
export async function withTenantTransaction<T>(
  organizationId: string,
  fn: (tx: TenantPrisma) => Promise<T>,
): Promise<T> {
  return runWithTenant(organizationId, async () => {
    const extended = getTenantPrisma();
    return extended.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${organizationId}, true)`;
      return fn(tx as TenantPrisma);
    });
  });
}
