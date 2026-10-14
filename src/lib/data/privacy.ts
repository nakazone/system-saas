import { prisma } from "../prisma.js";

/** Pedidos de privacidade (acesso, correção, exclusão), com prazo de 30 dias. */

export const PRIVACY_DAYS = 30;

export const KIND_LABEL: Record<string, string> = {
  access: "Cópia dos dados",
  correction: "Correção",
  deletion: "Exclusão",
  other: "Outro",
};
export const STATUS_LABEL: Record<string, string> = {
  received: "Recebido",
  in_progress: "Em andamento",
  done: "Concluído",
  rejected: "Recusado",
};
export const OPEN_STATUSES = ["received", "in_progress"];

export function dueFrom(receivedAt: Date): Date {
  return new Date(receivedAt.getTime() + PRIVACY_DAYS * 86400e3);
}

/** Days until the deadline (negative = late). */
export function daysLeft(dueAt: Date, now = new Date()): number {
  return Math.ceil((dueAt.getTime() - now.getTime()) / 86400e3);
}

export type AttentionRow = { id: string; kind: string; requesterName: string; orgName: string | null; dueAt: Date; days: number };

/** Open requests due within 7 days or late (Central queue + menu badge). */
export async function privacyAttention(now = new Date()): Promise<AttentionRow[]> {
  const rows = await prisma.privacyRequest.findMany({
    where: { status: { in: OPEN_STATUSES }, dueAt: { lte: new Date(now.getTime() + 7 * 86400e3) } },
    orderBy: { dueAt: "asc" },
    select: { id: true, kind: true, requesterName: true, orgName: true, dueAt: true },
  });
  return rows.map((r: { id: string; kind: string; requesterName: string; orgName: string | null; dueAt: Date }) => ({ ...r, days: daysLeft(r.dueAt, now) }));
}
