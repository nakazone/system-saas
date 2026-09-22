/**
 * Construction payroll v2 — employees, periods, timesheets, reports.
 */
import { getDBConnection } from '../config/db.js';
import { calcTimesheetLineAmount } from '../modules/payroll/constructionPayrollCalc.js';
import {
  buildIndividualPayrollReportsPdfBuffer,
  buildPayrollSlipPdfBuffer,
} from '../modules/payroll/payrollSlipPdf.js';
import { sendQuoteEmail } from '../modules/quotes/quoteMail.js';

function isMissingTable(err) {
  return err && (err.code === 'ER_NO_SUCH_TABLE' || String(err.message || '').includes('doesn\'t exist'));
}

/** Por funcionário: somas de dias/horas e repartição base vs HE (alinhada a calcTimesheetLineAmount). */
function aggregateTimesheetLinesForPreview(lines) {
  const byEmp = new Map();
  for (const r of lines || []) {
    const eid = r.employee_id;
    const emp = {
      payment_type: r.payment_type,
      daily_rate: r.daily_rate,
      hourly_rate: r.hourly_rate,
      overtime_rate: r.overtime_rate,
    };
    const line = {
      days_worked: r.days_worked,
      regular_hours: r.regular_hours,
      overtime_hours: r.overtime_hours,
      daily_rate_override: r.daily_rate_override,
    };
    const baseAmt = calcTimesheetLineAmount(emp, { ...line, overtime_hours: 0 });
    const otH = Number(line.overtime_hours) || 0;
    const ort = Number(emp.overtime_rate) || 0;
    const otAmt = Math.round(otH * ort * 100) / 100;
    const cur = byEmp.get(eid) || {
      days_worked_sum: 0,
      regular_hours_sum: 0,
      overtime_hours_sum: 0,
      amount_sheet_base: 0,
      amount_overtime: 0,
    };
    cur.days_worked_sum += Number(r.days_worked) || 0;
    cur.regular_hours_sum += Number(r.regular_hours) || 0;
    cur.overtime_hours_sum += Number(r.overtime_hours) || 0;
    cur.amount_sheet_base += baseAmt;
    cur.amount_overtime += otAmt;
    byEmp.set(eid, cur);
  }
  for (const cur of byEmp.values()) {
    cur.days_worked_sum = Math.round(cur.days_worked_sum * 100) / 100;
    cur.regular_hours_sum = Math.round(cur.regular_hours_sum * 100) / 100;
    cur.overtime_hours_sum = Math.round(cur.overtime_hours_sum * 100) / 100;
    cur.amount_sheet_base = Math.round(cur.amount_sheet_base * 100) / 100;
    cur.amount_overtime = Math.round(cur.amount_overtime * 100) / 100;
  }
  return byEmp;
}

/** Por funcionário: datas (YYYY-MM-DD) em que a soma de `days_worked` >= 2 (diária/misto). */
function computeDoubleDiariaDatesByEmployee(detailLines) {
  const map = new Map();
  for (const r of detailLines || []) {
    const pt = String(r.payment_type || 'daily').toLowerCase();
    if (pt === 'hourly') continue;
    const eid = r.employee_id;
    if (!eid) continue;
    const wd = mysqlDateToYmd(r.work_date);
    if (!wd || !/^\d{4}-\d{2}-\d{2}$/.test(wd)) continue;
    const d = Number(r.days_worked) || 0;
    if (!map.has(eid)) map.set(eid, new Map());
    const inner = map.get(eid);
    inner.set(wd, (inner.get(wd) || 0) + d);
  }
  const out = new Map();
  for (const [eid, dateMap] of map) {
    const dates = [];
    for (const [date, sum] of dateMap) {
      if (Math.round(sum * 100) >= 200) dates.push(date);
    }
    dates.sort();
    if (dates.length) out.set(eid, dates);
  }
  return out;
}

function isMissingColumn(err, colName) {
  return (
    err &&
    err.code === 'ER_BAD_FIELD_ERROR' &&
    String(err.message || '').includes(String(colName || ''))
  );
}

/** Bases criadas antes da migração de descontos não tinham a coluna `discount`; o fallback gravava só reembolso. */
async function ensurePayrollPeriodAdjustmentsDiscountColumn(conn) {
  const [[t]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'construction_payroll_period_adjustments'`
  );
  if (!t || Number(t.c) === 0) return;
  const [[col]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'construction_payroll_period_adjustments'
       AND COLUMN_NAME = 'discount'`
  );
  if (Number(col?.c) > 0) return;
  try {
    await conn.execute(
      `ALTER TABLE construction_payroll_period_adjustments
       ADD COLUMN discount decimal(12,2) NOT NULL DEFAULT 0.00
       COMMENT 'Desconto no fechamento (subtrai ao total do funcionário)'
       AFTER reimbursement`
    );
  } catch (e) {
    if (e && (e.code === 'ER_DUP_FIELDNAME' || String(e.message || '').includes('Duplicate column'))) return;
    throw e;
  }
}

/** Relatórios: garantir from ≤ to e formato YYYY-MM-DD */
function normalizeReportRange(from, to) {
  const a = String(from || '').trim().slice(0, 10);
  const b = String(to || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  return a <= b ? [a, b] : [b, a];
}

/** Resposta JSON: DATE do MySQL vira Date em UTC — usar componentes UTC (evita dia errado no <input type="date">). */
function mysqlDateToYmd(v) {
  if (v == null || v === '') return v;
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getUTCFullYear();
    const mo = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  return String(v).match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || String(v).slice(0, 10);
}

function serializePeriodForClient(p) {
  if (!p || typeof p !== 'object') return p;
  return {
    ...p,
    start_date: mysqlDateToYmd(p.start_date),
    end_date: mysqlDateToYmd(p.end_date),
  };
}

/** id de linha já gravada (evita Boolean(line.id) falhar com strings / omitir updates). */
function hasPositiveTimesheetLineId(line) {
  if (!line || line.id == null || line.id === '') return false;
  const n = parseInt(String(line.id), 10);
  return Number.isFinite(n) && n > 0;
}

function serializeTimesheetRowForClient(row) {
  if (!row || typeof row !== 'object') return row;
  const o = { ...row };
  o.work_date = mysqlDateToYmd(row.work_date);
  for (const k of ['days_worked', 'regular_hours', 'overtime_hours', 'calculated_amount']) {
    const v = row[k];
    if (v != null && v !== '') {
      const n = Number(String(v).replace(',', '.'));
      if (Number.isFinite(n)) o[k] = Math.round(n * 1e6) / 1e6;
    }
  }
  const dro = row.daily_rate_override;
  if (dro == null || dro === '') {
    o.daily_rate_override = null;
  } else {
    const n = Number(String(dro).replace(',', '.'));
    o.daily_rate_override = Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }
  return o;
}

function sendDbError(res, err) {
  if (isMissingTable(err)) {
    return res.status(503).json({
      success: false,
      error: 'Tabelas de payroll não encontradas. Execute: npm run migrate:construction-payroll',
      code: 'PAYROLL_SCHEMA_MISSING',
    });
  }
  console.error('[construction-payroll]', err);
  return res.status(500).json({ success: false, error: err.message || String(err) });
}

async function loadPeriod(pool, id) {
  const [rows] = await pool.query('SELECT * FROM construction_payroll_periods WHERE id = ?', [id]);
  return rows[0] || null;
}

async function assertPeriodWritable(pool, periodId) {
  const p = await loadPeriod(pool, periodId);
  if (!p) {
    const e = new Error('Período não encontrado');
    e.statusCode = 404;
    throw e;
  }
  if (p.status === 'closed') {
    const e = new Error('Período fechado — edição bloqueada.');
    e.statusCode = 409;
    throw e;
  }
  return p;
}

function userHasPayrollManage(req) {
  if (!req.session?.userId) return false;
  if (String(req.session.userRole || '').toLowerCase() === 'admin') return true;
  return Array.isArray(req.session.permissionKeys) && req.session.permissionKeys.includes('payroll.manage');
}

/** Quadro de horas: aberto = qualquer um com payroll.view; fechado = só payroll.manage pode alterar/apagar linhas. */
async function assertPeriodAllowsTimesheetMutation(pool, periodId, req) {
  const p = await loadPeriod(pool, periodId);
  if (!p) {
    const e = new Error('Período não encontrado');
    e.statusCode = 404;
    throw e;
  }
  if (p.status === 'closed' && !userHasPayrollManage(req)) {
    const e = new Error(
      'Período fechado — só quem tem gestão da folha (payroll.manage) pode alterar ou excluir registros.'
    );
    e.statusCode = 409;
    throw e;
  }
  return p;
}

/** Extrai AAAA-MM-DD do input (date picker ou ISO). */
function normalizeWorkDateYMD(raw) {
  const s = String(raw ?? '').trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m && /^\d{4}-\d{2}-\d{2}$/.test(m[1]) ? m[1] : '';
}

/**
 * Validar intervalo no próprio MySQL — evita bugs de timezone / Date em JS com mysql2.
 */
async function assertWorkDateInPeriodDb(executor, periodId, workDateYmd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDateYmd)) {
    const e = new Error('Formato de data inválido (use AAAA-MM-DD).');
    e.statusCode = 400;
    throw e;
  }
  const [[row]] = await executor.query(
    `SELECT (CAST(? AS DATE) BETWEEN start_date AND end_date) AS ok
     FROM construction_payroll_periods WHERE id = ? LIMIT 1`,
    [workDateYmd, periodId]
  );
  if (!row) {
    const e = new Error('Período não encontrado');
    e.statusCode = 404;
    throw e;
  }
  if (Number(row.ok) !== 1) {
    const e = new Error('Data fora do período');
    e.statusCode = 400;
    throw e;
  }
}

async function loadEmployee(pool, id) {
  const [rows] = await pool.query('SELECT * FROM construction_payroll_employees WHERE id = ?', [id]);
  return rows[0] || null;
}

function employeeAllowsWorkDateOutsidePeriod(emp) {
  if (!emp) return false;
  const v = emp.allow_work_date_outside_period;
  return Number(v) === 1;
}

function safePaySlipFilenamePart(s) {
  return String(s || 'recibo').replace(/[^\w.\-]+/g, '_').slice(0, 48);
}

/** Aplica reembolso/desconto vindos do body (ex.: PDF alinhado ao preview antes de guardar). */
function applyAdjustmentOverridesToPreviewData(data, list) {
  if (!list || !list.length || !data?.by_employee) return;
  const m = new Map();
  for (const x of list) {
    const eid = parseInt(String(x.employee_id), 10);
    if (!eid) continue;
    m.set(eid, {
      reimbursement: Math.max(0, Number(x.reimbursement) || 0),
      discount: Math.max(0, Number(x.discount) || 0),
    });
  }
  for (const row of data.by_employee) {
    const o = m.get(row.employee_id);
    if (!o) continue;
    row.reimbursement = o.reimbursement;
    row.discount = o.discount;
    row.employee_total = Math.round((Number(row.subtotal) + o.reimbursement - o.discount) * 100) / 100;
  }
}

/**
 * Mesmos dados que GET /periods/:id/preview (para PDF, e-mail e ferramentas no CRM).
 * @param {import('mysql2/promise').Pool} pool
 * @param {number} id — period id
 * @param {{ adjustmentOverrides?: { employee_id: number, reimbursement?: number, discount?: number }[] }} [options]
 */
async function computePeriodPreviewData(pool, id, options = {}) {
  const p = await loadPeriod(pool, id);
  if (!p) {
    const e = new Error('Não encontrado');
    e.statusCode = 404;
    throw e;
  }

  let byEmpTs = [];
  try {
    const [rows] = await pool.query(
      `SELECT e.id AS employee_id, e.name, e.payment_type, e.sector,
        COUNT(t.id) AS line_count,
        COALESCE(SUM(t.calculated_amount),0) AS subtotal
       FROM construction_payroll_timesheets t
       INNER JOIN construction_payroll_employees e ON e.id = t.employee_id
       WHERE t.period_id = ?
       GROUP BY e.id, e.name, e.payment_type, e.sector
       ORDER BY e.name`,
      [id]
    );
    byEmpTs = rows || [];
  } catch (e) {
    if (e.code === 'ER_BAD_FIELD_ERROR' && String(e.message || '').includes('sector')) {
      const [rows] = await pool.query(
        `SELECT e.id AS employee_id, e.name, e.payment_type,
          COUNT(t.id) AS line_count,
          COALESCE(SUM(t.calculated_amount),0) AS subtotal
         FROM construction_payroll_timesheets t
         INNER JOIN construction_payroll_employees e ON e.id = t.employee_id
         WHERE t.period_id = ?
         GROUP BY e.id, e.name, e.payment_type
         ORDER BY e.name`,
        [id]
      );
      byEmpTs = (rows || []).map((r) => ({ ...r, sector: null }));
    } else {
      throw e;
    }
  }

  let detailLines = [];
  try {
    const [dl] = await pool.query(
      `SELECT t.employee_id, t.work_date, t.days_worked, t.regular_hours, t.overtime_hours,
              t.daily_rate_override, e.payment_type, e.daily_rate, e.hourly_rate, e.overtime_rate
       FROM construction_payroll_timesheets t
       INNER JOIN construction_payroll_employees e ON e.id = t.employee_id
       WHERE t.period_id = ?`,
      [id]
    );
    detailLines = dl || [];
  } catch (_) {
    detailLines = [];
  }
  const detailMap = aggregateTimesheetLinesForPreview(detailLines);
  const doubleDatesByEmp = computeDoubleDiariaDatesByEmployee(detailLines);

  let adjRows = [];
  try {
    const [ar] = await pool.query(
      'SELECT employee_id, reimbursement, discount, notes FROM construction_payroll_period_adjustments WHERE period_id = ?',
      [id]
    );
    adjRows = ar || [];
  } catch (e) {
    if (isMissingColumn(e, 'discount')) {
      try {
        const [ar] = await pool.query(
          'SELECT employee_id, reimbursement, notes FROM construction_payroll_period_adjustments WHERE period_id = ?',
          [id]
        );
        adjRows = (ar || []).map((x) => ({ ...x, discount: 0 }));
      } catch (_) {
        adjRows = [];
      }
    } else {
      adjRows = [];
    }
  }

  const adjMap = new Map(adjRows.map((r) => [r.employee_id, r]));
  const seen = new Set();
  const by_employee = [];

  for (const row of byEmpTs) {
    seen.add(row.employee_id);
    const adj = adjMap.get(row.employee_id);
    const reim = adj ? Number(adj.reimbursement) || 0 : 0;
    const disc = adj ? Number(adj.discount) || 0 : 0;
    const sub = Number(row.subtotal) || 0;
    const d = detailMap.get(row.employee_id) || {};
    by_employee.push({
      employee_id: row.employee_id,
      name: row.name,
      payment_type: row.payment_type,
      sector: row.sector,
      line_count: Number(row.line_count) || 0,
      subtotal: sub,
      days_worked_sum: d.days_worked_sum || 0,
      regular_hours_sum: d.regular_hours_sum || 0,
      overtime_hours_sum: d.overtime_hours_sum || 0,
      amount_sheet_base: d.amount_sheet_base || 0,
      amount_overtime: d.amount_overtime || 0,
      reimbursement: reim,
      discount: disc,
      reimbursement_notes: adj?.notes || null,
      employee_total: Math.round((sub + reim - disc) * 100) / 100,
      double_diaria_dates: doubleDatesByEmp.get(row.employee_id) || [],
    });
  }

  for (const adj of adjRows) {
    if (seen.has(adj.employee_id)) continue;
    const emp = await loadEmployee(pool, adj.employee_id);
    if (!emp) continue;
    const reim = Number(adj.reimbursement) || 0;
    const disc = Number(adj.discount) || 0;
    by_employee.push({
      employee_id: adj.employee_id,
      name: emp.name,
      payment_type: emp.payment_type,
      sector: emp.sector,
      line_count: 0,
      subtotal: 0,
      days_worked_sum: 0,
      regular_hours_sum: 0,
      overtime_hours_sum: 0,
      amount_sheet_base: 0,
      amount_overtime: 0,
      reimbursement: reim,
      discount: disc,
      reimbursement_notes: adj.notes || null,
      employee_total: Math.round((reim - disc) * 100) / 100,
      double_diaria_dates: [],
    });
  }

  by_employee.sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const [[grandTs]] = await pool.query(
    'SELECT COALESCE(SUM(calculated_amount),0) AS s FROM construction_payroll_timesheets WHERE period_id = ?',
    [id]
  );
  let grandReim = 0;
  let grandDisc = 0;
  try {
    const [[gr]] = await pool.query(
      'SELECT COALESCE(SUM(reimbursement),0) AS s FROM construction_payroll_period_adjustments WHERE period_id = ?',
      [id]
    );
    grandReim = Number(gr.s) || 0;
  } catch (_) {}
  try {
    const [[gd]] = await pool.query(
      'SELECT COALESCE(SUM(discount),0) AS s FROM construction_payroll_period_adjustments WHERE period_id = ?',
      [id]
    );
    grandDisc = Number(gd.s) || 0;
  } catch (_) {}

  const grand_timesheet = Number(grandTs.s) || 0;
  const grand_total = Math.round((grand_timesheet + grandReim - grandDisc) * 100) / 100;

  const result = {
    period: serializePeriodForClient(p),
    by_employee,
    grand_timesheet,
    grand_reimbursement: grandReim,
    grand_discount: grandDisc,
    grand_total,
  };
  if (Array.isArray(options.adjustmentOverrides) && options.adjustmentOverrides.length > 0) {
    applyAdjustmentOverridesToPreviewData(result, options.adjustmentOverrides);
  }
  return result;
}

/** @param {unknown} v */
function normalizeSector(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).toLowerCase().replace(/-/g, '_');
  if (s === 'installation') return 'installation';
  if (s === 'sand_finish' || s === 'sandandfinish' || s === 'sand and finish') return 'sand_finish';
  return null;
}

/** @param {import('express').Request} req @param {import('express').Response} res */
export async function getPayrollDashboard(req, res) {
  try {
    const pool = await getDBConnection();
    const [[empRow]] = await pool.query(
      'SELECT COUNT(*) AS c FROM construction_payroll_employees WHERE is_active = 1'
    );
    const [[openRow]] = await pool.query(
      "SELECT COUNT(*) AS c FROM construction_payroll_periods WHERE status = 'open'"
    );
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const from = startOfMonth.toISOString().slice(0, 10);
    const [[mtdRow]] = await pool.query(
      `SELECT COALESCE(SUM(calculated_amount),0) AS total FROM construction_payroll_timesheets WHERE work_date >= ?`,
      [from]
    );
    const [lastClosed] = await pool.query(
      `SELECT p.id, p.name, p.end_date, COALESCE(SUM(t.calculated_amount),0) AS total
       FROM construction_payroll_periods p
       LEFT JOIN construction_payroll_timesheets t ON t.period_id = p.id
       WHERE p.status = 'closed'
       GROUP BY p.id, p.name, p.end_date
       ORDER BY p.end_date DESC
       LIMIT 1`
    );
    return res.json({
      success: true,
      data: {
        active_employees: Number(empRow.c) || 0,
        open_periods: Number(openRow.c) || 0,
        month_to_date_payroll_total: Number(mtdRow.total) || 0,
        last_closed_period: lastClosed[0] || null,
      },
    });
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function listEmployees(req, res) {
  try {
    const pool = await getDBConnection();
    const activeOnly =
      req.query.active !== '0' && req.query.active !== 'false' && req.query.active !== 'all';
    let q = 'SELECT * FROM construction_payroll_employees';
    const params = [];
    if (activeOnly) {
      q += ' WHERE is_active = 1';
    }
    q += ' ORDER BY name ASC';
    const [rows] = await pool.query(q, params);
    return res.json({ success: true, data: rows });
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function getEmployee(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    const row = await loadEmployee(pool, id);
    if (!row) return res.status(404).json({ success: false, error: 'Não encontrado' });
    return res.json({ success: true, data: row });
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function createEmployee(req, res) {
  try {
    const pool = await getDBConnection();
    const b = req.body || {};
    const sector = normalizeSector(b.sector);
    const flexDates =
      b.allow_work_date_outside_period === true ||
      b.allow_work_date_outside_period === 1 ||
      b.allow_work_date_outside_period === '1'
        ? 1
        : 0;
    const baseParams = [
      String(b.name || '').trim() || 'Sem nome',
      b.role != null ? String(b.role) : null,
      b.phone != null ? String(b.phone) : null,
      b.email != null ? String(b.email) : null,
      ['daily', 'hourly', 'mixed'].includes(b.payment_type) ? b.payment_type : 'daily',
      Number(b.daily_rate) || 0,
      Number(b.hourly_rate) || 0,
      Number(b.overtime_rate) || 0,
      b.payment_method != null ? String(b.payment_method) : null,
      b.user_id != null && b.user_id !== '' ? parseInt(b.user_id, 10) : null,
      b.is_active === false || b.is_active === 0 ? 0 : 1,
    ];
    let r;
    try {
      const params = [...baseParams.slice(0, 9), sector, baseParams[9], baseParams[10], flexDates];
      [r] = await pool.execute(
        `INSERT INTO construction_payroll_employees
         (name, role, phone, email, payment_type, daily_rate, hourly_rate, overtime_rate, payment_method, sector, user_id, is_active, allow_work_date_outside_period)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params
      );
    } catch (e) {
      if (e.code === 'ER_BAD_FIELD_ERROR' && String(e.message || '').includes('sector')) {
        [r] = await pool.execute(
          `INSERT INTO construction_payroll_employees
           (name, role, phone, email, payment_type, daily_rate, hourly_rate, overtime_rate, payment_method, user_id, is_active, allow_work_date_outside_period)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [...baseParams, flexDates]
        );
      } else {
        throw e;
      }
    }
    const [rows] = await pool.query('SELECT * FROM construction_payroll_employees WHERE id = ?', [r.insertId]);
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function updateEmployee(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    const existing = await loadEmployee(pool, id);
    if (!existing) return res.status(404).json({ success: false, error: 'Não encontrado' });
    const b = req.body || {};
    const params = [
      b.name != null ? String(b.name).trim() : null,
      b.role !== undefined ? b.role : existing.role,
      b.phone !== undefined ? b.phone : existing.phone,
      b.email !== undefined ? b.email : existing.email,
      b.payment_type != null && ['daily', 'hourly', 'mixed'].includes(b.payment_type) ? b.payment_type : null,
      b.daily_rate != null ? Number(b.daily_rate) : null,
      b.hourly_rate != null ? Number(b.hourly_rate) : null,
      b.overtime_rate != null ? Number(b.overtime_rate) : null,
      b.payment_method !== undefined ? b.payment_method : existing.payment_method,
      b.sector !== undefined ? normalizeSector(b.sector) : existing.sector,
      b.user_id !== undefined ? (b.user_id === '' || b.user_id == null ? null : parseInt(b.user_id, 10)) : existing.user_id,
      b.allow_work_date_outside_period !== undefined
        ? b.allow_work_date_outside_period === true ||
          b.allow_work_date_outside_period === 1 ||
          b.allow_work_date_outside_period === '1'
          ? 1
          : 0
        : null,
      b.is_active !== undefined ? (b.is_active ? 1 : 0) : null,
      id,
    ];
    try {
      await pool.execute(
        `UPDATE construction_payroll_employees SET
          name = COALESCE(?, name),
          role = ?,
          phone = ?,
          email = ?,
          payment_type = COALESCE(?, payment_type),
          daily_rate = COALESCE(?, daily_rate),
          hourly_rate = COALESCE(?, hourly_rate),
          overtime_rate = COALESCE(?, overtime_rate),
          payment_method = ?,
          sector = ?,
          user_id = ?,
          allow_work_date_outside_period = COALESCE(?, allow_work_date_outside_period),
          is_active = COALESCE(?, is_active)
         WHERE id = ?`,
        params
      );
    } catch (e) {
      if (e.code === 'ER_BAD_FIELD_ERROR' && String(e.message || '').includes('sector')) {
        await pool.execute(
          `UPDATE construction_payroll_employees SET
            name = COALESCE(?, name),
            role = ?,
            phone = ?,
            email = ?,
            payment_type = COALESCE(?, payment_type),
            daily_rate = COALESCE(?, daily_rate),
            hourly_rate = COALESCE(?, hourly_rate),
            overtime_rate = COALESCE(?, overtime_rate),
            payment_method = ?,
            user_id = ?,
            allow_work_date_outside_period = COALESCE(?, allow_work_date_outside_period),
            is_active = COALESCE(?, is_active)
           WHERE id = ?`,
          [
            params[0],
            params[1],
            params[2],
            params[3],
            params[4],
            params[5],
            params[6],
            params[7],
            params[8],
            params[10],
            params[11],
            params[12],
            params[13],
          ]
        );
      } else {
        throw e;
      }
    }
    const row = await loadEmployee(pool, id);
    return res.json({ success: true, data: row });
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function deleteEmployee(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }
    const existing = await loadEmployee(pool, id);
    if (!existing) return res.status(404).json({ success: false, error: 'Não encontrado' });
    const [[cnt]] = await pool.query(
      'SELECT COUNT(*) AS c FROM construction_payroll_timesheets WHERE employee_id = ?',
      [id]
    );
    if (Number(cnt.c) > 0) {
      return res.status(409).json({
        success: false,
        error:
          'Não é possível excluir: há linhas na planilha de horas associadas a este funcionário. Exclua ou altere essas linhas nos períodos ou desative o funcionário (desmarque Ativo) em vez de excluir o cadastro.',
      });
    }
    await pool.execute('DELETE FROM construction_payroll_employees WHERE id = ?', [id]);
    return res.json({ success: true });
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === '1451') {
      return res.status(409).json({
        success: false,
        error: 'Não é possível excluir: ainda há referências no banco de dados.',
      });
    }
    return sendDbError(res, err);
  }
}

export async function listPeriods(req, res) {
  try {
    const pool = await getDBConnection();
    let rows;
    try {
      const [r] = await pool.query(
        `SELECT p.*,
          (SELECT COUNT(*) FROM construction_payroll_timesheets t WHERE t.period_id = p.id) AS line_count,
          (SELECT COALESCE(SUM(calculated_amount),0) FROM construction_payroll_timesheets t WHERE t.period_id = p.id) AS total_amount,
          (SELECT COALESCE(SUM(a.reimbursement),0) FROM construction_payroll_period_adjustments a WHERE a.period_id = p.id) AS reimbursement_total,
          (SELECT COALESCE(SUM(a.discount),0) FROM construction_payroll_period_adjustments a WHERE a.period_id = p.id) AS discount_total
         FROM construction_payroll_periods p
         ORDER BY p.start_date DESC, p.id DESC`
      );
      rows = r;
    } catch (e) {
      if (isMissingColumn(e, 'discount')) {
        const [r] = await pool.query(
          `SELECT p.*,
            (SELECT COUNT(*) FROM construction_payroll_timesheets t WHERE t.period_id = p.id) AS line_count,
            (SELECT COALESCE(SUM(calculated_amount),0) FROM construction_payroll_timesheets t WHERE t.period_id = p.id) AS total_amount,
            (SELECT COALESCE(SUM(a.reimbursement),0) FROM construction_payroll_period_adjustments a WHERE a.period_id = p.id) AS reimbursement_total
           FROM construction_payroll_periods p
           ORDER BY p.start_date DESC, p.id DESC`
        );
        rows = (r || []).map((x) => ({ ...x, discount_total: 0 }));
      } else if (isMissingTable(e) && String(e.message || '').includes('construction_payroll_period_adjustments')) {
        const [r] = await pool.query(
          `SELECT p.*,
            (SELECT COUNT(*) FROM construction_payroll_timesheets t WHERE t.period_id = p.id) AS line_count,
            (SELECT COALESCE(SUM(calculated_amount),0) FROM construction_payroll_timesheets t WHERE t.period_id = p.id) AS total_amount
           FROM construction_payroll_periods p
           ORDER BY p.start_date DESC, p.id DESC`
        );
        rows = (r || []).map((x) => ({ ...x, reimbursement_total: 0, discount_total: 0 }));
      } else {
        throw e;
      }
    }
    return res.json({ success: true, data: (rows || []).map(serializePeriodForClient) });
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function getPeriod(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    const p = await loadPeriod(pool, id);
    if (!p) return res.status(404).json({ success: false, error: 'Não encontrado' });
    const [[agg]] = await pool.query(
      `SELECT COUNT(*) AS line_count, COALESCE(SUM(calculated_amount),0) AS total_amount
       FROM construction_payroll_timesheets WHERE period_id = ?`,
      [id]
    );
    let reimbursement_total = 0;
    let discount_total = 0;
    try {
      const [[r]] = await pool.query(
        'SELECT COALESCE(SUM(reimbursement),0) AS s FROM construction_payroll_period_adjustments WHERE period_id = ?',
        [id]
      );
      reimbursement_total = Number(r.s) || 0;
    } catch (_) {
      /* tabela opcional até migrate */
    }
    try {
      const [[r2]] = await pool.query(
        'SELECT COALESCE(SUM(discount),0) AS s FROM construction_payroll_period_adjustments WHERE period_id = ?',
        [id]
      );
      discount_total = Number(r2.s) || 0;
    } catch (_) {
      discount_total = 0;
    }
    return res.json({
      success: true,
      data: { ...serializePeriodForClient(p), ...agg, reimbursement_total, discount_total },
    });
  } catch (err) {
    return sendDbError(res, err);
  }
}

/** AAAA-MM-DD → segunda-feira da semana (calendário local do servidor). */
function mondayYmdFromCalendarYmd(ymd) {
  const s = String(ymd || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, mo, d] = s.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  const day = dt.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  dt.setDate(dt.getDate() + diff);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function sundayYmdAfterMonday(monYmd) {
  const s = String(monYmd || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, mo, d] = s.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(y, mo - 1, d + 6);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function ymdToBrShort(ymd) {
  const s = String(ymd || '').slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export async function createPeriod(req, res) {
  try {
    const pool = await getDBConnection();
    const b = req.body || {};
    let start_date = b.start_date;
    let end_date = b.end_date;
    let frequency = ['weekly', 'biweekly', 'monthly'].includes(b.frequency) ? b.frequency : 'biweekly';
    let name = String(b.name || '').trim();

    const weekMonday = String(b.week_monday || '').trim().slice(0, 10);
    if (weekMonday) {
      const mon = mondayYmdFromCalendarYmd(weekMonday);
      if (!mon) {
        return res.status(400).json({ success: false, error: 'week_monday inválido' });
      }
      if (mon !== weekMonday) {
        return res.status(400).json({
          success: false,
          error: 'week_monday deve ser uma segunda-feira (início da semana Seg–Dom)',
        });
      }
      const sun = sundayYmdAfterMonday(mon);
      if (!sun) {
        return res.status(400).json({ success: false, error: 'Não foi possível calcular o domingo da semana' });
      }
      start_date = mon;
      end_date = sun;
      frequency = 'weekly';
      if (!name) {
        name = `Semana ${ymdToBrShort(mon)} – ${ymdToBrShort(sun)}`;
      }
    }

    if (!start_date || !end_date) {
      return res.status(400).json({
        success: false,
        error: 'Informe week_monday (semana Seg–Dom) ou start_date e end_date',
      });
    }
    if (!name) name = 'Período';

    const [[dup]] = await pool.query(
      'SELECT id FROM construction_payroll_periods WHERE start_date = ? AND end_date = ? LIMIT 1',
      [start_date, end_date]
    );
    if (dup?.id) {
      const existing = await loadPeriod(pool, dup.id);
      return res.status(409).json({
        success: false,
        code: 'PERIOD_RANGE_EXISTS',
        error: 'Já existe um período com este intervalo de datas',
        data: serializePeriodForClient(existing),
      });
    }

    const [r] = await pool.execute(
      `INSERT INTO construction_payroll_periods (name, frequency, start_date, end_date, status)
       VALUES (?, ?, ?, ?, 'open')`,
      [name, frequency, start_date, end_date]
    );
    const p = await loadPeriod(pool, r.insertId);
    return res.status(201).json({ success: true, data: serializePeriodForClient(p) });
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function updatePeriod(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    const p = await assertPeriodWritable(pool, id);
    const b = req.body || {};
    const sd = b.start_date != null ? b.start_date : p.start_date;
    const ed = b.end_date != null ? b.end_date : p.end_date;
    if (String(sd) > String(ed)) {
      return res.status(400).json({ success: false, error: 'Datas do período inválidas' });
    }
    await pool.execute(
      `UPDATE construction_payroll_periods SET
        name = COALESCE(?, name),
        frequency = COALESCE(?, frequency),
        start_date = COALESCE(?, start_date),
        end_date = COALESCE(?, end_date)
       WHERE id = ?`,
      [
        b.name != null ? String(b.name).trim() : null,
        b.frequency != null && ['weekly', 'biweekly', 'monthly'].includes(b.frequency) ? b.frequency : null,
        b.start_date != null ? b.start_date : null,
        b.end_date != null ? b.end_date : null,
        id,
      ]
    );
    return res.json({ success: true, data: serializePeriodForClient(await loadPeriod(pool, id)) });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, error: err.message });
    return sendDbError(res, err);
  }
}

export async function deletePeriod(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }
    const p = await loadPeriod(pool, id);
    if (!p) return res.status(404).json({ success: false, error: 'Período não encontrado' });
    await pool.execute('DELETE FROM construction_payroll_periods WHERE id = ?', [id]);
    return res.json({ success: true });
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function closePeriod(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    const p = await loadPeriod(pool, id);
    if (!p) return res.status(404).json({ success: false, error: 'Não encontrado' });
    if (p.status === 'closed') {
      return res.status(409).json({ success: false, error: 'Período já fechado' });
    }
    const uid = req.session.userId || null;
    await pool.execute(
      `UPDATE construction_payroll_periods SET status = 'closed', closed_at = NOW(), closed_by = ? WHERE id = ?`,
      [uid, id]
    );
    return res.json({ success: true, data: serializePeriodForClient(await loadPeriod(pool, id)) });
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function reopenPeriod(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    const p = await loadPeriod(pool, id);
    if (!p) return res.status(404).json({ success: false, error: 'Não encontrado' });
    if (p.status !== 'closed') {
      return res.status(409).json({ success: false, error: 'Só é possível reabrir um período fechado' });
    }
    await pool.execute(
      `UPDATE construction_payroll_periods SET status = 'open', closed_at = NULL, closed_by = NULL WHERE id = ?`,
      [id]
    );
    return res.json({ success: true, data: serializePeriodForClient(await loadPeriod(pool, id)) });
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function getPeriodPreview(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    const data = await computePeriodPreviewData(pool, id);
    return res.json({ success: true, data });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ success: false, error: err.message || 'Não encontrado' });
    }
    return sendDbError(res, err);
  }
}

/** PDF de um recibo (marca Senior Floors, alinhado ao quote PDF). */
export async function getEmployeePaySlipPdf(req, res) {
  try {
    const pool = await getDBConnection();
    const periodId = parseInt(req.params.id, 10);
    const employeeId = parseInt(req.params.employeeId, 10);
    if (!periodId || !employeeId) {
      return res.status(400).json({ success: false, error: 'IDs inválidos' });
    }
    const data = await computePeriodPreviewData(pool, periodId);
    const row = data.by_employee.find((e) => e.employee_id === employeeId);
    if (!row) {
      return res.status(404).json({ success: false, error: 'Funcionário sem dados neste período' });
    }
    const p = await loadPeriod(pool, periodId);
    const buf = await buildPayrollSlipPdfBuffer({ period: p, employeeRow: row });
    const fn = `Senior-Floors-Pay-Slip-${safePaySlipFilenamePart(row.name)}-${periodId}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fn}"`);
    res.send(buf);
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ success: false, error: err.message || 'Não encontrado' });
    }
    return sendDbError(res, err);
  }
}

/** PDF multi-página: um relatório individual por funcionário (layout = recibo). */
export async function getIndividualReportsPdf(req, res) {
  try {
    const pool = await getDBConnection();
    const periodId = parseInt(req.params.id, 10);
    if (!periodId) {
      return res.status(400).json({ success: false, error: 'Período inválido' });
    }
    const data = await computePeriodPreviewData(pool, periodId);
    if (!data.by_employee.length) {
      return res.status(404).json({ success: false, error: 'Não há dados neste período' });
    }
    const p = await loadPeriod(pool, periodId);
    const buf = await buildIndividualPayrollReportsPdfBuffer({ period: p, employeeRows: data.by_employee });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="Senior-Floors-relatorios-individuais-${periodId}.pdf"`
    );
    res.send(buf);
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ success: false, error: err.message || 'Não encontrado' });
    }
    return sendDbError(res, err);
  }
}

/**
 * Igual ao GET, mas aceita body.adjustments para refletir valores do modal de pré-visualização (não guardados).
 */
export async function postIndividualReportsPdf(req, res) {
  try {
    const pool = await getDBConnection();
    const periodId = parseInt(req.params.id, 10);
    if (!periodId) {
      return res.status(400).json({ success: false, error: 'Período inválido' });
    }
    const adj = Array.isArray(req.body?.adjustments) ? req.body.adjustments : [];
    const data = await computePeriodPreviewData(
      pool,
      periodId,
      adj.length ? { adjustmentOverrides: adj } : {}
    );
    if (!data.by_employee.length) {
      return res.status(404).json({ success: false, error: 'Não há dados neste período' });
    }
    const p = await loadPeriod(pool, periodId);
    const buf = await buildIndividualPayrollReportsPdfBuffer({ period: p, employeeRows: data.by_employee });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="Senior-Floors-relatorios-individuais-${periodId}.pdf"`
    );
    res.send(buf);
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ success: false, error: err.message || 'Não encontrado' });
    }
    return sendDbError(res, err);
  }
}

/**
 * Envia um PDF por funcionário (e-mail no cadastro). Requer transporte configurado (Resend ou SMTP).
 * Body opcional: { employee_ids: number[] } — omite para todos com dados no período.
 */
export async function postDistributePaySlips(req, res) {
  try {
    const pool = await getDBConnection();
    const periodId = parseInt(req.params.id, 10);
    if (!periodId) return res.status(400).json({ success: false, error: 'Período inválido' });
    const data = await computePeriodPreviewData(pool, periodId);
    const filterIds = Array.isArray(req.body?.employee_ids)
      ? req.body.employee_ids.map((x) => parseInt(String(x), 10)).filter((n) => n > 0)
      : null;
    const rows = filterIds?.length
      ? data.by_employee.filter((e) => filterIds.includes(e.employee_id))
      : data.by_employee;
    const p = await loadPeriod(pool, periodId);
    const periodLabel = `${p.name} (${String(p.start_date).slice(0, 10)} a ${String(p.end_date).slice(0, 10)})`;
    const results = [];
    for (const row of rows) {
      const emp = await loadEmployee(pool, row.employee_id);
      const email = emp?.email != null ? String(emp.email).trim() : '';
      if (!email) {
        results.push({
          employee_id: row.employee_id,
          name: row.name,
          ok: false,
          error: 'Sem e-mail no cadastro do funcionário',
        });
        continue;
      }
      const buf = await buildPayrollSlipPdfBuffer({ period: p, employeeRow: row });
      const subj = `Senior Floors — recibo de pagamento (${String(p.name || 'período').slice(0, 42)})`;
      const first = String(row.name || '').trim().split(/\s+/)[0] || '';
      const html = `<p>Olá${first ? ` ${escapeHtmlPaySlip(first)}` : ''},</p><p>Em anexo está o seu recibo de pagamento referente a <strong>${escapeHtmlPaySlip(periodLabel)}</strong>.</p><p>Atenciosamente,<br>Senior Floors</p>`;
      const r = await sendQuoteEmail({
        to: email,
        subject: subj,
        html,
        pdfBuffer: buf,
        filename: 'Senior-Floors-Pay-Slip.pdf',
      });
      results.push({
        employee_id: row.employee_id,
        name: row.name,
        ok: r.ok,
        error: r.error || null,
        transport: r.transport || null,
      });
    }
    const sent = results.filter((x) => x.ok).length;
    return res.json({ success: true, data: { sent, total: results.length, results } });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ success: false, error: err.message || 'Não encontrado' });
    }
    return sendDbError(res, err);
  }
}

function escapeHtmlPaySlip(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

export async function putPeriodAdjustments(req, res) {
  try {
    const pool = await getDBConnection();
    const periodId = parseInt(req.params.id, 10);
    await assertPeriodWritable(pool, periodId);
    const list = req.body?.adjustments;
    if (!Array.isArray(list)) {
      return res.status(400).json({ success: false, error: 'Body.adjustments deve ser um array' });
    }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await ensurePayrollPeriodAdjustmentsDiscountColumn(conn);
      await conn.execute('DELETE FROM construction_payroll_period_adjustments WHERE period_id = ?', [periodId]);
      for (const r of list) {
        if (!r || typeof r !== 'object') continue;
        const eid = parseInt(r.employee_id, 10);
        if (!eid) continue;
        const emp = await loadEmployee(conn, eid);
        if (!emp) continue;
        const amt = Math.round((Number(r.reimbursement) || 0) * 100) / 100;
        const disc = Math.round((Number(r.discount) || 0) * 100) / 100;
        const notes = r.notes != null ? String(r.notes).slice(0, 500) : null;
        if (amt === 0 && disc === 0 && (!notes || notes === '')) continue;
        await conn.execute(
          `INSERT INTO construction_payroll_period_adjustments (period_id, employee_id, reimbursement, discount, notes)
           VALUES (?,?,?,?,?)`,
          [periodId, eid, amt, disc, notes]
        );
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    return res.json({ success: true });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, error: err.message });
    return sendDbError(res, err);
  }
}

export async function listTimesheets(req, res) {
  try {
    const pool = await getDBConnection();
    const periodId = parseInt(req.params.periodId, 10);
    const p = await loadPeriod(pool, periodId);
    if (!p) return res.status(404).json({ success: false, error: 'Período não encontrado' });
    let q = `SELECT t.*, e.name AS employee_name, e.payment_type AS employee_payment_type, e.sector AS employee_sector,
              pr.project_number, pr.status AS project_status
       FROM construction_payroll_timesheets t
       INNER JOIN construction_payroll_employees e ON e.id = t.employee_id
       LEFT JOIN projects pr ON pr.id = t.project_id
       WHERE t.period_id = ?`;
    const params = [periodId];
    if (req.query.employee_id) {
      q += ' AND t.employee_id = ?';
      params.push(parseInt(req.query.employee_id, 10));
    }
    if (req.query.project_id) {
      q += ' AND t.project_id = ?';
      params.push(parseInt(req.query.project_id, 10));
    }
    q += ' ORDER BY t.work_date ASC, t.id ASC';
    const qProjFallback = q.replace(
      'pr.project_number, pr.status AS project_status',
      "COALESCE(pr.name, CONCAT('#', pr.id)) AS project_number, pr.status AS project_status"
    );
    const stripSector = (sql) =>
      sql.replace(
        'e.payment_type AS employee_payment_type, e.sector AS employee_sector,',
        'e.payment_type AS employee_payment_type,'
      );

    let rows;
    try {
      const [r] = await pool.query(q, params);
      rows = r;
    } catch (e) {
      if (isMissingColumn(e, 'project_number')) {
        try {
          const [r] = await pool.query(qProjFallback, params);
          rows = r;
        } catch (e2) {
          if (e2.code === 'ER_BAD_FIELD_ERROR' && String(e2.message || '').includes('sector')) {
            const [r] = await pool.query(stripSector(qProjFallback), params);
            rows = (r || []).map((x) => ({ ...x, employee_sector: null }));
          } else {
            throw e2;
          }
        }
      } else if (e.code === 'ER_BAD_FIELD_ERROR' && String(e.message || '').includes('sector')) {
        try {
          const [r] = await pool.query(stripSector(q), params);
          rows = (r || []).map((x) => ({ ...x, employee_sector: null }));
        } catch (e3) {
          if (isMissingColumn(e3, 'project_number')) {
            const [r] = await pool.query(stripSector(qProjFallback), params);
            rows = (r || []).map((x) => ({ ...x, employee_sector: null }));
          } else {
            throw e3;
          }
        }
      } else {
        throw e;
      }
    }
    return res.json({
      success: true,
      data: (rows || []).map(serializeTimesheetRowForClient),
      period: serializePeriodForClient(p),
    });
  } catch (err) {
    return sendDbError(res, err);
  }
}

async function upsertOneLine(executor, period, line, userId, options = {}) {
  const { allowClosedLineUpdates = false } = options;
  const employeeId = parseInt(String(line.employee_id), 10);
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    const e = new Error('ID de funcionário inválido');
    e.statusCode = 400;
    throw e;
  }
  const emp = await loadEmployee(executor, employeeId);
  if (!emp) {
    const e = new Error('Funcionário inválido');
    e.statusCode = 400;
    throw e;
  }
  const isUpdate = hasPositiveTimesheetLineId(line);
  if (!isUpdate && !emp.is_active) {
    const e = new Error('Funcionário inativo — não é possível criar linhas novas para este funcionário');
    e.statusCode = 400;
    throw e;
  }
  const workDate = normalizeWorkDateYMD(line.work_date);
  if (!workDate) {
    const e = new Error('Data de trabalho em falta ou inválida');
    e.statusCode = 400;
    throw e;
  }
  if (!employeeAllowsWorkDateOutsidePeriod(emp)) {
    await assertWorkDateInPeriodDb(executor, period.id, workDate);
  }
  let projectId = line.project_id != null && line.project_id !== '' ? parseInt(line.project_id, 10) : null;
  if (projectId) {
    const [pr] = await executor.query('SELECT id FROM projects WHERE id = ?', [projectId]);
    if (!pr.length) {
      const e = new Error('Projeto não encontrado');
      e.statusCode = 400;
      throw e;
    }
  }
  const days_worked = Number(line.days_worked) || 0;
  const regular_hours = Number(line.regular_hours) || 0;
  const overtime_hours = Number(line.overtime_hours) || 0;
  const notes = line.notes != null ? String(line.notes) : null;

  const payType = String(emp.payment_type || 'daily').toLowerCase();
  if (payType === 'daily' || payType === 'mixed') {
    if (Math.round(days_worked * 100) > 200) {
      const e = new Error('No máximo 2 diárias por linha (tipos por dia / misto).');
      e.statusCode = 400;
      throw e;
    }
    const excludeId = isUpdate ? parseInt(String(line.id), 10) : 0;
    const ex = Number.isFinite(excludeId) && excludeId > 0 ? excludeId : 0;
    const [sumRows] = await executor.query(
      `SELECT COALESCE(SUM(days_worked), 0) AS s FROM construction_payroll_timesheets
       WHERE period_id = ? AND employee_id = ? AND work_date = ? AND id <> ?`,
      [period.id, employeeId, workDate, ex]
    );
    const sumOther = Number(sumRows[0]?.s) || 0;
    const totalCent = Math.round(sumOther * 100) + Math.round(days_worked * 100);
    if (totalCent > 200) {
      const e = new Error(
        'No mesmo dia, a soma de diárias deste funcionário não pode passar de 2 (double = duas linhas de 1 ou uma linha com 2).'
      );
      e.statusCode = 400;
      throw e;
    }
  }

  let daily_rate_override_db = null;
  const rawOvr = line.daily_rate_override;
  if (rawOvr === undefined && isUpdate) {
    const tidPre = parseInt(String(line.id), 10);
    const [ex] = await executor.query(
      'SELECT daily_rate_override FROM construction_payroll_timesheets WHERE id = ? AND period_id = ? LIMIT 1',
      [tidPre, period.id]
    );
    const prev = ex[0]?.daily_rate_override;
    if (prev != null && prev !== '') {
      const n = Number(prev);
      if (Number.isFinite(n) && n >= 0) daily_rate_override_db = Math.round(n * 100) / 100;
    }
  } else if (rawOvr === null || (typeof rawOvr === 'string' && rawOvr.trim() === '')) {
    daily_rate_override_db = null;
  } else if (rawOvr !== undefined) {
    const s = String(rawOvr).trim();
    if (s !== '') {
      const n = Number(s.replace(',', '.'));
      if (Number.isFinite(n) && n >= 0) {
        daily_rate_override_db = Math.round(n * 100) / 100;
      }
    }
  }

  const calcLine = { days_worked, regular_hours, overtime_hours };
  if (daily_rate_override_db != null) {
    calcLine.daily_rate_override = daily_rate_override_db;
  }
  const calculated_amount = calcTimesheetLineAmount(emp, calcLine);

  const payload = [
    period.id,
    employeeId,
    projectId,
    workDate,
    days_worked,
    daily_rate_override_db,
    regular_hours,
    overtime_hours,
    notes,
    calculated_amount,
    userId,
  ];

  if (isUpdate) {
    const tid = parseInt(String(line.id), 10);
    const [existing] = await executor.query(
      'SELECT t.id, p.status FROM construction_payroll_timesheets t JOIN construction_payroll_periods p ON p.id = t.period_id WHERE t.id = ?',
      [tid]
    );
    if (!existing.length) {
      const e = new Error('Linha não encontrada');
      e.statusCode = 404;
      throw e;
    }
    if (existing[0].status === 'closed' && !allowClosedLineUpdates) {
      const e = new Error('Período fechado');
      e.statusCode = 409;
      throw e;
    }
    await executor.execute(
      `UPDATE construction_payroll_timesheets SET
        employee_id = ?, project_id = ?, work_date = ?, days_worked = ?, daily_rate_override = ?, regular_hours = ?, overtime_hours = ?,
        notes = ?, calculated_amount = ?
       WHERE id = ? AND period_id = ?`,
      [
        employeeId,
        projectId,
        workDate,
        days_worked,
        daily_rate_override_db,
        regular_hours,
        overtime_hours,
        notes,
        calculated_amount,
        tid,
        period.id,
      ]
    );
    const [rows] = await executor.query(
      `SELECT t.*, e.name AS employee_name FROM construction_payroll_timesheets t
       INNER JOIN construction_payroll_employees e ON e.id = t.employee_id WHERE t.id = ?`,
      [tid]
    );
    return serializeTimesheetRowForClient(rows[0]);
  }

  if (period.status === 'closed') {
    const e = new Error('Período fechado — não é possível adicionar linhas novas, só alterar as já existentes.');
    e.statusCode = 409;
    throw e;
  }

  const [ins] = await executor.execute(
    `INSERT INTO construction_payroll_timesheets
     (period_id, employee_id, project_id, work_date, days_worked, daily_rate_override, regular_hours, overtime_hours, notes, calculated_amount, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    payload
  );
  const [rows] = await executor.query(
    `SELECT t.*, e.name AS employee_name FROM construction_payroll_timesheets t
     INNER JOIN construction_payroll_employees e ON e.id = t.employee_id WHERE t.id = ?`,
    [ins.insertId]
  );
  return serializeTimesheetRowForClient(rows[0]);
}

export async function bulkTimesheets(req, res) {
  try {
    const pool = await getDBConnection();
    const periodId = parseInt(req.params.periodId, 10);
    const period = await assertPeriodAllowsTimesheetMutation(pool, periodId, req);
    const allowClosedUpdates = period.status === 'closed';
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    const uid = req.session.userId || null;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const out = [];
      for (const line of lines) {
        if (!line || typeof line !== 'object') continue;
        const hasEmp = line.employee_id != null && String(line.employee_id).trim() !== '';
        const hasDate = line.work_date != null && String(line.work_date).trim() !== '';
        if (!hasPositiveTimesheetLineId(line) && (!hasEmp || !hasDate)) continue;
        try {
          const row = await upsertOneLine(conn, period, line, uid, {
            allowClosedLineUpdates: allowClosedUpdates,
          });
          out.push(row);
        } catch (e) {
          if (e.code === 'ER_DUP_ENTRY') {
            e.statusCode = 409;
            e.message =
              'Conflito ao gravar linha. Se precisar de duas linhas no mesmo dia (double), execute: npm run migrate:payroll-timesheet-allow-double-lines';
          }
          throw e;
        }
      }
      if (lines.length > 0 && out.length === 0) {
        await conn.rollback();
        return res.status(400).json({
          success: false,
          code: 'BULK_NO_ROWS_SAVED',
          error:
            'Nenhuma linha foi salva. Confira funcionário e data em cada linha nova, valores (dias/horas ou nota) e se a data está dentro do período.',
        });
      }
      await conn.commit();
      return res.json({ success: true, data: out });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, error: err.message });
    return sendDbError(res, err);
  }
}

export async function updateTimesheet(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    const [existing] = await pool.query(
      `SELECT t.*, p.status, p.start_date, p.end_date FROM construction_payroll_timesheets t
       JOIN construction_payroll_periods p ON p.id = t.period_id WHERE t.id = ?`,
      [id]
    );
    if (!existing.length) return res.status(404).json({ success: false, error: 'Não encontrado' });
    const row0 = existing[0];
    await assertPeriodAllowsTimesheetMutation(pool, row0.period_id, req);
    const period = {
      id: row0.period_id,
      start_date: row0.start_date,
      end_date: row0.end_date,
    };
    const b = req.body || {};
    const merged = {
      id,
      employee_id: b.employee_id != null ? b.employee_id : row0.employee_id,
      project_id: b.project_id !== undefined ? b.project_id : row0.project_id,
      work_date: b.work_date != null ? b.work_date : row0.work_date,
      days_worked: b.days_worked != null ? b.days_worked : row0.days_worked,
      daily_rate_override:
        b.daily_rate_override !== undefined ? b.daily_rate_override : row0.daily_rate_override,
      regular_hours: b.regular_hours != null ? b.regular_hours : row0.regular_hours,
      overtime_hours: b.overtime_hours != null ? b.overtime_hours : row0.overtime_hours,
      notes: b.notes !== undefined ? b.notes : row0.notes,
    };
    const uid = req.session.userId || null;
    const updated = await upsertOneLine(pool, period, merged, uid, {
      allowClosedLineUpdates: row0.status === 'closed',
    });
    return res.json({ success: true, data: updated });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, error: err.message });
    return sendDbError(res, err);
  }
}

export async function deleteTimesheet(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    const [existing] = await pool.query(
      `SELECT t.id, t.period_id, p.status FROM construction_payroll_timesheets t
       JOIN construction_payroll_periods p ON p.id = t.period_id WHERE t.id = ?`,
      [id]
    );
    if (!existing.length) return res.status(404).json({ success: false, error: 'Não encontrado' });
    await assertPeriodAllowsTimesheetMutation(pool, existing[0].period_id, req);
    await pool.execute('DELETE FROM construction_payroll_timesheets WHERE id = ?', [id]);
    return res.json({ success: true });
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function reportEmployeeEarnings(req, res) {
  try {
    const pool = await getDBConnection();
    const norm = normalizeReportRange(req.query.from, req.query.to);
    if (!norm) {
      return res.status(400).json({
        success: false,
        error: 'Parâmetros from e to são obrigatórios (formato AAAA-MM-DD)',
      });
    }
    const [from, to] = norm;
    const adjReim = `COALESCE((
            SELECT SUM(a.reimbursement) FROM construction_payroll_period_adjustments a
            INNER JOIN construction_payroll_periods p ON p.id = a.period_id
            WHERE a.employee_id = e.id AND p.end_date >= ? AND p.end_date <= ?
          ), 0)`;
    const adjDisc = `COALESCE((
            SELECT SUM(a.discount) FROM construction_payroll_period_adjustments a
            INNER JOIN construction_payroll_periods p ON p.id = a.period_id
            WHERE a.employee_id = e.id AND p.end_date >= ? AND p.end_date <= ?
          ), 0)`;
    const sqlEmpDiscount = (sectorExpr) => `SELECT e.id AS employee_id,
          MAX(e.name) AS name,
          MAX(e.role) AS role,
          ${sectorExpr}
          COUNT(t.id) AS entries,
          COALESCE(SUM(t.days_worked),0) AS total_days,
          COALESCE(SUM(t.regular_hours),0) AS total_regular_hours,
          COALESCE(SUM(t.overtime_hours),0) AS total_overtime_hours,
          COALESCE(SUM(t.calculated_amount),0) AS timesheet_earnings,
          ${adjReim} AS reimbursement_total,
          ${adjDisc} AS discount_total,
          COALESCE(SUM(t.calculated_amount),0) + ${adjReim} - ${adjDisc} AS total_earnings
         FROM construction_payroll_timesheets t
         INNER JOIN construction_payroll_employees e ON e.id = t.employee_id
         WHERE t.work_date >= ? AND t.work_date <= ?
         GROUP BY e.id
         ORDER BY total_earnings DESC`;
    const sqlEmpReimOnly = (sectorExpr) => `SELECT e.id AS employee_id,
          MAX(e.name) AS name,
          MAX(e.role) AS role,
          ${sectorExpr}
          COUNT(t.id) AS entries,
          COALESCE(SUM(t.days_worked),0) AS total_days,
          COALESCE(SUM(t.regular_hours),0) AS total_regular_hours,
          COALESCE(SUM(t.overtime_hours),0) AS total_overtime_hours,
          COALESCE(SUM(t.calculated_amount),0) AS timesheet_earnings,
          ${adjReim} AS reimbursement_total,
          COALESCE(SUM(t.calculated_amount),0) + ${adjReim} AS total_earnings
         FROM construction_payroll_timesheets t
         INNER JOIN construction_payroll_employees e ON e.id = t.employee_id
         WHERE t.work_date >= ? AND t.work_date <= ?
         GROUP BY e.id
         ORDER BY total_earnings DESC`;
    const paramsDisc = [from, to, from, to, from, to, from, to, from, to];
    const paramsReim = [from, to, from, to, from, to];

    let rows;
    try {
      const [r] = await pool.query(sqlEmpDiscount('MAX(e.sector) AS sector,'), paramsDisc);
      rows = r;
    } catch (e) {
      if (isMissingColumn(e, 'discount')) {
        try {
          const [r] = await pool.query(sqlEmpReimOnly('MAX(e.sector) AS sector,'), paramsReim);
          rows = (r || []).map((x) => ({ ...x, discount_total: 0 }));
        } catch (e2) {
          if (e2.code === 'ER_BAD_FIELD_ERROR' && String(e2.message || '').includes('sector')) {
            const [r] = await pool.query(sqlEmpReimOnly('NULL AS sector,'), paramsReim);
            rows = (r || []).map((x) => ({ ...x, discount_total: 0, sector: null }));
          } else {
            throw e2;
          }
        }
      } else if (e.code === 'ER_BAD_FIELD_ERROR' && String(e.message || '').includes('sector')) {
        try {
          const [r] = await pool.query(sqlEmpDiscount('NULL AS sector,'), paramsDisc);
          rows = (r || []).map((x) => ({ ...x, sector: null }));
        } catch (e3) {
          if (isMissingColumn(e3, 'discount')) {
            const [r] = await pool.query(sqlEmpReimOnly('NULL AS sector,'), paramsReim);
            rows = (r || []).map((x) => ({ ...x, discount_total: 0, sector: null }));
          } else {
            throw e3;
          }
        }
      } else if (
        isMissingTable(e) ||
        String(e.message || '').includes('construction_payroll_period_adjustments')
      ) {
        const [r] = await pool.query(
          `SELECT e.id AS employee_id,
            MAX(e.name) AS name,
            MAX(e.role) AS role,
            COUNT(t.id) AS entries,
            COALESCE(SUM(t.days_worked),0) AS total_days,
            COALESCE(SUM(t.regular_hours),0) AS total_regular_hours,
            COALESCE(SUM(t.overtime_hours),0) AS total_overtime_hours,
            COALESCE(SUM(t.calculated_amount),0) AS timesheet_earnings,
            0 AS reimbursement_total,
            0 AS discount_total,
            COALESCE(SUM(t.calculated_amount),0) AS total_earnings
           FROM construction_payroll_timesheets t
           INNER JOIN construction_payroll_employees e ON e.id = t.employee_id
           WHERE t.work_date >= ? AND t.work_date <= ?
           GROUP BY e.id
           ORDER BY total_earnings DESC`,
          [from, to]
        );
        rows = (r || []).map((x) => ({ ...x, sector: null }));
      } else {
        throw e;
      }
    }
    return res.json({ success: true, data: rows, range: { from, to } });
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function reportProjectLabor(req, res) {
  try {
    const pool = await getDBConnection();
    const norm = normalizeReportRange(req.query.from, req.query.to);
    if (!norm) {
      return res.status(400).json({
        success: false,
        error: 'Parâmetros from e to são obrigatórios (formato AAAA-MM-DD)',
      });
    }
    const [from, to] = norm;
    let rows;
    try {
      const [r] = await pool.query(
        `SELECT t.project_id,
          MAX(pr.project_number) AS project_number,
          COUNT(t.id) AS entries,
          COALESCE(SUM(t.calculated_amount),0) AS labor_cost
         FROM construction_payroll_timesheets t
         LEFT JOIN projects pr ON pr.id = t.project_id
         WHERE t.work_date >= ? AND t.work_date <= ?
         GROUP BY t.project_id
         ORDER BY labor_cost DESC`,
        [from, to]
      );
      rows = r;
    } catch (e) {
      if (isMissingColumn(e, 'project_number')) {
        const [r] = await pool.query(
          `SELECT t.project_id,
            MAX(COALESCE(pr.name, CONCAT('#', pr.id))) AS project_number,
            COUNT(t.id) AS entries,
            COALESCE(SUM(t.calculated_amount),0) AS labor_cost
           FROM construction_payroll_timesheets t
           LEFT JOIN projects pr ON pr.id = t.project_id
           WHERE t.work_date >= ? AND t.work_date <= ?
           GROUP BY t.project_id
           ORDER BY labor_cost DESC`,
          [from, to]
        );
        rows = r;
      } else if (isMissingTable(e) && String(e.message || '').toLowerCase().includes('projects')) {
        const [r] = await pool.query(
          `SELECT t.project_id,
            COUNT(t.id) AS entries,
            COALESCE(SUM(t.calculated_amount),0) AS labor_cost
           FROM construction_payroll_timesheets t
           WHERE t.work_date >= ? AND t.work_date <= ?
           GROUP BY t.project_id
           ORDER BY labor_cost DESC`,
          [from, to]
        );
        rows = (r || []).map((row) => ({ ...row, project_number: null }));
      } else {
        throw e;
      }
    }
    return res.json({ success: true, data: rows, range: { from, to } });
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function reportTotalExpenses(req, res) {
  try {
    const pool = await getDBConnection();
    if (req.query.period_id) {
      const pid = parseInt(req.query.period_id, 10);
      const p = await loadPeriod(pool, pid);
      if (!p) return res.status(404).json({ success: false, error: 'Período não encontrado' });
      const [[agg]] = await pool.query(
        'SELECT COALESCE(SUM(calculated_amount),0) AS total, COUNT(*) AS ts_line_count FROM construction_payroll_timesheets WHERE period_id = ?',
        [pid]
      );
      let reim = 0;
      let disc = 0;
      try {
        const [[r]] = await pool.query(
          'SELECT COALESCE(SUM(reimbursement),0) AS s FROM construction_payroll_period_adjustments WHERE period_id = ?',
          [pid]
        );
        reim = Number(r.s) || 0;
      } catch (_) {}
      try {
        const [[r2]] = await pool.query(
          'SELECT COALESCE(SUM(discount),0) AS s FROM construction_payroll_period_adjustments WHERE period_id = ?',
          [pid]
        );
        disc = Number(r2.s) || 0;
      } catch (_) {}
      const labor = Number(agg.total) || 0;
      return res.json({
        success: true,
        data: {
          scope: 'period',
          period: p,
          timesheet_total: labor,
          reimbursement_total: reim,
          discount_total: disc,
          total: Math.round((labor + reim - disc) * 100) / 100,
          line_count: Number(agg.ts_line_count) || 0,
        },
      });
    }
    const norm = normalizeReportRange(req.query.from, req.query.to);
    if (!norm) {
      return res.status(400).json({
        success: false,
        error: 'Informe period_id ou from e to (AAAA-MM-DD)',
      });
    }
    const [from, to] = norm;
    const [[agg]] = await pool.query(
      'SELECT COALESCE(SUM(calculated_amount),0) AS total, COUNT(*) AS ts_line_count FROM construction_payroll_timesheets WHERE work_date >= ? AND work_date <= ?',
      [from, to]
    );
    let reimRange = 0;
    let discRange = 0;
    try {
      const [[r]] = await pool.query(
        `SELECT COALESCE(SUM(a.reimbursement),0) AS s
         FROM construction_payroll_period_adjustments a
         INNER JOIN construction_payroll_periods p ON p.id = a.period_id
         WHERE p.end_date >= ? AND p.end_date <= ?`,
        [from, to]
      );
      reimRange = Number(r.s) || 0;
    } catch (_) {}
    try {
      const [[r2]] = await pool.query(
        `SELECT COALESCE(SUM(a.discount),0) AS s
         FROM construction_payroll_period_adjustments a
         INNER JOIN construction_payroll_periods p ON p.id = a.period_id
         WHERE p.end_date >= ? AND p.end_date <= ?`,
        [from, to]
      );
      discRange = Number(r2.s) || 0;
    } catch (_) {}
    const labor = Number(agg.total) || 0;
    return res.json({
      success: true,
      data: {
        scope: 'range',
        timesheet_total: labor,
        reimbursement_total: reimRange,
        discount_total: discRange,
        total: Math.round((labor + reimRange - discRange) * 100) / 100,
        line_count: Number(agg.ts_line_count) || 0,
        range: { from, to },
      },
    });
  } catch (err) {
    return sendDbError(res, err);
  }
}
