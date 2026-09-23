import { Prisma } from "@prisma/client";
import type { TenantPrisma } from "../tenant/prisma-tenant.js";

function n(v: Prisma.Decimal | number | string | null | undefined): number {
  return Number(v ?? 0);
}

export type CostCategory = "material" | "labor" | "other";

export type ProjectCostSummary = {
  revenue: number;
  budgeted: { material: number; labor: number; other: number; total: number };
  committed: { material: number; total: number };
  actual: {
    material: number;
    labor: number;
    expenses: number;
    /** expenses linked to material orders (excluded from total to avoid double-count) */
    expensesLinkedToOrders: number;
    total: number;
  };
  margin: number;
  marginPercent: number | null;
  wasteHints: { description: string; budgetedQty: number; usedQty: number; deltaQty: number }[];
};

/** Freeze selected quote line costs onto the project (idempotent). */
export async function freezeProjectBudget(
  tx: TenantPrisma,
  params: { organizationId: string; projectId: string; quoteId: string },
): Promise<void> {
  const project = await tx.project.findFirst({ where: { id: params.projectId } });
  if (!project) throw new Error("Project not found");
  if (project.budgetFrozenAt) return;

  const quote = await tx.quote.findFirst({
    where: { id: params.quoteId },
    include: {
      lineItems: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!quote) throw new Error("Quote not found");

  const selected = quote.lineItems.filter((li) => !li.isOptional || li.isSelected);
  let material = 0;
  let labor = 0;
  let other = 0;
  let sort = 0;

  for (const li of selected) {
    const qty = n(li.quantity);
    const unitCost = n(li.unitCost);
    const amount = Number((qty * unitCost).toFixed(2));
    const category: CostCategory =
      li.itemType === "product" || /material/i.test(li.description)
        ? "material"
        : /labor/i.test(li.description) || /labor/i.test(li.name || "")
          ? "labor"
          : unitCost > 0
            ? "material"
            : "other";

    if (category === "material") material += amount;
    else if (category === "labor") labor += amount;
    else other += amount;

    sort += 1;
    await tx.projectBudgetLine.create({
      data: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        quoteLineItemId: li.id,
        category,
        description: li.name || li.description,
        quantity: li.quantity,
        unitCost: li.unitCost,
        amount: new Prisma.Decimal(amount.toFixed(2)),
        sortOrder: sort,
      },
    });
  }

  // Quote-level laborCost/materialCost as fallback when line unitCosts are empty
  if (material === 0 && n(quote.materialCost) > 0) {
    material = n(quote.materialCost);
    await tx.projectBudgetLine.create({
      data: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        category: "material",
        description: "Quoted material (rollup)",
        quantity: new Prisma.Decimal(1),
        unitCost: quote.materialCost,
        amount: quote.materialCost,
        sortOrder: sort + 1,
      },
    });
  }
  if (labor === 0 && n(quote.laborCost) > 0) {
    labor = n(quote.laborCost);
    await tx.projectBudgetLine.create({
      data: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        category: "labor",
        description: "Quoted labor (rollup)",
        quantity: new Prisma.Decimal(1),
        unitCost: quote.laborCost,
        amount: quote.laborCost,
        sortOrder: sort + 2,
      },
    });
  }

  await tx.project.update({
    where: { id: params.projectId },
    data: {
      budgetFrozenAt: new Date(),
      budgetedMaterial: new Prisma.Decimal(material.toFixed(2)),
      budgetedLabor: new Prisma.Decimal(labor.toFixed(2)),
      budgetedOther: new Prisma.Decimal(other.toFixed(2)),
    },
  });
}

export async function resolveHourlyRate(
  tx: TenantPrisma,
  params: { organizationId: string; userId?: string | null; roleKey?: string | null; on: Date },
): Promise<number> {
  const on = params.on;
  if (params.userId) {
    const userRate = await tx.laborRate.findFirst({
      where: {
        userId: params.userId,
        effectiveFrom: { lte: on },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }],
      },
      orderBy: { effectiveFrom: "desc" },
    });
    if (userRate) return n(userRate.hourlyRate);
  }
  if (params.roleKey) {
    const roleRate = await tx.laborRate.findFirst({
      where: {
        userId: null,
        roleKey: params.roleKey,
        effectiveFrom: { lte: on },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }],
      },
      orderBy: { effectiveFrom: "desc" },
    });
    if (roleRate) return n(roleRate.hourlyRate);
  }
  return 0;
}

/**
 * Summarize budgeted / committed / actual.
 * Anti-double-count: expenses with materialOrderId are tracked separately and
 * excluded from actual.total (order qty×unitCost already counts material actual).
 * Expenses with quoteLineItemId still count as actual cash out but are flagged.
 */
export async function summarizeProjectCosts(
  tx: TenantPrisma,
  projectId: string,
): Promise<ProjectCostSummary> {
  const project = await tx.project.findFirst({
    where: { id: projectId },
    include: {
      quote: true,
      budgetLines: true,
      materialOrders: { where: { status: { not: "canceled" } } },
      laborEntries: true,
      expenses: { where: { status: { not: "void" } } },
    },
  });
  if (!project) throw new Error("Project not found");

  const budgetedMaterial =
    n(project.budgetedMaterial) ||
    project.budgetLines.filter((b) => b.category === "material").reduce((s, b) => s + n(b.amount), 0);
  const budgetedLabor =
    n(project.budgetedLabor) ||
    project.budgetLines.filter((b) => b.category === "labor").reduce((s, b) => s + n(b.amount), 0);
  const budgetedOther =
    n(project.budgetedOther) ||
    project.budgetLines.filter((b) => b.category === "other").reduce((s, b) => s + n(b.amount), 0);
  const budgetedTotal = budgetedMaterial + budgetedLabor + budgetedOther;

  const committedMaterial = project.materialOrders.reduce(
    (s, o) => s + n(o.quantityOrdered) * n(o.unitCost),
    0,
  );

  const actualMaterial = project.materialOrders.reduce((s, o) => {
    const used = n(o.quantityUsed);
    const received = n(o.quantityReceived);
    const qty = used > 0 ? used : received;
    return s + qty * n(o.unitCost);
  }, 0);

  const actualLabor = project.laborEntries.reduce((s, e) => s + n(e.amount), 0);

  let expensesLinked = 0;
  let expensesCounted = 0;
  for (const e of project.expenses) {
    if (e.materialOrderId) {
      expensesLinked += n(e.amount);
      continue;
    }
    expensesCounted += n(e.amount);
  }

  const actualTotal = actualMaterial + actualLabor + expensesCounted;
  const revenue = n(project.quote?.total);
  const margin = revenue - actualTotal;
  const marginPercent = revenue > 0 ? (margin / revenue) * 100 : null;

  const wasteHints: ProjectCostSummary["wasteHints"] = [];
  for (const line of project.budgetLines.filter((b) => b.category === "material")) {
    const used = project.materialOrders
      .filter((o) => o.description === line.description)
      .reduce((s, o) => s + n(o.quantityUsed), 0);
    if (used > 0 || n(line.quantity) > 0) {
      wasteHints.push({
        description: line.description,
        budgetedQty: n(line.quantity),
        usedQty: used,
        deltaQty: used - n(line.quantity),
      });
    }
  }

  return {
    revenue,
    budgeted: {
      material: Number(budgetedMaterial.toFixed(2)),
      labor: Number(budgetedLabor.toFixed(2)),
      other: Number(budgetedOther.toFixed(2)),
      total: Number(budgetedTotal.toFixed(2)),
    },
    committed: {
      material: Number(committedMaterial.toFixed(2)),
      total: Number(committedMaterial.toFixed(2)),
    },
    actual: {
      material: Number(actualMaterial.toFixed(2)),
      labor: Number(actualLabor.toFixed(2)),
      expenses: Number(expensesCounted.toFixed(2)),
      expensesLinkedToOrders: Number(expensesLinked.toFixed(2)),
      total: Number(actualTotal.toFixed(2)),
    },
    margin: Number(margin.toFixed(2)),
    marginPercent: marginPercent != null ? Number(marginPercent.toFixed(2)) : null,
    wasteHints,
  };
}

export function profitabilityCsv(
  projectName: string,
  summary: ProjectCostSummary,
): string {
  const rows = [
    ["Project", projectName],
    ["Revenue", summary.revenue.toFixed(2)],
    ["Budgeted material", summary.budgeted.material.toFixed(2)],
    ["Budgeted labor", summary.budgeted.labor.toFixed(2)],
    ["Budgeted other", summary.budgeted.other.toFixed(2)],
    ["Budgeted total", summary.budgeted.total.toFixed(2)],
    ["Committed material", summary.committed.material.toFixed(2)],
    ["Actual material", summary.actual.material.toFixed(2)],
    ["Actual labor", summary.actual.labor.toFixed(2)],
    ["Actual expenses (excl. linked to POs)", summary.actual.expenses.toFixed(2)],
    ["Expenses linked to material orders", summary.actual.expensesLinkedToOrders.toFixed(2)],
    ["Actual total", summary.actual.total.toFixed(2)],
    ["Margin", summary.margin.toFixed(2)],
    ["Margin %", summary.marginPercent != null ? String(summary.marginPercent) : ""],
    [],
    ["Waste hints (description)", "Budgeted qty", "Used qty", "Delta"],
    ...summary.wasteHints.map((w) => [
      w.description,
      String(w.budgetedQty),
      String(w.usedQty),
      String(w.deltaQty),
    ]),
  ];
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}

/** Pure helper for tests: actual total excluding linked material-order expenses. */
export function actualTotalExcludingLinked(params: {
  materialActual: number;
  laborActual: number;
  expenses: { amount: number; materialOrderId?: string | null }[];
}): number {
  const exp = params.expenses
    .filter((e) => !e.materialOrderId)
    .reduce((s, e) => s + e.amount, 0);
  return params.materialActual + params.laborActual + exp;
}
