import type { Prisma } from "@prisma/client";

export type ActivityEntityType =
  | "quote"
  | "project"
  | "visit"
  | "invoice"
  | "payment"
  | "lead"
  | "customer"
  | "property";

export type ActivityActorType = "user" | "customer" | "system";

export type ActivityChanges = Record<string, { from: unknown; to: unknown }>;

export type RecordActivityInput = {
  organizationId: string;
  entityType: ActivityEntityType;
  entityId: string;
  actorType: ActivityActorType;
  actorId?: string | null;
  action: string;
  changes?: ActivityChanges | null;
};

type ActivityTx = {
  activityEvent: {
    create: (args: {
      data: {
        organizationId: string;
        entityType: string;
        entityId: string;
        actorType: string;
        actorId?: string | null;
        action: string;
        changes?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
      };
    }) => Promise<unknown>;
  };
};

/**
 * Append an immutable activity row. Call inside the same tenant transaction as the mutation.
 */
export async function recordActivity(tx: ActivityTx, input: RecordActivityInput): Promise<void> {
  await tx.activityEvent.create({
    data: {
      organizationId: input.organizationId,
      entityType: input.entityType,
      entityId: input.entityId,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      action: input.action,
      changes: input.changes
        ? (input.changes as Prisma.InputJsonValue)
        : undefined,
    },
  });
}

/** Diff scalar fields for activity `changes` payloads. */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: string[],
): ActivityChanges | null {
  const changes: ActivityChanges = {};
  for (const field of fields) {
    const from = before[field] ?? null;
    const to = after[field] ?? null;
    if (String(from ?? "") !== String(to ?? "")) {
      changes[field] = { from, to };
    }
  }
  return Object.keys(changes).length ? changes : null;
}
