/**
 * Dashboard API — métricas operacionais (pipeline, conversão, financeiro, alertas).
 * GET /api/dashboard/stats?period=today|week|month|overall
 */
import { getDBConnection } from '../config/db.js';
import { isNoSuchTableError } from '../lib/mysqlSchemaErrors.js';

const PERIODS = new Set(['today', 'week', 'month', 'overall']);

/** Estágios de pipeline considerados “em proposta” (leads nestas etapas). */
const PROPOSAL_STAGE_SLUGS_SQL = `('proposal_created','proposal_sent','negotiation')`;

/** Valor monetário do quote: total_amount; se 0 ou ausente, subtotal + tax (fluxos legados / PDF). */
function quoteEffectiveAmountExpr(alias = 'q') {
  const a = alias;
  return `(CASE WHEN ${a}.total_amount IS NOT NULL AND ${a}.total_amount > 0 THEN ${a}.total_amount
           ELSE COALESCE(${a}.subtotal, 0) + COALESCE(${a}.tax_total, 0) END)`;
}

/** Valor em estimates.final_price (ignora 0 / NULL em SUM). */
function estimateMoneyExpr(alias = 'e') {
  const a = alias;
  return `(CASE WHEN ${a}.final_price IS NOT NULL AND ${a}.final_price > 0 THEN ${a}.final_price ELSE 0 END)`;
}

/** Número finito a partir de string/BigInt/Decimal do mysql2. */
function toFiniteNumber(v) {
  if (v == null) return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'bigint') return Number(v);
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Condições SQL para coluna de timestamp `col` dentro do período */
function periodPredicate(col, period) {
  if (period === 'overall') {
    return '1=1';
  }
  if (period === 'today') {
    return `DATE(${col}) = CURDATE()`;
  }
  if (period === 'week') {
    return `${col} >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`;
  }
  return `${col} >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`;
}

async function safeQuery(pool, sql, fallback = null) {
  try {
    const [rows] = await pool.query(sql);
    return rows;
  } catch (e) {
    if (isNoSuchTableError(e)) {
      console.warn('[dashboard] tabela ausente:', e.message);
      return fallback;
    }
    throw e;
  }
}

function firstRow(rows) {
  if (!rows || !rows.length) return {};
  return rows[0];
}

/** Follow-ups em `tasks` com lead (schema novo: due_date/status; legado: due_at/completed_at). */
async function queryFollowupKpis(pool) {
  const fallback = { pending: 0, overdue: 0, due_today: 0 };
  try {
    const [colRows] = await pool.query(
      `SELECT COLUMN_NAME AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks'`
    );
    const cols = new Set((colRows || []).map((r) => r.n));
    if (!cols.has('lead_id')) return fallback;
    const dueCol = cols.has('due_date') ? 't.due_date' : cols.has('due_at') ? 't.due_at' : null;
    if (!dueCol) return fallback;
    const openCond = cols.has('status')
      ? `LOWER(TRIM(COALESCE(t.status,''))) IN ('pending','in_progress')`
      : 't.completed_at IS NULL';
    const sql = `SELECT
      COUNT(*) AS pending,
      COALESCE(SUM(CASE WHEN ${dueCol} < NOW() THEN 1 ELSE 0 END), 0) AS overdue,
      COALESCE(SUM(CASE WHEN DATE(${dueCol}) = CURDATE() THEN 1 ELSE 0 END), 0) AS due_today
     FROM tasks t
     WHERE t.lead_id IS NOT NULL AND (${openCond})`;
    const [rows] = await pool.query(sql);
    const r = rows[0] || {};
    return {
      pending: Number(r.pending) || 0,
      overdue: Number(r.overdue) || 0,
      due_today: Number(r.due_today) || 0,
    };
  } catch (e) {
    if (isNoSuchTableError(e)) return fallback;
    console.warn('[dashboard] followup kpis:', e.message);
    return fallback;
  }
}

/** Ordem canónica dos slugs (alinhada ao pipeline_stages típico). */
const FUNNEL_STAGE_ORDER = [
  'lead_received',
  'contact_made',
  'qualified',
  'visit_scheduled',
  'measurement_done',
  'proposal_created',
  'proposal_sent',
  'negotiation',
  'closed_won',
  'production',
];

/**
 * Funil: LEFT JOIN pipeline_stages + leads no período (sem subquery pesada em `quotes`).
 * @param {import('mysql2/promise').Pool} pool
 * @param {string} pLeads — fragmento SQL já interpolado (ex.: periodPredicate em l.created_at)
 */
async function getFunnelData(pool, pLeads) {
  try {
    const [rows] = await pool.query(
      `SELECT ps.id AS stage_id, ps.slug AS stage_key, ps.name AS stage_name,
              COALESCE(ps.order_num, 0) AS order_index,
              COUNT(l.id) AS cnt
       FROM pipeline_stages ps
       LEFT JOIN leads l ON l.pipeline_stage_id = ps.id AND (${pLeads})
       WHERE ps.slug <> 'closed_lost'
       GROUP BY ps.id, ps.slug, ps.name, ps.order_num
       ORDER BY ps.order_num ASC, ps.id ASC`
    );
    const list = rows || [];
    list.sort((a, b) => {
      const ia = FUNNEL_STAGE_ORDER.indexOf(a.stage_key);
      const ib = FUNNEL_STAGE_ORDER.indexOf(b.stage_key);
      if (ia === -1 && ib === -1) return (Number(a.order_index) || 0) - (Number(b.order_index) || 0);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    return list.map((r) => ({
      stage_id: r.stage_id,
      stage_key: r.stage_key,
      stage_name: r.stage_name,
      slug: r.stage_key,
      cnt: r.cnt,
    }));
  } catch (e) {
    console.error('[FUNNEL] Erro na query:', e.message);
    try {
      const [rows] = await pool.query(
        `SELECT pipeline_stage_id AS stage_id, COUNT(*) AS cnt
         FROM leads WHERE (${pLeads}) GROUP BY pipeline_stage_id`
      );
      return (rows || []).map((r) => ({
        stage_id: r.stage_id,
        stage_key: 'unknown',
        stage_name: r.stage_id != null ? `Estágio ${r.stage_id}` : 'Sem estágio',
        slug: 'unknown',
        cnt: r.cnt,
      }));
    } catch (e2) {
      console.error('[FUNNEL] Fallback falhou:', e2.message);
      return [];
    }
  }
}

async function queryLeadsBySource(pool, pLeads) {
  const sqlUtm = `
    SELECT COALESCE(NULLIF(TRIM(l.utm_source), ''), NULLIF(TRIM(l.source), ''), 'direct') AS source,
           COUNT(*) AS count
    FROM leads l
    WHERE ${pLeads}
    GROUP BY COALESCE(NULLIF(TRIM(l.utm_source), ''), NULLIF(TRIM(l.source), ''), 'direct')
    ORDER BY count DESC
    LIMIT 6`;
  try {
    const [rows] = await pool.query(sqlUtm);
    return rows || [];
  } catch (_) {
    try {
      const [rows] = await pool.query(
        `SELECT COALESCE(NULLIF(TRIM(l.source), ''), 'direct') AS source, COUNT(*) AS count
         FROM leads l
         WHERE ${pLeads}
         GROUP BY COALESCE(NULLIF(TRIM(l.source), ''), 'direct')
         ORDER BY count DESC
         LIMIT 6`
      );
      return rows || [];
    } catch (e2) {
      console.warn('[dashboard] leads_by_source:', e2.message);
      return [];
    }
  }
}

async function queryRevenueByService(pool) {
  const sql = `
    SELECT COALESCE(SUM(supply_value), 0) AS supply,
           COALESCE(SUM(installation_value), 0) AS installation,
           COALESCE(SUM(sand_finish_value), 0) AS sand_finish,
           COALESCE(SUM(contract_value), 0) AS total
    FROM projects
    WHERE status IN ('in_progress', 'completed')
      AND (deleted_at IS NULL)`;
  try {
    const [rows] = await pool.query(sql);
    const r = rows[0] || {};
    return {
      supply: toFiniteNumber(r.supply),
      installation: toFiniteNumber(r.installation),
      sand_finish: toFiniteNumber(r.sand_finish),
      total: toFiniteNumber(r.total),
    };
  } catch (_) {
    try {
      const [rows] = await pool.query(
        `SELECT COALESCE(SUM(supply_value), 0) AS supply,
                COALESCE(SUM(installation_value), 0) AS installation,
                COALESCE(SUM(sand_finish_value), 0) AS sand_finish,
                COALESCE(SUM(contract_value), 0) AS total
         FROM projects
         WHERE status IN ('in_progress', 'completed')`
      );
      const r = rows[0] || {};
      return {
        supply: toFiniteNumber(r.supply),
        installation: toFiniteNumber(r.installation),
        sand_finish: toFiniteNumber(r.sand_finish),
        total: toFiniteNumber(r.total),
      };
    } catch (e2) {
      console.warn('[dashboard] revenue_by_service:', e2.message);
      return { supply: 0, installation: 0, sand_finish: 0, total: 0 };
    }
  }
}

/**
 * GET /api/dashboard/fix-orphan-leads — apenas admin. Atribui pipeline_stage_id ao estágio lead_received.
 */
export async function fixDashboardOrphanLeads(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const [ps] = await pool.query(
      `SELECT id FROM pipeline_stages WHERE slug = 'lead_received' ORDER BY id ASC LIMIT 1`
    );
    if (!ps.length) {
      return res.status(400).json({ success: false, error: 'Estágio lead_received não encontrado' });
    }
    const sid = ps[0].id;
    const [r] = await pool.execute(`UPDATE leads SET pipeline_stage_id = ? WHERE pipeline_stage_id IS NULL`, [
      sid,
    ]);
    return res.json({
      success: true,
      pipeline_stage_id: sid,
      updated: r.affectedRows != null ? Number(r.affectedRows) : 0,
    });
  } catch (e) {
    console.error('fixDashboardOrphanLeads:', e);
    return res.status(500).json({ success: false, error: e.message || 'Internal error' });
  }
}

export async function getDashboardStats(req, res) {
  const period = PERIODS.has(String(req.query.period || '').toLowerCase())
    ? String(req.query.period).toLowerCase()
    : 'month';
  const isOverall = period === 'overall';
  const pLeads = periodPredicate('l.created_at', period);
  const pVisitsSched = periodPredicate('v.scheduled_at', period);
  /** Visitas concluídas no período — só `updated_at` (coluna `completed_at` nem sempre existe no schema legado). */
  const pVisitsCompletedAt = periodPredicate('v.updated_at', period);
  const pProposalsSent = periodPredicate('COALESCE(pr.sent_at, pr.updated_at)', period);
  const pProposalsAccepted = periodPredicate('pr.accepted_at', period);
  const pQuotesApproved = periodPredicate('COALESCE(q.approved_at, q.updated_at)', period);
  const pQuotesSent = periodPredicate('COALESCE(q.sent_at, q.updated_at)', period);
  const pQuotesCreated = periodPredicate('q.created_at', period);
  const pEstimatesSent = periodPredicate('COALESCE(e.sent_at, e.updated_at)', period);
  const pEstimatesAccepted = periodPredicate('COALESCE(e.accepted_at, e.updated_at)', period);
  const pLeadUpdated = periodPredicate('l.updated_at', period);
  const pEstCreated = periodPredicate('e.created_at', period);
  const pwPropAcc = isOverall ? '1=1' : pProposalsAccepted;
  const pwQuoteApr = isOverall ? '1=1' : pQuotesApproved;
  const pwEstAcc = isOverall ? '1=1' : pEstimatesAccepted;
  const pwPropRej = isOverall ? '1=1' : periodPredicate('COALESCE(pr.updated_at, pr.created_at)', period);
  const pwQuoteDec = isOverall ? '1=1' : periodPredicate('q.updated_at', period);
  const pwEstDec = isOverall ? '1=1' : periodPredicate('COALESCE(e.declined_at, e.updated_at)', period);

  const closedWonLeadsSql = isOverall
    ? `SELECT COUNT(*) AS c FROM leads l
       INNER JOIN pipeline_stages ps ON ps.id = l.pipeline_stage_id AND ps.slug = 'closed_won'`
    : `SELECT COUNT(*) AS c FROM leads l
       INNER JOIN pipeline_stages ps ON ps.id = l.pipeline_stage_id AND ps.slug = 'closed_won'
       WHERE ${pLeadUpdated}`;

  const closedLostLeadsSql = isOverall
    ? `SELECT COUNT(*) AS c FROM leads l
       INNER JOIN pipeline_stages ps ON ps.id = l.pipeline_stage_id AND ps.slug = 'closed_lost'`
    : `SELECT COUNT(*) AS c FROM leads l
       INNER JOIN pipeline_stages ps ON ps.id = l.pipeline_stage_id AND ps.slug = 'closed_lost'
       WHERE ${pLeadUpdated}`;

  const revenueMonthSql = isOverall
    ? `SELECT COALESCE(SUM(pf.actual_revenue), 0) AS s FROM project_financials pf`
    : `SELECT COALESCE(SUM(pf.actual_revenue), 0) AS s FROM project_financials pf
       WHERE pf.updated_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`;

  const expensesMonthSql = isOverall
    ? `SELECT COALESCE(SUM(e.total_amount), 0) AS s
       FROM expenses e
       WHERE e.status IN ('approved', 'paid')`
    : `SELECT COALESCE(SUM(e.total_amount), 0) AS s
       FROM expenses e
       WHERE e.status IN ('approved', 'paid')
         AND e.expense_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`;

  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const [
      leadsReceived,
      leadsNewToday,
      contactPending,
      leadsInProposal,
      visitsScheduled,
      visitsCompleted,
      visitsToday,
      proposalsSent,
      proposalsOpen,
      closedWon,
      closedWonValue,
      closedLost,
      inProduction,
      convLeadsTotal,
      convLeadsReachedVisit,
      visitsCompletedPeriod,
      visitsWithProposal,
      propWinWinsLosses,
      avgDeal,
      revenueMonth,
      revenueProjected,
      expensesMonth,
      avgMargin,
      funnelRows,
      recentLeadsRows,
      visitsTodayList,
      staleOpenProposals,
      staleSentProposals,
      visitsTodayUnconfirmed,
      newLeadsUrgent,
      upcomingVisits,
      orphanLeadsCount,
      leadsBySourceRows,
      estimatesByStatusRows,
      monthlyRevenueRows,
      revenueByServiceData,
      leadsTrendRows,
      followupKpis,
    ] = await Promise.all([
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c FROM leads l WHERE ${pLeads}`,
        [{ c: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c FROM leads l WHERE DATE(l.created_at) = CURDATE()`,
        [{ c: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c
         FROM leads l
         INNER JOIN pipeline_stages ps ON ps.id = l.pipeline_stage_id AND ps.slug = 'lead_received'
         WHERE l.created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
           AND NOT EXISTS (SELECT 1 FROM interactions i WHERE i.lead_id = l.id)`,
        [{ c: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c FROM leads l
         INNER JOIN pipeline_stages ps ON ps.id = l.pipeline_stage_id
         WHERE ps.slug IN ${PROPOSAL_STAGE_SLUGS_SQL}`,
        [{ c: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c FROM visits v WHERE v.status = 'scheduled' AND ${pVisitsSched}`,
        [{ c: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c FROM visits v WHERE v.status = 'completed' AND ${pVisitsCompletedAt}`,
        [{ c: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c FROM visits v WHERE DATE(v.scheduled_at) = CURDATE()`,
        [{ c: 0 }]
      ),
      Promise.all([
        safeQuery(
          pool,
          `SELECT COUNT(*) AS c FROM proposals pr
           WHERE LOWER(TRIM(pr.status)) IN ('sent', 'viewed', 'created')
             AND ${pProposalsSent}`,
          [{ c: 0 }]
        ),
        safeQuery(
          pool,
          `SELECT COUNT(*) AS c FROM quotes q
           WHERE LOWER(TRIM(q.status)) IN ('sent', 'viewed', 'created')
             AND ${pQuotesSent}`,
          [{ c: 0 }]
        ),
        safeQuery(
          pool,
          `SELECT COUNT(*) AS c FROM estimates e
           WHERE LOWER(TRIM(e.status)) IN ('sent', 'viewed', 'draft')
             AND ${pEstimatesSent}`,
          [{ c: 0 }]
        ),
      ]).then((parts) => [
        {
          c: parts.reduce((s, rows) => s + toFiniteNumber(firstRow(rows).c), 0),
        },
      ]),
      Promise.all([
        safeQuery(
          pool,
          `SELECT COUNT(*) AS cnt,
                  COALESCE(SUM(pr.total_value), 0) AS val
           FROM proposals pr
           WHERE LOWER(TRIM(pr.status)) IN ('sent', 'draft', 'viewed', 'created')
             AND pr.total_value IS NOT NULL AND pr.total_value > 0`,
          [{ cnt: 0, val: 0 }]
        ),
        safeQuery(
          pool,
          `SELECT COUNT(*) AS cnt,
                  COALESCE(SUM(${quoteEffectiveAmountExpr('q')}), 0) AS val
           FROM quotes q
           WHERE LOWER(TRIM(q.status)) IN ('sent', 'draft', 'viewed', 'created')`,
          [{ cnt: 0, val: 0 }]
        ),
        safeQuery(
          pool,
          `SELECT COUNT(*) AS cnt,
                  COALESCE(SUM(${estimateMoneyExpr('e')}), 0) AS val
           FROM estimates e
           WHERE LOWER(TRIM(e.status)) IN ('draft', 'sent', 'viewed')`,
          [{ cnt: 0, val: 0 }]
        ),
      ]).then((parts) => {
        let cnt = 0;
        let val = 0;
        for (const rows of parts) {
          const row = firstRow(rows);
          cnt += toFiniteNumber(row.cnt);
          val += toFiniteNumber(row.val);
        }
        return [{ cnt, val }];
      }),
      safeQuery(pool, closedWonLeadsSql, [{ c: 0 }]),
      Promise.all(
        isOverall
          ? [
              safeQuery(
                pool,
                `SELECT COALESCE(SUM(pr.total_value), 0) AS s FROM proposals pr
                 WHERE pr.status = 'accepted' AND pr.total_value IS NOT NULL AND pr.total_value > 0`,
                [{ s: 0 }]
              ),
              safeQuery(
                pool,
                `SELECT COALESCE(SUM(${quoteEffectiveAmountExpr('q')}), 0) AS s FROM quotes q
                 WHERE LOWER(TRIM(q.status)) IN ('approved', 'accepted')`,
                [{ s: 0 }]
              ),
              safeQuery(
                pool,
                `SELECT COALESCE(SUM(${estimateMoneyExpr('e')}), 0) AS s FROM estimates e
                 WHERE LOWER(TRIM(e.status)) = 'accepted'`,
                [{ s: 0 }]
              ),
            ]
          : [
              safeQuery(
                pool,
                `SELECT COALESCE(SUM(pr.total_value), 0) AS s
                 FROM proposals pr
                 WHERE pr.status = 'accepted'
                   AND ${pProposalsAccepted}
                   AND pr.total_value IS NOT NULL AND pr.total_value > 0`,
                [{ s: 0 }]
              ),
              safeQuery(
                pool,
                `SELECT COALESCE(SUM(${quoteEffectiveAmountExpr('q')}), 0) AS s
                 FROM quotes q
                 WHERE LOWER(TRIM(q.status)) IN ('approved', 'accepted')
                   AND ${pQuotesApproved}`,
                [{ s: 0 }]
              ),
              safeQuery(
                pool,
                `SELECT COALESCE(SUM(${estimateMoneyExpr('e')}), 0) AS s
                 FROM estimates e
                 WHERE LOWER(TRIM(e.status)) = 'accepted'
                   AND ${pEstimatesAccepted}`,
                [{ s: 0 }]
              ),
            ]
      ).then((parts) => [
        {
          s: parts.reduce((sum, rows) => sum + toFiniteNumber(firstRow(rows).s), 0),
        },
      ]),
      safeQuery(pool, closedLostLeadsSql, [{ c: 0 }]),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c
         FROM leads l
         INNER JOIN pipeline_stages ps ON ps.id = l.pipeline_stage_id AND ps.slug = 'production'`,
        [{ c: 0 }]
      ),
      safeQuery(pool, `SELECT COUNT(*) AS c FROM leads l WHERE ${pLeads}`, [{ c: 0 }]),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c
         FROM leads l
         INNER JOIN pipeline_stages ps ON ps.id = l.pipeline_stage_id
         WHERE ${pLeads} AND ps.order_num >= 4`,
        [{ c: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c FROM visits v WHERE v.status = 'completed' AND ${pVisitsCompletedAt}`,
        [{ c: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c
         FROM visits v
         WHERE v.status = 'completed'
           AND ${pVisitsCompletedAt}
           AND (
             EXISTS (SELECT 1 FROM proposals pr WHERE pr.lead_id = v.lead_id)
             OR EXISTS (SELECT 1 FROM quotes q WHERE q.lead_id = v.lead_id)
             OR EXISTS (SELECT 1 FROM estimates e WHERE e.lead_id = v.lead_id)
           )`,
        [{ c: 0 }]
      ),
      Promise.all([
        safeQuery(
          pool,
          `SELECT COUNT(*) AS c FROM proposals pr
           WHERE pr.status = 'accepted' AND (${pwPropAcc})`,
          [{ c: 0 }]
        ),
        safeQuery(
          pool,
          `SELECT COUNT(*) AS c FROM quotes q
           WHERE LOWER(TRIM(q.status)) IN ('approved', 'accepted') AND (${pwQuoteApr})`,
          [{ c: 0 }]
        ),
        safeQuery(
          pool,
          `SELECT COUNT(*) AS c FROM estimates e
           WHERE LOWER(TRIM(e.status)) = 'accepted' AND (${pwEstAcc})`,
          [{ c: 0 }]
        ),
        safeQuery(
          pool,
          `SELECT COUNT(*) AS c FROM proposals pr
           WHERE pr.status = 'rejected' AND (${pwPropRej})`,
          [{ c: 0 }]
        ),
        safeQuery(
          pool,
          `SELECT COUNT(*) AS c FROM quotes q
           WHERE LOWER(TRIM(q.status)) IN ('declined', 'rejected')
             AND (${pwQuoteDec})`,
          [{ c: 0 }]
        ),
        safeQuery(
          pool,
          `SELECT COUNT(*) AS c FROM estimates e
           WHERE LOWER(TRIM(e.status)) IN ('declined', 'expired')
             AND (${pwEstDec})`,
          [{ c: 0 }]
        ),
      ]).then((parts) => {
        const wins =
          toFiniteNumber(firstRow(parts[0]).c) +
          toFiniteNumber(firstRow(parts[1]).c) +
          toFiniteNumber(firstRow(parts[2]).c);
        const losses =
          toFiniteNumber(firstRow(parts[3]).c) +
          toFiniteNumber(firstRow(parts[4]).c) +
          toFiniteNumber(firstRow(parts[5]).c);
        return [{ wins, losses }];
      }),
      safeQuery(
        pool,
        `SELECT COALESCE(SUM(${quoteEffectiveAmountExpr('q')}), 0) AS s,
                COUNT(*) AS c
         FROM quotes q
         WHERE LOWER(TRIM(q.status)) NOT IN ('declined', 'rejected')
           AND (${pQuotesCreated})`,
        [{ s: 0, c: 0 }]
      ),
      safeQuery(pool, revenueMonthSql, [{ s: 0 }]),
      safeQuery(
        pool,
        `SELECT
           (SELECT COALESCE(SUM(pr1.total_value), 0) FROM proposals pr1
              WHERE pr1.status = 'accepted' AND pr1.total_value IS NOT NULL AND pr1.total_value > 0)
         + (SELECT COALESCE(SUM(pr2.total_value), 0)
              FROM proposals pr2
              INNER JOIN leads l2 ON l2.id = pr2.lead_id
              INNER JOIN pipeline_stages ps2 ON ps2.id = l2.pipeline_stage_id
              WHERE ps2.slug = 'negotiation'
                AND pr2.status IN ('draft', 'sent', 'viewed', 'created')
                AND pr2.total_value IS NOT NULL AND pr2.total_value > 0)
         + (SELECT COALESCE(SUM(${quoteEffectiveAmountExpr('q1')}), 0) FROM quotes q1
              WHERE LOWER(TRIM(q1.status)) IN ('approved', 'accepted'))
         + (SELECT COALESCE(SUM(${quoteEffectiveAmountExpr('q2')}), 0)
              FROM quotes q2
              INNER JOIN leads lq ON lq.id = q2.lead_id
              INNER JOIN pipeline_stages psq ON psq.id = lq.pipeline_stage_id
              WHERE psq.slug = 'negotiation'
                AND LOWER(TRIM(q2.status)) IN ('draft', 'sent', 'viewed', 'created'))
         + (SELECT COALESCE(SUM(${estimateMoneyExpr('e1')}), 0) FROM estimates e1
              WHERE LOWER(TRIM(e1.status)) = 'accepted')
         + (SELECT COALESCE(SUM(${estimateMoneyExpr('e2')}), 0)
              FROM estimates e2
              INNER JOIN leads le2 ON le2.id = e2.lead_id
              INNER JOIN pipeline_stages pse ON pse.id = le2.pipeline_stage_id
              WHERE pse.slug = 'negotiation'
                AND LOWER(TRIM(e2.status)) IN ('draft', 'sent', 'viewed')) AS s`,
        [{ s: 0 }]
      ),
      safeQuery(pool, expensesMonthSql, [{ s: 0 }]),
      safeQuery(
        pool,
        `SELECT COALESCE(AVG(pf.actual_margin_percentage), 0) AS a
         FROM project_financials pf
         INNER JOIN projects p ON p.id = pf.project_id
         WHERE p.status = 'in_progress'`,
        [{ a: 0 }]
      ),
      getFunnelData(pool, pLeads),
      safeQuery(
        pool,
        `SELECT l.id, l.name, l.source, l.created_at,
                ps.name AS pipeline_stage_name, ps.id AS stage_id, ps.slug AS pipeline_stage_slug
         FROM leads l
         LEFT JOIN pipeline_stages ps ON ps.id = l.pipeline_stage_id
         ORDER BY l.created_at DESC
         LIMIT 5`,
        []
      ),
      safeQuery(
        pool,
        `SELECT v.scheduled_at, v.status, l.name AS client_name, l.id AS lead_id
         FROM visits v
         INNER JOIN leads l ON l.id = v.lead_id
         WHERE DATE(v.scheduled_at) = CURDATE()
         ORDER BY v.scheduled_at ASC`,
        []
      ),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c FROM proposals pr
         WHERE pr.status IN ('draft', 'sent', 'viewed')
           AND pr.created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
           AND pr.status NOT IN ('accepted', 'rejected')`,
        [{ c: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c FROM proposals pr
         WHERE pr.status = 'sent'
           AND COALESCE(pr.sent_at, pr.updated_at) < DATE_SUB(NOW(), INTERVAL 14 DAY)
           AND pr.status NOT IN ('accepted', 'rejected')`,
        [{ c: 0 }]
      ),
      // Sem coluna confirmed_at no schema legado: contamos visitas de hoje ainda "scheduled".
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c FROM visits v
         WHERE DATE(v.scheduled_at) = CURDATE()
           AND v.status = 'scheduled'`,
        [{ c: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT id, name, email, phone, created_at FROM leads
         WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 MINUTE)
         ORDER BY created_at DESC`,
        []
      ),
      safeQuery(
        pool,
        `SELECT v.id, v.scheduled_at, v.status,
                l.name AS lead_name, c.name AS customer_name, p.name AS project_name
         FROM visits v
         LEFT JOIN leads l ON v.lead_id = l.id
         LEFT JOIN customers c ON v.customer_id = c.id
         LEFT JOIN projects p ON v.project_id = p.id
         WHERE v.scheduled_at >= NOW() AND v.scheduled_at <= DATE_ADD(NOW(), INTERVAL 7 DAY)
         ORDER BY v.scheduled_at ASC
         LIMIT 10`,
        []
      ),
      safeQuery(pool, `SELECT COUNT(*) AS c FROM leads WHERE pipeline_stage_id IS NULL`, [{ c: 0 }]),
      queryLeadsBySource(pool, pLeads),
      safeQuery(
        pool,
        `SELECT LOWER(TRIM(e.status)) AS status, COUNT(*) AS count,
           COALESCE(SUM(CASE WHEN e.final_price IS NOT NULL AND e.final_price > 0 THEN e.final_price ELSE 0 END), 0) AS total_value
         FROM estimates e
         WHERE ${pEstCreated}
         GROUP BY LOWER(TRIM(e.status))`,
        []
      ),
      safeQuery(
        pool,
        `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month,
                COUNT(*) AS deals_count,
                COALESCE(SUM(CASE WHEN final_price IS NOT NULL AND final_price > 0 THEN final_price ELSE 0 END), 0) AS revenue
         FROM estimates
         WHERE LOWER(TRIM(status)) = 'accepted'
           AND created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
         GROUP BY DATE_FORMAT(created_at, '%Y-%m')
         ORDER BY month ASC`,
        []
      ),
      queryRevenueByService(pool),
      safeQuery(
        pool,
        `SELECT DATE(l.created_at) AS day_key, COUNT(*) AS count
         FROM leads l
         WHERE l.created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
         GROUP BY DATE(l.created_at)
         ORDER BY day_key ASC`,
        []
      ),
      queryFollowupKpis(pool),
    ]);

    const lr = Number(firstRow(leadsReceived).c) || 0;
    const lnt = Number(firstRow(leadsNewToday).c) || 0;
    const cp = Number(firstRow(contactPending).c) || 0;
    const vs = Number(firstRow(visitsScheduled).c) || 0;
    const vc = Number(firstRow(visitsCompleted).c) || 0;
    const vt = Number(firstRow(visitsToday).c) || 0;
    const psent = Number(firstRow(proposalsSent).c) || 0;
    const lip = Number(firstRow(leadsInProposal).c) || 0;
    const po = firstRow(proposalsOpen);
    const proposalsOpenCount = toFiniteNumber(po.cnt);
    const proposalsOpenValue = toFiniteNumber(po.val);
    const cwc = Number(firstRow(closedWon).c) || 0;
    const cwv = toFiniteNumber(firstRow(closedWonValue).s);
    const clc = Number(firstRow(closedLost).c) || 0;
    const iprod = Number(firstRow(inProduction).c) || 0;

    const fPending = followupKpis?.pending ?? 0;
    const fOverdue = followupKpis?.overdue ?? 0;
    const fDueToday = followupKpis?.due_today ?? 0;

    const denomL = Number(firstRow(convLeadsTotal).c) || 0;
    const numLV = Number(firstRow(convLeadsReachedVisit).c) || 0;
    const leadToVisit = denomL > 0 ? Math.round((numLV / denomL) * 1000) / 10 : 0;

    const denomVisit = Number(firstRow(visitsCompletedPeriod).c) || 0;
    const numVP = Number(firstRow(visitsWithProposal).c) || 0;
    const visitToProposal = denomVisit > 0 ? Math.round((numVP / denomVisit) * 1000) / 10 : 0;

    const wlr = firstRow(propWinWinsLosses);
    const winCount = toFiniteNumber(wlr.wins);
    const lossCount = toFiniteNumber(wlr.losses);
    let denWin = winCount + lossCount;
    if (denWin === 0) denWin = Math.max(psent, lip, 1);
    const proposalWin =
      denWin > 0 ? Math.min(100, Math.round((winCount / denWin) * 1000) / 10) : 0;

    const avgRow = firstRow(avgDeal);
    const quoteSum = toFiniteNumber(avgRow.s);
    const quoteCnt = Number(avgRow.c) || 0;
    const avgDealVal =
      quoteCnt > 0 ? Math.round((quoteSum / quoteCnt) * 100) / 100 : 0;

    const revM = toFiniteNumber(firstRow(revenueMonth).s);
    const revP = toFiniteNumber(firstRow(revenueProjected).s);
    const expM = toFiniteNumber(firstRow(expensesMonth).s);
    const profitM = Math.round((revM - expM) * 100) / 100;
    const avgMarg = Math.round(toFiniteNumber(firstRow(avgMargin).a) * 10) / 10;

    const alerts = [];
    if (cp > 0) {
      alerts.push({
        type: 'warning',
        message: 'Leads sem primeiro contato há mais de 24h',
        count: cp,
        action_url: '/leads?filter=no_contact',
      });
    }
    if (Number(firstRow(visitsTodayUnconfirmed).c) > 0) {
      const n = Number(firstRow(visitsTodayUnconfirmed).c) || 0;
      alerts.push({
        type: 'info',
        message: 'Visitas agendadas para hoje (pendentes)',
        count: n,
        action_url: '/schedule',
      });
    }
    const sop = Number(firstRow(staleOpenProposals).c) || 0;
    if (sop > 0) {
      alerts.push({
        type: 'warning',
        message: 'Propostas em aberto há mais de 7 dias',
        count: sop,
        action_url: '/crm',
      });
    }
    const ssp = Number(firstRow(staleSentProposals).c) || 0;
    if (ssp > 0) {
      alerts.push({
        type: 'danger',
        message: 'Propostas enviadas há mais de 14 dias sem resposta',
        count: ssp,
        action_url: '/crm',
      });
    }

    const pipelineFunnel = (funnelRows || []).map((row) => ({
      stage_id: row.stage_id,
      stage_key: row.stage_key || row.slug,
      stage_name: row.stage_name,
      slug: row.slug || row.stage_key,
      count: Number(row.cnt) || 0,
      value: 0,
    }));

    const orphanLeads = Number(firstRow(orphanLeadsCount).c) || 0;

    const charts = {
      leads_by_source: (leadsBySourceRows || []).map((r) => ({
        source: r.source != null ? String(r.source) : 'direct',
        count: Number(r.count) || 0,
      })),
      proposals_by_status: (estimatesByStatusRows || []).map((r) => ({
        status: r.status != null ? String(r.status) : 'unknown',
        count: Number(r.count) || 0,
        total_value: Math.round(toFiniteNumber(r.total_value) * 100) / 100,
      })),
      monthly_revenue: (monthlyRevenueRows || []).map((r) => ({
        month: r.month != null ? String(r.month) : '',
        deals_count: Number(r.deals_count) || 0,
        revenue: Math.round(toFiniteNumber(r.revenue) * 100) / 100,
      })),
      revenue_by_service: revenueByServiceData || {
        supply: 0,
        installation: 0,
        sand_finish: 0,
        total: 0,
      },
      pipeline_funnel: pipelineFunnel,
      leads_trend_7d: (leadsTrendRows || []).map((r) => ({
        day_key: r.day_key != null ? String(r.day_key).slice(0, 10) : '',
        count: Number(r.count) || 0,
      })),
    };

    const now = Date.now();
    const recent_leads = (recentLeadsRows || []).map((l) => ({
      id: l.id,
      name: l.name,
      pipeline_stage: l.pipeline_stage_name || '—',
      stage_id: l.stage_id,
      slug: l.pipeline_stage_slug,
      source: l.source || '—',
      time_ago: timeAgoLabel(l.created_at, now),
      created_at: l.created_at,
    }));

    const visits_today_detail = (visitsTodayList || []).map((v) => ({
      scheduled_at: v.scheduled_at,
      status: v.status,
      client_name: v.client_name,
      lead_id: v.lead_id,
    }));

    const new_leads_urgent = newLeadsUrgent || [];
    const new_leads_urgent_count = new_leads_urgent.length;

    return res.json({
      success: true,
      period,
      generated_at: new Date().toISOString(),
      pipeline: {
        leads_received: lr,
        leads_new_today: lnt,
        contact_pending: cp,
        visits_scheduled: vs,
        visits_completed: vc,
        visits_today: vt,
        leads_in_proposal: lip,
        proposals_sent: psent,
        proposals_open_count: proposalsOpenCount,
        proposals_open_value: Math.round(proposalsOpenValue * 100) / 100,
        closed_won_count: cwc,
        closed_won_value: Math.round(cwv * 100) / 100,
        closed_lost_count: clc,
        in_production: iprod,
        followups_pending: fPending,
        followups_overdue: fOverdue,
        followups_due_today: fDueToday,
      },
      conversion: {
        lead_to_visit_rate: leadToVisit,
        visit_to_proposal_rate: visitToProposal,
        proposal_win_rate: proposalWin,
        proposal_wins: winCount,
        proposal_losses: lossCount,
        avg_deal_value: Math.round(avgDealVal * 100) / 100,
        avg_ticket_quotes_count: quoteCnt,
        avg_ticket_quotes_total: Math.round(quoteSum * 100) / 100,
      },
      financial: {
        revenue_month: Math.round(revM * 100) / 100,
        revenue_projected: Math.round(revP * 100) / 100,
        expenses_month: Math.round(expM * 100) / 100,
        profit_month: profitM,
        avg_margin: avgMarg,
      },
      alerts,
      recent_leads,
      pipeline_funnel: pipelineFunnel,
      orphan_leads_count: orphanLeads,
      charts,
      visits_today_detail,
      new_leads_urgent,
      new_leads_urgent_count,
      upcoming_visits: upcomingVisits || [],
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Internal error' });
  }
}

/**
 * GET /api/dashboard/debug — agregados brutos por tabela (quotes, proposals, estimates, pipeline).
 * Ative no servidor: DASHBOARD_DEBUG=1. Desative em produção quando não precisar.
 */
export async function getDashboardDebug(req, res) {
  if (process.env.DASHBOARD_DEBUG !== '1') {
    return res.status(404).json({
      success: false,
      error: 'Endpoint desligado. Defina DASHBOARD_DEBUG=1 no ambiente para inspecionar agregados.',
    });
  }
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const run = async (sql) => {
      try {
        const [rows] = await pool.query(sql);
        return { ok: true, rows };
      } catch (e) {
        if (isNoSuchTableError(e)) {
          return { ok: false, error: 'no_such_table', message: e.message };
        }
        throw e;
      }
    };

    const [estimates, proposals, quotes, pipeline] = await Promise.all([
      run(
        `SELECT status, COUNT(*) AS n,
                COALESCE(SUM(CASE WHEN final_price IS NOT NULL AND final_price > 0 THEN final_price ELSE 0 END), 0) AS total
         FROM estimates GROUP BY status ORDER BY status`
      ),
      run(
        `SELECT status, COUNT(*) AS n,
                COALESCE(SUM(CASE WHEN total_value IS NOT NULL AND total_value > 0 THEN total_value ELSE 0 END), 0) AS total
         FROM proposals GROUP BY status ORDER BY status`
      ),
      run(
        `SELECT status, COUNT(*) AS n,
                COALESCE(SUM(${quoteEffectiveAmountExpr('q')}), 0) AS total
         FROM quotes GROUP BY status ORDER BY status`
      ),
      run(
        `SELECT ps.slug AS stage_slug, COUNT(*) AS n
         FROM leads l
         INNER JOIN pipeline_stages ps ON ps.id = l.pipeline_stage_id
         GROUP BY ps.slug ORDER BY ps.slug`
      ),
    ]);

    return res.json({
      success: true,
      generated_at: new Date().toISOString(),
      estimates,
      proposals,
      quotes,
      pipeline_stages: pipeline,
    });
  } catch (e) {
    console.error('getDashboardDebug:', e);
    return res.status(500).json({ success: false, error: e.message || 'Internal error' });
  }
}

function timeAgoLabel(iso, nowMs) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const sec = Math.floor((nowMs - t) / 1000);
  if (sec < 60) return `há ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d} dias`;
}
