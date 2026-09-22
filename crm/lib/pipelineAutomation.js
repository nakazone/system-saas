import { getDBConnection } from '../config/db.js';
import { ensureProjectFromWonLead } from '../modules/projects/fromWonLead.js';

/** Alinhado a routes/leads.js / pipeline-stage-labels.js */
const LEGACY_SLUG_TO_CANONICAL = {
  lead_received: 'new_lead',
  new: 'new_lead',
  contacted: 'stand_by',
  contact_made: 'stand_by',
  qualified: 'stand_by',
  visit_scheduled: 'meeting_scheduled',
  measurement_done: 'follow_up_1',
  followup_1: 'follow_up_1',
  follow_up1: 'follow_up_1',
  'follow-up-1': 'follow_up_1',
  followup1: 'follow_up_1',
  followup_2: 'follow_up_1',
  follow_up2: 'follow_up_1',
  'follow-up-2': 'follow_up_1',
  followup2: 'follow_up_1',
  proposal_created: 'quote_sent',
  proposal_sent: 'quote_sent',
  negotiation: 'follow_up_1',
  closing_attempt: 'follow_up_1',
  closed_won: 'won',
  closed_lost: 'lost',
  production: 'won',
};

const KANBAN_V9_STAGE_DEFS = {
  new_lead: { name: 'New Lead', order_num: 1, color: '#3498db', is_closed: 0 },
  meeting_scheduled: { name: 'Meeting Scheduled', order_num: 2, color: '#90EE90', is_closed: 0 },
  quote_sent: { name: 'Quote Sent', order_num: 3, color: '#9b59b6', is_closed: 0 },
  follow_up_1: { name: 'Follow Up', order_num: 4, color: '#F1C40F', is_closed: 0 },
  stand_by: { name: 'Stand By', order_num: 5, color: '#f39c12', is_closed: 0 },
  won: { name: 'Won', order_num: 6, color: '#27ae60', is_closed: 1 },
  lost: { name: 'Lost', order_num: 7, color: '#c0392b', is_closed: 1 },
};

function normalizePipelineSlug(slug) {
  const s = String(slug || '').trim();
  if (!s) return '';
  if (LEGACY_SLUG_TO_CANONICAL[s]) return LEGACY_SLUG_TO_CANONICAL[s];
  const lower = s.toLowerCase().replace(/\s+/g, '_');
  return LEGACY_SLUG_TO_CANONICAL[lower] || lower || s;
}

async function findPipelineStageRow(pool, slug) {
  const [rows] = await pool.execute(
    'SELECT id, slug, is_closed FROM pipeline_stages WHERE slug = ? ORDER BY order_num LIMIT 1',
    [slug]
  );
  return rows.length ? rows[0] : null;
}

/**
 * Resolve estágio canónico (ex.: quote_sent), incluindo slugs legados (proposal_sent).
 * Cria a linha em pipeline_stages se ainda não existir.
 */
async function ensurePipelineStage(pool, rawSlug) {
  const canonical = normalizePipelineSlug(rawSlug);
  if (!canonical) return null;

  let row = await findPipelineStageRow(pool, canonical);
  if (row) return { id: row.id, slug: canonical, is_closed: row.is_closed };

  const legacySlugs = Object.entries(LEGACY_SLUG_TO_CANONICAL)
    .filter(([, canon]) => canon === canonical)
    .map(([leg]) => leg);
  for (const leg of legacySlugs) {
    row = await findPipelineStageRow(pool, leg);
    if (row) return { id: row.id, slug: canonical, is_closed: row.is_closed };
  }

  const nameHints = {
    quote_sent: ['Quote Sent', 'Proposta Enviada', 'Orcamento enviado', 'Orçamento enviado'],
    follow_up_1: ['Follow Up', 'Follow Up 1', 'Follow-up 1', 'Follow up 1'],
    stand_by: ['Stand By', 'Standby', 'Contacted'],
  };
  const hints = nameHints[canonical];
  if (hints) {
    for (const nm of hints) {
      const [byName] = await pool.execute(
        'SELECT id, slug, is_closed FROM pipeline_stages WHERE name = ? LIMIT 1',
        [nm]
      );
      if (byName.length) {
        return { id: byName[0].id, slug: canonical, is_closed: byName[0].is_closed };
      }
    }
  }

  const def = KANBAN_V9_STAGE_DEFS[canonical];
  if (!def) return null;
  try {
    await pool.execute(
      `INSERT INTO pipeline_stages (name, slug, description, order_num, color, is_closed, is_active)
       VALUES (?, ?, '', ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         order_num = VALUES(order_num),
         color = VALUES(color),
         is_closed = VALUES(is_closed),
         is_active = 1`,
      [def.name, canonical, def.order_num, def.color, def.is_closed]
    );
  } catch (e) {
    console.warn('[pipelineAutomation] ensurePipelineStage insert:', e.message);
  }
  row = await findPipelineStageRow(pool, canonical);
  if (row) return { id: row.id, slug: canonical, is_closed: row.is_closed };
  return null;
}

/**
 * Move lead to pipeline stage by slug (best-effort).
 * @param {number|string} leadId
 * @param {string} slug
 * @param {{ force?: boolean }} [opts] — force=true move mesmo de estágios fechados
 * @returns {Promise<{ ok: boolean, reason?: string, stage_id?: number }>}
 */
export async function setLeadPipelineBySlug(leadId, slug, opts = {}) {
  if (!leadId || !slug) return { ok: false, reason: 'missing_args' };
  const pool = await getDBConnection();
  if (!pool) return { ok: false, reason: 'no_db' };
  try {
    const target = await ensurePipelineStage(pool, slug);
    if (!target) return { ok: false, reason: 'stage_not_found' };

    if (!opts.force) {
      const [cur] = await pool.query(
        `SELECT ps.is_closed AS closed
         FROM leads l
         LEFT JOIN pipeline_stages ps ON ps.id = l.pipeline_stage_id
         WHERE l.id = ? LIMIT 1`,
        [leadId]
      );
      // Não puxar para trás leads já em Won / Lost / outros estágios finais
      if (cur.length && Number(cur[0].closed) === 1 && Number(target.is_closed) !== 1) {
        return { ok: false, reason: 'lead_closed' };
      }
    }

    const [cols] = await pool.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'pipeline_stage_entered_at'`
    );
    const hasEntered = Number(cols[0]?.c) > 0;
    if (hasEntered) {
      await pool.execute(
        `UPDATE leads
         SET pipeline_stage_id = ?, status = ?, pipeline_stage_entered_at = NOW(), updated_at = NOW()
         WHERE id = ?`,
        [target.id, target.slug, leadId]
      );
    } else {
      await pool.execute(
        'UPDATE leads SET pipeline_stage_id = ?, status = ?, updated_at = NOW() WHERE id = ?',
        [target.id, target.slug, leadId]
      );
    }

    if (target.slug === 'closed_won' || target.slug === 'won') {
      try {
        await ensureProjectFromWonLead(pool, leadId, null);
      } catch (e) {
        console.warn('[pipelineAutomation] ensureProjectFromWonLead:', e.message);
      }
    }
    return { ok: true, stage_id: target.id };
  } catch (e) {
    console.warn('[pipelineAutomation]', e.message);
    return { ok: false, reason: e.message };
  }
}

/**
 * Resolve lead_id do orçamento: quotes.lead_id → customers.lead_id → override.
 */
async function resolveLeadIdForQuote(pool, quoteId, overrideLeadId) {
  const override =
    overrideLeadId != null ? parseInt(String(overrideLeadId), 10) : null;
  if (Number.isFinite(override) && override > 0) return override;

  const [rows] = await pool.query(
    `SELECT q.lead_id AS quote_lead_id, c.lead_id AS customer_lead_id
     FROM quotes q
     LEFT JOIN customers c ON c.id = q.customer_id
     WHERE q.id = ? LIMIT 1`,
    [quoteId]
  );
  if (!rows.length) return null;
  const fromQuote =
    rows[0].quote_lead_id != null ? parseInt(String(rows[0].quote_lead_id), 10) : null;
  if (Number.isFinite(fromQuote) && fromQuote > 0) return fromQuote;
  const fromCust =
    rows[0].customer_lead_id != null
      ? parseInt(String(rows[0].customer_lead_id), 10)
      : null;
  if (Number.isFinite(fromCust) && fromCust > 0) return fromCust;
  return null;
}

/**
 * Após envio de orçamento, move o lead ligado para Quote Sent.
 * @param {import('mysql2/promise').Pool} pool
 * @param {number|string} quoteId
 * @param {{ leadId?: number|string|null }} [opts]
 */
export async function moveLeadToQuoteSentForQuote(pool, quoteId, opts = {}) {
  const id = parseInt(String(quoteId), 10);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, reason: 'invalid_id' };
  try {
    const leadId = await resolveLeadIdForQuote(pool, id, opts.leadId);
    if (!leadId) return { ok: false, reason: 'no_lead' };

    // Backfill quotes.lead_id quando veio só do customer
    try {
      await pool.execute(
        'UPDATE quotes SET lead_id = ? WHERE id = ? AND (lead_id IS NULL OR lead_id = 0)',
        [leadId, id]
      );
    } catch (_) {
      /* coluna ausente — ignorar */
    }

    const moved = await setLeadPipelineBySlug(leadId, 'quote_sent');
    if (!moved.ok) {
      console.warn(
        `[pipelineAutomation] moveLeadToQuoteSentForQuote quote=${id} lead=${leadId}:`,
        moved.reason
      );
      return { ok: false, reason: moved.reason, lead_id: leadId };
    }
    return { ok: true, lead_id: leadId, stage_id: moved.stage_id };
  } catch (e) {
    console.warn('[pipelineAutomation] moveLeadToQuoteSentForQuote:', e.message);
    return { ok: false, reason: e.message };
  }
}
