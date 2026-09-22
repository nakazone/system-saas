/**
 * Motor central de cálculos financeiros (empresa).
 * Queries defensivas: tabelas/colunas em falta retornam zeros.
 */
import { getProjectsTableColumnSet } from '../modules/projects/projectHelpers.js';

/** Cache por processo: BD legada sem `projects.project_number`. */
let _projectsHasProjectNumber = null;

/**
 * Expressão SQL para rótulo de projeto (sem referenciar coluna em falta).
 * @param {import('mysql2/promise').Pool} pool
 * @param {string} tableAlias ex.: 'p'
 */
export async function sqlProjectLabelExpr(pool, tableAlias = 'p') {
  const a = tableAlias;
  const idExpr = `${a}.id`;
  if (!pool) return `CONCAT('PRJ-', ${idExpr})`;
  if (_projectsHasProjectNumber === null) {
    try {
      const cols = await getProjectsTableColumnSet(pool);
      _projectsHasProjectNumber = cols.has('project_number');
    } catch (_) {
      _projectsHasProjectNumber = false;
    }
  }
  if (_projectsHasProjectNumber) {
    return `COALESCE(NULLIF(TRIM(${a}.project_number), ''), CONCAT('PRJ-', ${idExpr}))`;
  }
  return `CONCAT('PRJ-', ${idExpr})`;
}

async function safeQuery(pool, fn) {
  try {
    return await fn();
  } catch (e) {
    console.warn('[financialEngine]', e.code || '', e.message);
    return null;
  }
}

/**
 * Linha «não apagada» por soft-delete (deleted_at).
 * Não usar literal '0000-00-00' — em NO_ZERO_DATE (Railway/MySQL 8) a query falha.
 * Valores zero legados ficam abaixo do limiar de 1970.
 * @param {string | null} alias prefixo de tabela (ex.: 'p', 'oc'); null = coluna `deleted_at` só
 */
export function sqlNotDeletedAt(alias = null) {
  const col = alias ? `${alias}.deleted_at` : 'deleted_at';
  return `(${col} IS NULL OR ${col} < '1970-01-02 00:00:01')`;
}

function deletedAtClause(alias = 'p') {
  return `AND ${sqlNotDeletedAt(alias)}`;
}

function parseLocalDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12, 0, 0, 0);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const d = parseInt(m[3], 10);
  const dt = new Date(y, mo, d, 12, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function dateOnly(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

function daysInMonth(y, monthIndex) {
  return new Date(y, monthIndex + 1, 0).getDate();
}

function clampDayOfMonth(y, monthIndex, dom) {
  const dim = daysInMonth(y, monthIndex);
  return Math.min(Math.max(1, dom), dim);
}

function eachDayInRangeInclusive(weekStart, weekEnd) {
  const out = [];
  const cur = dateOnly(weekStart);
  const last = dateOnly(weekEnd);
  while (cur <= last) {
    out.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function paymentAllowedByEnd(paymentDay, recurrenceEndRaw) {
  if (!recurrenceEndRaw) return true;
  const end = parseLocalDate(recurrenceEndRaw);
  if (!end) return true;
  return dateOnly(paymentDay) <= dateOnly(end);
}

/**
 * Custos operacionais recorrentes na previsão semanal: só entram na semana em que há vencimento
 * (ex.: mensal no dia X → só na semana que contém esse dia civil).
 */
function recurringOperationalCostHitsWeek(row, weekStartStr, weekEndStr) {
  const ws = parseLocalDate(weekStartStr);
  const we = parseLocalDate(weekEndStr);
  const anchor = parseLocalDate(row.expense_date);
  if (!ws || !we || !anchor) return false;

  if (row.recurrence_end_date) {
    const seriesEnd = parseLocalDate(row.recurrence_end_date);
    if (seriesEnd && dateOnly(seriesEnd) < ws) return false;
  }

  const anchorDay = dateOnly(anchor);
  const type = String(row.recurrence_type || 'monthly').toLowerCase();
  const days = eachDayInRangeInclusive(ws, we);

  if (type === 'monthly') {
    let dom =
      row.recurrence_day != null && row.recurrence_day !== ''
        ? parseInt(String(row.recurrence_day), 10)
        : NaN;
    if (!Number.isFinite(dom) || dom < 1 || dom > 31) {
      dom = anchor.getDate();
    }
    for (const d of days) {
      if (dateOnly(d) < anchorDay) continue;
      const payDay = clampDayOfMonth(d.getFullYear(), d.getMonth(), dom);
      if (d.getDate() !== payDay) continue;
      if (!paymentAllowedByEnd(d, row.recurrence_end_date)) continue;
      return true;
    }
    return false;
  }

  if (type === 'weekly' || type === 'biweekly') {
    const step = type === 'biweekly' ? 14 : 7;
    const anchorMs = anchorDay.getTime();
    for (const d of days) {
      const diffDays = Math.round((dateOnly(d).getTime() - anchorMs) / 86400000);
      if (diffDays < 0) continue;
      if (diffDays % step !== 0) continue;
      if (!paymentAllowedByEnd(d, row.recurrence_end_date)) continue;
      return true;
    }
    return false;
  }

  if (type === 'quarterly') {
    let dom =
      row.recurrence_day != null && row.recurrence_day !== ''
        ? parseInt(String(row.recurrence_day), 10)
        : NaN;
    if (!Number.isFinite(dom) || dom < 1 || dom > 31) {
      dom = anchor.getDate();
    }
    const ay = anchor.getFullYear();
    const am = anchor.getMonth();
    for (const d of days) {
      if (dateOnly(d) < anchorDay) continue;
      const monthsDiff = (d.getFullYear() - ay) * 12 + (d.getMonth() - am);
      if (monthsDiff < 0 || monthsDiff % 3 !== 0) continue;
      const payDay = clampDayOfMonth(d.getFullYear(), d.getMonth(), dom);
      if (d.getDate() !== payDay) continue;
      if (!paymentAllowedByEnd(d, row.recurrence_end_date)) continue;
      return true;
    }
    return false;
  }

  if (type === 'annual') {
    const am = anchor.getMonth();
    const adRaw = anchor.getDate();
    for (const d of days) {
      if (dateOnly(d) < anchorDay) continue;
      if (d.getMonth() !== am) continue;
      const payDay = clampDayOfMonth(d.getFullYear(), am, adRaw);
      if (d.getDate() !== payDay) continue;
      if (!paymentAllowedByEnd(d, row.recurrence_end_date)) continue;
      return true;
    }
    return false;
  }

  return false;
}

function formatLocalYMD(d) {
  if (!d || Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Soma dias a uma data civil local YYYY-MM-DD. */
function addDaysYmd(ymdStr, deltaDays) {
  const d = parseLocalDate(ymdStr);
  if (!d) return null;
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate() + deltaDays, 12, 0, 0, 0);
  return formatLocalYMD(out);
}

/**
 * Folha construção (Seg–Dom) paga na semana SEGUINTE, no sábado dessa semana de pagamento.
 * Ex.: trabalho 30 mar–5 abr → pagamento sáb 11 abr (semana pagamento começa 6 abr).
 * work_week = [pay_week_monday - 7, pay_week_monday - 1]; payment = pay_week_monday + 5 (sábado).
 */
async function fetchConstructionPayrollForPaymentWeek(pool, payWeekMondayYmd) {
  const workMon = addDaysYmd(payWeekMondayYmd, -7);
  const workSun = addDaysYmd(payWeekMondayYmd, -1);
  const paySaturday = addDaysYmd(payWeekMondayYmd, 5);
  if (!workMon || !workSun || !paySaturday) return null;

  try {
    const [tcheck] = await pool.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'construction_payroll_periods'`
    );
    if (!tcheck.length) return null;

    const [adjT] = await pool.query(
      `SELECT COUNT(*) AS c FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'construction_payroll_period_adjustments'`
    );
    const hasAdj = Number(adjT[0]?.c) > 0;
    const extraCols = hasAdj
      ? `, (SELECT COALESCE(SUM(a.reimbursement),0) FROM construction_payroll_period_adjustments a WHERE a.period_id = p.id) AS reimbursement_total,
        (SELECT COALESCE(SUM(a.discount),0) FROM construction_payroll_period_adjustments a WHERE a.period_id = p.id) AS discount_total`
      : `, 0 AS reimbursement_total, 0 AS discount_total`;

    const [rows] = await pool.query(
      `SELECT p.id, p.name, p.start_date, p.end_date,
        (SELECT COALESCE(SUM(calculated_amount),0) FROM construction_payroll_timesheets t WHERE t.period_id = p.id) AS timesheet_total
        ${extraCols}
       FROM construction_payroll_periods p
       WHERE p.start_date = ? AND p.end_date = ?
       LIMIT 1`,
      [workMon, workSun]
    );
    const row = rows && rows[0];
    if (!row) return null;

    const ts = parseFloat(row.timesheet_total) || 0;
    const reim = parseFloat(row.reimbursement_total) || 0;
    const disc = parseFloat(row.discount_total) || 0;
    const payable = Math.max(0, ts + reim - disc);

    return {
      amount: payable,
      item: {
        source: 'construction_payroll',
        period_id: row.id,
        period_name: row.name,
        work_week_start: String(row.start_date).slice(0, 10),
        work_week_end: String(row.end_date).slice(0, 10),
        payment_date: paySaturday,
        payable_total: payable,
        timesheet_total: ts,
        reimbursement_total: reim,
        discount_total: disc,
      },
      meta: {
        source: 'construction_payroll',
        payment_date: paySaturday,
        work_week: { start: workMon, end: workSun },
      },
    };
  } catch (e) {
    console.warn('[financialEngine] construction payroll weekly forecast:', e && e.message);
    return null;
  }
}

/** Todas as datas YYYY-MM-DD de vencimento de um custo recorrente num intervalo (mesma regra da previsão semanal). */
export function getRecurringPaymentDatesInRange(row, startYmd, endYmd) {
  const rs = parseLocalDate(startYmd);
  const re = parseLocalDate(endYmd);
  const out = [];
  if (!rs || !re || re < rs) return out;
  for (const d of eachDayInRangeInclusive(rs, re)) {
    const ymd = formatLocalYMD(d);
    if (recurringOperationalCostHitsWeek(row, ymd, ymd)) {
      out.push(ymd);
    }
  }
  return out;
}

/**
 * Próximos pagamentos a fornecedores (operational_costs com vendor_id):
 * recorrentes no horizonte, únicos pendentes futuros, e pendentes atrasados (últimos 180 dias).
 */
export async function getUpcomingVendorPayments(pool, horizonDays = 90) {
  if (!pool) return [];
  const horizon = Math.min(366, Math.max(1, parseInt(String(horizonDays), 10) || 90));
  const startD = dateOnly(new Date());
  const startYmd = formatLocalYMD(startD);
  const endD = new Date(startD);
  endD.setDate(endD.getDate() + horizon);
  const endYmd = formatLocalYMD(endD);
  const del = sqlNotDeletedAt('oc');

  const [recurring] = await pool.query(
    `SELECT oc.*, v.name AS vendor_name
     FROM operational_costs oc
     INNER JOIN vendors v ON v.id = oc.vendor_id
     WHERE oc.is_recurring = 1
       AND oc.vendor_id IS NOT NULL
       AND oc.status IN ('paid','recurring','pending')
       AND (oc.recurrence_end_date IS NULL OR oc.recurrence_end_date >= ?)
       AND ${del}`,
    [startYmd]
  );

  const [futureOnce] = await pool.query(
    `SELECT oc.*, v.name AS vendor_name
     FROM operational_costs oc
     INNER JOIN vendors v ON v.id = oc.vendor_id
     WHERE oc.is_recurring = 0
       AND oc.vendor_id IS NOT NULL
       AND oc.status = 'pending'
       AND oc.expense_date >= ?
       AND oc.expense_date <= ?
       AND ${del}`,
    [startYmd, endYmd]
  );

  const [overdueOnce] = await pool.query(
    `SELECT oc.*, v.name AS vendor_name
     FROM operational_costs oc
     INNER JOIN vendors v ON v.id = oc.vendor_id
     WHERE oc.is_recurring = 0
       AND oc.vendor_id IS NOT NULL
       AND oc.status = 'pending'
       AND oc.expense_date < ?
       AND oc.expense_date >= DATE_SUB(?, INTERVAL 180 DAY)
       AND ${del}`,
    [startYmd, startYmd]
  );

  const out = [];
  for (const row of recurring || []) {
    for (const due of getRecurringPaymentDatesInRange(row, startYmd, endYmd)) {
      out.push({
        kind: 'recurring',
        overdue: false,
        due_date: due,
        vendor_id: row.vendor_id,
        vendor_name: row.vendor_name,
        operational_cost_id: row.id,
        description: row.description,
        amount: parseFloat(row.total_amount) || 0,
        recurrence_type: row.recurrence_type,
      });
    }
  }
  for (const row of futureOnce || []) {
    out.push({
      kind: 'one_time',
      overdue: false,
      due_date: String(row.expense_date).slice(0, 10),
      vendor_id: row.vendor_id,
      vendor_name: row.vendor_name,
      operational_cost_id: row.id,
      description: row.description,
      amount: parseFloat(row.total_amount) || 0,
      recurrence_type: null,
    });
  }
  for (const row of overdueOnce || []) {
    out.push({
      kind: 'one_time',
      overdue: true,
      due_date: String(row.expense_date).slice(0, 10),
      vendor_id: row.vendor_id,
      vendor_name: row.vendor_name,
      operational_cost_id: row.id,
      description: row.description,
      amount: parseFloat(row.total_amount) || 0,
      recurrence_type: null,
    });
  }
  out.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    const c = a.due_date.localeCompare(b.due_date);
    if (c !== 0) return c;
    return String(a.vendor_name || '').localeCompare(String(b.vendor_name || ''));
  });
  return out;
}

/** P&L agregado da empresa no período */
export async function getCompanyPL(pool, periodStart, periodEnd) {
  const del = deletedAtClause('p');

  const revenueRows = await safeQuery(pool, async () => {
    const [r] = await pool.query(
      `SELECT
        COALESCE(SUM(p.contract_value), 0) AS total_revenue,
        COUNT(p.id) AS projects_count,
        COALESCE(AVG(
          (p.contract_value - (COALESCE(p.labor_cost_actual,0) + COALESCE(p.material_cost_actual,0) + COALESCE(p.additional_cost_actual,0)))
          / NULLIF(p.contract_value, 0) * 100
        ), 0) AS avg_margin_pct
      FROM projects p
      WHERE p.status = 'completed'
        AND COALESCE(p.end_date_actual, p.end_date_estimated) >= ?
        AND COALESCE(p.end_date_actual, p.end_date_estimated) <= ?
        ${del}`,
      [periodStart, periodEnd]
    );
    return r;
  });

  const payrollRows = await safeQuery(pool, async () => {
    const [r] = await pool.query(
      `SELECT
        COALESCE(SUM(pe.total_cost), 0) AS total_payroll,
        COUNT(DISTINCT pe.employee_id) AS employees_count,
        COALESCE(SUM(pe.hours_worked), 0) AS total_hours
      FROM payroll_entries pe
      WHERE pe.approved = 1
        AND pe.date >= ? AND pe.date <= ?`,
      [periodStart, periodEnd]
    );
    return r;
  });

  const projectCostRows = await safeQuery(pool, async () => {
    const [hasProj] = await pool.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_costs' AND COLUMN_NAME = 'is_projected'`
    );
    const projFilter = Number(hasProj[0]?.c) > 0 ? 'AND IFNULL(pc.is_projected,0)=0' : '';
    const [r] = await pool.query(
      `SELECT
        COALESCE(SUM(CASE WHEN pc.cost_type='labor' THEN pc.total_cost ELSE 0 END), 0) AS labor,
        COALESCE(SUM(CASE WHEN pc.cost_type='material' THEN pc.total_cost ELSE 0 END), 0) AS material,
        COALESCE(SUM(CASE WHEN pc.cost_type='additional' THEN pc.total_cost ELSE 0 END), 0) AS additional
      FROM project_costs pc
      JOIN projects p ON pc.project_id = p.id
      WHERE 1=1 ${projFilter}
        AND DATE(pc.created_at) >= ? AND DATE(pc.created_at) <= ?
        ${del}`,
      [periodStart, periodEnd]
    );
    return r;
  });

  let operationalRows = [];
  await safeQuery(pool, async () => {
    const [r] = await pool.query(
      `SELECT category, COALESCE(SUM(total_amount), 0) AS amount
      FROM operational_costs
      WHERE status IN ('paid','recurring')
        AND expense_date >= ? AND expense_date <= ?
        AND ${sqlNotDeletedAt()}
      GROUP BY category`,
      [periodStart, periodEnd]
    );
    operationalRows = r || [];
    return r;
  });

  const marketingRows = await safeQuery(pool, async () => {
    const [r] = await pool.query(
      `SELECT COALESCE(SUM(spend), 0) AS total_marketing
      FROM ad_spend
      WHERE period_start <= ? AND period_end >= ?
        AND ${sqlNotDeletedAt()}`,
      [periodEnd, periodStart]
    );
    return r;
  });

  const receivedRows = await safeQuery(pool, async () => {
    const [r] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total_received
      FROM payment_receipts
      WHERE payment_date >= ? AND payment_date <= ?`,
      [periodStart, periodEnd]
    );
    return r;
  });

  const revenue = parseFloat(revenueRows?.[0]?.total_revenue) || 0;
  const payroll = parseFloat(payrollRows?.[0]?.total_payroll) || 0;
  const projectCosts =
    (parseFloat(projectCostRows?.[0]?.labor) || 0) +
    (parseFloat(projectCostRows?.[0]?.material) || 0) +
    (parseFloat(projectCostRows?.[0]?.additional) || 0);
  const operational = operationalRows.reduce((s, row) => s + (parseFloat(row.amount) || 0), 0);
  const marketing = parseFloat(marketingRows?.[0]?.total_marketing) || 0;
  const received = parseFloat(receivedRows?.[0]?.total_received) || 0;

  const totalCosts = payroll + projectCosts + operational + marketing;
  const grossProfit = revenue - (payroll + projectCosts);
  const netProfit = revenue - totalCosts;
  const netMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;

  const projectLabelSql = await sqlProjectLabelExpr(pool);
  const topProjects = await safeQuery(pool, async () => {
    const [r] = await pool.query(
      `SELECT
        p.id,
        ${projectLabelSql} AS project_label,
        COALESCE(p.contract_value, 0) AS contract_value,
        (COALESCE(p.labor_cost_actual,0) + COALESCE(p.material_cost_actual,0) + COALESCE(p.additional_cost_actual,0)) AS cost_total,
        COALESCE(p.contract_value,0) - (COALESCE(p.labor_cost_actual,0) + COALESCE(p.material_cost_actual,0) + COALESCE(p.additional_cost_actual,0)) AS profit,
        p.status,
        CASE WHEN COALESCE(p.contract_value,0) > 0 THEN
          (COALESCE(p.contract_value,0) - (COALESCE(p.labor_cost_actual,0) + COALESCE(p.material_cost_actual,0) + COALESCE(p.additional_cost_actual,0)))
          / p.contract_value * 100 ELSE 0 END AS margin_pct
      FROM projects p
      WHERE p.status = 'completed'
        AND COALESCE(p.end_date_actual, p.end_date_estimated) >= ?
        AND COALESCE(p.end_date_actual, p.end_date_estimated) <= ?
        ${del}
      ORDER BY profit DESC
      LIMIT 10`,
      [periodStart, periodEnd]
    );
    return r;
  });

  return {
    revenue,
    received,
    costs: {
      payroll,
      project: projectCosts,
      operational,
      marketing,
      total: totalCosts,
    },
    operational_breakdown: operationalRows,
    gross_profit: grossProfit,
    gross_margin_pct: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
    net_profit: netProfit,
    net_margin_pct: netMargin,
    projects_count: parseInt(revenueRows?.[0]?.projects_count, 10) || 0,
    employees_count: parseInt(payrollRows?.[0]?.employees_count, 10) || 0,
    total_hours: parseFloat(payrollRows?.[0]?.total_hours) || 0,
    top_projects: topProjects || [],
  };
}

/** Previsão semanal (heurística) */
export async function generateWeeklyForecast(pool, weekStart) {
  const d0 = new Date(`${weekStart}T12:00:00`);
  const weekEnd = new Date(d0);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const wEnd = weekEnd.toISOString().slice(0, 10);
  const projectLabelSql = await sqlProjectLabelExpr(pool);

  let payrollForecast = [];
  let payrollPayMeta = {
    source: 'schedule_estimate',
    payment_date: null,
    work_week: null,
  };

  const cpp = await fetchConstructionPayrollForPaymentWeek(pool, weekStart);
  if (cpp) {
    payrollForecast = [cpp.item];
    payrollPayMeta = cpp.meta;
  } else {
    await safeQuery(pool, async () => {
      const [r] = await pool.query(
        `SELECT
        p.id AS project_id,
        ${projectLabelSql} AS project_name,
        ps.crew_id,
        c.name AS crew_name,
        GREATEST(0,
          DATEDIFF(LEAST(ps.end_date, ?), GREATEST(ps.start_date, ?)) + 1
        ) AS days_overlap,
        COALESCE(
          (SELECT AVG(pe.hourly_rate * 8) FROM payroll_entries pe
           WHERE pe.crew_id = ps.crew_id AND pe.approved = 1),
          200
        ) AS daily_rate_avg
      FROM project_schedules ps
      JOIN projects p ON ps.project_id = p.id
      JOIN crews c ON ps.crew_id = c.id
      WHERE ps.status IN ('scheduled', 'in_progress')
        AND ps.start_date <= ? AND ps.end_date >= ?
        ${deletedAtClause('p')}`,
        [wEnd, weekStart, wEnd, weekStart]
      );
      payrollForecast = (r || []).map((row) => ({ ...row, source: 'schedule_estimate' }));
      return r;
    });
  }

  let recurringCosts = [];
  await safeQuery(pool, async () => {
    const [r] = await pool.query(
      `SELECT *
      FROM operational_costs
      WHERE is_recurring = 1
        AND status IN ('paid','recurring','pending')
        AND (recurrence_end_date IS NULL OR recurrence_end_date >= ?)
        AND ${sqlNotDeletedAt()}`,
      [weekStart]
    );
    recurringCosts = (r || []).filter((row) => recurringOperationalCostHitsWeek(row, weekStart, wEnd));
    return r;
  });

  let materialsPending = [];
  await safeQuery(pool, async () => {
    const [r] = await pool.query(
      `SELECT pm.*, ${projectLabelSql} AS project_name
      FROM project_materials pm
      JOIN projects p ON pm.project_id = p.id
      WHERE pm.status IN ('ordered', 'partial')
        AND (
          (pm.order_date IS NOT NULL AND pm.order_date <= ?)
          OR (pm.received_date IS NOT NULL AND pm.received_date BETWEEN ? AND ?)
        )
        ${deletedAtClause('p')}`,
      [wEnd, weekStart, wEnd]
    );
    materialsPending = r || [];
    return r;
  });

  let marketingTotal = 0;
  await safeQuery(pool, async () => {
    const [r] = await pool.query(
      `SELECT COALESCE(SUM(
        spend * (GREATEST(0, DATEDIFF(LEAST(period_end, ?), GREATEST(period_start, ?)) + 1))
        / GREATEST(DATEDIFF(period_end, period_start) + 1, 1)
      ), 0) AS weekly_marketing
      FROM ad_spend
      WHERE period_start <= ? AND period_end >= ?
        AND ${sqlNotDeletedAt()}`,
      [wEnd, weekStart, wEnd, weekStart]
    );
    marketingTotal = parseFloat(r[0]?.weekly_marketing) || 0;
    return r;
  });

  const payrollTotal = cpp
    ? cpp.amount
    : payrollForecast.reduce((s, row) => {
        return s + (parseFloat(row.days_overlap) || 0) * (parseFloat(row.daily_rate_avg) || 0);
      }, 0);
  const operationalTotal = recurringCosts.reduce((s, row) => s + (parseFloat(row.total_amount) || 0), 0);
  const materialsTotal = materialsPending.reduce((s, row) => s + (parseFloat(row.total_cost) || 0), 0);

  return {
    week_start: weekStart,
    week_end: wEnd,
    forecast: {
      payroll: {
        amount: payrollTotal,
        items: payrollForecast,
        source: payrollPayMeta.source,
        payment_date: payrollPayMeta.payment_date,
        work_week: payrollPayMeta.work_week,
      },
      operational: { amount: operationalTotal, items: recurringCosts },
      materials: { amount: materialsTotal, items: materialsPending },
      marketing: { amount: marketingTotal, items: [] },
      total: payrollTotal + operationalTotal + materialsTotal + marketingTotal,
    },
  };
}

export async function updateVendorTotalSpent(pool, vendorId) {
  if (!vendorId) return;
  await safeQuery(pool, async () => {
    const [[exp]] = await pool.query(
      `SELECT COALESCE(SUM(total_amount),0) AS t FROM expenses
       WHERE vendor_id = ?
         AND (status IS NULL OR status NOT IN ('rejected','cancelled'))`,
      [vendorId]
    );
    const [[op]] = await pool.query(
      `SELECT COALESCE(SUM(total_amount),0) AS t FROM operational_costs
       WHERE vendor_id = ? AND status IN ('paid','recurring')
       AND ${sqlNotDeletedAt()}`,
      [vendorId]
    );
    const total = (parseFloat(exp?.t) || 0) + (parseFloat(op?.t) || 0);
    await pool.query('UPDATE vendors SET total_spent = ?, updated_at = NOW() WHERE id = ?', [total, vendorId]);
    return true;
  });
}

export async function importMarketingCosts(pool, periodStart, periodEnd) {
  const rows =
    (await safeQuery(pool, async () => {
      const [r] = await pool.query(
        `SELECT platform, campaign_name, SUM(spend) AS total_spend,
        MIN(period_start) AS period_start, MAX(period_end) AS period_end
      FROM ad_spend
      WHERE period_start <= ? AND period_end >= ?
        AND ${sqlNotDeletedAt()}
      GROUP BY platform, campaign_name`,
        [periodEnd, periodStart]
      );
      return r;
    })) || [];
  if (!rows.length) return { imported: 0 };

  let imported = 0;
  for (const row of rows) {
    const desc = `[Marketing] ${row.campaign_name} (${row.platform})`;
    const [[existing]] = await pool.query(
      `SELECT id FROM expenses
       WHERE category = 'other'
         AND description = ?
         AND expense_date >= ? AND expense_date <= ?
       LIMIT 1`,
      [desc, periodStart, periodEnd]
    );
    if (existing) continue;
    const amt = parseFloat(row.total_spend) || 0;
    await pool.query(
      `INSERT INTO expenses (category, description, amount, total_amount, expense_date, status)
       VALUES ('other', ?, ?, ?, ?, 'approved')`,
      [desc, amt, amt, row.period_start || periodStart]
    );
    imported += 1;
  }
  return { imported };
}
