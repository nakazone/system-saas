/**
 * Job → Fatura (fixed-price flow for Builders, Contractors and Lojas).
 * The job's service lines, priced from the Tabela de Valores, are billed directly — no quote.
 */
import { Router } from "express";
import { z } from "zod";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth, requireCrmPermission, dec } from "../http.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { computeInvoiceMoney, invoiceKindLabel } from "../../lib/invoices/core.js";
import { createJobInvoice, jobBilling, jobBillingLabel } from "../../lib/invoices/job.js";

export const jobInvoicesRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00.000Z`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

jobInvoicesRouter.get(
  "/api/work-orders/:id/invoices",
  requireCrmAuth,
  requireCrmPermission("invoices.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      if (!UUID_RE.test(id)) {
        res.status(400).json({ success: false, error: "ID inválido" });
        return;
      }
      const now = new Date();
      const job = await withTenantTransaction(req.organizationId!, (tx) =>
        tx.workOrder.findFirst({
          where: { id },
          select: {
            id: true,
            lineItems: { select: { lineTotal: true } },
            invoices: {
              orderBy: { createdAt: "asc" },
              include: { receipts: { select: { amount: true, paidAt: true } } },
            },
          },
        }),
      );
      if (!job) {
        res.status(404).json({ success: false, error: "Job não encontrado" });
        return;
      }
      const total = job.lineItems.reduce((s, li) => s + dec(li.lineTotal), 0);
      const billing = jobBilling(total, job.invoices);
      res.json({
        success: true,
        data: job.invoices.map((inv) => {
          const m = computeInvoiceMoney(inv, now);
          return {
            id: inv.id,
            invoice_number: inv.invoiceNumber,
            invoice_type: inv.invoiceType,
            invoice_type_label: invoiceKindLabel(inv.invoiceType, "pt"),
            status: inv.status,
            display_status: m.displayStatus,
            amount: m.amount,
            paid_amount: m.paid,
            remaining_amount: m.balance,
            due_date: inv.dueDate,
            days_overdue: m.daysOverdue,
            created_at: inv.createdAt,
            url: `invoice.html?id=${encodeURIComponent(inv.id)}`,
          };
        }),
        billing: { ...billing, billing_status_label: jobBillingLabel(billing.billing_status) },
      });
    } catch (error) {
      next(error);
    }
  },
);

const createSchema = z.object({
  invoice_type: z.enum(["full", "final", "deposit", "progress", "custom"]).optional(),
  deposit_pct: z.coerce.number().optional().nullable(),
  custom_amount: z.coerce.number().optional().nullable(),
  due_date: z.string().optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  payment_instructions: z.string().max(4000).optional().nullable(),
});

jobInvoicesRouter.post(
  "/api/work-orders/:id/invoices",
  requireCrmAuth,
  requireCrmPermission("invoices.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      if (!UUID_RE.test(id)) {
        res.status(400).json({ success: false, error: "ID inválido" });
        return;
      }
      const parsed = createSchema.safeParse(req.body || {});
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Dados inválidos" });
        return;
      }
      const b = parsed.data;
      const result = await withTenantTransaction(req.organizationId!, (tx) =>
        createJobInvoice(tx, {
          organizationId: req.organizationId!,
          workOrderId: id,
          actorId: req.user!.id,
          kind: b.invoice_type || "full",
          depositPct: b.deposit_pct,
          customAmount: b.custom_amount,
          dueDate: parseDate(b.due_date),
          notes: b.notes,
          paymentInstructions: b.payment_instructions,
        }),
      );
      if (!result.ok) {
        res.status(result.status).json({ success: false, error: result.error });
        return;
      }
      res.status(201).json({
        success: true,
        data: {
          id: result.invoice.id,
          invoice_number: result.invoice.invoiceNumber,
          invoice_type: result.invoice.invoiceType,
          status: result.invoice.status,
          amount: result.invoice.amount,
          due_date: result.invoice.dueDate,
        },
        redirect: `invoices.html?id=${encodeURIComponent(result.invoice.id)}&new=1`,
        billing: { ...result.billing, billing_status_label: jobBillingLabel(result.billing.billing_status) },
      });
    } catch (error) {
      next(error);
    }
  },
);
