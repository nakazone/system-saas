/**
 * Production pay by item — the company's rates and each employee's own rates (trades with piece
 * items, e.g. Tile). Hardwood companies get `enabled: false` and an empty list.
 *
 * GET  /api/payroll/piece-rates?employee_id=…  (payroll.view)
 * PUT  /api/payroll/piece-rates  { employee_id?: uuid|null, rates: { floor_sf: 1.5, niche: null } }  (payroll.manage)
 *      employee: null removes their own rate (back to the company rate).
 */
import { Router } from "express";
import { z } from "zod";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth, requireCrmPermission } from "../http.js";
import { withTenantTransaction, type TenantPrisma } from "../../lib/tenant/prisma-tenant.js";
import { UNIT_LABEL, loadRates, pieceItemsFor, saveRates } from "../../lib/payroll/piece-rates.js";

export const pieceRatesRouter = Router();

async function state(tx: TenantPrisma, req: AuthedRequest, employeeId: string | null) {
  const items = pieceItemsFor(req.organization?.tradePacks);
  if (employeeId) {
    const emp = await tx.payrollEmployee.findFirst({ where: { id: employeeId }, select: { id: true } });
    if (!emp) throw Object.assign(new Error("Funcionário não encontrado."), { status: 404 });
  }
  const rates = await loadRates(tx, items, employeeId);
  return {
    enabled: items.length > 0,
    employee_id: employeeId,
    units: UNIT_LABEL,
    items: rates,
  };
}

const uuid = z.string().uuid();

pieceRatesRouter.get("/api/payroll/piece-rates", requireCrmAuth, requireCrmPermission("payroll.view", "payroll.manage"), async (req: AuthedRequest, res, next) => {
  try {
    const raw = req.query.employee_id ? String(req.query.employee_id) : null;
    if (raw && !uuid.safeParse(raw).success) {
      res.status(400).json({ success: false, error: "Funcionário inválido." });
      return;
    }
    const data = await withTenantTransaction(req.organizationId!, (tx) => state(tx, req, raw));
    res.json({ success: true, data });
  } catch (error) {
    const e = error as { status?: number; message?: string };
    if (e.status) {
      res.status(e.status).json({ success: false, error: e.message });
      return;
    }
    next(error);
  }
});

const putBody = z.object({
  employee_id: uuid.nullable().optional(),
  rates: z.record(z.string(), z.number().min(0).max(100000).nullable()),
});

pieceRatesRouter.put("/api/payroll/piece-rates", requireCrmAuth, requireCrmPermission("payroll.manage"), async (req: AuthedRequest, res, next) => {
  try {
    const body = putBody.safeParse(req.body || {});
    if (!body.success) {
      res.status(400).json({ success: false, error: "Confira os valores." });
      return;
    }
    const items = pieceItemsFor(req.organization?.tradePacks);
    if (!items.length) {
      res.status(409).json({ success: false, code: "no_piece_items", error: "Este ofício paga produção por sq ft, sem itens." });
      return;
    }
    const employeeId = body.data.employee_id ?? null;
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      await state(tx, req, employeeId); // employee must exist in this company
      await saveRates(tx, req.organizationId!, items, employeeId, body.data.rates);
      return state(tx, req, employeeId);
    });
    res.json({ success: true, data });
  } catch (error) {
    const e = error as { status?: number; message?: string };
    if (e.status) {
      res.status(e.status).json({ success: false, error: e.message });
      return;
    }
    next(error);
  }
});
