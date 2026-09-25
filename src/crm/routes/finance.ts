/**
 * Finance module APIs — cash flow, receivables, payroll abatement, costs/receipts (+ scan).
 */
import { Router } from "express";
import type { AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { storage } from "../../lib/storage/index.js";
import { dec, requireCrmAuth, requireCrmPermission } from "../http.js";
import {
  extractReceiptFromDataUrl,
  isReceiptOcrConfigured,
} from "../../lib/finance/receipt-ocr.js";

export const financeRouter = Router();

function parseDateOnly(raw: unknown, fallback?: Date): Date | null {
  if (raw == null || raw === "") return fallback ?? null;
  const s = String(raw).trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = new Date(s.slice(0, 10) + "T12:00:00.000Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

function periodBounds(req: AuthedRequest): { from: Date; to: Date } {
  const now = new Date();
  const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 12));
  const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 12));
  const from = parseDateOnly(req.query.from, defaultFrom)!;
  const to = parseDateOnly(req.query.to, defaultTo)!;
  return { from, to };
}

function money(n: number) {
  return Math.round(n * 100) / 100;
}

/** GET /api/finance/summary — KPIs for the selected period */
financeRouter.get(
  "/api/finance/summary",
  requireCrmAuth,
  requireCrmPermission("finance.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const { from, to } = periodBounds(req);
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const [receipts, costs, abatements, openInvoices] = await Promise.all([
          tx.invoiceReceipt.findMany({
            where: { paidAt: { gte: from, lte: new Date(to.getTime() + 24 * 3600 * 1000 - 1) } },
            select: { amount: true },
          }),
          tx.financeCost.findMany({
            where: {
              status: "posted",
              incurredOn: { gte: from, lte: to },
            },
            select: { amount: true },
          }),
          tx.financePayrollAbatement.findMany({
            where: {
              status: { in: ["paid", "pending"] },
              paidOn: { gte: from, lte: to },
            },
            select: { amount: true, status: true },
          }),
          tx.quoteInvoice.findMany({
            where: { status: { in: ["sent", "partially_paid", "draft"] } },
            include: { receipts: { select: { amount: true } } },
          }),
        ]);

        const inflow = receipts.reduce((s, r) => s + dec(r.amount), 0);
        const costOut = costs.reduce((s, c) => s + dec(c.amount), 0);
        const payrollOut = abatements
          .filter((a) => a.status === "paid")
          .reduce((s, a) => s + dec(a.amount), 0);
        const payrollPending = abatements
          .filter((a) => a.status === "pending")
          .reduce((s, a) => s + dec(a.amount), 0);

        let receivables = 0;
        for (const inv of openInvoices) {
          if (inv.status === "draft") continue;
          const paid = inv.receipts.reduce((s, r) => s + dec(r.amount), 0);
          const bal = Math.max(0, dec(inv.amount) - paid);
          receivables += bal;
        }

        return {
          from: from.toISOString().slice(0, 10),
          to: to.toISOString().slice(0, 10),
          inflow: money(inflow),
          outflow: money(costOut + payrollOut),
          net: money(inflow - costOut - payrollOut),
          receivables: money(receivables),
          payroll_pending: money(payrollPending),
          costs: money(costOut),
          payroll_paid: money(payrollOut),
        };
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

/** GET /api/finance/cashflow — ledger lines for the period */
financeRouter.get(
  "/api/finance/cashflow",
  requireCrmAuth,
  requireCrmPermission("finance.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const { from, to } = periodBounds(req);
      const toEnd = new Date(to.getTime() + 24 * 3600 * 1000 - 1);
      const rows = await withTenantTransaction(req.organizationId!, async (tx) => {
        const [receipts, costs, abatements] = await Promise.all([
          tx.invoiceReceipt.findMany({
            where: { paidAt: { gte: from, lte: toEnd } },
            include: {
              invoice: {
                select: { invoiceNumber: true, id: true, customer: { select: { name: true } } },
              },
            },
            orderBy: { paidAt: "desc" },
          }),
          tx.financeCost.findMany({
            where: { status: "posted", incurredOn: { gte: from, lte: to } },
            orderBy: { incurredOn: "desc" },
          }),
          tx.financePayrollAbatement.findMany({
            where: { status: "paid", paidOn: { gte: from, lte: to } },
            orderBy: { paidOn: "desc" },
          }),
        ]);

        const lines: Array<{
          id: string;
          date: string;
          direction: "in" | "out";
          kind: string;
          label: string;
          amount: number;
          meta?: Record<string, unknown>;
        }> = [];

        for (const r of receipts) {
          const invNo = r.invoice?.invoiceNumber || r.invoiceId.slice(0, 8);
          const cust = r.invoice?.customer?.name || "";
          lines.push({
            id: `rcp_${r.id}`,
            date: r.paidAt.toISOString().slice(0, 10),
            direction: "in",
            kind: "invoice_receipt",
            label: cust ? `Recebimento · Invoice ${invNo} · ${cust}` : `Recebimento · Invoice ${invNo}`,
            amount: money(dec(r.amount)),
            meta: { invoice_id: r.invoiceId, method: r.method },
          });
        }
        for (const c of costs) {
          lines.push({
            id: `cost_${c.id}`,
            date: c.incurredOn.toISOString().slice(0, 10),
            direction: "out",
            kind: "cost",
            label: c.vendorName ? `${c.description} · ${c.vendorName}` : c.description,
            amount: money(dec(c.amount)),
            meta: { category: c.category, source: c.source, cost_id: c.id },
          });
        }
        for (const a of abatements) {
          lines.push({
            id: `pay_${a.id}`,
            date: a.paidOn.toISOString().slice(0, 10),
            direction: "out",
            kind: "payroll",
            label: `Folha · ${a.label}`,
            amount: money(dec(a.amount)),
            meta: { period_id: a.periodId, method: a.method },
          });
        }

        lines.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
        return lines;
      });
      res.json({ success: true, data: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), lines: rows } });
    } catch (error) {
      next(error);
    }
  },
);

/** GET /api/finance/receivables — open balances from sent invoices */
financeRouter.get(
  "/api/finance/receivables",
  requireCrmAuth,
  requireCrmPermission("finance.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const invoices = await tx.quoteInvoice.findMany({
          where: { status: { in: ["sent", "partially_paid"] } },
          include: {
            customer: { select: { id: true, name: true } },
            receipts: { select: { amount: true, paidAt: true } },
          },
          orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
        });
        return invoices.map((inv) => {
          const paid = inv.receipts.reduce((s, r) => s + dec(r.amount), 0);
          const total = dec(inv.amount);
          const balance = money(Math.max(0, total - paid));
          const due = inv.dueDate ? inv.dueDate.toISOString().slice(0, 10) : null;
          const overdue = due ? due < new Date().toISOString().slice(0, 10) && balance > 0 : false;
          return {
            id: inv.id,
            invoice_number: inv.invoiceNumber,
            status: inv.status,
            customer_name: inv.customer?.name || "—",
            customer_id: inv.customerId,
            amount: money(total),
            paid: money(paid),
            balance,
            due_date: due,
            issued_at: inv.issuedAt?.toISOString() || inv.createdAt.toISOString(),
            overdue,
          };
        });
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

/** GET /api/finance/payroll — periods + abatement status */
financeRouter.get(
  "/api/finance/payroll",
  requireCrmAuth,
  requireCrmPermission("finance.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const [periods, abatements] = await Promise.all([
          tx.payrollPeriod.findMany({
            include: {
              timesheets: {
                include: { employee: { select: { hourlyRate: true, name: true } } },
              },
            },
            orderBy: { startDate: "desc" },
            take: 40,
          }),
          tx.financePayrollAbatement.findMany({
            where: { status: { not: "void" } },
            orderBy: { paidOn: "desc" },
          }),
        ]);

        const byPeriod = new Map(abatements.filter((a) => a.periodId).map((a) => [a.periodId!, a]));

        const periodRows = periods.map((p) => {
          let estimated = 0;
          for (const t of p.timesheets) {
            estimated += dec(t.hours) * dec(t.employee?.hourlyRate ?? 0);
          }
          const ab = byPeriod.get(p.id);
          return {
            id: p.id,
            label: p.label,
            start_date: p.startDate.toISOString().slice(0, 10),
            end_date: p.endDate.toISOString().slice(0, 10),
            status: p.status,
            estimated_cost: money(estimated),
            timesheet_count: p.timesheets.length,
            abatement: ab
              ? {
                  id: ab.id,
                  amount: money(dec(ab.amount)),
                  paid_on: ab.paidOn.toISOString().slice(0, 10),
                  status: ab.status,
                  method: ab.method,
                }
              : null,
          };
        });

        return {
          periods: periodRows,
          abatements: abatements.map((a) => ({
            id: a.id,
            period_id: a.periodId,
            label: a.label,
            amount: money(dec(a.amount)),
            paid_on: a.paidOn.toISOString().slice(0, 10),
            status: a.status,
            method: a.method,
            notes: a.notes,
          })),
        };
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

/** POST /api/finance/payroll/abatements — register payroll cash outflow */
financeRouter.post(
  "/api/finance/payroll/abatements",
  requireCrmAuth,
  requireCrmPermission("finance.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = req.body || {};
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        res.status(400).json({ success: false, error: "Informe um valor válido" });
        return;
      }
      const paidOn = parseDateOnly(body.paid_on || body.paidOn, new Date());
      if (!paidOn) {
        res.status(400).json({ success: false, error: "Data inválida" });
        return;
      }
      const periodId = body.period_id || body.periodId || null;
      const label = String(body.label || "").trim() || "Abatimento de folha";
      const method = body.method ? String(body.method) : null;
      const notes = body.notes ? String(body.notes) : null;
      const status = body.status === "pending" ? "pending" : "paid";

      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        if (periodId) {
          const period = await tx.payrollPeriod.findFirst({ where: { id: String(periodId) } });
          if (!period) {
            const err = new Error("Período de folha não encontrado");
            (err as Error & { status: number }).status = 404;
            throw err;
          }
          const existing = await tx.financePayrollAbatement.findFirst({
            where: { periodId: period.id, status: { not: "void" } },
          });
          if (existing) {
            return tx.financePayrollAbatement.update({
              where: { id: existing.id },
              data: {
                label: label || period.label,
                amount,
                paidOn,
                method,
                notes,
                status,
              },
            });
          }
          return tx.financePayrollAbatement.create({
            data: {
              organizationId: req.organizationId!,
              periodId: period.id,
              label: label || period.label,
              amount,
              paidOn,
              method,
              notes,
              status,
            },
          });
        }
        return tx.financePayrollAbatement.create({
          data: {
            organizationId: req.organizationId!,
            label,
            amount,
            paidOn,
            method,
            notes,
            status,
          },
        });
      });

      res.json({
        success: true,
        data: {
          id: row.id,
          period_id: row.periodId,
          label: row.label,
          amount: money(dec(row.amount)),
          paid_on: row.paidOn.toISOString().slice(0, 10),
          status: row.status,
        },
      });
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 404) {
        res.status(404).json({ success: false, error: (error as Error).message });
        return;
      }
      next(error);
    }
  },
);

/** GET /api/finance/costs */
financeRouter.get(
  "/api/finance/costs",
  requireCrmAuth,
  requireCrmPermission("finance.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const { from, to } = periodBounds(req);
      const status = String(req.query.status || "posted");
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const rows = await tx.financeCost.findMany({
          where: {
            incurredOn: { gte: from, lte: to },
            ...(status === "all" ? {} : { status }),
          },
          orderBy: { incurredOn: "desc" },
        });
        return rows.map((c) => ({
          id: c.id,
          description: c.description,
          category: c.category,
          amount: money(dec(c.amount)),
          incurred_on: c.incurredOn.toISOString().slice(0, 10),
          vendor_name: c.vendorName,
          source: c.source,
          receipt_url: c.receiptUrl,
          ocr_status: c.ocrStatus,
          ocr_vendor: c.ocrVendor,
          ocr_amount: c.ocrAmount != null ? money(dec(c.ocrAmount)) : null,
          notes: c.notes,
          status: c.status,
        }));
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

async function uploadReceiptDataUrl(
  organizationId: string,
  dataUrl: string,
): Promise<{ url: string; key: string } | null> {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(String(dataUrl || "").trim());
  if (!match) return null;
  const contentType = match[1]!;
  const ok =
    contentType.startsWith("image/") ||
    contentType === "application/pdf" ||
    contentType === "image/heic" ||
    contentType === "image/heif";
  if (!ok) return null;
  const body = Buffer.from(match[2]!, "base64");
  if (body.length > 12 * 1024 * 1024) return null;
  const ext = contentType.includes("png")
    ? "png"
    : contentType.includes("webp")
      ? "webp"
      : contentType.includes("pdf")
        ? "pdf"
        : contentType.includes("heic") || contentType.includes("heif")
          ? "heic"
          : "jpg";
  const key = `orgs/${organizationId}/finance-receipts/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const stored = await storage.upload({ key, body, contentType });
  return { url: stored.url, key };
}

/** POST /api/finance/costs — manual cost entry */
financeRouter.post(
  "/api/finance/costs",
  requireCrmAuth,
  requireCrmPermission("finance.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = req.body || {};
      const description = String(body.description || "").trim();
      const amount = Number(body.amount);
      if (!description) {
        res.status(400).json({ success: false, error: "Descrição obrigatória" });
        return;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        res.status(400).json({ success: false, error: "Valor inválido" });
        return;
      }
      const incurredOn = parseDateOnly(body.incurred_on || body.incurredOn, new Date());
      if (!incurredOn) {
        res.status(400).json({ success: false, error: "Data inválida" });
        return;
      }

      let receiptUrl: string | null = null;
      let receiptKey: string | null = null;
      if (body.receipt_data_url || body.receiptDataUrl) {
        const up = await uploadReceiptDataUrl(
          req.organizationId!,
          body.receipt_data_url || body.receiptDataUrl,
        );
        if (!up) {
          res.status(400).json({ success: false, error: "Ficheiro de recibo inválido (imagem/PDF até 12MB)" });
          return;
        }
        receiptUrl = up.url;
        receiptKey = up.key;
      }

      const row = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.financeCost.create({
          data: {
            organizationId: req.organizationId!,
            description,
            category: String(body.category || "other"),
            amount,
            incurredOn,
            vendorName: body.vendor_name || body.vendorName || null,
            source: "manual",
            receiptUrl,
            receiptKey,
            ocrStatus: "none",
            notes: body.notes || null,
            status: body.status === "draft" ? "draft" : "posted",
          },
        }),
      );

      res.json({
        success: true,
        data: {
          id: row.id,
          description: row.description,
          amount: money(dec(row.amount)),
          incurred_on: row.incurredOn.toISOString().slice(0, 10),
          receipt_url: row.receiptUrl,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/finance/costs/scan
 * Mobile/camera receipt or nota fiscal upload + OCR extraction.
 * When amount is extracted with enough confidence, posts into cash flow automatically.
 */
financeRouter.post(
  "/api/finance/costs/scan",
  requireCrmAuth,
  requireCrmPermission("finance.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = req.body || {};
      const dataUrl = body.receipt_data_url || body.receiptDataUrl || body.image;
      if (!dataUrl) {
        res.status(400).json({ success: false, error: "Envie a imagem do recibo ou nota fiscal" });
        return;
      }
      const up = await uploadReceiptDataUrl(req.organizationId!, String(dataUrl));
      if (!up) {
        res.status(400).json({ success: false, error: "Ficheiro inválido (imagem/PDF até 12MB)" });
        return;
      }

      const amountHint =
        body.amount != null && body.amount !== "" ? Number(body.amount) : null;
      const vendorHint = body.vendor_name || body.vendorName || body.ocr_vendor || null;
      const dateHintRaw = body.incurred_on || body.incurredOn || body.ocr_date || null;

      const ocr = await extractReceiptFromDataUrl(String(dataUrl));

      const amountFromOcr = ocr.amount != null && ocr.amount > 0 ? ocr.amount : null;
      const amountFromHint =
        amountHint != null && Number.isFinite(amountHint) && amountHint > 0 ? amountHint : null;
      const amount = amountFromHint ?? amountFromOcr;

      const vendorName = vendorHint
        ? String(vendorHint)
        : ocr.vendorName
          ? String(ocr.vendorName)
          : null;

      const dateFromOcr = ocr.date ? parseDateOnly(ocr.date) : null;
      const dateFromHint = dateHintRaw ? parseDateOnly(dateHintRaw) : null;
      const incurredOn = dateFromHint || dateFromOcr || new Date();

      const description =
        String(body.description || "").trim() ||
        ocr.description ||
        (vendorName ? `Recibo · ${vendorName}` : "Recibo / nota fiscal (scan)");

      const category = String(body.category || ocr.category || "other");

      const confidence = ocr.confidence ?? 0;
      const autoPostThreshold = Number(process.env.FINANCE_OCR_AUTO_POST_MIN || 0.55);
      const forcePost = body.post === true;
      const forceDraft = body.post === false;
      const canAutoPost =
        amount != null &&
        amount > 0 &&
        (forcePost ||
          (!forceDraft &&
            (amountFromHint != null ||
              (ocr.status === "extracted" && confidence >= autoPostThreshold))));

      let ocrStatus: string = "none";
      if (amountFromHint != null && ocr.status !== "extracted") ocrStatus = "skipped";
      else if (ocr.status === "extracted") ocrStatus = "extracted";
      else if (ocr.status === "unavailable") ocrStatus = "pending";
      else if (ocr.status === "failed") ocrStatus = "failed";
      else ocrStatus = "pending";

      const row = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.financeCost.create({
          data: {
            organizationId: req.organizationId!,
            description,
            category,
            amount: amount != null && amount > 0 ? amount : 0.01,
            incurredOn,
            vendorName,
            source: "scan",
            receiptUrl: up.url,
            receiptKey: up.key,
            ocrStatus,
            ocrVendor: ocr.vendorName || vendorName,
            ocrAmount: amountFromOcr,
            ocrDate: dateFromOcr,
            ocrRaw: {
              provider: ocr.provider,
              status: ocr.status,
              confidence,
              currency: ocr.currency,
              error: ocr.error || null,
              configured: isReceiptOcrConfigured(),
              captured_at: new Date().toISOString(),
              result: ocr.raw,
            },
            notes: body.notes || null,
            status: canAutoPost ? "posted" : "draft",
          },
        }),
      );

      const needsReview = row.status === "draft";
      let message: string;
      if (row.status === "posted" && ocr.status === "extracted") {
        message = "Scan lido automaticamente e custo lançado no fluxo de caixa.";
      } else if (row.status === "posted") {
        message = "Custo lançado a partir do scan.";
      } else if (ocr.status === "unavailable") {
        message =
          "Recibo guardado. Configure OPENAI_API_KEY para leitura automática, ou confirme o valor manualmente.";
      } else if (ocr.status === "extracted" && needsReview) {
        message = "Dados extraídos — confirme o valor para lançar no fluxo de caixa.";
      } else if (ocr.error) {
        message = `Scan guardado como rascunho (${ocr.error}). Confirme o valor para lançar.`;
      } else {
        message = "Scan guardado como rascunho — confirme o valor para lançar no fluxo de caixa.";
      }

      res.json({
        success: true,
        data: {
          id: row.id,
          description: row.description,
          amount: money(dec(row.amount)),
          incurred_on: row.incurredOn.toISOString().slice(0, 10),
          vendor_name: row.vendorName,
          category: row.category,
          receipt_url: row.receiptUrl,
          ocr_status: row.ocrStatus,
          ocr: {
            status: ocr.status,
            provider: ocr.provider,
            confidence,
            vendor_name: ocr.vendorName,
            amount: amountFromOcr,
            date: ocr.date,
            description: ocr.description,
            category: ocr.category,
            currency: ocr.currency,
            error: ocr.error || null,
            configured: isReceiptOcrConfigured(),
          },
          status: row.status,
          needs_review: needsReview,
          auto_posted: row.status === "posted",
        },
        message,
      });
    } catch (error) {
      next(error);
    }
  },
);

/** GET /api/finance/ocr-status — whether automatic OCR is configured */
financeRouter.get(
  "/api/finance/ocr-status",
  requireCrmAuth,
  requireCrmPermission("finance.view"),
  (_req, res) => {
    res.json({
      success: true,
      data: {
        configured: isReceiptOcrConfigured(),
        provider: isReceiptOcrConfigured() ? "openai_vision" : null,
      },
    });
  },
);

/** PATCH /api/finance/costs/:id — confirm/update draft from scan */
financeRouter.patch(
  "/api/finance/costs/:id",
  requireCrmAuth,
  requireCrmPermission("finance.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id || "");
      const body = req.body || {};
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.financeCost.findFirst({ where: { id } });
        if (!existing) return null;
        const data: Record<string, unknown> = {};
        if (body.description != null) data.description = String(body.description).trim();
        if (body.category != null) data.category = String(body.category);
        if (body.amount != null) {
          const amount = Number(body.amount);
          if (!Number.isFinite(amount) || amount <= 0) {
            const err = new Error("Valor inválido");
            (err as Error & { status: number }).status = 400;
            throw err;
          }
          data.amount = amount;
        }
        if (body.incurred_on || body.incurredOn) {
          const d = parseDateOnly(body.incurred_on || body.incurredOn);
          if (!d) {
            const err = new Error("Data inválida");
            (err as Error & { status: number }).status = 400;
            throw err;
          }
          data.incurredOn = d;
        }
        if (body.vendor_name != null || body.vendorName != null) {
          data.vendorName = body.vendor_name || body.vendorName || null;
        }
        if (body.notes != null) data.notes = body.notes || null;
        if (body.status === "posted" || body.status === "draft" || body.status === "void") {
          data.status = body.status;
        }
        if (body.ocr_status) data.ocrStatus = String(body.ocr_status);
        return tx.financeCost.update({ where: { id }, data });
      });
      if (!row) {
        res.status(404).json({ success: false, error: "Custo não encontrado" });
        return;
      }
      res.json({
        success: true,
        data: {
          id: row.id,
          description: row.description,
          amount: money(dec(row.amount)),
          status: row.status,
          receipt_url: row.receiptUrl,
        },
      });
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 400) {
        res.status(400).json({ success: false, error: (error as Error).message });
        return;
      }
      next(error);
    }
  },
);
