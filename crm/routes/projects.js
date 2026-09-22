/**
 * Projetos — API completa (lista, detalhe, custos, materiais, checklist, fotos, P&L).
 */
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDBConnection } from '../config/db.js';
import { isNoSuchTableError, isBadFieldError } from '../lib/mysqlSchemaErrors.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { setLeadPipelineBySlug } from '../lib/pipelineAutomation.js';
import { uploadProjectPhoto } from '../lib/projectPhotoUpload.js';
import { createOrSyncProjectFromAcceptedEstimate } from '../modules/projects/fromEstimate.js';
import {
  nextProjectNumber,
  seedChecklistIfEmpty,
  refreshChecklistCompletedFlag,
  mapListProjectRow,
  formatAddressFromCustomerAndLead,
  resolveProjectAddress,
  money,
  moneyRound,
  getProjectsTableColumnSet,
} from '../modules/projects/projectHelpers.js';
import {
  calculateProfitability,
  profitabilityFromRollup,
  syncPayrollToProjectCosts,
  publishToPortfolio,
  recalculateProjectCosts,
} from '../lib/projectAutomation.js';
import { sumQuoteItemsRevenueByCategory } from '../lib/quoteRevenueSplit.js';
import { applyQuoteLineRevenueToProject } from '../lib/syncProjectRevenueFromQuote.js';
import * as productsRepo from '../modules/erp/productsRepo.js';
import {
  linkProjectToBuilderPartner,
  resolveBuilderPartnerForProject,
} from '../lib/linkProjectToBuilder.js';
import { logBuilderActivityForProject, recordProjectCrmUpdate } from '../lib/builderActivityLog.js';
import { applyPortalMaterialDisplayFields } from '../lib/builderMaterialPortal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();
const allAuthed = [requireAuth];

function nf(v) {
  return parseFloat(v) || 0;
}

const MATERIAL_STATUSES = ['pending', 'ordered', 'received', 'partial', 'returned'];

function normalizeMaterialUnitIn(v) {
  if (v == null) return null;
  const t = String(v).trim();
  return t === '' ? null : t.slice(0, 50);
}

/** Qtd base para total_cost: pedida; senão usada; senão recebida. */
function materialLineQtyForTotal(qo, qr, qu) {
  const a = nf(qo);
  const b = nf(qu);
  const c = nf(qr);
  if (a > 0) return a;
  if (b > 0) return b;
  return c;
}

function resolveNewMaterialStatus(b, qo, qr, qu) {
  const s = b.status;
  if (s && MATERIAL_STATUSES.includes(String(s))) return String(s);
  if (nf(qr) >= nf(qo) && nf(qo) > 0) return 'received';
  if (nf(qr) > 0) return 'partial';
  return 'ordered';
}

function coerceMaterialStatusForUpdate(b) {
  if (b.status == null || b.status === '') return null;
  const s = String(b.status);
  return MATERIAL_STATUSES.includes(s) ? s : null;
}

/** @param {import('mysql2/promise').RowDataPacket} row */
function floatMoneyFields(obj, keys) {
  const o = { ...obj };
  for (const k of keys) {
    if (o[k] != null) o[k] = moneyRound(o[k], 2);
  }
  return o;
}

async function columnExists(pool, table, col) {
  const [r] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return Number(r[0].c) > 0;
}

async function tableExists(pool, name) {
  const [rows] = await pool.query('SHOW TABLES LIKE ?', [name]);
  return Array.isArray(rows) && rows.length > 0;
}

/** Colunas existentes em `projects` (schema novo ou legado Hostinger). */
async function projectsColumnSet(pool) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects'`
  );
  return new Set((rows || []).map((r) => r.n));
}

function usersJoinSql(hasCol) {
  if (hasCol('assigned_to') && hasCol('owner_id')) {
    return 'LEFT JOIN users u ON COALESCE(p.assigned_to, p.owner_id) = u.id';
  }
  if (hasCol('owner_id')) {
    return 'LEFT JOIN users u ON p.owner_id = u.id';
  }
  if (hasCol('assigned_to')) {
    return 'LEFT JOIN users u ON p.assigned_to = u.id';
  }
  return 'LEFT JOIN users u ON 1=0';
}

async function safeChildQuery(pool, sql, params, fallback = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (e) {
    if (isNoSuchTableError(e) || isBadFieldError(e)) {
      console.warn('[projects] query opcional ignorada:', e.code, e.message);
      return fallback;
    }
    throw e;
  }
}

/** Colunas físicas de datas em `projects` (schema novo vs legado `estimated_*` / `actual_*`). */
function erpUnitTypeToMaterialUnit(ut) {
  const u = String(ut || 'sq_ft').toLowerCase();
  if (u === 'sq_ft') return 'sq ft';
  if (u === 'linear_ft') return 'linear ft';
  return u.replace(/_/g, ' ');
}

/** Preenche nome/SKU/fornecedor/un/custo a partir do produto ERP quando `erp_product_id` vem no body. */
async function mergeProjectMaterialFromErp(pool, b) {
  const out = { ...(b || {}) };
  const eid = out.erp_product_id != null ? parseInt(String(out.erp_product_id), 10) : null;
  if (!Number.isFinite(eid) || eid <= 0) return out;
  try {
    const prod = await productsRepo.getProduct(pool, eid);
    if (!prod) return out;
    const pn = String(out.product_name || '').trim();
    if (!pn) out.product_name = prod.name;
    if (out.sku == null || String(out.sku).trim() === '') out.sku = prod.sku;
    if (out.supplier == null || String(out.supplier).trim() === '') out.supplier = prod.supplier_name;
    if (out.unit == null || String(out.unit).trim() === '') out.unit = erpUnitTypeToMaterialUnit(prod.unit_type);
    const ucNum = out.unit_cost != null && out.unit_cost !== '' ? nf(out.unit_cost) : 0;
    if (ucNum <= 0 && prod.cost_price != null) out.unit_cost = Number(prod.cost_price) || 0;
    out.erp_product_id = eid;
    if (!out.service_category || out.service_category === 'general') out.service_category = 'supply';
  } catch (_) {
    /* tabela products ausente ou erro de rede */
  }
  return out;
}

function projectDatePhysicalColumns(pcols) {
  return {
    start: pcols.has('start_date')
      ? 'start_date'
      : pcols.has('estimated_start_date')
        ? 'estimated_start_date'
        : null,
    endEst: pcols.has('end_date_estimated')
      ? 'end_date_estimated'
      : pcols.has('estimated_end_date')
        ? 'estimated_end_date'
        : null,
    endActual: pcols.has('end_date_actual')
      ? 'end_date_actual'
      : pcols.has('actual_end_date')
        ? 'actual_end_date'
        : null,
  };
}

function sumByCat(byCat, field) {
  return Object.values(byCat).reduce((a, x) => a + nf(x[field]), 0);
}

const QUOTE_ORDER_SQL = `ORDER BY CASE WHEN status IN ('accepted','approved') THEN 0 WHEN status IN ('sent','viewed') THEN 1 ELSE 2 END, updated_at DESC, id DESC`;

const QUOTE_ROW_SELECT = `id, total_amount, labor_amount, materials_amount, status`;

/** Orçamento preferencial para split de receita (linhas do quote), mesmo com contract_value já preenchido no projeto. */
async function fetchQuoteRowForProjectRevenue(pool, projectId, p) {
  if (!(await tableExists(pool, 'quotes'))) return null;
  try {
    const [qr] = await pool.query(
      `SELECT ${QUOTE_ROW_SELECT} FROM quotes WHERE project_id = ? ${QUOTE_ORDER_SQL} LIMIT 1`,
      [projectId]
    );
    if (qr[0]) return qr[0];
  } catch (e) {
    console.warn('[projects] fetchQuoteRowForProjectRevenue by project:', e.message);
  }
  if (p.lead_id) {
    try {
      const [qr] = await pool.query(
        `SELECT ${QUOTE_ROW_SELECT} FROM quotes WHERE lead_id = ? ${QUOTE_ORDER_SQL} LIMIT 1`,
        [p.lead_id]
      );
      if (qr[0]) return qr[0];
    } catch (e) {
      console.warn('[projects] fetchQuoteRowForProjectRevenue by lead:', e.message);
    }
  }
  return null;
}

/**
 * Valor "fechado" para KPIs: `projects.contract_value` → `contracts.closed_amount` → `quotes` (projeto / contrato / lead).
 */
async function resolveProjectContractValue(pool, projectId, p) {
  const base = money(p.contract_value);
  if (base > 0.005) return { value: base, source: 'project', quoteSplit: null };

  if (await tableExists(pool, 'contracts')) {
    try {
      const [cr] = await pool.query(
        'SELECT closed_amount, quote_id FROM contracts WHERE project_id = ? ORDER BY id DESC LIMIT 1',
        [projectId]
      );
      const row = cr[0];
      if (row) {
        const ca = nf(row.closed_amount);
        if (ca > 0.005) return { value: ca, source: 'contract', quoteSplit: null };
        if (row.quote_id != null && (await tableExists(pool, 'quotes'))) {
          const [qr] = await pool.query(
            `SELECT ${QUOTE_ROW_SELECT} FROM quotes WHERE id = ? LIMIT 1`,
            [row.quote_id]
          );
          const q = qr[0];
          if (q) {
            const ta = nf(q.total_amount);
            if (ta > 0.005) return { value: ta, source: 'quote', quoteSplit: q };
          }
        }
      }
    } catch (e) {
      console.warn('[projects] resolveProjectContractValue contracts:', e.message);
    }
  }

  if (await tableExists(pool, 'quotes')) {
    try {
      const [qr] = await pool.query(
        `SELECT ${QUOTE_ROW_SELECT} FROM quotes WHERE project_id = ? ${QUOTE_ORDER_SQL} LIMIT 1`,
        [projectId]
      );
      const q = qr[0];
      if (q) {
        const ta = nf(q.total_amount);
        if (ta > 0.005) return { value: ta, source: 'quote', quoteSplit: q };
      }
    } catch (e) {
      console.warn('[projects] resolveProjectContractValue quotes by project:', e.message);
    }
    if (p.lead_id) {
      try {
        const [qr] = await pool.query(
          `SELECT ${QUOTE_ROW_SELECT} FROM quotes WHERE lead_id = ? ${QUOTE_ORDER_SQL} LIMIT 1`,
          [p.lead_id]
        );
        const q = qr[0];
        if (q) {
          const ta = nf(q.total_amount);
          if (ta > 0.005) return { value: ta, source: 'quote_lead', quoteSplit: q };
        }
      } catch (e) {
        console.warn('[projects] resolveProjectContractValue quotes by lead:', e.message);
      }
    }
  }

  return { value: 0, source: 'none', quoteSplit: null };
}

/**
 * Receita por serviço: colunas do projeto; senão soma das linhas do quote (Supply / Installation / Sand&Finish);
 * senão labor_amount/materials_amount do quote; senão tudo em installation.
 */
function serviceRevenuesForProfitability(p, effectiveContract, quoteSplit, quoteItemSplit) {
  let revSupply = money(p.supply_value);
  let revInst = money(p.installation_value);
  let revSand = money(p.sand_finish_value);
  const sumRev = revSupply + revInst + revSand;
  if (sumRev > 0.005) return { revSupply, revInst, revSand };
  if (effectiveContract <= 0.005) return { revSupply: 0, revInst: 0, revSand: 0 };
  if (quoteItemSplit && quoteItemSplit.lineTotal > 0.01) {
    return {
      revSupply: money(quoteItemSplit.revSupply),
      revInst: money(quoteItemSplit.revInst),
      revSand: money(quoteItemSplit.revSand),
    };
  }
  if (quoteSplit) {
    const la = nf(quoteSplit.labor_amount);
    const ma = nf(quoteSplit.materials_amount);
    if (la + ma > 0.01) {
      const extra = Math.max(0, effectiveContract - la - ma);
      return { revSupply: ma, revInst: la + extra, revSand: 0 };
    }
  }
  return { revSupply: 0, revInst: effectiveContract, revSand: 0 };
}

/** Lista com filtros + agregados */
router.get('/', ...allAuthed, requirePermission('projects.view'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const status = req.query.status ? String(req.query.status) : null;
    const clientType = req.query.client_type ? String(req.query.client_type) : null;
    const builderId = req.query.builder_id ? parseInt(req.query.builder_id, 10) : null;
    const crewId = req.query.crew_id ? parseInt(req.query.crew_id, 10) : null;
    const flooring = req.query.flooring_type ? String(req.query.flooring_type) : null;
    const search = req.query.search ? String(req.query.search).trim() : '';

    const [colSet, hasPhotosTbl, hasCheckTbl] = await Promise.all([
      projectsColumnSet(pool),
      tableExists(pool, 'project_photos'),
      tableExists(pool, 'project_checklist'),
    ]);
    const hasCol = (c) => colSet.has(c);

    const parts = ['1=1'];
    const params = [];
    if (hasCol('deleted_at')) parts.push('(p.deleted_at IS NULL)');
    if (status) {
      parts.push('p.status = ?');
      params.push(status);
    }
    if (clientType && hasCol('client_type')) {
      parts.push('p.client_type = ?');
      params.push(clientType);
    }
    if (builderId && hasCol('builder_id')) {
      parts.push('p.builder_id = ?');
      params.push(builderId);
    }
    if (crewId && hasCol('crew_id')) {
      parts.push('p.crew_id = ?');
      params.push(crewId);
    }
    if (flooring && hasCol('flooring_type')) {
      parts.push('p.flooring_type = ?');
      params.push(flooring);
    }
    if (search) {
      const q = `%${search}%`;
      const custAddr = `IFNULL(CONCAT_WS(' ', c.address, c.city, c.state, c.zipcode),'')`;
      if (hasCol('builder_name')) {
        parts.push(
          `(p.name LIKE ? OR IFNULL(p.address,'') LIKE ? OR IFNULL(p.builder_name,'') LIKE ? OR ${custAddr} LIKE ?)`
        );
        params.push(q, q, q, q);
      } else {
        parts.push(`(p.name LIKE ? OR IFNULL(p.address,'') LIKE ? OR ${custAddr} LIKE ?)`);
        params.push(q, q, q);
      }
    }
    const where = parts.join(' AND ');

    const photosSel = hasPhotosTbl
      ? '(SELECT COUNT(*) FROM project_photos pp WHERE pp.project_id = p.id)'
      : '0';
    const chkTotalSel = hasCheckTbl
      ? '(SELECT COUNT(*) FROM project_checklist pc WHERE pc.project_id = p.id)'
      : '0';
    const chkDoneSel = hasCheckTbl
      ? `(SELECT COALESCE(SUM(CASE WHEN pc.checked = 1 THEN 1 ELSE 0 END), 0) FROM project_checklist pc WHERE pc.project_id = p.id)`
      : '0';

    const uJoin = usersJoinSql(hasCol);
    const crewJoin = hasCol('crew_id') ? 'LEFT JOIN crews cr ON p.crew_id = cr.id' : '';
    const crewSel = hasCol('crew_id') ? 'cr.name AS crew_name' : 'NULL AS crew_name';
    const sqlList = `
      SELECT p.*,
        u.name AS assigned_to_name,
        c.name AS customer_name,
        c.address AS _customer_address,
        c.city AS _customer_city,
        c.state AS _customer_state,
        c.zipcode AS _customer_zipcode,
        l.address AS _lead_address,
        l.zipcode AS _lead_zipcode,
        ${crewSel},
        ${photosSel} AS photos_count,
        ${chkTotalSel} AS checklist_total,
        ${chkDoneSel} AS checklist_done
      FROM projects p
      ${uJoin}
      LEFT JOIN customers c ON p.customer_id = c.id
      LEFT JOIN leads l ON p.lead_id = l.id
      ${crewJoin}
      WHERE ${where}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?`;

    const sqlCount = `SELECT COUNT(*) AS total FROM projects p WHERE ${where}`;

    const [[rows], [cntRows]] = await Promise.all([
      pool.query(sqlList, [...params, limit, offset]),
      pool.query(sqlCount, params),
    ]);

    const total = Number(cntRows[0]?.total) || 0;
    const data = rows.map((r) => {
      const mapped = mapListProjectRow(r);
      return { ...mapped, profitability: calculateProfitability(mapped) };
    });
    res.json({ success: true, data, total, page, limit });
  } catch (e) {
    console.error('listProjects', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/stats/overview', ...allAuthed, requirePermission('projects.view'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });

    const hasDeleted = await columnExists(pool, 'projects', 'deleted_at');
    const delClause = hasDeleted ? 'deleted_at IS NULL AND ' : '';

    const ym = new Date();
    const y = ym.getFullYear();
    const m = ym.getMonth() + 1;

    let activeRows;
    let completedMonth;
    let revMargin;
    let sqftVar;
    let byStatus;
    let byFloor;
    try {
      [
        [activeRows],
        [completedMonth],
        [revMargin],
        [sqftVar],
        [byStatus],
        [byFloor],
      ] = await Promise.all([
        pool.query(
          `SELECT COUNT(*) AS c FROM projects WHERE ${delClause} status IN ('scheduled','in_progress','on_hold','quoted')`
        ),
        pool.query(
          `SELECT COUNT(*) AS c FROM projects WHERE ${delClause} status = 'completed'
         AND YEAR(COALESCE(end_date_actual, updated_at)) = ? AND MONTH(COALESCE(end_date_actual, updated_at)) = ?`,
          [y, m]
        ),
        pool.query(
          `SELECT
           COALESCE(SUM(contract_value), 0) AS revenue,
           AVG(CASE WHEN contract_value > 0 THEN (contract_value - (COALESCE(labor_cost_actual,0)+COALESCE(material_cost_actual,0)+COALESCE(additional_cost_actual,0))) / contract_value * 100 END) AS avg_margin
         FROM projects WHERE ${delClause} status = 'completed'
         AND YEAR(COALESCE(end_date_actual, updated_at)) = ? AND MONTH(COALESCE(end_date_actual, updated_at)) = ?`,
          [y, m]
        ),
        pool.query(
          `SELECT
           COALESCE(SUM(total_sqft), 0) AS sqft,
           AVG(CASE WHEN days_estimated IS NOT NULL AND days_estimated > 0 AND days_actual IS NOT NULL
               THEN (days_actual - days_estimated) END) AS avg_var
         FROM projects WHERE ${delClause} status = 'completed'
         AND YEAR(COALESCE(end_date_actual, updated_at)) = ? AND MONTH(COALESCE(end_date_actual, updated_at)) = ?`,
          [y, m]
        ),
        pool.query(`SELECT status, COUNT(*) AS c FROM projects WHERE ${delClause} 1=1 GROUP BY status`),
        pool.query(
          `SELECT flooring_type AS type, COUNT(*) AS count, COALESCE(SUM(total_sqft), 0) AS sqft
         FROM projects WHERE ${delClause} flooring_type IS NOT NULL AND TRIM(flooring_type) <> ''
         GROUP BY flooring_type`
        ),
      ]);
    } catch (inner) {
      console.warn('projects stats/overview fallback (schema legado):', inner.message);
      const [[a], [b]] = await Promise.all([
        pool.query(
          `SELECT COUNT(*) AS c FROM projects WHERE ${delClause} status IN ('scheduled','in_progress','on_hold','quoted')`
        ),
        pool.query(`SELECT status, COUNT(*) AS c FROM projects WHERE ${delClause} 1=1 GROUP BY status`),
      ]);
      activeRows = a;
      completedMonth = [{ c: 0 }];
      revMargin = [{ revenue: 0, avg_margin: null }];
      sqftVar = [{ sqft: 0, avg_var: null }];
      byStatus = b;
      byFloor = [];
    }

    const by_status = {};
    for (const r of byStatus) {
      by_status[r.status] = Number(r.c) || 0;
    }

    const by_flooring = byFloor.map((r) => ({
      type: r.type,
      count: Number(r.count) || 0,
      sqft: moneyRound(r.sqft, 2),
    }));

    res.json({
      success: true,
      data: {
        total_active: Number(activeRows[0]?.c) || 0,
        total_completed_month: Number(completedMonth[0]?.c) || 0,
        revenue_month: moneyRound(revMargin[0]?.revenue, 2),
        avg_margin_pct: moneyRound(revMargin[0]?.avg_margin, 1),
        total_sqft_month: moneyRound(sqftVar[0]?.sqft, 2),
        avg_days_variance: moneyRound(sqftVar[0]?.avg_var, 1),
        by_status,
        by_flooring,
      },
    });
  } catch (e) {
    console.error('stats overview', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/builder/:builderId', ...allAuthed, requirePermission('projects.view'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const builderId = parseInt(req.params.builderId, 10);
    if (!builderId) return res.status(400).json({ success: false, error: 'Invalid builder id' });

    const hasDeleted = await columnExists(pool, 'projects', 'deleted_at');
    const delClause = hasDeleted ? 'deleted_at IS NULL AND ' : '';
    const hasBuilderId = await columnExists(pool, 'projects', 'builder_id');
    const hasClientType = await columnExists(pool, 'projects', 'client_type');
    if (!hasBuilderId) {
      const [custEmpty] = await pool.query('SELECT * FROM customers WHERE id = ?', [builderId]);
      return res.json({
        success: true,
        data: {
          builder: custEmpty[0] || null,
          projects: [],
          aggregates: {
            project_count: 0,
            total_sqft: 0,
            total_revenue: 0,
            total_profit: 0,
            avg_margin_pct: 0,
          },
        },
      });
    }
    const typeClause = hasClientType ? "client_type = 'builder' AND " : '';
    const [projects] = await pool.query(
      `SELECT * FROM projects WHERE ${delClause}${typeClause}builder_id = ? ORDER BY created_at DESC`,
      [builderId]
    );

    let totalRev = 0;
    let totalProfit = 0;
    let totalSqft = 0;
    let marginSum = 0;
    let marginN = 0;
    for (const p of projects) {
      const c = money(p.contract_value);
      const cost =
        money(p.labor_cost_actual) + money(p.material_cost_actual) + money(p.additional_cost_actual);
      const g = c - cost;
      totalRev += c;
      totalProfit += g;
      totalSqft += money(p.total_sqft);
      if (c > 0) {
        marginSum += (g / c) * 100;
        marginN += 1;
      }
    }

    const [cust] = await pool.query('SELECT * FROM customers WHERE id = ?', [builderId]);

    res.json({
      success: true,
      data: {
        builder: cust[0] || null,
        projects: projects.map((p) => {
          const mapped = mapListProjectRow(p);
          return { ...mapped, profitability: calculateProfitability(mapped) };
        }),
        aggregates: {
          project_count: projects.length,
          total_sqft: moneyRound(totalSqft, 2),
          total_revenue: moneyRound(totalRev, 2),
          total_profit: moneyRound(totalProfit, 2),
          avg_margin_pct: marginN ? moneyRound(marginSum / marginN, 1) : 0,
        },
      },
    });
  } catch (e) {
    console.error('builder projects', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post(
  '/from-estimate/:estimateId',
  ...allAuthed,
  requirePermission('projects.create'),
  async (req, res) => {
    try {
      const pool = await getDBConnection();
      if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
      const estimateId = parseInt(req.params.estimateId, 10);
      const uid = req.session?.userId || null;
      const r = await createOrSyncProjectFromAcceptedEstimate(pool, estimateId, uid);
      if (!r.ok) {
        return res.status(r.error === 'estimate_not_found' ? 404 : 400).json({
          success: false,
          error: r.error,
        });
      }
      res.status(201).json({
        success: true,
        data: floatMoneyFields(r.data, [
          'contract_value',
          'supply_value',
          'installation_value',
          'sand_finish_value',
          'labor_cost_actual',
          'material_cost_actual',
          'additional_cost_actual',
        ]),
      });
    } catch (e) {
      console.error('from-estimate', e);
      res.status(500).json({ success: false, error: e.message });
    }
  }
);

router.post('/', ...allAuthed, requirePermission('projects.create'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });

    const b = req.body || {};
    const name = b.name != null ? String(b.name).trim() : '';
    if (!name) return res.status(400).json({ success: false, error: 'name is required' });

    let customerId = b.customer_id != null ? parseInt(String(b.customer_id), 10) : null;
    const leadId = b.lead_id != null ? parseInt(String(b.lead_id), 10) : null;
    const partnerBuilderId =
      b.builder_partner_id != null ? parseInt(String(b.builder_partner_id), 10) || null : null;

    if (!customerId && leadId) {
      const [c] = await pool.query('SELECT id FROM customers WHERE lead_id = ? LIMIT 1', [leadId]);
      if (c.length) customerId = c[0].id;
    }
    if (!customerId && partnerBuilderId) {
      const [br] = await pool.query('SELECT customer_id FROM builders WHERE id = ? LIMIT 1', [
        partnerBuilderId,
      ]);
      if (br.length && br[0].customer_id) customerId = Number(br[0].customer_id);
    }
    if (!customerId) {
      return res.status(400).json({
        success: false,
        error:
          'Selecione um lead com cliente, um cliente, ou um parceiro builder para associar o projeto.',
      });
    }

    const pn = await nextProjectNumber(pool);
    const uid = req.session?.userId || null;
    const serviceType = b.service_type != null ? String(b.service_type) : 'installation';
    const start = b.start_date || null;
    let endEst = b.end_date_estimated || null;
    const daysEst = b.days_estimated != null ? parseInt(String(b.days_estimated), 10) : null;
    if (start && daysEst && !endEst) {
      const d = new Date(`${start}T12:00:00`);
      d.setDate(d.getDate() + daysEst);
      endEst = d.toISOString().slice(0, 10);
    }

    const pcols = await getProjectsTableColumnSet(pool);
    const fromLead = leadId != null && leadId > 0;
    const rowMap = {
      customer_id: customerId,
      lead_id: leadId || null,
      estimate_id: b.estimate_id != null ? parseInt(String(b.estimate_id), 10) || null : null,
      name: name.slice(0, 255),
      project_number: pn,
      client_type: partnerBuilderId
        ? 'builder'
        : fromLead
          ? 'customer'
          : b.client_type === 'builder'
            ? 'builder'
            : 'customer',
      builder_id: fromLead ? null : b.builder_id != null ? parseInt(String(b.builder_id), 10) || null : null,
      builder_name: fromLead ? null : b.builder_name != null ? String(b.builder_name).slice(0, 255) : null,
      flooring_type: b.flooring_type != null ? String(b.flooring_type).slice(0, 100) : null,
      total_sqft: b.total_sqft != null ? money(b.total_sqft) : null,
      service_type: serviceType,
      contract_value: b.contract_value != null ? money(b.contract_value) : 0,
      supply_value: b.supply_value != null ? money(b.supply_value) : 0,
      installation_value: b.installation_value != null ? money(b.installation_value) : 0,
      sand_finish_value: b.sand_finish_value != null ? money(b.sand_finish_value) : 0,
      crew_id: b.crew_id != null ? parseInt(String(b.crew_id), 10) || null : null,
      assigned_to: b.assigned_to != null ? parseInt(String(b.assigned_to), 10) || null : null,
      status: 'scheduled',
      created_by: uid,
      notes: b.notes != null ? String(b.notes) : null,
      client_name:
        b.client_name != null && String(b.client_name).trim()
          ? String(b.client_name).trim().slice(0, 255)
          : null,
    };
    const dtIns = projectDatePhysicalColumns(pcols);
    if (start != null && dtIns.start) rowMap[dtIns.start] = start;
    if (endEst != null && dtIns.endEst) rowMap[dtIns.endEst] = endEst;
    if (daysEst != null && pcols.has('days_estimated')) rowMap.days_estimated = daysEst;

    if (pcols.has('address')) {
      const bodyAddr = b.address != null ? String(b.address).trim() : '';
      if (bodyAddr) {
        rowMap.address = bodyAddr;
      } else {
        const [custRows] = await pool.query(
          'SELECT address, city, state, zipcode FROM customers WHERE id = ? LIMIT 1',
          [customerId]
        );
        let leadRow = null;
        if (leadId) {
          const [lr] = await pool.query('SELECT address, zipcode FROM leads WHERE id = ? LIMIT 1', [leadId]);
          leadRow = lr[0] || null;
        }
        rowMap.address = custRows[0]
          ? formatAddressFromCustomerAndLead(custRows[0], leadRow) || null
          : leadRow
            ? formatAddressFromCustomerAndLead(null, leadRow) || null
            : null;
      }
    }
    const fields = [];
    const insVals = [];
    for (const [col, val] of Object.entries(rowMap)) {
      if (!pcols.has(col)) continue;
      if (col === 'project_number' && (val == null || val === '')) continue;
      fields.push(`\`${col}\``);
      insVals.push(val);
    }
    if (fields.length < 3) {
      return res.status(500).json({ success: false, error: 'Tabela projects incompatível com esta versão da API' });
    }
    const [ins] = await pool.execute(
      `INSERT INTO projects (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`,
      insVals
    );

    const projectId = ins.insertId;
    await seedChecklistIfEmpty(pool, projectId);
    if (leadId) await setLeadPipelineBySlug(leadId, 'production');

    if (partnerBuilderId) {
      await linkProjectToBuilderPartner(pool, projectId, partnerBuilderId);
    } else if (b.client_type === 'builder' && b.builder_id != null) {
      const legacyCid = parseInt(String(b.builder_id), 10);
      const [br] = await pool.query('SELECT id FROM builders WHERE customer_id = ? LIMIT 1', [legacyCid]);
      if (br.length) await linkProjectToBuilderPartner(pool, projectId, br[0].id);
    }

    const [rows] = await pool.query(
      `SELECT p.*,
        c.address AS _customer_address,
        c.city AS _customer_city,
        c.state AS _customer_state,
        c.zipcode AS _customer_zipcode,
        l.address AS _lead_address,
        l.zipcode AS _lead_zipcode
       FROM projects p
       LEFT JOIN customers c ON p.customer_id = c.id
       LEFT JOIN leads l ON p.lead_id = l.id
       WHERE p.id = ?`,
      [projectId]
    );
    const created = mapListProjectRow(rows[0]);
    created.builder_partner = await resolveBuilderPartnerForProject(pool, rows[0]);
    created.partner_builder_id =
      created.builder_partner?.builder_table_id ?? rows[0].partner_builder_id ?? null;
    res.status(201).json({ success: true, data: created });
  } catch (e) {
    console.error('createProject', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

/** Taxas da folha de construção (diária/hora) para projeção de mão-de-obra no projeto — só exige projects.view. */
router.get(
  '/lookup/construction-payroll-rates',
  ...allAuthed,
  requirePermission('projects.view'),
  async (req, res) => {
    try {
      const pool = await getDBConnection();
      if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
      if (!(await tableExists(pool, 'construction_payroll_employees'))) {
        return res.json({ success: true, data: [] });
      }
      const [rows] = await pool.query(
        `SELECT id, name, role, payment_type, daily_rate, hourly_rate, overtime_rate
         FROM construction_payroll_employees
         WHERE is_active = 1
         ORDER BY name ASC`
      );
      res.json({
        success: true,
        data: rows.map((r) =>
          floatMoneyFields(r, ['daily_rate', 'hourly_rate', 'overtime_rate'])
        ),
      });
    } catch (e) {
      console.error('lookup construction-payroll-rates', e);
      res.status(500).json({ success: false, error: e.message });
    }
  }
);

/** Parceiros builder para associar ao projeto (portal). */
router.get('/lookup/builders', ...allAuthed, requirePermission('projects.view'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const [rows] = await pool.query(
      `SELECT id, customer_id, first_name, last_name, company, email, status
       FROM builders
       WHERE status IN ('active', 'pending')
       ORDER BY company ASC, first_name ASC, last_name ASC
       LIMIT 500`
    );
    res.json({
      success: true,
      data: rows.map((b) => ({
        id: b.id,
        customer_id: b.customer_id,
        label:
          [b.company, [b.first_name, b.last_name].filter(Boolean).join(' ')].filter(Boolean).join(' — ') ||
          b.email ||
          `Builder #${b.id}`,
        status: b.status,
      })),
    });
  } catch (e) {
    console.error('lookup builders', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

/** Produtos do ERP para preencher materiais do projeto (quem tem projects.view). */
router.get(
  '/lookup/erp-products',
  ...allAuthed,
  requirePermission('projects.view'),
  async (req, res) => {
    try {
      const pool = await getDBConnection();
      if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
      const supplierId = req.query.supplier_id ? parseInt(req.query.supplier_id, 10) : null;
      const q = req.query.q || req.query.search;
      const rows = await productsRepo.listProducts(pool, {
        supplierId: supplierId && supplierId > 0 ? supplierId : undefined,
        q,
        activeOnly: req.query.all !== '1',
        limit: Math.min(parseInt(req.query.limit, 10) || 120, 300),
      });
      res.json({ success: true, data: rows, erp_available: true });
    } catch (e) {
      const msg = String(e?.sqlMessage || e?.message || '');
      if (
        e?.code === 'ER_NO_SUCH_TABLE' ||
        msg.toLowerCase().includes("doesn't exist") ||
        msg.toLowerCase().includes('unknown table')
      ) {
        return res.json({ success: true, data: [], erp_available: false });
      }
      console.error('lookup erp-products', e);
      res.status(500).json({ success: false, error: e.message });
    }
  }
);

router.get('/:id/profitability', ...allAuthed, requirePermission('projects.view'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });

    const [pr] = await pool.query('SELECT * FROM projects WHERE id = ?', [id]);
    if (!pr.length) return res.status(404).json({ success: false, error: 'Project not found' });
    const p = pr[0];

    const exclProj = await columnExists(pool, 'project_costs', 'is_projected');
    const projClause = exclProj ? 'AND IFNULL(is_projected,0)=0' : '';
    const [costRows] = await pool.query(
      `SELECT service_category, cost_type,
        COALESCE(SUM(total_cost), 0) AS s
       FROM project_costs WHERE project_id = ? ${projClause}
       GROUP BY service_category, cost_type`,
      [id]
    );

    const byCat = {
      supply: { labor: 0, material: 0, additional: 0 },
      installation: { labor: 0, material: 0, additional: 0 },
      sand_finish: { labor: 0, material: 0, additional: 0 },
      general: { labor: 0, material: 0, additional: 0 },
    };
    for (const r of costRows) {
      const cat = byCat[r.service_category] ? r.service_category : 'general';
      const t = r.cost_type;
      if (byCat[cat][t] !== undefined) byCat[cat][t] += nf(r.s);
    }

    const { value: effectiveContract, source: contractValueSource, quoteSplit } = await resolveProjectContractValue(
      pool,
      id,
      p
    );
    let quoteRow = quoteSplit && quoteSplit.id != null ? quoteSplit : null;
    if (!quoteRow) {
      quoteRow = await fetchQuoteRowForProjectRevenue(pool, id, p);
    }

    let quoteItemSplit = null;
    if (quoteRow && quoteRow.id != null && (await tableExists(pool, 'quote_items'))) {
      try {
        const [itemRows] = await pool.query('SELECT * FROM quote_items WHERE quote_id = ?', [quoteRow.id]);
        quoteItemSplit = sumQuoteItemsRevenueByCategory(itemRows || []);
      } catch (e) {
        if (e?.code !== 'ER_NO_SUCH_TABLE') console.warn('[projects] profitability quote_items:', e.message);
      }
    }

    const sumStoredRev = money(p.supply_value) + money(p.installation_value) + money(p.sand_finish_value);
    if (
      quoteItemSplit &&
      quoteItemSplit.lineTotal > 0.01 &&
      sumStoredRev < 0.01 &&
      quoteRow &&
      quoteRow.id != null
    ) {
      try {
        await applyQuoteLineRevenueToProject(pool, id, quoteRow.id);
        const [pr2] = await pool.query('SELECT * FROM projects WHERE id = ?', [id]);
        if (pr2.length) Object.assign(p, pr2[0]);
      } catch (e) {
        console.warn('[projects] profitability sync revenue from quote:', e.message);
      }
    }

    let { revSupply, revInst, revSand } = serviceRevenuesForProfitability(
      p,
      effectiveContract,
      quoteRow || quoteSplit,
      quoteItemSplit
    );
    let sumServiceRev = revSupply + revInst + revSand;
    if (effectiveContract > sumServiceRev + 0.01) {
      revInst += effectiveContract - sumServiceRev;
      sumServiceRev = effectiveContract;
    }

    function block(revenue, cat) {
      const b = byCat[cat] || byCat.general;
      const labor = b.labor;
      const material = b.material;
      const additional = b.additional;
      const totalCost = labor + material + additional;
      const gross = revenue - totalCost;
      const margin_pct = revenue > 0 ? moneyRound((gross / revenue) * 100, 1) : 0;
      return {
        revenue: moneyRound(revenue, 2),
        labor_cost: moneyRound(labor, 2),
        material_cost: moneyRound(material, 2),
        additional_cost: moneyRound(additional, 2),
        total_cost: moneyRound(totalCost, 2),
        gross_profit: moneyRound(gross, 2),
        margin_pct,
      };
    }

    const by_service = {
      supply: block(revSupply, 'supply'),
      installation: block(revInst, 'installation'),
      sand_finish: block(revSand, 'sand_finish'),
    };

    const total_revenue = revSupply + revInst + revSand;
    const total_labor = Object.values(byCat).reduce((a, x) => a + x.labor, 0);
    const total_material = Object.values(byCat).reduce((a, x) => a + x.material, 0);
    const total_additional = Object.values(byCat).reduce((a, x) => a + x.additional, 0);
    const total_cost = total_labor + total_material + total_additional;
    const gross_profit = total_revenue - total_cost;
    const margin_pct = total_revenue > 0 ? moneyRound((gross_profit / total_revenue) * 100, 1) : 0;

    const laborA = sumByCat(byCat, 'labor');
    const materialA = sumByCat(byCat, 'material');
    const additionalA = sumByCat(byCat, 'additional');
    let laborP = nf(p.labor_cost_projected);
    let materialP = nf(p.material_cost_projected);
    let additionalP = nf(p.additional_cost_projected);
    if (exclProj) {
      laborP = 0;
      materialP = 0;
      additionalP = 0;
      try {
        const [projRows] = await pool.query(
          `SELECT cost_type, COALESCE(SUM(total_cost), 0) AS s
           FROM project_costs WHERE project_id = ? AND IFNULL(is_projected,0)=1
           GROUP BY cost_type`,
          [id]
        );
        for (const r of projRows) {
          const s = nf(r.s);
          if (r.cost_type === 'labor') laborP += s;
          else if (r.cost_type === 'material') materialP += s;
          else if (r.cost_type === 'additional') additionalP += s;
        }
      } catch (e) {
        console.warn('[projects] profitability projected split:', e.message);
      }
    }

    const pForPl = {
      ...p,
      supply_value: revSupply,
      installation_value: revInst,
      sand_finish_value: revSand,
    };
    const profitabilityLive = profitabilityFromRollup(
      pForPl,
      effectiveContract > 0 ? effectiveContract : money(p.contract_value),
      laborA,
      materialA,
      additionalA,
      laborP,
      materialP,
      additionalP
    );

    const [allCosts] = await pool.query(
      'SELECT * FROM project_costs WHERE project_id = ? ORDER BY id',
      [id]
    );

    const days_estimated = p.days_estimated != null ? parseInt(String(p.days_estimated), 10) : null;
    const days_actual = p.days_actual != null ? parseInt(String(p.days_actual), 10) : null;
    const days_variance =
      days_estimated != null && days_actual != null ? days_actual - days_estimated : null;

    const costsByService = { supply: {}, installation: {}, sand_finish: {}, general: {} };
    for (const cat of Object.keys(costsByService)) {
      const catCosts = allCosts.filter(
        (c) => c.service_category === cat && !Number(c.is_projected)
      );
      costsByService[cat] = {
        labor: catCosts.filter((c) => c.cost_type === 'labor').reduce((s, c) => s + (+c.total_cost || 0), 0),
        material: catCosts.filter((c) => c.cost_type === 'material').reduce((s, c) => s + (+c.total_cost || 0), 0),
        additional: catCosts
          .filter((c) => c.cost_type === 'additional')
          .reduce((s, c) => s + (+c.total_cost || 0), 0),
      };
      costsByService[cat].total =
        costsByService[cat].labor + costsByService[cat].material + costsByService[cat].additional;
    }

    const contractOut = moneyRound(
      effectiveContract > 0 ? effectiveContract : money(p.contract_value),
      2
    );

    res.json({
      success: true,
      data: {
        project_id: id,
        contract_value: contractOut,
        contract_value_source: contractValueSource,
        by_service,
        totals: {
          total_revenue: moneyRound(total_revenue, 2),
          total_labor: moneyRound(total_labor, 2),
          total_material: moneyRound(total_material, 2),
          total_additional: moneyRound(total_additional, 2),
          total_cost: moneyRound(total_cost, 2),
          gross_profit: moneyRound(gross_profit, 2),
          margin_pct,
        },
        cost_breakdown: allCosts.map((c) => floatMoneyFields(c, ['quantity', 'unit_cost', 'total_cost'])),
        cost_items: allCosts.map((c) => floatMoneyFields(c, ['quantity', 'unit_cost', 'total_cost'])),
        costs_by_service: costsByService,
        profitability: profitabilityLive,
        days_estimated,
        days_actual,
        days_variance,
      },
    });
  } catch (e) {
    console.error('profitability', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/:id/costs/sync-payroll', ...allAuthed, requirePermission('projects.edit'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const result = await syncPayrollToProjectCosts(pool, req.params.id);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/:id/costs', ...allAuthed, requirePermission('projects.view'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    const ct = req.query.cost_type || null;
    const sc = req.query.service_category || null;
    let q = 'SELECT * FROM project_costs WHERE project_id = ?';
    const params = [id];
    if (ct) {
      q += ' AND cost_type = ?';
      params.push(ct);
    }
    if (sc) {
      q += ' AND service_category = ?';
      params.push(sc);
    }
    q += ' ORDER BY id';
    const [rows] = await pool.query(q, params);
    res.json({
      success: true,
      data: rows.map((c) => floatMoneyFields(c, ['quantity', 'unit_cost', 'total_cost'])),
    });
  } catch (e) {
    console.error('list costs', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/:id/costs', ...allAuthed, requirePermission('projects.edit'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    const b = req.body || {};
    const costType = b.cost_type;
    if (!['labor', 'material', 'additional'].includes(costType)) {
      return res.status(400).json({ success: false, error: 'Invalid cost_type' });
    }
    const qty = b.quantity != null ? nf(b.quantity) : 1;
    const unitCost = b.unit_cost != null ? nf(b.unit_cost) : 0;
    const total = moneyRound(qty * unitCost, 2);
    const uid = req.session?.userId || null;
    const hasProj = await columnExists(pool, 'project_costs', 'is_projected');
    const isProj = !!(b.is_projected === true || b.is_projected === 1 || b.is_projected === '1');
    let ins;
    if (hasProj) {
      [ins] = await pool.execute(
        `INSERT INTO project_costs (
          project_id, cost_type, service_category, description, quantity, unit, unit_cost, total_cost,
          vendor, notes, created_by, is_projected
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          costType,
          b.service_category && ['supply', 'installation', 'sand_finish', 'general'].includes(b.service_category)
            ? b.service_category
            : 'general',
          String(b.description || '').slice(0, 255) || 'Item',
          qty,
          b.unit != null ? String(b.unit).slice(0, 50) : null,
          unitCost,
          total,
          b.vendor != null ? String(b.vendor).slice(0, 255) : null,
          b.notes != null ? String(b.notes) : null,
          uid,
          isProj ? 1 : 0,
        ]
      );
    } else {
      [ins] = await pool.execute(
        `INSERT INTO project_costs (
          project_id, cost_type, service_category, description, quantity, unit, unit_cost, total_cost,
          vendor, notes, created_by
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          costType,
          b.service_category && ['supply', 'installation', 'sand_finish', 'general'].includes(b.service_category)
            ? b.service_category
            : 'general',
          String(b.description || '').slice(0, 255) || 'Item',
          qty,
          b.unit != null ? String(b.unit).slice(0, 50) : null,
          unitCost,
          total,
          b.vendor != null ? String(b.vendor).slice(0, 255) : null,
          b.notes != null ? String(b.notes) : null,
          uid,
        ]
      );
    }
    await recalculateProjectCosts(pool, id);
    const [rows] = await pool.query('SELECT * FROM project_costs WHERE id = ?', [ins.insertId]);
    res.status(201).json({ success: true, data: floatMoneyFields(rows[0], ['quantity', 'unit_cost', 'total_cost']) });
  } catch (e) {
    console.error('post cost', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.put('/:id/costs/:costId', ...allAuthed, requirePermission('projects.edit'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    const costId = parseInt(req.params.costId, 10);
    const b = req.body || {};
    const [ex] = await pool.query('SELECT * FROM project_costs WHERE id = ? AND project_id = ?', [
      costId,
      id,
    ]);
    if (!ex.length) return res.status(404).json({ success: false, error: 'Cost not found' });

    const qty = b.quantity != null ? nf(b.quantity) : nf(ex[0].quantity);
    const unitCost = b.unit_cost != null ? nf(b.unit_cost) : nf(ex[0].unit_cost);
    const total = moneyRound(qty * unitCost, 2);

    const hasProj = await columnExists(pool, 'project_costs', 'is_projected');
    const isProjVal =
      b.is_projected === undefined ? null : b.is_projected === true || b.is_projected === 1 || b.is_projected === '1';
    if (hasProj && isProjVal !== null) {
      await pool.execute(
        `UPDATE project_costs SET
          cost_type = COALESCE(?, cost_type),
          service_category = COALESCE(?, service_category),
          description = COALESCE(?, description),
          quantity = ?,
          unit = COALESCE(?, unit),
          unit_cost = ?,
          total_cost = ?,
          vendor = COALESCE(?, vendor),
          notes = COALESCE(?, notes),
          paid = COALESCE(?, paid),
          paid_at = COALESCE(?, paid_at),
          is_projected = ?
        WHERE id = ?`,
        [
          b.cost_type || null,
          b.service_category || null,
          b.description != null ? String(b.description).slice(0, 255) : null,
          qty,
          b.unit != null ? String(b.unit).slice(0, 50) : null,
          unitCost,
          total,
          b.vendor != null ? String(b.vendor).slice(0, 255) : null,
          b.notes !== undefined ? b.notes : null,
          b.paid !== undefined ? (b.paid ? 1 : 0) : null,
          b.paid_at !== undefined ? b.paid_at : null,
          isProjVal ? 1 : 0,
          costId,
        ]
      );
    } else {
      await pool.execute(
        `UPDATE project_costs SET
          cost_type = COALESCE(?, cost_type),
          service_category = COALESCE(?, service_category),
          description = COALESCE(?, description),
          quantity = ?,
          unit = COALESCE(?, unit),
          unit_cost = ?,
          total_cost = ?,
          vendor = COALESCE(?, vendor),
          notes = COALESCE(?, notes),
          paid = COALESCE(?, paid),
          paid_at = COALESCE(?, paid_at)
        WHERE id = ?`,
        [
          b.cost_type || null,
          b.service_category || null,
          b.description != null ? String(b.description).slice(0, 255) : null,
          qty,
          b.unit != null ? String(b.unit).slice(0, 50) : null,
          unitCost,
          total,
          b.vendor != null ? String(b.vendor).slice(0, 255) : null,
          b.notes !== undefined ? b.notes : null,
          b.paid !== undefined ? (b.paid ? 1 : 0) : null,
          b.paid_at !== undefined ? b.paid_at : null,
          costId,
        ]
      );
    }
    await recalculateProjectCosts(pool, id);
    const [rows] = await pool.query('SELECT * FROM project_costs WHERE id = ?', [costId]);
    res.json({ success: true, data: floatMoneyFields(rows[0], ['quantity', 'unit_cost', 'total_cost']) });
  } catch (e) {
    console.error('put cost', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete('/:id/costs/:costId', ...allAuthed, requirePermission('projects.edit'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    const costId = parseInt(req.params.costId, 10);
    await pool.execute('DELETE FROM project_costs WHERE id = ? AND project_id = ?', [costId, id]);
    await recalculateProjectCosts(pool, id);
    res.json({ success: true });
  } catch (e) {
    console.error('delete cost', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/:id/materials', ...allAuthed, requirePermission('projects.view'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    const [rows] = await pool.query('SELECT * FROM project_materials WHERE project_id = ? ORDER BY id', [id]);
    res.json({
      success: true,
      data: rows.map((r) => floatMoneyFields(r, ['qty_ordered', 'qty_received', 'qty_used', 'unit_cost', 'total_cost'])),
    });
  } catch (e) {
    console.error('list materials', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/:id/materials', ...allAuthed, requirePermission('projects.edit'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    let b = await mergeProjectMaterialFromErp(pool, req.body || {});
    const qo = b.qty_ordered != null ? nf(b.qty_ordered) : 0;
    const qr = b.qty_received != null ? nf(b.qty_received) : 0;
    const qu = b.qty_used != null ? nf(b.qty_used) : 0;
    const uc = b.unit_cost != null ? nf(b.unit_cost) : 0;
    const lineQty = materialLineQtyForTotal(qo, qr, qu);
    const total = moneyRound(lineQty * uc, 2);
    const statusResolved = resolveNewMaterialStatus(b, qo, qr, qu);
    const hasMatProj = await columnExists(pool, 'project_materials', 'is_projected');
    const hasErpPid = await columnExists(pool, 'project_materials', 'erp_product_id');
    const isProj = !!(b.is_projected === true || b.is_projected === 1 || b.is_projected === '1');
    const erpPid =
      hasErpPid && b.erp_product_id != null
        ? (() => {
            const x = parseInt(String(b.erp_product_id), 10);
            return Number.isFinite(x) && x > 0 ? x : null;
          })()
        : null;
    const baseVals = [
      id,
      String(b.product_name || 'Material').slice(0, 255),
      b.sku != null ? String(b.sku).slice(0, 100) : null,
      b.supplier != null ? String(b.supplier).slice(0, 255) : null,
      normalizeMaterialUnitIn(b.unit),
      qo,
      b.qty_received != null ? nf(b.qty_received) : 0,
      b.qty_used != null ? nf(b.qty_used) : 0,
      uc,
      total,
      b.service_category && ['supply', 'installation', 'sand_finish', 'general'].includes(b.service_category)
        ? b.service_category
        : 'general',
      statusResolved,
      b.order_date || null,
      b.received_date || null,
      b.notes != null ? String(b.notes) : null,
    ];
    const colNames = [
      'project_id',
      'product_name',
      'sku',
      'supplier',
      'unit',
      'qty_ordered',
      'qty_received',
      'qty_used',
      'unit_cost',
      'total_cost',
      'service_category',
      'status',
      'order_date',
      'received_date',
      'notes',
    ];
    const vals = [...baseVals];
    if (hasMatProj) {
      colNames.push('is_projected');
      vals.push(isProj ? 1 : 0);
    }
    if (hasErpPid) {
      colNames.push('erp_product_id');
      vals.push(erpPid);
    }
    const sql = `INSERT INTO project_materials (${colNames.map((c) => `\`${c}\``).join(', ')}) VALUES (${colNames.map(() => '?').join(', ')})`;
    const [ins] = await pool.execute(sql, vals);
    await applyPortalMaterialDisplayFields(pool, ins.insertId, b);
    await recalculateProjectCosts(pool, id);
    const [rows] = await pool.query('SELECT * FROM project_materials WHERE id = ?', [ins.insertId]);
    res.status(201).json({
      success: true,
      data: floatMoneyFields(rows[0], ['qty_ordered', 'qty_received', 'qty_used', 'unit_cost', 'total_cost']),
    });
  } catch (e) {
    console.error('post material', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.put('/:id/materials/:materialId', ...allAuthed, requirePermission('projects.edit'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    const mid = parseInt(req.params.materialId, 10);
    const rawBody = req.body || {};
    const [ex] = await pool.query('SELECT * FROM project_materials WHERE id = ? AND project_id = ?', [mid, id]);
    if (!ex.length) return res.status(404).json({ success: false, error: 'Not found' });
    const b = await mergeProjectMaterialFromErp(pool, rawBody);
    const hasErpPidCol = await columnExists(pool, 'project_materials', 'erp_product_id');
    let erpPidVal;
    if (hasErpPidCol && Object.prototype.hasOwnProperty.call(rawBody, 'erp_product_id')) {
      const r = rawBody.erp_product_id;
      if (r == null || r === '' || r === 0 || r === '0') erpPidVal = null;
      else {
        const n = parseInt(String(r), 10);
        erpPidVal = Number.isFinite(n) && n > 0 ? n : null;
      }
    }
    const qo = b.qty_ordered != null ? nf(b.qty_ordered) : nf(ex[0].qty_ordered);
    const qr = b.qty_received != null ? nf(b.qty_received) : nf(ex[0].qty_received);
    const qu = b.qty_used != null ? nf(b.qty_used) : nf(ex[0].qty_used);
    const uc = b.unit_cost != null ? nf(b.unit_cost) : nf(ex[0].unit_cost);
    const lineQty = materialLineQtyForTotal(qo, qr, qu);
    const total = moneyRound(lineQty * uc, 2);
    const unitUpd =
      b.unit !== undefined
        ? normalizeMaterialUnitIn(b.unit)
        : ex[0].unit != null && String(ex[0].unit).trim() !== ''
          ? String(ex[0].unit).trim().slice(0, 50)
          : null;
    const statusUpd = coerceMaterialStatusForUpdate(b);
    const hasMatProj = await columnExists(pool, 'project_materials', 'is_projected');
    if (hasMatProj && b.is_projected !== undefined) {
      const isProj = !!(b.is_projected === true || b.is_projected === 1 || b.is_projected === '1');
      await pool.execute(
        `UPDATE project_materials SET
          product_name = COALESCE(?, product_name),
          sku = COALESCE(?, sku),
          supplier = COALESCE(?, supplier),
          unit = ?,
          qty_ordered = ?,
          qty_received = COALESCE(?, qty_received),
          qty_used = COALESCE(?, qty_used),
          unit_cost = ?,
          total_cost = ?,
          service_category = COALESCE(?, service_category),
          status = COALESCE(?, status),
          order_date = COALESCE(?, order_date),
          received_date = COALESCE(?, received_date),
          notes = COALESCE(?, notes),
          is_projected = ?
        WHERE id = ?`,
        [
          b.product_name != null ? String(b.product_name).slice(0, 255) : null,
          b.sku !== undefined ? b.sku : null,
          b.supplier !== undefined ? b.supplier : null,
          unitUpd,
          qo,
          b.qty_received != null ? nf(b.qty_received) : null,
          b.qty_used != null ? nf(b.qty_used) : null,
          uc,
          total,
          b.service_category || null,
          statusUpd,
          b.order_date !== undefined ? b.order_date : null,
          b.received_date !== undefined ? b.received_date : null,
          b.notes !== undefined ? b.notes : null,
          isProj ? 1 : 0,
          mid,
        ]
      );
    } else {
      await pool.execute(
        `UPDATE project_materials SET
          product_name = COALESCE(?, product_name),
          sku = COALESCE(?, sku),
          supplier = COALESCE(?, supplier),
          unit = ?,
          qty_ordered = ?,
          qty_received = COALESCE(?, qty_received),
          qty_used = COALESCE(?, qty_used),
          unit_cost = ?,
          total_cost = ?,
          service_category = COALESCE(?, service_category),
          status = COALESCE(?, status),
          order_date = COALESCE(?, order_date),
          received_date = COALESCE(?, received_date),
          notes = COALESCE(?, notes)
        WHERE id = ?`,
        [
          b.product_name != null ? String(b.product_name).slice(0, 255) : null,
          b.sku !== undefined ? b.sku : null,
          b.supplier !== undefined ? b.supplier : null,
          unitUpd,
          qo,
          b.qty_received != null ? nf(b.qty_received) : null,
          b.qty_used != null ? nf(b.qty_used) : null,
          uc,
          total,
          b.service_category || null,
          statusUpd,
          b.order_date !== undefined ? b.order_date : null,
          b.received_date !== undefined ? b.received_date : null,
          b.notes !== undefined ? b.notes : null,
          mid,
        ]
      );
    }
    if (erpPidVal !== undefined) {
      await pool.execute(
        'UPDATE project_materials SET erp_product_id = ? WHERE id = ? AND project_id = ?',
        [erpPidVal, mid, id]
      );
    }
    await applyPortalMaterialDisplayFields(pool, mid, b);
    await recalculateProjectCosts(pool, id);
    const [rows] = await pool.query('SELECT * FROM project_materials WHERE id = ?', [mid]);
    res.json({
      success: true,
      data: floatMoneyFields(rows[0], ['qty_ordered', 'qty_received', 'qty_used', 'unit_cost', 'total_cost']),
    });
  } catch (e) {
    console.error('put material', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete('/:id/materials/:materialId', ...allAuthed, requirePermission('projects.edit'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    const mid = parseInt(req.params.materialId, 10);
    const [r] = await pool.execute('DELETE FROM project_materials WHERE id = ? AND project_id = ?', [mid, id]);
    if (r.affectedRows === 0) return res.status(404).json({ success: false, error: 'Not found' });
    await recalculateProjectCosts(pool, id);
    res.json({ success: true });
  } catch (e) {
    console.error('delete material', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/:id/checklist', ...allAuthed, requirePermission('projects.view'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    const [rows] = await pool.query(
      'SELECT * FROM project_checklist WHERE project_id = ? ORDER BY category, sort_order, id',
      [id]
    );
    const grouped = {};
    for (const r of rows) {
      if (!grouped[r.category]) grouped[r.category] = [];
      grouped[r.category].push(r);
    }
    res.json({ success: true, data: { grouped, items: rows } });
  } catch (e) {
    console.error('checklist get', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.put('/:id/checklist/:itemId', ...allAuthed, requirePermission('projects.edit'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    const itemId = parseInt(req.params.itemId, 10);
    const b = req.body || {};
    const { loadChecklistItemState, notifyBuilderChecklistAssigned } = await import(
      '../lib/builderChecklistNotify.js'
    );
    const prevState = await loadChecklistItemState(pool, itemId);
    const uid = req.session?.userId || null;
    const checked = !!b.checked;
    const hasVisible = await columnExists(pool, 'project_checklist', 'visible_to_builder');
    const hasAssigned = await columnExists(pool, 'project_checklist', 'assigned_to');
    const sets = [
      'checked = ?',
      'checked_by = ?',
      'checked_at = IF(? = 1, NOW(), NULL)',
      'notes = COALESCE(?, notes)',
    ];
    const vals = [checked ? 1 : 0, checked ? uid : null, checked ? 1 : 0, b.notes !== undefined ? b.notes : null];
    if (hasVisible && b.visible_to_builder !== undefined) {
      sets.push('visible_to_builder = ?');
      vals.push(b.visible_to_builder ? 1 : 0);
    }
    if (hasAssigned && b.assigned_to !== undefined) {
      const at = ['builder', 'sf'].includes(String(b.assigned_to).toLowerCase())
        ? String(b.assigned_to).toLowerCase()
        : 'sf';
      sets.push('assigned_to = ?');
      vals.push(at);
    }
    vals.push(itemId, id);
    await pool.execute(
      `UPDATE project_checklist SET ${sets.join(', ')} WHERE id = ? AND project_id = ?`,
      vals
    );
    await refreshChecklistCompletedFlag(pool, id);
    const [rows] = await pool.query('SELECT * FROM project_checklist WHERE id = ?', [itemId]);
    const updated = rows[0];
    if (updated && prevState) {
      notifyBuilderChecklistAssigned(pool, id, [updated], {
        [itemId]: prevState,
      }).catch((err) => console.warn('[checklist notify]', err.message));
    }
    res.json({ success: true, data: updated || null });
  } catch (e) {
    console.error('checklist put', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post(
  '/:id/photos',
  ...allAuthed,
  requirePermission('projects.edit'),
  (req, res, next) => {
    uploadProjectPhoto.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ success: false, error: err.message });
      next();
    });
  },
  async (req, res) => {
    try {
      const pool = await getDBConnection();
      if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
      const id = parseInt(req.params.id, 10);
      if (!req.file) return res.status(400).json({ success: false, error: 'file required' });
      const phase = ['before', 'during', 'after'].includes(req.body?.phase) ? req.body.phase : 'during';
      const rel = path.join('projects', String(id), req.file.filename).replace(/\\/g, '/');
      const fileUrl = `/uploads/${rel}`;
      const uid = req.session?.userId || null;
      const hasFileUrl = await columnExists(pool, 'project_photos', 'file_url');
      let ins;
      if (hasFileUrl) {
        [ins] = await pool.execute(
          `INSERT INTO project_photos (
            project_id, phase, filename, original_name, file_path, file_url, file_size, mime_type, caption, uploaded_by
          ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [
            id,
            phase,
            req.file.filename,
            req.file.originalname || null,
            rel,
            fileUrl,
            req.file.size || null,
            req.file.mimetype || null,
            req.body?.caption != null ? String(req.body.caption).slice(0, 255) : null,
            uid,
          ]
        );
      } else {
        [ins] = await pool.execute(
          `INSERT INTO project_photos (
            project_id, phase, filename, original_name, file_path, file_size, mime_type, caption, uploaded_by
          ) VALUES (?,?,?,?,?,?,?,?,?)`,
          [
            id,
            phase,
            req.file.filename,
            req.file.originalname || null,
            rel,
            req.file.size || null,
            req.file.mimetype || null,
            req.body?.caption != null ? String(req.body.caption).slice(0, 255) : null,
            uid,
          ]
        );
      }
      const [rows] = await pool.query('SELECT * FROM project_photos WHERE id = ?', [ins.insertId]);
      logBuilderActivityForProject(pool, id, {
        type: 'photo',
        text: `Senior Floors added a ${phase} photo to the project`,
      }).catch((err) => console.warn('[projects] photo activity:', err.message));
      res.status(201).json({ success: true, data: rows[0] });
    } catch (e) {
      console.error('photo upload', e);
      res.status(500).json({ success: false, error: e.message });
    }
  }
);

router.get('/:id/photos', ...allAuthed, requirePermission('projects.view'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    const [rows] = await pool.query('SELECT * FROM project_photos WHERE project_id = ? ORDER BY id', [id]);
    const before = [];
    const during = [];
    const after = [];
    for (const r of rows) {
      const fu = r.file_url != null ? String(r.file_url).trim() : '';
      const url =
        fu && fu.startsWith('/')
          ? fu
          : fu
            ? `/uploads/${fu.replace(/^\//, '')}`
            : `/uploads/${String(r.file_path || '').replace(/^\//, '')}`;
      const row = { ...r, url, file_url: url };
      if (r.phase === 'before') before.push(row);
      else if (r.phase === 'after') after.push(row);
      else during.push(row);
    }
    res.json({ success: true, data: { before, during, after } });
  } catch (e) {
    console.error('photos list', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete('/:id/photos/:photoId', ...allAuthed, requirePermission('projects.edit'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    const pid = parseInt(req.params.photoId, 10);
    const [rows] = await pool.query('SELECT * FROM project_photos WHERE id = ? AND project_id = ?', [pid, id]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    const fp = rows[0].file_path;
    const abs = path.join(process.cwd(), 'uploads', fp);
    await pool.execute('DELETE FROM project_photos WHERE id = ?', [pid]);
    try {
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch (_) {}
    res.json({ success: true });
  } catch (e) {
    console.error('photo delete', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.put('/:id/photos/:photoId/cover', ...allAuthed, requirePermission('projects.edit'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    const photoId = parseInt(req.params.photoId, 10);
    const hasCoverCol = await columnExists(pool, 'project_photos', 'is_cover');
    if (hasCoverCol) {
      await pool.execute('UPDATE project_photos SET is_cover = 0 WHERE project_id = ?', [id]);
      await pool.execute('UPDATE project_photos SET is_cover = 1 WHERE id = ? AND project_id = ?', [
        photoId,
        id,
      ]);
    }
    if (await columnExists(pool, 'projects', 'portfolio_cover_photo_id')) {
      await pool.execute('UPDATE projects SET portfolio_cover_photo_id = ? WHERE id = ?', [photoId, id]);
    }
    res.json({ success: true });
  } catch (e) {
    console.error('photo cover', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/:id/portfolio/publish', ...allAuthed, requirePermission('projects.edit'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    const { photo_ids, title, description } = req.body || {};
    if (!photo_ids?.length) {
      return res.status(400).json({ success: false, error: 'Selecione ao menos uma foto' });
    }
    const result = await publishToPortfolio(pool, id, photo_ids, { title, description });
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/:id/portfolio/status', ...allAuthed, requirePermission('projects.view'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    const cols = await projectsColumnSet(pool);
    const pick = {};
    for (const c of [
      'portfolio_published',
      'portfolio_published_at',
      'portfolio_title',
      'portfolio_description',
      'portfolio_external_id',
      'portfolio_cover_photo_id',
    ]) {
      if (cols.has(c)) pick[c] = true;
    }
    if (!Object.keys(pick).length) {
      return res.json({ success: true, data: {} });
    }
    const fields = Object.keys(pick).join(', ');
    const [rows] = await pool.query(`SELECT ${fields} FROM projects WHERE id = ?`, [id]);
    res.json({ success: true, data: rows[0] || {} });
  } catch (e) {
    console.error('portfolio status', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

const PPF_TYPES = new Set(['deposit', 'progress', 'final', 'other']);
const PPF_METHODS = new Set(['cash', 'check', 'zelle', 'venmo', 'credit_card', 'bank_transfer', 'other']);

function ymdPpf(s) {
  const m = String(s || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

router.get('/:id/payment-forecast', ...allAuthed, requirePermission('projects.view'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const [pex] = await pool.query('SELECT id FROM projects WHERE id = ?', [id]);
    if (!pex.length) return res.status(404).json({ success: false, error: 'Project not found' });
    if (!(await tableExists(pool, 'project_payment_forecasts'))) {
      return res.json({
        success: true,
        data: { forecasts: [], receipts: [], tableMissing: true },
      });
    }
    const [forecasts] = await pool.query(
      `SELECT * FROM project_payment_forecasts WHERE project_id = ? ORDER BY expected_payment_date ASC, id ASC`,
      [id]
    );
    let receipts = [];
    if (await tableExists(pool, 'payment_receipts')) {
      const [r] = await pool.query(
        `SELECT id, payment_type, amount, payment_date, payment_method, reference_number, notes
         FROM payment_receipts WHERE project_id = ? ORDER BY payment_date DESC, id DESC`,
        [id]
      );
      receipts = r || [];
    }
    res.json({ success: true, data: { forecasts, receipts, tableMissing: false } });
  } catch (e) {
    console.error('GET /projects/:id/payment-forecast', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/:id/payment-forecast', ...allAuthed, requirePermission('projects.edit'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const projectId = parseInt(req.params.id, 10);
    if (!projectId) return res.status(400).json({ success: false, error: 'Invalid id' });
    if (!(await tableExists(pool, 'project_payment_forecasts'))) {
      return res.status(503).json({
        success: false,
        error: 'Tabela project_payment_forecasts em falta — reinicie o servidor para criar o schema financeiro.',
        code: 'PPF_SCHEMA_MISSING',
      });
    }
    const [pex] = await pool.query('SELECT id FROM projects WHERE id = ?', [projectId]);
    if (!pex.length) return res.status(404).json({ success: false, error: 'Project not found' });

    const b = req.body || {};
    const expected_payment_date = ymdPpf(b.expected_payment_date);
    let payment_type = String(b.payment_type || 'progress').toLowerCase();
    let payment_method = String(b.payment_method || 'check').toLowerCase();
    if (!PPF_TYPES.has(payment_type)) payment_type = 'progress';
    if (!PPF_METHODS.has(payment_method)) payment_method = 'check';
    const amount =
      b.amount != null && String(b.amount).trim() !== '' ? Math.round(Number(b.amount) * 100) / 100 : null;
    const notes = b.notes != null ? String(b.notes).slice(0, 500) : null;
    const prParsed =
      b.payment_receipt_id != null && String(b.payment_receipt_id).trim() !== ''
        ? parseInt(String(b.payment_receipt_id), 10)
        : null;
    const payment_receipt_id = Number.isFinite(prParsed) && prParsed > 0 ? prParsed : null;
    const uid = req.session?.userId || null;

    if (!expected_payment_date) {
      return res.status(400).json({ success: false, error: 'expected_payment_date obrigatória (YYYY-MM-DD)' });
    }

    let receiptOk = true;
    if (payment_receipt_id && (await tableExists(pool, 'payment_receipts'))) {
      const [rc] = await pool.query(
        'SELECT id FROM payment_receipts WHERE id = ? AND project_id = ? LIMIT 1',
        [payment_receipt_id, projectId]
      );
      receiptOk = rc.length > 0;
    } else if (payment_receipt_id) {
      receiptOk = false;
    }
    const prid = receiptOk && payment_receipt_id ? payment_receipt_id : null;

    const [ins] = await pool.execute(
      `INSERT INTO project_payment_forecasts
       (project_id, expected_payment_date, payment_type, payment_method, amount, notes, payment_receipt_id, created_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [projectId, expected_payment_date, payment_type, payment_method, amount, notes, prid, uid]
    );
    const [rowsIns] = await pool.query('SELECT * FROM project_payment_forecasts WHERE id = ?', [ins.insertId]);
    res.status(201).json({ success: true, data: rowsIns[0] });
  } catch (e) {
    console.error('POST /projects/:id/payment-forecast', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.put('/:id/payment-forecast/:forecastId', ...allAuthed, requirePermission('projects.edit'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const projectId = parseInt(req.params.id, 10);
    const forecastId = parseInt(req.params.forecastId, 10);
    if (!projectId || !forecastId) return res.status(400).json({ success: false, error: 'Invalid id' });
    if (!(await tableExists(pool, 'project_payment_forecasts'))) {
      return res.status(503).json({ success: false, error: 'Tabela project_payment_forecasts em falta' });
    }
    const [ex] = await pool.query(
      'SELECT id FROM project_payment_forecasts WHERE id = ? AND project_id = ?',
      [forecastId, projectId]
    );
    if (!ex.length) return res.status(404).json({ success: false, error: 'Não encontrado' });

    const b = req.body || {};
    const expected_payment_date = ymdPpf(b.expected_payment_date);
    let payment_type = String(b.payment_type || 'progress').toLowerCase();
    let payment_method = String(b.payment_method || 'check').toLowerCase();
    if (!PPF_TYPES.has(payment_type)) payment_type = 'progress';
    if (!PPF_METHODS.has(payment_method)) payment_method = 'check';
    const amount =
      b.amount != null && String(b.amount).trim() !== '' ? Math.round(Number(b.amount) * 100) / 100 : null;
    const notes = b.notes != null ? String(b.notes).slice(0, 500) : null;
    const prParsedPut =
      b.payment_receipt_id != null && String(b.payment_receipt_id).trim() !== ''
        ? parseInt(String(b.payment_receipt_id), 10)
        : null;
    const payment_receipt_id = Number.isFinite(prParsedPut) && prParsedPut > 0 ? prParsedPut : null;

    if (!expected_payment_date) {
      return res.status(400).json({ success: false, error: 'expected_payment_date obrigatória' });
    }

    let receiptOk = true;
    if (payment_receipt_id && (await tableExists(pool, 'payment_receipts'))) {
      const [rc] = await pool.query(
        'SELECT id FROM payment_receipts WHERE id = ? AND project_id = ? LIMIT 1',
        [payment_receipt_id, projectId]
      );
      receiptOk = rc.length > 0;
    } else if (payment_receipt_id) {
      receiptOk = false;
    }
    const prid = receiptOk && payment_receipt_id ? payment_receipt_id : null;

    await pool.execute(
      `UPDATE project_payment_forecasts SET
        expected_payment_date = ?, payment_type = ?, payment_method = ?, amount = ?, notes = ?, payment_receipt_id = ?
       WHERE id = ? AND project_id = ?`,
      [expected_payment_date, payment_type, payment_method, amount, notes, prid, forecastId, projectId]
    );
    const [rowsUp] = await pool.query('SELECT * FROM project_payment_forecasts WHERE id = ?', [forecastId]);
    res.json({ success: true, data: rowsUp[0] });
  } catch (e) {
    console.error('PUT /projects/:id/payment-forecast', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete('/:id/payment-forecast/:forecastId', ...allAuthed, requirePermission('projects.edit'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const projectId = parseInt(req.params.id, 10);
    const forecastId = parseInt(req.params.forecastId, 10);
    if (!projectId || !forecastId) return res.status(400).json({ success: false, error: 'Invalid id' });
    if (!(await tableExists(pool, 'project_payment_forecasts'))) {
      return res.status(404).json({ success: false, error: 'Não encontrado' });
    }
    const [r] = await pool.execute(
      'DELETE FROM project_payment_forecasts WHERE id = ? AND project_id = ?',
      [forecastId, projectId]
    );
    if (r.affectedRows === 0) return res.status(404).json({ success: false, error: 'Não encontrado' });
    res.json({ success: true });
  } catch (e) {
    console.error('DELETE /projects/:id/payment-forecast', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/:id', ...allAuthed, requirePermission('projects.view'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });

    const colSet = await projectsColumnSet(pool);
    const hasCol = (c) => colSet.has(c);
    const uJoin = usersJoinSql(hasCol);

    let proj;
    try {
      const [rows] = await pool.query(
        `SELECT p.*, u.name AS assigned_to_name,
          c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
         FROM projects p
         ${uJoin}
         LEFT JOIN customers c ON p.customer_id = c.id
         WHERE p.id = ?`,
        [id]
      );
      proj = rows;
    } catch (e) {
      if (isBadFieldError(e)) {
        const [rows] = await pool.query('SELECT p.* FROM projects p WHERE p.id = ?', [id]);
        proj = rows;
      } else {
        throw e;
      }
    }

    const [costs, materials, checklist, photos, lead, customer] = await Promise.all([
      safeChildQuery(pool, 'SELECT * FROM project_costs WHERE project_id = ? ORDER BY id', [id]),
      safeChildQuery(pool, 'SELECT * FROM project_materials WHERE project_id = ? ORDER BY id', [id]),
      safeChildQuery(pool, 'SELECT * FROM project_checklist WHERE project_id = ? ORDER BY category, sort_order, id', [id]),
      safeChildQuery(
        pool,
        `SELECT id, project_id, phase, filename, original_name, file_path, file_size, mime_type, caption, taken_at, uploaded_by, created_at
         FROM project_photos WHERE project_id = ? ORDER BY id`,
        [id]
      ),
      safeChildQuery(
        pool,
        `SELECT l.*, ps.slug AS pipeline_stage_slug
         FROM projects p LEFT JOIN leads l ON p.lead_id = l.id
         LEFT JOIN pipeline_stages ps ON l.pipeline_stage_id = ps.id
         WHERE p.id = ?`,
        [id]
      ),
      safeChildQuery(
        pool,
        `SELECT c.* FROM projects p LEFT JOIN customers c ON p.customer_id = c.id WHERE p.id = ?`,
        [id]
      ),
    ]);

    if (!proj.length) return res.status(404).json({ success: false, error: 'Project not found' });
    const p = proj[0];

    let estRows = [];
    if (hasCol('estimate_id') && p.estimate_id != null) {
      const [byId] = await pool.query('SELECT e.* FROM estimates e WHERE e.id = ? LIMIT 1', [p.estimate_id]);
      estRows = byId || [];
    }
    if (!estRows.length) {
      estRows = await safeChildQuery(
        pool,
        'SELECT e.* FROM estimates e WHERE e.project_id = ? ORDER BY e.id DESC LIMIT 1',
        [id]
      );
    }

    const photoMeta = photos.map((ph) => ({
      ...ph,
      url: `/uploads/${String(ph.file_path || '').replace(/^\//, '')}`,
    }));

    const base = mapListProjectRow(p);
    const cust = customer[0] && customer[0].id ? customer[0] : null;
    const leadRow = lead[0] && lead[0].id ? lead[0] : null;
    const address = resolveProjectAddress(base.address, cust, leadRow) || base.address;
    const builderPartner = await resolveBuilderPartnerForProject(pool, p);
    res.json({
      success: true,
      data: {
        ...base,
        address,
        builder_partner: builderPartner,
        partner_builder_id: builderPartner?.builder_table_id ?? p.partner_builder_id ?? null,
        costs: costs.map((c) => floatMoneyFields(c, ['quantity', 'unit_cost', 'total_cost'])),
        materials: materials.map((m) =>
          floatMoneyFields(m, ['qty_ordered', 'qty_received', 'qty_used', 'unit_cost', 'total_cost'])
        ),
        checklist,
        photos: photoMeta,
        lead: lead[0] && lead[0].id ? lead[0] : null,
        estimate: estRows[0] || null,
        customer: customer[0] && customer[0].id ? customer[0] : null,
      },
    });
  } catch (e) {
    console.error('get project', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.put('/:id', ...allAuthed, requirePermission('projects.edit'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    const b = req.body || {};

    const [ex] = await pool.query('SELECT * FROM projects WHERE id = ?', [id]);
    if (!ex.length) return res.status(404).json({ success: false, error: 'Project not found' });

    const pcols = await getProjectsTableColumnSet(pool);
    const dtPut = projectDatePhysicalColumns(pcols);

    const allowed = [
      'status',
      'completion_percentage',
      'days_estimated',
      'days_actual',
      'notes',
      'internal_notes',
      'crew_id',
      'assigned_to',
      'supply_value',
      'installation_value',
      'sand_finish_value',
      'name',
      'address',
      'flooring_type',
      'total_sqft',
      'contract_value',
      'service_type',
      'project_number',
      'client_name',
      'general_manager_id',
      'installation_supervisor_id',
      'sand_finish_supervisor_id',
    ];
    const moneyKeys = new Set([
      'supply_value',
      'installation_value',
      'sand_finish_value',
      'total_sqft',
      'contract_value',
    ]);
    const intKeys = new Set([
      'completion_percentage',
      'crew_id',
      'assigned_to',
      'days_actual',
      'days_estimated',
      'general_manager_id',
      'installation_supervisor_id',
      'sand_finish_supervisor_id',
    ]);
    const updates = [];
    const vals = [];
    for (const k of allowed) {
      if (b[k] === undefined) continue;
      if (!pcols.has(k)) continue;
      if (k === 'name') {
        const n = String(b.name).trim();
        if (!n) return res.status(400).json({ success: false, error: 'name cannot be empty' });
        updates.push('`name` = ?');
        vals.push(n.slice(0, 255));
        continue;
      }
      if (k === 'address') {
        updates.push('`address` = ?');
        vals.push(b.address == null || b.address === '' ? null : String(b.address).trim().slice(0, 2000));
        continue;
      }
      if (k === 'flooring_type' || k === 'service_type' || k === 'project_number') {
        updates.push(`\`${k}\` = ?`);
        vals.push(
          b[k] == null || b[k] === '' ? null : String(b[k]).trim().slice(0, k === 'project_number' ? 64 : 100)
        );
        continue;
      }
      if (k === 'client_name') {
        updates.push('`client_name` = ?');
        vals.push(b.client_name == null || b.client_name === '' ? null : String(b.client_name).trim().slice(0, 255));
        continue;
      }
      updates.push(`\`${k}\` = ?`);
      if (moneyKeys.has(k)) vals.push(money(b[k]));
      else if (intKeys.has(k)) vals.push(b[k] === null || b[k] === '' ? null : parseInt(String(b[k]), 10));
      else vals.push(b[k]);
    }

    if (b.start_date !== undefined && dtPut.start) {
      updates.push(`\`${dtPut.start}\` = ?`);
      vals.push(b.start_date);
    }
    if (b.end_date_estimated !== undefined && dtPut.endEst) {
      updates.push(`\`${dtPut.endEst}\` = ?`);
      vals.push(b.end_date_estimated);
    }
    if (b.end_date_actual !== undefined && dtPut.endActual) {
      updates.push(`\`${dtPut.endActual}\` = ?`);
      vals.push(b.end_date_actual);
    }

    if (String(b.status) === 'completed' && dtPut.endActual) {
      updates.push(`\`${dtPut.endActual}\` = COALESCE(\`${dtPut.endActual}\`, CURDATE())`);
      if (b.days_actual === undefined) {
        const start = ex[0].start_date || ex[0].estimated_start_date;
        const endA =
          b.end_date_actual ||
          ex[0].end_date_actual ||
          ex[0].actual_end_date ||
          new Date().toISOString().slice(0, 10);
        if (start) {
          const d0 = new Date(`${String(start).slice(0, 10)}T12:00:00`);
          const d1 = new Date(`${String(endA).slice(0, 10)}T12:00:00`);
          const days = Math.max(0, Math.round((d1 - d0) / 86400000));
          if (pcols.has('days_actual')) {
            updates.push('`days_actual` = ?');
            vals.push(days);
          }
        }
      }
    }

    if (b.builder_partner_id !== undefined) {
      await linkProjectToBuilderPartner(
        pool,
        id,
        b.builder_partner_id === null || b.builder_partner_id === ''
          ? null
          : parseInt(String(b.builder_partner_id), 10)
      );
    }

    if (updates.length === 0 && b.builder_partner_id === undefined) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }
    if (updates.length > 0) {
      vals.push(id);
      await pool.execute(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`, vals);
      recordProjectCrmUpdate(pool, id, ex[0], b).catch((err) =>
        console.warn('[projects] activity log:', err.message)
      );
    }

    const [rows] = await pool.query(
      `SELECT p.*,
        c.address AS _customer_address,
        c.city AS _customer_city,
        c.state AS _customer_state,
        c.zipcode AS _customer_zipcode,
        l.address AS _lead_address,
        l.zipcode AS _lead_zipcode
       FROM projects p
       LEFT JOIN customers c ON p.customer_id = c.id
       LEFT JOIN leads l ON p.lead_id = l.id
       WHERE p.id = ?`,
      [id]
    );
    const mapped = mapListProjectRow(rows[0]);
    mapped.builder_partner = await resolveBuilderPartnerForProject(pool, rows[0]);
    mapped.partner_builder_id =
      mapped.builder_partner?.builder_table_id ?? rows[0].partner_builder_id ?? null;
    res.json({ success: true, data: mapped });
  } catch (e) {
    console.error('put project', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete('/:id', ...allAuthed, requirePermission('projects.delete'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    const hasDeleted = await columnExists(pool, 'projects', 'deleted_at');
    if (!hasDeleted) {
      return res.status(500).json({ success: false, error: 'Coluna deleted_at em falta — rode npm run migrate:projects-complete' });
    }
    await pool.execute('UPDATE projects SET deleted_at = NOW() WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (e) {
    console.error('soft delete project', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
