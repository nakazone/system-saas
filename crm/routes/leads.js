/**
 * Leads API — list, get, update (CRM)
 */
import { getDBConnection, isDatabaseConfigured } from '../config/db.js';
import { getLeadsTableColumns } from '../lib/leadColumns.js';
import { extractMarketingFromBody, MARKETING_KEYS } from '../lib/marketingLeadFields.js';
import * as quoteRepo from '../modules/quotes/quoteRepository.js';
import { buildLeadVisitIcs } from '../lib/leadVisitIcs.js';

/** Alinhado a public/pipeline-stage-labels.js — normaliza status legado para slug canonico. */
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

async function findPipelineStageRow(pool, slug) {
  const [rows] = await pool.execute(
    'SELECT id, slug FROM pipeline_stages WHERE slug = ? LIMIT 1',
    [slug]
  );
  return rows.length > 0 ? rows[0] : null;
}

async function resolvePipelineStageForStatus(pool, canonicalSlug) {
  const row = await findPipelineStageRow(pool, canonicalSlug);
  if (row) return { id: row.id, slug: canonicalSlug };
  const legacySlugs = Object.entries(LEGACY_SLUG_TO_CANONICAL)
    .filter(([, canon]) => canon === canonicalSlug)
    .map(([leg]) => leg);
  for (const leg of legacySlugs) {
    const legRow = await findPipelineStageRow(pool, leg);
    if (legRow) return { id: legRow.id, slug: canonicalSlug };
  }
  const nameHints = {
    follow_up_1: ['Follow Up', 'Follow Up 1', 'Follow-up 1', 'Follow up 1'],
    stand_by: ['Stand By', 'Standby', 'Contacted'],
  };
  const hints = nameHints[canonicalSlug];
  if (hints) {
    for (const nm of hints) {
      const [byName] = await pool.execute(
        'SELECT id, slug FROM pipeline_stages WHERE name = ? LIMIT 1',
        [nm]
      );
      if (byName.length > 0) return { id: byName[0].id, slug: canonicalSlug };
    }
  }
  return null;
}

async function ensurePipelineStageForStatus(pool, canonicalSlug) {
  let resolved = await resolvePipelineStageForStatus(pool, canonicalSlug);
  if (resolved) return resolved;
  const def = KANBAN_V9_STAGE_DEFS[canonicalSlug];
  if (!def) return null;
  await pool.execute(
    `INSERT INTO pipeline_stages (name, slug, description, order_num, color, is_closed, is_active)
     VALUES (?, ?, '', ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       order_num = VALUES(order_num),
       color = VALUES(color),
       is_closed = VALUES(is_closed),
       is_active = 1`,
    [def.name, canonicalSlug, def.order_num, def.color, def.is_closed]
  );
  return resolvePipelineStageForStatus(pool, canonicalSlug);
}

function normalizePipelineSlugForDb(slug) {
  const s = String(slug || '').trim();
  if (!s) return '';
  if (LEGACY_SLUG_TO_CANONICAL[s]) return LEGACY_SLUG_TO_CANONICAL[s];
  const lower = s.toLowerCase().replace(/\s+/g, '_');
  return LEGACY_SLUG_TO_CANONICAL[lower] || s;
}

/** Escapa % e _ para uso seguro em LIKE. */
function escapeLikePattern(q) {
  return String(q).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export async function listLeads(req, res) {
  if (!isDatabaseConfigured()) return res.status(503).json({ success: false, error: 'Database not configured' });
  try {
    const pool = await getDBConnection();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const status = req.query.status || null;
    const ownerId = req.query.owner_id || null;
    const pipelineStageId = req.query.pipeline_stage_id || null;
    
    let whereClause = '1=1';
    const params = [];
    
    if (status) {
      whereClause += ' AND l.status = ?';
      params.push(status);
    }
    if (ownerId) {
      whereClause += ' AND l.owner_id = ?';
      params.push(ownerId);
    }
    if (pipelineStageId) {
      whereClause += ' AND l.pipeline_stage_id = ?';
      params.push(pipelineStageId);
    }
    const utmCampaign = (req.query.utm_campaign || '').trim();
    if (utmCampaign) {
      whereClause += ' AND l.utm_campaign = ?';
      params.push(utmCampaign);
    }
    const mPlatform = (req.query.marketing_platform || '').trim();
    if (mPlatform) {
      whereClause += ' AND l.marketing_platform = ?';
      params.push(mPlatform);
    }
    const createdFrom = (req.query.created_from || req.query.date_from || '').trim().slice(0, 10);
    if (createdFrom && /^\d{4}-\d{2}-\d{2}$/.test(createdFrom)) {
      whereClause += ' AND DATE(l.created_at) >= ?';
      params.push(createdFrom);
    }
    const createdTo = (req.query.created_to || req.query.date_to || '').trim().slice(0, 10);
    if (createdTo && /^\d{4}-\d{2}-\d{2}$/.test(createdTo)) {
      whereClause += ' AND DATE(l.created_at) <= ?';
      params.push(createdTo);
    }

    const searchQ = (req.query.q || req.query.search || '').trim();
    if (searchQ) {
      const colSet = await getLeadsTableColumns(pool);
      const idToken = searchQ.replace(/^#/, '').trim();
      const idNum = parseInt(idToken, 10);
      if (idToken && String(idNum) === idToken && idNum > 0) {
        whereClause += ' AND l.id = ?';
        params.push(idNum);
      } else {
        const like = `%${escapeLikePattern(searchQ)}%`;
        const parts = [
          'l.name LIKE ?',
          'l.email LIKE ?',
          'l.phone LIKE ?',
          'CAST(l.id AS CHAR) LIKE ?',
        ];
        const likeParams = [like, like, like, like];
        if (colSet.has('zipcode')) {
          parts.push('l.zipcode LIKE ?');
          likeParams.push(like);
        }
        if (colSet.has('address')) {
          parts.push('l.address LIKE ?');
          likeParams.push(like);
        }
        if (colSet.has('company_name')) {
          parts.push('l.company_name LIKE ?');
          likeParams.push(like);
        }
        whereClause += ` AND (${parts.join(' OR ')})`;
        params.push(...likeParams);
      }
    }

    const [rows] = await pool.query(
      `SELECT l.*, u.name as owner_name, ps.name as pipeline_stage_name, ps.slug as pipeline_stage_slug, ps.color as pipeline_stage_color
       FROM leads l
       LEFT JOIN users u ON l.owner_id = u.id
       LEFT JOIN pipeline_stages ps ON l.pipeline_stage_id = ps.id
       WHERE ${whereClause}
       ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) as total FROM leads l WHERE ${whereClause}`, params);
    res.json({ success: true, data: rows, total, page, limit });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

/** Resumo por lead: e-mail enviado, link aberto, PDF descarregado (orçamentos). */
export async function getLeadsQuoteEngagementSummary(req, res) {
  if (!isDatabaseConfigured()) {
    return res.status(503).json({ success: false, error: 'Database not configured' });
  }
  try {
    const pool = await getDBConnection();
    const cols = await quoteRepo.quoteColumns(pool);
    const selectParts = ['lead_id', 'COUNT(*) AS quote_count'];
    if (cols.has('email_sent_at')) selectParts.push('MAX(email_sent_at) AS quote_email_sent_at');
    if (cols.has('viewed_at')) selectParts.push('MAX(viewed_at) AS quote_viewed_at');
    if (cols.has('pdf_viewed_at')) selectParts.push('MAX(pdf_viewed_at) AS quote_pdf_viewed_at');

    const [rows] = await pool.query(
      `SELECT ${selectParts.join(', ')} FROM quotes WHERE lead_id IS NOT NULL GROUP BY lead_id`
    );

    const data = {};
    for (const r of rows) {
      const id = r.lead_id;
      if (id == null) continue;
      data[id] = {
        quote_count: Number(r.quote_count) || 0,
        email_sent: !!(cols.has('email_sent_at') && r.quote_email_sent_at),
        email_sent_at: r.quote_email_sent_at || null,
        viewed: !!(cols.has('viewed_at') && r.quote_viewed_at),
        viewed_at: r.quote_viewed_at || null,
        pdf_viewed: !!(cols.has('pdf_viewed_at') && r.quote_pdf_viewed_at),
        pdf_viewed_at: r.quote_pdf_viewed_at || null,
      };
    }
    res.json({ success: true, data });
  } catch (e) {
    console.error('getLeadsQuoteEngagementSummary:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getLead(req, res) {
  if (!isDatabaseConfigured()) return res.status(503).json({ error: 'Database not configured' });
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getDBConnection();
    const [rows] = await pool.query(
      `SELECT l.*, u.name AS owner_name, u.email AS owner_email,
              ps.name AS pipeline_stage_name, ps.slug AS pipeline_stage_slug, ps.color AS pipeline_stage_color
       FROM leads l
       LEFT JOIN users u ON l.owner_id = u.id
       LEFT JOIN pipeline_stages ps ON l.pipeline_stage_id = ps.id
       WHERE l.id = ?`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Lead not found' });
    res.json({ success: true, data: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/** .ics inline — abre calendário nativo (iOS/Android/desktop) em vez de forçar download. */
export async function getLeadVisitCalendar(req, res) {
  if (!isDatabaseConfigured()) return res.status(503).send('Database not configured');
  const id = parseInt(req.params.leadId, 10);
  if (!id) return res.status(400).send('Invalid id');
  try {
    const pool = await getDBConnection();
    const [rows] = await pool.query('SELECT * FROM leads WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).send('Lead not found');
    const ics = buildLeadVisitIcs(rows[0]);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="visita-lead.ics"');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(ics);
  } catch (e) {
    console.error('getLeadVisitCalendar:', e);
    res.status(500).send('Error generating calendar');
  }
}

export async function createLead(req, res) {
  if (!isDatabaseConfigured()) return res.status(503).json({ success: false, error: 'Database not configured' });
  
  const {
    name,
    email,
    phone,
    zipcode,
    message,
    source,
    form_type,
    status,
    priority,
    owner_id,
    pipeline_stage_id,
    estimated_value,
    notes,
    ...restBody
  } = req.body;
  
  // Validation
  if (!name || name.trim().length < 2) {
    return res.status(400).json({ success: false, error: 'Name is required (min 2 characters)' });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, error: 'Valid email is required' });
  }
  if (!phone || phone.trim().length < 10) {
    return res.status(400).json({ success: false, error: 'Phone is required' });
  }
  const zipClean = (zipcode || '').replace(/\D/g, '');
  if (!zipClean || zipClean.length < 5) {
    return res.status(400).json({ success: false, error: 'Valid 5-digit zip code is required' });
  }
  
  try {
    const pool = await getDBConnection();
    const userId = req.session?.user?.id;
    
    // Get default pipeline stage if not provided
    let finalPipelineStageId = pipeline_stage_id;
    if (!finalPipelineStageId) {
      const [stages] = await pool.execute(
        "SELECT id FROM pipeline_stages WHERE slug IN ('new_lead','lead_received') ORDER BY FIELD(slug,'new_lead','lead_received') LIMIT 1"
      );
      if (stages.length > 0) {
        finalPipelineStageId = stages[0].id;
      }
    }
    
    const colSet = await getLeadsTableColumns(pool);
    const marketing = extractMarketingFromBody({ ...restBody, ...req.body });
    const cols = [
      'name',
      'email',
      'phone',
      'zipcode',
      'message',
      'source',
      'form_type',
      'status',
      'priority',
      'owner_id',
      'pipeline_stage_id',
      'estimated_value',
      'notes',
    ];
    const vals = [
      name.trim(),
      email.trim(),
      phone.trim(),
      zipClean.slice(0, 5),
      message || null,
      source || 'Manual',
      form_type || 'manual',
      status || 'new_lead',
      priority || 'medium',
      owner_id || userId || null,
      finalPipelineStageId,
      estimated_value || null,
      notes || null,
    ];
    for (const key of MARKETING_KEYS) {
      if (colSet.has(key)) {
        cols.push(key);
        vals.push(marketing[key]);
      }
    }
    const colSql = cols.map((c) => `\`${c}\``).join(', ');
    const qmarks = cols.map(() => '?').join(', ');
    const stageEnteredSql = colSet.has('pipeline_stage_entered_at')
      ? ', `pipeline_stage_entered_at`'
      : '';
    const stageEnteredVal = colSet.has('pipeline_stage_entered_at') ? ', NOW()' : '';
    const [result] = await pool.execute(
      `INSERT INTO leads (${colSql}, \`created_at\`${stageEnteredSql}) VALUES (${qmarks}, NOW()${stageEnteredVal})`,
      vals
    );
    
    // Get created lead
    const [created] = await pool.execute(
      `SELECT l.*, u.name as owner_name, ps.name as pipeline_stage_name, ps.slug as pipeline_stage_slug
       FROM leads l
       LEFT JOIN users u ON l.owner_id = u.id
       LEFT JOIN pipeline_stages ps ON l.pipeline_stage_id = ps.id
       WHERE l.id = ?`,
      [result.insertId]
    );
    
    return res.status(201).json({ success: true, data: created[0], lead_id: result.insertId });
  } catch (error) {
    console.error('Create lead error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export async function updateLead(req, res) {
  if (!isDatabaseConfigured()) return res.status(503).json({ success: false, error: 'Database not configured' });
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
  const body = req.body || {};
  const set = [];
  const values = [];
  
  try {
    const pool = await getDBConnection();
    const colSet = await getLeadsTableColumns(pool);
    const [existingRows] = await pool.query(
      'SELECT pipeline_stage_id, status FROM leads WHERE id = ? LIMIT 1',
      [id]
    );
    if (!existingRows.length) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }
    const currentLead = existingRows[0];
    const OPTIONAL_DIRECT_STRING = [
      'source',
      'form_type',
      'company_name',
      'job_title',
      'city',
      'state',
      'gclid',
      'fbclid',
      'referrer_url',
    ];

    const allowed = [
      'name',
      'email',
      'phone',
      'zipcode',
      ...(colSet.has('address') ? ['address'] : []),
      'message',
      'status',
      'priority',
      'owner_id',
      'pipeline_stage_id',
      'estimated_value',
      'notes',
      ...MARKETING_KEYS.filter((k) => colSet.has(k)),
      ...OPTIONAL_DIRECT_STRING.filter((k) => colSet.has(k)),
    ];
    
    // Status no painel do lead: sempre resolver pipeline_stage_id pelo slug (Kanban usa o id na coluna)
    if (body.status !== undefined && body.status !== null && String(body.status).trim() !== '') {
      const canonical = normalizePipelineSlugForDb(body.status);
      body.status = canonical;
      const resolved = await ensurePipelineStageForStatus(pool, canonical);
      if (resolved) {
        body.pipeline_stage_id = resolved.id;
        body.status = resolved.slug;
      }
    } else if (body.pipeline_stage_id && !body.status) {
      const [stages] = await pool.execute(
        'SELECT slug FROM pipeline_stages WHERE id = ? LIMIT 1',
        [body.pipeline_stage_id]
      );
      if (stages.length > 0) {
        body.status = stages[0].slug;
      }
    }
    
    for (const key of allowed) {
      if (body[key] !== undefined) {
        set.push(`\`${key}\` = ?`);
        let val = body[key];
        if (val === undefined) val = null;
        else if (['owner_id', 'pipeline_stage_id'].includes(key)) val = val === '' || val == null ? null : parseInt(val, 10) || null;
        else if (key === 'estimated_value') val = val === '' || val == null ? null : parseFloat(val) || null;
        else if (key === 'zipcode' && val !== '' && val != null) {
          val = String(val).replace(/\D/g, '').slice(0, 10);
        } else if (key === 'address' && val != null) {
          val = String(val).trim().slice(0, 500) || null;
        } else if (key === 'name' && val != null) val = String(val).trim().slice(0, 255);
        else if (key === 'email' && val != null) val = String(val).trim().slice(0, 255);
        else if (key === 'phone' && val != null) val = String(val).trim().slice(0, 50);
        else if (OPTIONAL_DIRECT_STRING.includes(key)) {
          if (val === '' || val == null) val = null;
          else {
            const max =
              key === 'referrer_url' ? 2000 : key === 'gclid' || key === 'fbclid' ? 255 : 500;
            val = String(val).trim().slice(0, max) || null;
          }
        }
        values.push(val);
      }
    }

    const willName = body.name !== undefined;
    const willEmail = body.email !== undefined;
    const willPhone = body.phone !== undefined;
    if (willName && String(body.name || '').trim().length < 2) {
      return res.status(400).json({ success: false, error: 'Nome deve ter pelo menos 2 caracteres' });
    }
    if (willEmail && body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.email).trim())) {
      return res.status(400).json({ success: false, error: 'Email inválido' });
    }
    if (willPhone && String(body.phone || '').trim().length < 3) {
      return res.status(400).json({ success: false, error: 'Telefone inválido' });
    }
    if (body.zipcode !== undefined) {
      const z = String(body.zipcode || '').replace(/\D/g, '');
      if (z && z.length < 5) {
        return res.status(400).json({ success: false, error: 'ZIP deve ter pelo menos 5 dígitos' });
      }
    }
    
    if (set.length === 0) return res.status(400).json({ success: false, error: 'No fields to update' });

    const stageIdChanged =
      body.pipeline_stage_id !== undefined &&
      parseInt(body.pipeline_stage_id, 10) !== parseInt(currentLead.pipeline_stage_id, 10);
    const statusChanged =
      body.status !== undefined &&
      normalizePipelineSlugForDb(String(body.status || '')) !==
        normalizePipelineSlugForDb(String(currentLead.status || ''));
    if (colSet.has('pipeline_stage_entered_at') && (stageIdChanged || statusChanged)) {
      set.push('`pipeline_stage_entered_at` = NOW()');
    }
    
    values.push(id);
    await pool.execute(`UPDATE leads SET ${set.join(', ')}, updated_at = NOW() WHERE id = ?`, values);
    
    // Get updated lead with joins
    const [rows] = await pool.query(
      `SELECT l.*, u.name as owner_name, ps.name as pipeline_stage_name, ps.slug as pipeline_stage_slug, ps.color as pipeline_stage_color
       FROM leads l
       LEFT JOIN users u ON l.owner_id = u.id
       LEFT JOIN pipeline_stages ps ON l.pipeline_stage_id = ps.id
       WHERE l.id = ?`,
      [id]
    );
    
    return res.json({ success: true, data: rows[0] });
  } catch (e) {
    console.error('Update lead error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
}

async function execIgnoreNoSuchTable(conn, sql, params) {
  try {
    await conn.execute(sql, params);
  } catch (e) {
    if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
  }
}

/** DELETE lead and related rows (best-effort per table). */
export async function deleteLead(req, res) {
  if (!isDatabaseConfigured()) return res.status(503).json({ success: false, error: 'Database not configured' });
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });

  let conn;
  try {
    const pool = await getDBConnection();
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const leadId = id;
    await execIgnoreNoSuchTable(conn, 'DELETE FROM interactions WHERE lead_id = ?', [leadId]);
    await execIgnoreNoSuchTable(conn, 'DELETE FROM tasks WHERE lead_id = ?', [leadId]);
    await execIgnoreNoSuchTable(conn, 'DELETE FROM lead_qualification WHERE lead_id = ?', [leadId]);
    await execIgnoreNoSuchTable(conn, 'DELETE FROM activities WHERE lead_id = ?', [leadId]);
    await execIgnoreNoSuchTable(conn, 'DELETE FROM proposals WHERE lead_id = ?', [leadId]);
    await execIgnoreNoSuchTable(conn, 'DELETE FROM quotes WHERE lead_id = ?', [leadId]);
    await execIgnoreNoSuchTable(conn, 'DELETE FROM estimates WHERE lead_id = ?', [leadId]);
    await execIgnoreNoSuchTable(conn, 'DELETE FROM measurements WHERE lead_id = ?', [leadId]);
    await execIgnoreNoSuchTable(conn, 'DELETE FROM visits WHERE lead_id = ?', [leadId]);

    const [result] = await conn.execute('DELETE FROM leads WHERE id = ?', [leadId]);
    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    await conn.commit();
    return res.json({ success: true, message: 'Lead deleted' });
  } catch (e) {
    if (conn) await conn.rollback();
    console.error('Delete lead error:', e);
    return res.status(500).json({ success: false, error: e.message || 'Failed to delete lead' });
  } finally {
    if (conn) conn.release();
  }
}
