/**
 * Marketing module — métricas, ad_spend, metas, campanhas, import CSV/XLSX.
 * Rotas montadas em /api/marketing (ver index.js).
 *
 * Atribuição “real” (CPL/CPA vs UTMs): quando utm_campaign nos leads não bate
 * campaign_name em ad_spend ou utm_source não alinha à plataforma, os JOINs
 * retornam 0 — use metas e KPIs agregados como referência principal.
 */
import express from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { getDBConnection, isDatabaseConfigured } from '../config/db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const router = express.Router();
router.use(requireAuth);
router.use(requirePermission('reports.view'));

const PERIODS = new Set(['month', 'quarter', 'year']);
const PLATFORMS = new Set(['google_ads', 'meta', 'instagram', 'tiktok', 'other']);

const PLATFORM_LABELS = {
  google_ads: 'Google Ads',
  meta: 'Meta',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  other: 'Outras',
};

function safeDivide(a, b) {
  const x = Number(a) || 0;
  const y = Number(b) || 0;
  if (y <= 0) return 0;
  const r = x / y;
  return Number.isFinite(r) ? r : 0;
}

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function round2(x) {
  return Math.round(num(x) * 100) / 100;
}

function parseDate(s, fallback) {
  if (!s || typeof s !== 'string') return fallback;
  const d = s.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return fallback;
  return d;
}

function toYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Mês / trimestre / ano civil corrente; fim = hoje quando o período ainda não terminou. */
function calendarRangeForPeriod(period) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const y = today.getFullYear();
  const m = today.getMonth();

  let startD;
  let endD;

  if (period === 'month') {
    startD = new Date(y, m, 1);
    const lastOfMonth = new Date(y, m + 1, 0);
    endD = lastOfMonth.getTime() < today.getTime() ? lastOfMonth : today;
  } else if (period === 'quarter') {
    const q0 = Math.floor(m / 3) * 3;
    startD = new Date(y, q0, 1);
    const lastOfQ = new Date(y, q0 + 3, 0);
    endD = lastOfQ.getTime() < today.getTime() ? lastOfQ : today;
  } else {
    startD = new Date(y, 0, 1);
    const lastOfYear = new Date(y, 11, 31);
    endD = lastOfYear.getTime() < today.getTime() ? lastOfYear : today;
  }

  return { start: toYMD(startD), end: toYMD(endD) };
}

/** Clausula SQL: linhas ad_spend ativas sobrepostas ao intervalo [start,end]. */
function adSpendOverlapWhere(alias = 'a') {
  const p = `${alias}`;
  return `(
    ${p}.deleted_at IS NULL
    AND (
      (${p}.period_start IS NOT NULL AND ${p}.period_end IS NOT NULL
        AND ${p}.period_start <= ? AND ${p}.period_end >= ?)
      OR (
        (${p}.period_start IS NULL OR ${p}.period_end IS NULL)
        AND ${p}.spend_date IS NOT NULL
        AND ${p}.spend_date >= ? AND ${p}.spend_date <= ?
      )
    )
  )`;
}

function adSpendOverlapParams(start, end) {
  return [end, start, start, end];
}

async function tableExists(pool, name) {
  const [t] = await pool.query('SHOW TABLES LIKE ?', [name]);
  return t && t.length > 0;
}

function isUnknownColumnError(e) {
  if (!e) return false;
  const msg = String(e.sqlMessage || e.message || '');
  return (
    e.code === 'ER_BAD_FIELD_ERROR' ||
    e.errno === 1054 ||
    /unknown column/i.test(msg)
  );
}

function isMissingTableError(e) {
  if (!e) return false;
  const msg = String(e.sqlMessage || e.message || '');
  return e.code === 'ER_NO_SUCH_TABLE' || e.errno === 1146 || /doesn't exist/i.test(msg);
}

/** Resposta válida para o SPA quando o esquema de marketing ainda não foi migrado. */
function emptyMarketingStatsPayload(period, start, end, setupMessage) {
  return {
    period,
    date_range: { start, end },
    summary: {
      total_spend: 0,
      total_impressions: 0,
      total_clicks: 0,
      total_leads: 0,
      total_conversions: 0,
      total_revenue_attributed: 0,
      closed_won_count: 0,
      closed_won_value: 0,
    },
    kpis: {
      cpc: 0,
      cpl: 0,
      cpa: 0,
      roas: 0,
      ctr: 0,
      conversion_rate: 0,
      avg_order_value: 0,
    },
    by_platform: [],
    by_campaign: [],
    leads_by_source: [],
    monthly_trend: [],
    goals: {
      exists: false,
      budget_limit: null,
      budget_used: 0,
      budget_pct: 0,
      goal_leads: null,
      leads_current: 0,
      leads_pct: 0,
      goal_cpl_max: null,
      cpl_current: 0,
      cpl_status: 'ok',
      goal_roas_min: null,
      roas_current: 0,
      roas_status: 'ok',
      goal_cpa_max: null,
      cpa_current: 0,
      cpa_status: 'ok',
    },
    attribution: {
      matched_leads_in_period: 0,
      note: 'Execute as migrações de marketing na base de dados para ver atribuição e KPIs.',
    },
    setup_required: true,
    setup_message: setupMessage,
  };
}

function platformSourceMatchSql(alias = 'a') {
  const a = alias;
  return `(
    (${a}.platform = 'google_ads' AND (
      LOWER(COALESCE(l.utm_source,'')) LIKE '%google%'
      OR LOWER(COALESCE(l.marketing_platform,'')) LIKE '%google%'
    ))
    OR (${a}.platform = 'meta' AND (
      LOWER(COALESCE(l.utm_source,'')) REGEXP 'facebook|meta|fb'
      OR LOWER(COALESCE(l.marketing_platform,'')) REGEXP 'facebook|meta'
    ))
    OR (${a}.platform = 'instagram' AND (
      LOWER(COALESCE(l.utm_source,'')) LIKE '%instagram%'
      OR LOWER(COALESCE(l.utm_source,'')) LIKE '%ig%'
      OR LOWER(COALESCE(l.marketing_platform,'')) LIKE '%instagram%'
    ))
    OR (${a}.platform = 'tiktok' AND (
      LOWER(COALESCE(l.utm_source,'')) LIKE '%tiktok%'
      OR LOWER(COALESCE(l.marketing_platform,'')) LIKE '%tiktok%'
    ))
    OR (${a}.platform = 'other')
  )`;
}

function goalStatusCpl(current, maxV) {
  if (maxV == null || maxV <= 0) return 'ok';
  if (current <= maxV) return 'ok';
  if (current <= maxV * 1.1) return 'warning';
  return 'danger';
}

function goalStatusRoas(current, minV) {
  if (minV == null || minV <= 0) return 'ok';
  if (current >= minV) return 'ok';
  if (current >= minV * 0.85) return 'warning';
  return 'danger';
}

function goalStatusCpa(current, maxV) {
  if (maxV == null || maxV <= 0) return 'ok';
  if (current <= maxV) return 'ok';
  if (current <= maxV * 1.1) return 'warning';
  return 'danger';
}

/** ─── GET /metrics (legado dashboard) ─── */
router.get('/metrics', async (req, res) => {
  if (!isDatabaseConfigured()) return res.status(503).json({ success: false, error: 'Database not configured' });
  const end = parseDate(req.query.end_date, new Date().toISOString().slice(0, 10));
  const start = parseDate(req.query.start_date, end);
  const utmCampaign = (req.query.utm_campaign || '').trim() || null;
  const platform = (req.query.marketing_platform || req.query.platform || '').trim() || null;
  const sourceFilter = (req.query.source || '').trim() || null;

  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database unavailable' });

    const leadFilters = ['l.created_at >= ?', 'l.created_at < DATE_ADD(?, INTERVAL 1 DAY)'];
    const leadParams = [start, end];
    if (utmCampaign) {
      leadFilters.push('l.utm_campaign = ?');
      leadParams.push(utmCampaign);
    }
    if (platform) {
      leadFilters.push('l.marketing_platform = ?');
      leadParams.push(platform);
    }
    if (sourceFilter) {
      leadFilters.push('l.source = ?');
      leadParams.push(sourceFilter);
    }
    const leadWhere = leadFilters.join(' AND ');

    const attrFilters = [];
    const attrParams = [];
    if (utmCampaign) {
      attrFilters.push('l.utm_campaign = ?');
      attrParams.push(utmCampaign);
    }
    if (platform) {
      attrFilters.push('l.marketing_platform = ?');
      attrParams.push(platform);
    }
    if (sourceFilter) {
      attrFilters.push('l.source = ?');
      attrParams.push(sourceFilter);
    }
    const attrWhere = attrFilters.length ? attrFilters.join(' AND ') : null;

    const [[{ total_leads }]] = await pool.query(
      `SELECT COUNT(*) AS total_leads FROM leads l WHERE ${leadWhere}`,
      leadParams
    );

    let total_spend = 0;
    if (await tableExists(pool, 'ad_spend')) {
      const spendParts = [adSpendOverlapWhere('ad_spend')];
      const spendParams = [...adSpendOverlapParams(start, end)];
      if (platform) {
        spendParts.push('(ad_spend.platform = ? OR ad_spend.platform LIKE ?)');
        spendParams.push(platform, `%${platform}%`);
      }
      if (utmCampaign) {
        spendParts.push('(ad_spend.utm_campaign = ? OR ad_spend.campaign_name = ?)');
        spendParams.push(utmCampaign, utmCampaign);
      }
      const [[row]] = await pool.query(
        `SELECT COALESCE(SUM(ad_spend.spend), 0) AS s FROM ad_spend WHERE ${spendParts.join(' AND ')}`,
        spendParams
      );
      total_spend = Number(row.s) || 0;
    }

    const quoteWhere = ['q.created_at >= ?', 'q.created_at < DATE_ADD(?, INTERVAL 1 DAY)'];
    const quoteParams = [start, end];
    if (attrWhere) {
      quoteWhere.push(`q.lead_id IN (SELECT l.id FROM leads l WHERE ${attrWhere})`);
      quoteParams.push(...attrParams);
    }
    const [[{ total_quotes }]] = await pool.query(
      `SELECT COUNT(*) AS total_quotes FROM quotes q WHERE ${quoteWhere.join(' AND ')}`,
      quoteParams
    );

    const [[{ quotes_sent }]] = await pool.query(
      `SELECT COUNT(*) AS quotes_sent FROM quotes q WHERE ${quoteWhere.join(' AND ')} AND q.status IN ('sent','approved','accepted')`,
      quoteParams
    );

    let dealWhere = ['c.created_at >= ?', 'c.created_at < DATE_ADD(?, INTERVAL 1 DAY)', 'c.closed_amount > 0'];
    const dealParams = [start, end];
    if (attrWhere) {
      dealWhere.push(`c.lead_id IN (SELECT l.id FROM leads l WHERE ${attrWhere})`);
      dealParams.push(...attrParams);
    }
    let total_deals = 0;
    let total_revenue = 0;
    if (await tableExists(pool, 'contracts')) {
      const [[d]] = await pool.query(
        `SELECT COUNT(*) AS n, COALESCE(SUM(c.closed_amount), 0) AS rev FROM contracts c WHERE ${dealWhere.join(' AND ')}`,
        dealParams
      );
      total_deals = Number(d.n) || 0;
      total_revenue = Number(d.rev) || 0;
    }

    const leads = Number(total_leads) || 0;
    const cpl = leads > 0 && total_spend > 0 ? total_spend / leads : null;
    const cac = total_deals > 0 && total_spend > 0 ? total_spend / total_deals : null;
    const roi = total_spend > 0 ? total_revenue / total_spend : null;
    const quote_conv = total_quotes > 0 && leads > 0 ? total_quotes / leads : null;
    const lead_close = leads > 0 && total_deals > 0 ? total_deals / leads : null;
    const rpl = leads > 0 && total_revenue > 0 ? total_revenue / leads : null;
    const avg_ticket = total_deals > 0 ? total_revenue / total_deals : null;

    const funnelSlugs = [
      'new_lead',
      'meeting_scheduled',
      'quote_sent',
      'follow_up_1',
      'stand_by',
      'won',
      'lost',
    ];
    const funnel = [];
    for (const slug of funnelSlugs) {
      const f = ['l.created_at >= ?', 'l.created_at < DATE_ADD(?, INTERVAL 1 DAY)'];
      const p = [start, end];
      if (utmCampaign) {
        f.push('l.utm_campaign = ?');
        p.push(utmCampaign);
      }
      if (platform) {
        f.push('l.marketing_platform = ?');
        p.push(platform);
      }
      if (sourceFilter) {
        f.push('l.source = ?');
        p.push(sourceFilter);
      }
      f.push('(l.status = ? OR ps.slug = ?)');
      p.push(slug, slug);
      const [[{ n }]] = await pool.query(
        `SELECT COUNT(*) AS n FROM leads l
         LEFT JOIN pipeline_stages ps ON l.pipeline_stage_id = ps.id
         WHERE ${f.join(' AND ')}`,
        p
      );
      funnel.push({ stage: slug, count: Number(n) || 0 });
    }

    const [lot] = await pool.query(
      `SELECT DATE(l.created_at) AS d, COUNT(*) AS c FROM leads l WHERE ${leadWhere} GROUP BY DATE(l.created_at) ORDER BY d`,
      leadParams
    );

    let revenue_over_time = [];
    if (await tableExists(pool, 'contracts')) {
      const revPh = ['c.created_at >= ?', 'c.created_at < DATE_ADD(?, INTERVAL 1 DAY)', 'c.closed_amount > 0'];
      const revPa = [start, end];
      if (attrWhere) {
        revPh.push(`c.lead_id IN (SELECT l.id FROM leads l WHERE ${attrWhere})`);
        revPa.push(...attrParams);
      }
      const [rot] = await pool.query(
        `SELECT DATE(c.created_at) AS d, COALESCE(SUM(c.closed_amount), 0) AS rev
         FROM contracts c WHERE ${revPh.join(' AND ')}
         GROUP BY DATE(c.created_at) ORDER BY d`,
        revPa
      );
      revenue_over_time = rot;
    }

    let revenue_by_campaign = [];
    try {
      const [rbc] = await pool.query(
        `SELECT COALESCE(NULLIF(TRIM(l.utm_campaign), ''), '(sem campanha)') AS campaign,
                COALESCE(SUM(c.closed_amount), 0) AS revenue,
                COUNT(DISTINCT c.id) AS deals
         FROM contracts c
         INNER JOIN leads l ON c.lead_id = l.id
         WHERE c.created_at >= ? AND c.created_at < DATE_ADD(?, INTERVAL 1 DAY) AND c.closed_amount > 0
         GROUP BY campaign ORDER BY revenue DESC LIMIT 25`,
        [start, end]
      );
      revenue_by_campaign = rbc;
    } catch (_) {}

    res.json({
      success: true,
      data: {
        period: { start, end },
        filters: { utm_campaign: utmCampaign, marketing_platform: platform, source: sourceFilter },
        kpis: {
          total_spend,
          total_leads: leads,
          total_quotes: Number(total_quotes) || 0,
          quotes_sent: Number(quotes_sent) || 0,
          total_deals,
          total_revenue,
          cpl,
          cac,
          roi,
          quote_conversion_rate: quote_conv,
          lead_to_close_rate: lead_close,
          revenue_per_lead: rpl,
          avg_deal_value: avg_ticket,
        },
        funnel,
        leads_over_time: lot,
        revenue_over_time,
        revenue_by_campaign,
      },
    });
  } catch (e) {
    console.error('getMarketingMetrics', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

/** ─── GET /stats ─── */
router.get('/stats', async (req, res) => {
  if (!isDatabaseConfigured()) return res.status(503).json({ error: 'Database not configured' });
  const period = PERIODS.has(String(req.query.period || '').toLowerCase())
    ? String(req.query.period).toLowerCase()
    : 'month';
  const { start, end } = calendarRangeForPeriod(period);

  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });

    const hasAd = await tableExists(pool, 'ad_spend');
    const hasGoals = await tableExists(pool, 'marketing_goals');
    const hasProposals = await tableExists(pool, 'proposals');

    const overlap = adSpendOverlapWhere('a');
    const ovParams = adSpendOverlapParams(start, end);

    const leadStart = `${start} 00:00:00`;
    const leadEndNext = `${end} 23:59:59`;

    const p1 = hasAd
      ? pool.query(
          `SELECT a.platform,
              COALESCE(SUM(a.spend),0) AS spend,
              COALESCE(SUM(a.clicks),0) AS clicks,
              COALESCE(SUM(a.impressions),0) AS impressions,
              COALESCE(SUM(a.conversions),0) AS conversions,
              COALESCE(SUM(a.conversion_value),0) AS conversion_value
           FROM ad_spend a WHERE ${overlap}
           GROUP BY a.platform`,
          ovParams
        )
      : Promise.resolve([[]]);

    const p2 = pool.query(
      `SELECT COALESCE(NULLIF(TRIM(utm_source), ''), NULLIF(TRIM(source), ''), '(unknown)') AS src,
              COUNT(*) AS cnt
       FROM leads
       WHERE created_at >= ? AND created_at <= ?
       GROUP BY src ORDER BY cnt DESC`,
      [leadStart, leadEndNext]
    );

    const p3 = hasProposals
      ? pool.query(
          `SELECT COUNT(*) AS n, COALESCE(SUM(total_value),0) AS val
           FROM proposals
           WHERE status = 'accepted'
             AND DATE(COALESCE(accepted_at, updated_at, created_at)) >= ?
             AND DATE(COALESCE(accepted_at, updated_at, created_at)) <= ?`,
          [start, end]
        )
      : Promise.resolve([[{ n: 0, val: 0 }]]);

    const p4 = hasAd
      ? pool.query(
          `SELECT a.campaign_name, a.platform,
              COALESCE(SUM(a.spend),0) AS spend,
              COALESCE(SUM(a.clicks),0) AS clicks,
              COALESCE(SUM(a.impressions),0) AS impressions,
              COALESCE(SUM(a.conversions),0) AS conversions,
              COALESCE(SUM(a.conversion_value),0) AS conversion_value
           FROM ad_spend a WHERE ${overlap}
           GROUP BY a.campaign_name, a.platform
           ORDER BY spend DESC LIMIT 50`,
          ovParams
        )
      : Promise.resolve([[]]);

    const firstOfMonth = () => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    };
    const monthFirst = firstOfMonth();

    const p5 = hasGoals
      ? pool.query(
          `SELECT * FROM marketing_goals WHERE month = ? AND platform = 'all' LIMIT 1`,
          [monthFirst]
        )
      : Promise.resolve([[]]);

    const p6 = hasAd
      ? pool.query(
          `SELECT COALESCE(SUM(a.spend),0) AS s FROM ad_spend a
           WHERE a.deleted_at IS NULL AND (
             (a.period_start IS NOT NULL AND a.period_end IS NOT NULL
               AND a.period_start <= LAST_DAY(CURDATE()) AND a.period_end >= DATE_FORMAT(CURDATE(), '%Y-%m-01'))
             OR (
               (a.period_start IS NULL OR a.period_end IS NULL) AND a.spend_date IS NOT NULL
               AND YEAR(a.spend_date) = YEAR(CURDATE()) AND MONTH(a.spend_date) = MONTH(CURDATE())
             )
           )`,
          []
        )
      : Promise.resolve([[{ s: 0 }]]);

    const monthlyTrendPromises = [];
    for (let i = 5; i >= 0; i--) {
      const ref = new Date();
      ref.setDate(1);
      ref.setMonth(ref.getMonth() - i);
      const y = ref.getFullYear();
      const m = ref.getMonth();
      const ms = `${y}-${String(m + 1).padStart(2, '0')}-01`;
      const me = new Date(y, m + 1, 0);
      const meStr = toYMD(me);
      const mParams = adSpendOverlapParams(ms, meStr);
      monthlyTrendPromises.push(
        (async () => {
          let spend = 0;
          let convVal = 0;
          if (hasAd) {
            const [[r]] = await pool.query(
              `SELECT COALESCE(SUM(a.spend),0) AS sp, COALESCE(SUM(a.conversion_value),0) AS cv
               FROM ad_spend a WHERE ${adSpendOverlapWhere('a')}`,
              mParams
            );
            spend = num(r.sp);
            convVal = num(r.cv);
          }
          const [[l]] = await pool.query(
            `SELECT COUNT(*) AS c FROM leads
             WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)`,
            [ms, meStr]
          );
          const leadC = num(l.c);
          let rev = 0;
          let closedN = 0;
          if (hasProposals) {
            const [[pr]] = await pool.query(
              `SELECT COUNT(*) AS n, COALESCE(SUM(total_value),0) AS val FROM proposals
               WHERE status = 'accepted'
                 AND DATE(COALESCE(accepted_at, updated_at, created_at)) >= ?
                 AND DATE(COALESCE(accepted_at, updated_at, created_at)) <= ?`,
              [ms, meStr]
            );
            rev = num(pr.val);
            closedN = num(pr.n);
          }
          const cplM = safeDivide(spend, leadC);
          const roasM = safeDivide(convVal, spend);
          return {
            month: ms.slice(0, 7),
            month_label: ref.toLocaleString('en-US', { month: 'short', year: 'numeric' }),
            spend: round2(spend),
            leads: leadC,
            cpl: round2(cplM),
            revenue: round2(rev),
            roas: round2(roasM),
            closed_won: closedN,
          };
        })()
      );
    }

    const pAttr = hasAd
      ? pool.query(
          `SELECT COUNT(DISTINCT l.id) AS n
           FROM leads l
           INNER JOIN ad_spend a ON a.deleted_at IS NULL
             AND (
               (a.period_start IS NOT NULL AND a.period_end IS NOT NULL
                 AND a.period_start <= ? AND a.period_end >= ?)
               OR (
                 (a.period_start IS NULL OR a.period_end IS NULL)
                 AND a.spend_date IS NOT NULL AND a.spend_date >= ? AND a.spend_date <= ?
               )
             )
             AND TRIM(COALESCE(l.utm_campaign,'')) = TRIM(a.campaign_name)
             AND ${platformSourceMatchSql('a')}
           WHERE l.created_at >= ? AND l.created_at <= ?`,
          [...ovParams, leadStart, leadEndNext]
        )
      : Promise.resolve([[{ n: 0 }]]);

    const pLeadsCalMonth = pool.query(
      `SELECT COUNT(*) AS c FROM leads
       WHERE created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
         AND created_at < DATE_ADD(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 MONTH)`
    );

    const [
      [byPlatRows],
      [leadSrcRows],
      [propRows],
      [byCampRows],
      [goalRows],
      [budgetRows],
      [attrRows],
      [leadsMonthRows],
    ] = await Promise.all([p1, p2, p3, p4, p5, p6, pAttr, pLeadsCalMonth]);

    const monthly_trend = await Promise.all(monthlyTrendPromises);

    const by_platform = (byPlatRows || []).map((r) => ({
      platform: r.platform,
      label: PLATFORM_LABELS[r.platform] || String(r.platform || 'other'),
      spend: round2(r.spend),
      clicks: num(r.clicks),
      impressions: num(r.impressions),
      conversions: num(r.conversions),
      platform_leads: num(r.conversions),
      conversion_value: round2(r.conversion_value),
      cpc: round2(safeDivide(r.spend, r.clicks)),
      cpl: round2(safeDivide(r.spend, r.conversions)),
      roas: round2(safeDivide(r.conversion_value, r.spend)),
      ctr: round2(safeDivide(num(r.clicks), num(r.impressions)) * 100),
      spend_share: 0,
    }));

    const total_spend = by_platform.reduce((s, x) => s + x.spend, 0);
    for (const row of by_platform) {
      row.spend_share = round2(safeDivide(row.spend, total_spend) * 100);
    }
    const total_clicks = by_platform.reduce((s, x) => s + x.clicks, 0);
    const total_impressions = by_platform.reduce((s, x) => s + x.impressions, 0);
    const total_conversions = by_platform.reduce((s, x) => s + x.conversions, 0);
    const total_revenue_attributed = by_platform.reduce((s, x) => s + x.conversion_value, 0);

    const total_leads = (leadSrcRows || []).reduce((s, r) => s + num(r.cnt), 0);
    const pr = (propRows && propRows[0]) || { n: 0, val: 0 };
    const closed_won_count = num(pr.n);
    const closed_won_value = round2(pr.val);

    const kpis = {
      cpc: round2(safeDivide(total_spend, total_clicks)),
      /* CPL = spend / conversões reportadas em ad_spend (não leads CRM). Sem conversões → 0. */
      cpl: round2(safeDivide(total_spend, total_conversions)),
      cpa: round2(safeDivide(total_spend, closed_won_count)),
      roas: round2(safeDivide(total_revenue_attributed, total_spend)),
      ctr: round2(safeDivide(total_clicks, total_impressions) * 100),
      conversion_rate: round2(safeDivide(total_conversions, total_clicks) * 100),
      avg_order_value: round2(safeDivide(total_revenue_attributed, total_conversions)),
    };

    const by_campaign = (byCampRows || []).map((r) => ({
      campaign_name: r.campaign_name,
      platform: r.platform,
      platform_label: PLATFORM_LABELS[r.platform] || String(r.platform || ''),
      spend: round2(r.spend),
      clicks: num(r.clicks),
      impressions: num(r.impressions),
      conversions: num(r.conversions),
      conversion_value: round2(r.conversion_value),
      cpl: round2(safeDivide(r.spend, r.conversions)),
      roas: round2(safeDivide(r.conversion_value, r.spend)),
      status: 'active',
    }));

    const srcList = leadSrcRows || [];
    const totalLeadsSrc = srcList.reduce((s, r) => s + num(r.cnt), 0);
    const leads_by_source = srcList.slice(0, 50).map((r) => ({
      source: r.src,
      count: num(r.cnt),
      percentage: round2(safeDivide(num(r.cnt), totalLeadsSrc) * 100),
    }));

    const goal = goalRows && goalRows[0];
    let budget_used = 0;
    if (budgetRows && budgetRows[0]) budget_used = num(budgetRows[0].s);
    const attributed_leads = num((attrRows && attrRows[0] && attrRows[0].n) || 0);
    const leads_calendar_month = num((leadsMonthRows && leadsMonthRows[0] && leadsMonthRows[0].c) || 0);

    let goalsPayload = {
      exists: false,
      budget_limit: null,
      budget_used: round2(budget_used),
      budget_pct: 0,
      goal_leads: null,
      leads_current: leads_calendar_month,
      leads_pct: 0,
      goal_cpl_max: null,
      cpl_current: kpis.cpl,
      cpl_status: 'ok',
      goal_roas_min: null,
      roas_current: kpis.roas,
      roas_status: 'ok',
      goal_cpa_max: null,
      cpa_current: kpis.cpa,
      cpa_status: 'ok',
    };

    if (goal) {
      const gl = goal.goal_leads != null ? num(goal.goal_leads) : null;
      const bl = goal.budget_limit != null ? num(goal.budget_limit) : null;
      goalsPayload = {
        exists: true,
        budget_limit: bl != null ? round2(bl) : null,
        budget_used: round2(budget_used),
        budget_pct: bl && bl > 0 ? round2(safeDivide(budget_used, bl) * 100) : 0,
        goal_leads: gl,
        leads_current: leads_calendar_month,
        leads_pct: gl && gl > 0 ? round2(safeDivide(leads_calendar_month, gl) * 100) : 0,
        goal_cpl_max: goal.goal_cpl_max != null ? round2(num(goal.goal_cpl_max)) : null,
        cpl_current: kpis.cpl,
        cpl_status: goalStatusCpl(kpis.cpl, num(goal.goal_cpl_max)),
        goal_roas_min: goal.goal_roas_min != null ? round2(num(goal.goal_roas_min)) : null,
        roas_current: kpis.roas,
        roas_status: goalStatusRoas(kpis.roas, num(goal.goal_roas_min)),
        goal_cpa_max: goal.goal_cpa_max != null ? round2(num(goal.goal_cpa_max)) : null,
        cpa_current: kpis.cpa,
        cpa_status: goalStatusCpa(kpis.cpa, num(goal.goal_cpa_max)),
      };
    }

    res.json({
      period,
      date_range: { start, end },
      summary: {
        total_spend: round2(total_spend),
        total_impressions: total_impressions,
        total_clicks: total_clicks,
        total_leads: total_leads,
        total_conversions: total_conversions,
        total_revenue_attributed: round2(total_revenue_attributed),
        closed_won_count,
        closed_won_value,
      },
      kpis,
      by_platform,
      by_campaign,
      leads_by_source,
      monthly_trend,
      goals: goalsPayload,
      attribution: {
        matched_leads_in_period: attributed_leads,
        note:
          attributed_leads === 0
            ? 'Nenhum lead cruzou utm_campaign com campaign_name de ad_spend e utm_source compatível com a plataforma no período.'
            : 'Leads com utm_campaign = campaign_name e utm_source alinhado à plataforma do gasto.',
      },
    });
  } catch (e) {
    console.error('GET /marketing/stats', e);
    if (isMissingTableError(e)) {
      return res.status(200).json(
        emptyMarketingStatsPayload(
          period,
          start,
          end,
          'Faltam tabelas de marketing. Na Railway: railway ssh -s senior-floors-system -- npm run migrate:marketing-complete'
        )
      );
    }
    if (isUnknownColumnError(e)) {
      return res.status(200).json(
        emptyMarketingStatsPayload(
          period,
          start,
          end,
          'Faltam colunas em `leads` ou `ad_spend`. Corra: migrate:marketing-analytics e migrate:marketing-complete (npm run …).'
        )
      );
    }
    res.status(500).json({ error: e.message || 'Internal error' });
  }
});

/** ─── GET /ad-spend (paginado) ─── */
router.get('/ad-spend', async (req, res) => {
  if (!isDatabaseConfigured()) return res.status(503).json({ success: false, error: 'Database not configured' });
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const hasDateFilter = Boolean(
    (req.query.start || req.query.start_date || req.query.end || req.query.end_date || '').trim()
  );
  let limit = parseInt(req.query.limit, 10);
  if (!Number.isFinite(limit) || limit < 1) limit = hasDateFilter ? 500 : 20;
  limit = Math.min(500, Math.max(1, limit));
  const offset = (page - 1) * limit;
  const platform = (req.query.platform || '').trim();
  const start = (req.query.start || req.query.start_date || '').trim().slice(0, 10);
  const end = (req.query.end || req.query.end_date || '').trim().slice(0, 10);

  try {
    const pool = await getDBConnection();
    if (!(await tableExists(pool, 'ad_spend'))) {
      return res.json({ success: true, data: [], total: 0, page, limit, period_spend: 0 });
    }
    const where = ['(deleted_at IS NULL)'];
    const params = [];
    if (platform && PLATFORMS.has(platform)) {
      where.push('platform = ?');
      params.push(platform);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(start)) {
      where.push(
        `(
          (period_start IS NOT NULL AND period_end IS NOT NULL AND period_end >= ?)
          OR (spend_date IS NOT NULL AND spend_date >= ?)
        )`
      );
      params.push(start, start);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      where.push(
        `(
          (period_start IS NOT NULL AND period_end IS NOT NULL AND period_start <= ?)
          OR (spend_date IS NOT NULL AND spend_date <= ?)
        )`
      );
      params.push(end, end);
    }
    const w = where.join(' AND ');
    const [[{ c }]] = await pool.query(`SELECT COUNT(*) AS c FROM ad_spend WHERE ${w}`, params);
    let period_spend = 0;
    if (/^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
      const [[ps]] = await pool.query(`SELECT COALESCE(SUM(spend),0) AS s FROM ad_spend WHERE ${w}`, params);
      period_spend = round2(ps.s);
    }
    const [rows] = await pool.query(
      `SELECT * FROM ad_spend WHERE ${w} ORDER BY COALESCE(period_end, spend_date) DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({ success: true, data: rows, total: num(c), page, limit, period_spend });
  } catch (e) {
    console.error('listAdSpend', e);
    if (isMissingTableError(e) || isUnknownColumnError(e)) {
      return res.json({
        success: true,
        data: [],
        total: 0,
        page,
        limit,
        period_spend: 0,
        setup_required: true,
      });
    }
    res.status(500).json({ success: false, error: e.message });
  }
});

function normalizePlatformInput(p) {
  const s = String(p || '')
    .trim()
    .toLowerCase();
  if (PLATFORMS.has(s)) return s;
  if (s.includes('google')) return 'google_ads';
  if (s === 'facebook' || s.includes('meta')) return 'meta';
  if (s.includes('instagram') || s === 'ig') return 'instagram';
  if (s.includes('tiktok')) return 'tiktok';
  return 'other';
}

/** ─── POST /ad-spend ─── */
router.post('/ad-spend', async (req, res) => {
  if (!isDatabaseConfigured()) return res.status(503).json({ success: false, error: 'Database not configured' });
  const b = req.body || {};
  let platform = normalizePlatformInput(b.platform);
  const campaign_name = String(b.campaign_name || '').trim();
  let period_start = String(b.period_start || b.spend_date || '').slice(0, 10);
  let period_end = String(b.period_end || b.spend_date || '').slice(0, 10);
  const spend = num(b.spend);
  if (!campaign_name || !/^\d{4}-\d{2}-\d{2}$/.test(period_start) || !/^\d{4}-\d{2}-\d{2}$/.test(period_end)) {
    return res.status(400).json({
      success: false,
      error: 'platform, campaign_name, period_start/period_end ou spend_date (YYYY-MM-DD), spend required',
    });
  }
  const uid = req.session?.userId ? parseInt(req.session.userId, 10) : null;
  try {
    const pool = await getDBConnection();
    if (!(await tableExists(pool, 'ad_spend'))) {
      return res.status(400).json({ success: false, error: 'Rode npm run migrate:marketing-complete' });
    }
    const [r] = await pool.execute(
      `INSERT INTO ad_spend (
        platform, campaign_name, campaign_id, ad_set_name, ad_name,
        period_start, period_end, impressions, clicks, spend, conversions, conversion_value,
        reach, frequency, video_views, notes, import_source, created_by, utm_campaign, spend_date
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        platform,
        campaign_name.slice(0, 255),
        b.campaign_id ? String(b.campaign_id).slice(0, 100) : null,
        b.ad_set_name ? String(b.ad_set_name).slice(0, 255) : null,
        b.ad_name ? String(b.ad_name).slice(0, 255) : null,
        period_start,
        period_end,
        Math.max(0, parseInt(b.impressions, 10) || 0),
        Math.max(0, parseInt(b.clicks, 10) || 0),
        round2(spend),
        Math.max(0, parseInt(b.conversions, 10) || 0),
        round2(b.conversion_value),
        Math.max(0, parseInt(b.reach, 10) || 0),
        round2(b.frequency),
        Math.max(0, parseInt(b.video_views, 10) || 0),
        b.notes != null ? String(b.notes).slice(0, 5000) : null,
        'manual',
        uid,
        b.utm_campaign ? String(b.utm_campaign).slice(0, 255) : null,
        period_end,
      ]
    );
    res.status(201).json({ success: true, id: r.insertId });
  } catch (e) {
    console.error('createAdSpend', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

/** ─── PUT /ad-spend/:id ─── */
router.put('/ad-spend/:id', async (req, res) => {
  if (!isDatabaseConfigured()) return res.status(503).json({ success: false, error: 'Database not configured' });
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
  const b = req.body || {};
  const allowed = [
    'platform',
    'campaign_name',
    'campaign_id',
    'ad_set_name',
    'ad_name',
    'period_start',
    'period_end',
    'impressions',
    'clicks',
    'spend',
    'conversions',
    'conversion_value',
    'reach',
    'frequency',
    'video_views',
    'notes',
    'utm_campaign',
  ];
  const fields = [];
  const vals = [];
  for (const k of allowed) {
    if (b[k] === undefined) continue;
    if (k === 'platform' && !PLATFORMS.has(String(b[k]).trim())) continue;
    fields.push(`${k} = ?`);
    if (k === 'spend' || k === 'conversion_value' || k === 'frequency') vals.push(round2(b[k]));
    else if (['impressions', 'clicks', 'conversions', 'reach', 'video_views'].includes(k))
      vals.push(Math.max(0, parseInt(b[k], 10) || 0));
    else vals.push(b[k]);
  }
  if (!fields.length) return res.status(400).json({ success: false, error: 'No valid fields' });
  vals.push(id);
  try {
    const pool = await getDBConnection();
    await pool.execute(`UPDATE ad_spend SET ${fields.join(', ')} WHERE id = ? AND deleted_at IS NULL`, vals);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** ─── DELETE /ad-spend/:id (soft) ─── */
router.delete('/ad-spend/:id', async (req, res) => {
  if (!isDatabaseConfigured()) return res.status(503).json({ success: false, error: 'Database not configured' });
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
  try {
    const pool = await getDBConnection();
    await pool.execute('UPDATE ad_spend SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL', [id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

function normHeader(h) {
  return String(h || '')
    .toLowerCase()
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/\s+/g, ' ');
}

function pickIdx(headers, matchers) {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    for (const m of matchers) {
      if (typeof m === 'string' && h === m) return i;
      if (m instanceof RegExp && m.test(h)) return i;
    }
  }
  return -1;
}

function parseNum(v) {
  if (v == null || v === '') return 0;
  const s = String(v).replace(/[%$,]/g, '').replace(/^\((.*)\)$/, '-$1').trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

function parseRowGoogle(headers, cells) {
  const H = headers.map(normHeader);
  const idx = (patterns) => pickIdx(H, patterns);
  const campaign = idx([/^campaign$/i, 'campaign']);
  const clicks = idx(['clicks']);
  const impr = idx([/^impr\.?$/i, 'impressions', /^impr$/i]);
  const cost = idx([/^cost$/i, 'spend', 'amount']);
  const conv = idx(['conversions']);
  const cval = idx([/^conv\. value$/i, 'conversion value', /^conversion value$/i]);
  const name = campaign >= 0 ? String(cells[campaign] || '').trim() : '';
  return {
    campaign_name: name,
    clicks: clicks >= 0 ? Math.max(0, Math.round(parseNum(cells[clicks]))) : 0,
    impressions: impr >= 0 ? Math.max(0, Math.round(parseNum(cells[impr]))) : 0,
    spend: cost >= 0 ? Math.max(0, parseNum(cells[cost])) : NaN,
    conversions: conv >= 0 ? Math.max(0, Math.round(parseNum(cells[conv]))) : 0,
    conversion_value: cval >= 0 ? Math.max(0, parseNum(cells[cval])) : 0,
    ad_set_name: null,
    ad_name: null,
    reach: 0,
    frequency: 0,
    video_views: 0,
  };
}

function parseRowMeta(headers, cells) {
  const H = headers.map(normHeader);
  const idx = (patterns) => pickIdx(H, patterns);
  const cn = idx(['campaign name', /^campaign name$/i]);
  const asn = idx(['ad set name']);
  const an = idx(['ad name']);
  const spent = idx(['amount spent', 'amount spent (usd)']);
  const impr = idx(['impressions']);
  const clk = idx([/^clicks \(all\)$/i, 'link clicks', 'clicks']);
  const res = idx(['results']);
  const roas = idx([/^purchase roas/i, /^roas$/i]);
  const rch = idx(['reach']);
  const freq = idx(['frequency']);
  const vid = idx(['video plays', 'video views', '3-second video plays']);
  const name = cn >= 0 ? String(cells[cn] || '').trim() : '';
  const spendV = spent >= 0 ? parseNum(cells[spent]) : NaN;
  let convVal = 0;
  let roasV = 0;
  if (roas >= 0) roasV = parseNum(cells[roas]);
  if (Number.isFinite(roasV) && roasV > 0 && Number.isFinite(spendV) && spendV > 0) {
    convVal = roasV * spendV;
  }
  return {
    campaign_name: name,
    ad_set_name: asn >= 0 ? String(cells[asn] || '').trim().slice(0, 255) : null,
    ad_name: an >= 0 ? String(cells[an] || '').trim().slice(0, 255) : null,
    clicks: clk >= 0 ? Math.max(0, Math.round(parseNum(cells[clk]))) : 0,
    impressions: impr >= 0 ? Math.max(0, Math.round(parseNum(cells[impr]))) : 0,
    spend: spendV,
    conversions: res >= 0 ? Math.max(0, Math.round(parseNum(cells[res]))) : 0,
    conversion_value: convVal,
    reach: rch >= 0 ? Math.max(0, Math.round(parseNum(cells[rch]))) : 0,
    frequency: freq >= 0 ? parseNum(cells[freq]) : 0,
    video_views: vid >= 0 ? Math.max(0, Math.round(parseNum(cells[vid]))) : 0,
  };
}

function rowsFromCsvBuffer(buf) {
  const text = buf.toString('utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map((h) => normHeader(h));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    rows.push(lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, '')));
  }
  return { headers, rows };
}

function rowsFromXlsxBuffer(buf) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sn = wb.SheetNames[0];
  const sheet = wb.Sheets[sn];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (!data.length) return { headers: [], rows: [] };
  const headers = (data[0] || []).map(normHeader);
  const rows = data.slice(1).map((r) => r.map((c) => String(c ?? '').trim()));
  return { headers, rows };
}

/** ─── POST /import ─── */
router.post('/import', upload.single('file'), async (req, res) => {
  if (!isDatabaseConfigured()) return res.status(503).json({ success: false, error: 'Database not configured' });
  const platform = String(req.body?.platform || '').trim();
  const period_start = String(req.body?.period_start || '').slice(0, 10);
  const period_end = String(req.body?.period_end || '').slice(0, 10);
  const replace = String(req.body?.replace || '') === '1' || String(req.body?.replace || '').toLowerCase() === 'true';
  if (!PLATFORMS.has(platform) || !/^\d{4}-\d{2}-\d{2}$/.test(period_start) || !/^\d{4}-\d{2}-\d{2}$/.test(period_end)) {
    return res.status(400).json({ success: false, error: 'platform, period_start, period_end obrigatórios' });
  }
  if (!req.file?.buffer) {
    return res.status(400).json({ success: false, error: 'file obrigatório' });
  }
  const uid = req.session?.userId ? parseInt(req.session.userId, 10) : null;
  const batchId = `import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const errors = [];
  let imported = 0;
  let skipped = 0;

  try {
    const pool = await getDBConnection();
    if (!(await tableExists(pool, 'ad_spend'))) {
      return res.status(400).json({ success: false, error: 'Rode npm run migrate:marketing-complete' });
    }

    const name = (req.file.originalname || '').toLowerCase();
    let headers;
    let rowCells;
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const p = rowsFromXlsxBuffer(req.file.buffer);
      headers = p.headers;
      rowCells = p.rows;
    } else {
      const p = rowsFromCsvBuffer(req.file.buffer);
      headers = p.headers;
      rowCells = p.rows;
    }

    if (replace) {
      await pool.execute(
        `UPDATE ad_spend SET deleted_at = NOW()
         WHERE deleted_at IS NULL AND platform = ?
           AND period_start = ? AND period_end = ?`,
        [platform, period_start, period_end]
      );
    }

    const isGoogle = platform === 'google_ads';
    const isMetaLike = platform === 'meta' || platform === 'instagram';

    let lineNo = 1;
    for (const cells of rowCells) {
      lineNo++;
      if (!cells.some((c) => String(c).trim())) {
        skipped++;
        continue;
      }
      let parsed;
      if (isGoogle) parsed = parseRowGoogle(headers, cells);
      else if (isMetaLike) parsed = parseRowMeta(headers, cells);
      else parsed = parseRowMeta(headers, cells);

      if (!parsed.campaign_name || !Number.isFinite(parsed.spend) || parsed.spend <= 0) {
        skipped++;
        errors.push(`Linha ${lineNo}: spend inválido ou campanha vazia`);
        continue;
      }

      await pool.execute(
        `INSERT INTO ad_spend (
          platform, campaign_name, ad_set_name, ad_name, period_start, period_end,
          impressions, clicks, spend, conversions, conversion_value,
          reach, frequency, video_views, import_source, import_batch_id, created_by, spend_date
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          platform,
          parsed.campaign_name.slice(0, 255),
          parsed.ad_set_name,
          parsed.ad_name,
          period_start,
          period_end,
          parsed.impressions,
          parsed.clicks,
          round2(parsed.spend),
          parsed.conversions,
          round2(parsed.conversion_value),
          parsed.reach || 0,
          round2(parsed.frequency),
          parsed.video_views || 0,
          'import',
          batchId,
          uid,
          period_end,
        ]
      );
      imported++;
    }

    res.json({ success: true, imported, skipped, errors: errors.slice(0, 50), batch_id: batchId });
  } catch (e) {
    console.error('import marketing', e);
    res.status(500).json({ success: false, error: e.message, batch_id: batchId });
  }
});

/** ─── GET /goals ─── */
router.get('/goals', async (req, res) => {
  if (!isDatabaseConfigured()) return res.status(503).json({ success: false, error: 'Database not configured' });
  const m = (req.query.month || '').trim();
  let monthFirst;
  if (/^\d{4}-\d{2}$/.test(m)) monthFirst = `${m}-01`;
  else {
    const d = new Date();
    monthFirst = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  }
  try {
    const pool = await getDBConnection();
    if (!(await tableExists(pool, 'marketing_goals'))) {
      return res.json({ success: true, data: [], month: monthFirst });
    }
    const [rows] = await pool.query('SELECT * FROM marketing_goals WHERE month = ? ORDER BY platform', [monthFirst]);
    res.json({ success: true, data: rows, month: monthFirst });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** ─── POST /goals (upsert) ─── */
router.post('/goals', async (req, res) => {
  if (!isDatabaseConfigured()) return res.status(503).json({ success: false, error: 'Database not configured' });
  const b = req.body || {};
  let monthFirst = String(b.month || '').trim();
  if (/^\d{4}-\d{2}$/.test(monthFirst)) monthFirst = `${monthFirst}-01`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(monthFirst)) {
    return res.status(400).json({ success: false, error: 'month YYYY-MM ou YYYY-MM-DD' });
  }
  const plat = String(b.platform || 'all').trim();
  if (!['google_ads', 'meta', 'instagram', 'tiktok', 'all'].includes(plat)) {
    return res.status(400).json({ success: false, error: 'platform inválida' });
  }
  const uid = req.session?.userId ? parseInt(req.session.userId, 10) : null;
  try {
    const pool = await getDBConnection();
    await pool.execute(
      `INSERT INTO marketing_goals (
        month, platform, budget_limit, goal_leads, goal_cpl_max, goal_roas_min, goal_cpa_max, notes, created_by
      ) VALUES (?,?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE
        budget_limit = VALUES(budget_limit),
        goal_leads = VALUES(goal_leads),
        goal_cpl_max = VALUES(goal_cpl_max),
        goal_roas_min = VALUES(goal_roas_min),
        goal_cpa_max = VALUES(goal_cpa_max),
        notes = VALUES(notes),
        created_by = COALESCE(VALUES(created_by), created_by)`,
      [
        monthFirst,
        plat,
        b.budget_limit != null && b.budget_limit !== '' ? round2(b.budget_limit) : null,
        b.goal_leads != null && b.goal_leads !== '' ? parseInt(b.goal_leads, 10) : null,
        b.goal_cpl_max != null && b.goal_cpl_max !== '' ? round2(b.goal_cpl_max) : null,
        b.goal_roas_min != null && b.goal_roas_min !== '' ? round2(b.goal_roas_min) : null,
        b.goal_cpa_max != null && b.goal_cpa_max !== '' ? round2(b.goal_cpa_max) : null,
        b.notes != null ? String(b.notes).slice(0, 5000) : null,
        uid,
      ]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** ─── PUT /goals/:id ─── */
router.put('/goals/:id', async (req, res) => {
  if (!isDatabaseConfigured()) return res.status(503).json({ success: false, error: 'Database not configured' });
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
  const b = req.body || {};
  const fields = [];
  const vals = [];
  const map = [
    ['budget_limit', 'budget_limit'],
    ['goal_leads', 'goal_leads'],
    ['goal_cpl_max', 'goal_cpl_max'],
    ['goal_roas_min', 'goal_roas_min'],
    ['goal_cpa_max', 'goal_cpa_max'],
    ['notes', 'notes'],
  ];
  for (const [k, col] of map) {
    if (b[k] === undefined) continue;
    fields.push(`${col} = ?`);
    if (k === 'goal_leads') vals.push(parseInt(b[k], 10) || 0);
    else if (['budget_limit', 'goal_cpl_max', 'goal_roas_min', 'goal_cpa_max'].includes(k)) vals.push(round2(b[k]));
    else vals.push(b[k]);
  }
  if (!fields.length) return res.status(400).json({ success: false, error: 'No fields' });
  vals.push(id);
  try {
    const pool = await getDBConnection();
    await pool.execute(`UPDATE marketing_goals SET ${fields.join(', ')} WHERE id = ?`, vals);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** ─── GET /campaigns ─── */
router.get('/campaigns', async (req, res) => {
  if (!isDatabaseConfigured()) return res.status(503).json({ success: false, error: 'Database not configured' });
  const status = (req.query.status || '').trim();
  const platform = (req.query.platform || '').trim();
  try {
    const pool = await getDBConnection();
    if (!(await tableExists(pool, 'marketing_campaigns'))) {
      return res.json({ success: true, data: [] });
    }
    const w = [];
    const p = [];
    if (status) {
      w.push('status = ?');
      p.push(status);
    }
    if (platform && PLATFORMS.has(platform)) {
      w.push('platform = ?');
      p.push(platform);
    }
    const wsql = w.length ? `WHERE ${w.join(' AND ')}` : '';
    const [rows] = await pool.query(`SELECT * FROM marketing_campaigns ${wsql} ORDER BY id DESC`, p);
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** ─── POST /campaigns ─── */
router.post('/campaigns', async (req, res) => {
  if (!isDatabaseConfigured()) return res.status(503).json({ success: false, error: 'Database not configured' });
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const platform = String(b.platform || '').trim();
  if (!name || !PLATFORMS.has(platform)) {
    return res.status(400).json({ success: false, error: 'name e platform obrigatórios' });
  }
  try {
    const pool = await getDBConnection();
    const [r] = await pool.execute(
      `INSERT INTO marketing_campaigns (name, platform, status, budget_monthly, start_date, end_date, goal, notes)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        name.slice(0, 255),
        platform,
        ['active', 'paused', 'ended'].includes(String(b.status)) ? b.status : 'active',
        b.budget_monthly != null ? round2(b.budget_monthly) : null,
        b.start_date || null,
        b.end_date || null,
        ['leads', 'awareness', 'conversions', 'traffic'].includes(String(b.goal)) ? b.goal : 'leads',
        b.notes != null ? String(b.notes).slice(0, 5000) : null,
      ]
    );
    res.status(201).json({ success: true, id: r.insertId });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** ─── GET /export/leads ─── */
router.get('/export/leads', async (req, res) => {
  if (!isDatabaseConfigured()) return res.status(503).end();
  const end = parseDate(req.query.end_date, new Date().toISOString().slice(0, 10));
  const start = parseDate(req.query.start_date, end);
  try {
    const pool = await getDBConnection();
    let rows;
    try {
      [rows] = await pool.query(
        `SELECT id, name, email, phone, zipcode, source, marketing_platform, utm_source, utm_medium, utm_campaign,
                utm_content, utm_term, utm_adset, utm_ad, status, created_at
         FROM leads WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY) ORDER BY id`,
        [start, end]
      );
    } catch (_) {
      [rows] = await pool.query(
        `SELECT id, name, email, phone, zipcode, source, status, created_at
         FROM leads WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY) ORDER BY id`,
        [start, end]
      );
    }
    const headers = rows.length ? Object.keys(rows[0]) : ['id', 'name', 'email', 'phone', 'zipcode', 'source', 'status', 'created_at'];
    const esc = (v) => {
      if (v == null) return '';
      const s = String(v);
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [headers.join(',')];
    for (const row of rows) {
      lines.push(headers.map((h) => esc(row[h])).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-${start}-${end}.csv"`);
    res.send('\uFEFF' + lines.join('\n'));
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** ─── GET /alerts/not-contacted ─── */
router.get('/alerts/not-contacted', async (req, res) => {
  if (!isDatabaseConfigured()) return res.status(503).json({ success: false, error: 'Database not configured' });
  try {
    const pool = await getDBConnection();
    const [rows] = await pool.query(
      `SELECT l.id, l.name, l.email, l.phone, l.created_at, ps.slug AS stage_slug
       FROM leads l
       LEFT JOIN pipeline_stages ps ON l.pipeline_stage_id = ps.id
       WHERE l.created_at <= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
         AND (
           l.status IN ('new_lead','new','lead_received')
           OR ps.slug IN ('new_lead','lead_received')
           OR (l.status = 'new' AND (ps.slug IS NULL OR ps.slug IN ('new_lead','lead_received')))
         )
       ORDER BY l.created_at ASC
       LIMIT 50`
    );
    res.json({ success: true, data: rows, count: rows.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
