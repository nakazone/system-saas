/**
 * Reembolsos / descontos ligados a um Dia de trabalho.
 * Aprovados entram no PayrollPeriodAdjustment da semana (pagamento).
 */
import { Prisma } from "@prisma/client";
import type { PayrollTx } from "../../crm/lib/payroll-employee-link.js";
import { periodFor } from "./day-service.js";

export type ExpenseKind = "reimbursement" | "discount";
export type ExpenseStatus = "pending" | "approved" | "rejected";

export function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "object" && v !== null && "toNumber" in v && typeof (v as { toNumber: () => number }).toNumber === "function") {
    return (v as { toNumber: () => number }).toNumber();
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function money(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function mapExpense(e: {
  id: string;
  kind: string;
  amount: unknown;
  description: string | null;
  receiptUrl: string | null;
  receiptKey: string | null;
  status: string;
  source: string;
  appliedAt: Date | null;
  reviewNote: string | null;
  createdAt: Date;
}) {
  return {
    id: e.id,
    kind: e.kind as ExpenseKind,
    kind_label: e.kind === "discount" ? "Desconto" : "Reembolso",
    amount: money(num(e.amount)),
    description: e.description,
    receipt_url: e.receiptUrl,
    receipt_key: e.receiptKey,
    status: e.status as ExpenseStatus,
    status_label:
      e.status === "approved" ? "Aprovado" : e.status === "rejected" ? "Recusado" : "Conferir",
    source: e.source,
    applied: Boolean(e.appliedAt),
    review_note: e.reviewNote,
    created_at: e.createdAt.toISOString(),
  };
}

/** Add approved (unapplied) expenses into the week's adjustment; reverse if rejected after apply. */
export async function syncExpenseIntoAdjustment(
  tx: PayrollTx,
  expenseId: string,
  nextStatus: ExpenseStatus,
  reviewerId: string | null,
  reviewNote?: string | null,
) {
  const e = await tx.campoShiftExpense.findFirst({
    where: { id: expenseId },
    include: { shift: { select: { workDate: true } } },
  });
  if (!e) throw Object.assign(new Error("Lançamento não encontrado"), { status: 404 });

  const period = await periodFor(tx, e.organizationId, e.shift.workDate);
  const amount = money(num(e.amount));
  const isReimb = e.kind === "reimbursement";

  if (nextStatus === "approved" && !e.appliedAt && period) {
    const adj = await tx.payrollPeriodAdjustment.findFirst({
      where: { periodId: period.id, employeeId: e.employeeId },
    });
    const reimbursement = money(num(adj?.reimbursement) + (isReimb ? amount : 0));
    const discount = money(num(adj?.discount) + (!isReimb ? amount : 0));
    await tx.payrollPeriodAdjustment.upsert({
      where: { periodId_employeeId: { periodId: period.id, employeeId: e.employeeId } },
      create: {
        organizationId: e.organizationId,
        periodId: period.id,
        employeeId: e.employeeId,
        reimbursement,
        discount,
        notes: adj?.notes || null,
      },
      update: { reimbursement, discount },
    });
  }

  if (nextStatus === "rejected" && e.appliedAt && period) {
    const adj = await tx.payrollPeriodAdjustment.findFirst({
      where: { periodId: period.id, employeeId: e.employeeId },
    });
    if (adj) {
      const reimbursement = money(Math.max(0, num(adj.reimbursement) - (isReimb ? amount : 0)));
      const discount = money(Math.max(0, num(adj.discount) - (!isReimb ? amount : 0)));
      await tx.payrollPeriodAdjustment.update({
        where: { id: adj.id },
        data: { reimbursement, discount },
      });
    }
  }

  return tx.campoShiftExpense.update({
    where: { id: e.id },
    data: {
      status: nextStatus,
      reviewedById: reviewerId,
      reviewedAt: new Date(),
      reviewNote: reviewNote?.trim() || null,
      appliedAt:
        nextStatus === "approved"
          ? e.appliedAt || new Date()
          : nextStatus === "rejected"
            ? null
            : e.appliedAt,
    },
  });
}

/** Approve every pending expense on a shift (used when the office approves the day). */
export async function approveShiftExpenses(tx: PayrollTx, shiftId: string, reviewerId: string) {
  const pending = await tx.campoShiftExpense.findMany({
    where: { shiftId, status: "pending" },
    select: { id: true },
  });
  for (const row of pending) {
    await syncExpenseIntoAdjustment(tx, row.id, "approved", reviewerId);
  }
  return pending.length;
}

export async function attachExpensesToShift(
  tx: PayrollTx,
  input: {
    organizationId: string;
    shiftId: string;
    employeeId: string;
    createdById: string | null;
    source: "employee" | "office";
    status?: ExpenseStatus;
    items: Array<{
      kind: ExpenseKind;
      amount: number;
      description?: string | null;
      receipt_url?: string | null;
      receipt_key?: string | null;
    }>;
  },
) {
  const created = [];
  for (const it of input.items) {
    const amount = money(it.amount);
    if (amount <= 0) continue;
    const row = await tx.campoShiftExpense.create({
      data: {
        organizationId: input.organizationId,
        shiftId: input.shiftId,
        employeeId: input.employeeId,
        kind: it.kind,
        amount: new Prisma.Decimal(amount),
        description: it.description?.trim() || null,
        receiptUrl: it.receipt_url || null,
        receiptKey: it.receipt_key || null,
        status: input.status || "pending",
        source: input.source,
        createdById: input.createdById,
      },
    });
    created.push(row);
  }
  return created;
}

/**
 * Edit a day reimbursement/discount. If it was already applied to the week
 * adjustment, reverse the old amount and apply the new one.
 */
export async function updateShiftExpense(
  tx: PayrollTx,
  expenseId: string,
  patch: {
    kind?: ExpenseKind;
    amount?: number;
    description?: string | null;
  },
  reviewerId: string | null,
) {
  const e = await tx.campoShiftExpense.findFirst({
    where: { id: expenseId },
    include: { shift: { select: { workDate: true } } },
  });
  if (!e) throw Object.assign(new Error("Lançamento não encontrado"), { status: 404 });

  const nextKind = (patch.kind || e.kind) as ExpenseKind;
  const nextAmount = patch.amount != null ? money(patch.amount) : money(num(e.amount));
  if (!(nextAmount > 0)) throw Object.assign(new Error("Informe o valor."), { status: 400 });
  const nextDesc = patch.description !== undefined ? patch.description?.trim() || null : e.description;
  const wasApplied = Boolean(e.appliedAt);
  const period = wasApplied ? await periodFor(tx, e.organizationId, e.shift.workDate) : null;

  if (wasApplied && period) {
    const adj = await tx.payrollPeriodAdjustment.findFirst({
      where: { periodId: period.id, employeeId: e.employeeId },
    });
    if (adj) {
      const oldReimb = e.kind === "reimbursement" ? money(num(e.amount)) : 0;
      const oldDisc = e.kind === "discount" ? money(num(e.amount)) : 0;
      await tx.payrollPeriodAdjustment.update({
        where: { id: adj.id },
        data: {
          reimbursement: money(Math.max(0, num(adj.reimbursement) - oldReimb)),
          discount: money(Math.max(0, num(adj.discount) - oldDisc)),
        },
      });
    }
  }

  const updated = await tx.campoShiftExpense.update({
    where: { id: e.id },
    data: {
      kind: nextKind,
      amount: new Prisma.Decimal(nextAmount),
      description: nextDesc,
      reviewedById: reviewerId,
      reviewedAt: new Date(),
    },
  });

  if (wasApplied && period && e.status === "approved") {
    const adj = await tx.payrollPeriodAdjustment.findFirst({
      where: { periodId: period.id, employeeId: e.employeeId },
    });
    const addR = nextKind === "reimbursement" ? nextAmount : 0;
    const addD = nextKind === "discount" ? nextAmount : 0;
    await tx.payrollPeriodAdjustment.upsert({
      where: { periodId_employeeId: { periodId: period.id, employeeId: e.employeeId } },
      create: {
        organizationId: e.organizationId,
        periodId: period.id,
        employeeId: e.employeeId,
        reimbursement: addR,
        discount: addD,
        notes: adj?.notes || null,
      },
      update: {
        reimbursement: money(num(adj?.reimbursement) + addR),
        discount: money(num(adj?.discount) + addD),
      },
    });
  }

  return updated;
}

/** After finish: keep day in review when there are receipts to check. */
export async function flagShiftForExpenses(tx: PayrollTx, shiftId: string) {
  const s = await tx.campoShift.findFirst({ where: { id: shiftId } });
  if (!s) return;
  const flags = Array.isArray(s.flags) ? [...(s.flags as string[])] : [];
  if (!flags.includes("reimbursement")) flags.push("reimbursement");
  if (s.reviewStatus === "approved") {
    const { removeDayFromPayroll } = await import("./day-service.js");
    const ok = await removeDayFromPayroll(tx, shiftId);
    if (!ok) return;
    await tx.campoShift.update({
      where: { id: shiftId },
      data: { flags, reviewStatus: "pending", reviewedAt: null, reviewedById: null },
    });
    return;
  }
  await tx.campoShift.update({
    where: { id: shiftId },
    data: { flags, ...(s.reviewStatus !== "in_progress" ? { reviewStatus: "pending" } : {}) },
  });
}
