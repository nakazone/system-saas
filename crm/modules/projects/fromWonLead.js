/**
 * Cria projeto automaticamente quando o lead passa a `closed_won` (ex.: Kanban, contrato).
 * Idempotente: se já existir projeto para o lead, não duplica.
 */
import { ensureClientFromLead } from '../clients/leadToClient.js';
import {
  nextProjectNumber,
  money,
  seedChecklistIfEmpty,
  getProjectsTableColumnSet,
  formatAddressFromCustomerAndLead,
} from './projectHelpers.js';

async function resolveMonetaryValue(pool, leadId, leadRow) {
  const lid = parseInt(String(leadId), 10);
  const fromLead = money(leadRow.estimated_value);
  try {
    const [est] = await pool.query(
      `SELECT final_price FROM estimates
       WHERE lead_id = ? AND LOWER(TRIM(status)) = 'accepted'
       ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 1`,
      [lid]
    );
    if (est.length && money(est[0].final_price) > 0) return money(est[0].final_price);
  } catch (_) {
    /* tabela/coluna ausente */
  }
  try {
    const [quo] = await pool.query(
      `SELECT total_amount, subtotal, tax_total FROM quotes
       WHERE lead_id = ? AND LOWER(TRIM(status)) IN ('approved','accepted')
       ORDER BY updated_at DESC LIMIT 1`,
      [lid]
    );
    if (quo.length) {
      const q = quo[0];
      const t = money(q.total_amount);
      if (t > 0) return t;
      const alt = money(q.subtotal) + money(q.tax_total);
      if (alt > 0) return alt;
    }
  } catch (_) {
    /* */
  }
  try {
    const [pr] = await pool.query(
      `SELECT total_value FROM proposals
       WHERE lead_id = ? AND LOWER(TRIM(status)) = 'accepted'
       ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 1`,
      [lid]
    );
    if (pr.length && money(pr[0].total_value) > 0) return money(pr[0].total_value);
  } catch (_) {
    /* */
  }
  return fromLead;
}

async function resolveMeasurementHints(pool, leadId) {
  const lid = parseInt(String(leadId), 10);
  let flooringType = null;
  let totalSqft = null;
  try {
    const [meas] = await pool.query(
      `SELECT * FROM measurements WHERE lead_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1`,
      [lid]
    );
    if (meas.length) {
      const m = meas[0];
      totalSqft =
        m.area_sqft != null
          ? money(m.area_sqft)
          : m.final_area != null
            ? money(m.final_area)
            : m.total_sqft != null
              ? money(m.total_sqft)
              : null;
      flooringType = m.flooring_type != null ? String(m.flooring_type) : null;
    }
  } catch (_) {
    /* */
  }
  return { flooringType, totalSqft };
}

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {number} leadId
 * @param {number|null} userId — sessão (opcional)
 * @returns {Promise<{ ok: boolean, skipped?: boolean, reason?: string, project_id?: number, created?: boolean, error?: string }>}
 */
export async function ensureProjectFromWonLead(pool, leadId, userId) {
  const lid = parseInt(String(leadId), 10);
  if (!Number.isFinite(lid) || lid <= 0) {
    return { ok: false, error: 'invalid_lead' };
  }

  const [leads] = await pool.query(
    `SELECT l.*, ps.slug AS pipeline_stage_slug
     FROM leads l
     LEFT JOIN pipeline_stages ps ON l.pipeline_stage_id = ps.id
     WHERE l.id = ?`,
    [lid]
  );
  if (!leads.length) return { ok: false, error: 'lead_not_found' };
  const lead = leads[0];
  // Não usar só pipeline_stage_slug: se status foi atualizado para closed_won mas
  // pipeline_stage_id ficou desalinhado, o JOIN ainda devolve o slug antigo.
  const fromStage = String(lead.pipeline_stage_slug || '')
    .trim()
    .toLowerCase();
  const fromStatus = String(lead.status || '')
    .trim()
    .toLowerCase();
  const isWon = fromStage === 'closed_won' || fromStatus === 'closed_won';
  if (!isWon) {
    return { ok: true, skipped: true, reason: 'not_won' };
  }

  const cols = await getProjectsTableColumnSet(pool);
  if (cols.size === 0) {
    return { ok: false, error: 'projects_table_missing' };
  }

  let existSql = 'SELECT id FROM projects WHERE lead_id = ?';
  if (cols.has('deleted_at')) existSql += ' AND (deleted_at IS NULL)';
  const [existing] = await pool.query(existSql, [lid]);
  if (existing.length) {
    return { ok: true, skipped: true, reason: 'project_exists', project_id: existing[0].id };
  }

  const conv = await ensureClientFromLead(pool, lead, { force: true });
  if (!conv.customer_id) {
    return {
      ok: false,
      error: conv.reason || 'no_customer',
      message:
        conv.reason === 'invalid_email'
          ? 'Email do lead inválido — necessário para criar cliente e projeto.'
          : 'Não foi possível garantir cliente para o projeto.',
    };
  }

  const contractVal = await resolveMonetaryValue(pool, lid, lead);
  const { flooringType, totalSqft } = await resolveMeasurementHints(pool, lid);

  const leadName = String(lead.name || 'Cliente').trim() || 'Cliente';
  const addr =
    String(lead.address || '').trim() ||
    String(lead.zipcode || '').trim() ||
    'Endereço a definir';
  const floorLabel = (flooringType || 'Piso').toString();
  const projectName = `${leadName} - ${floorLabel} - ${addr}`.slice(0, 255);

  const fields = [];
  const vals = [];
  const add = (col, val) => {
    if (!cols.has(col)) return;
    fields.push(`\`${col}\``);
    vals.push(val);
  };

  add('customer_id', conv.customer_id);
  add('lead_id', lid);
  if (cols.has('client_type')) add('client_type', 'customer');
  if (cols.has('builder_id')) add('builder_id', null);
  if (cols.has('builder_name')) add('builder_name', null);
  add('name', projectName);
  if (cols.has('project_number')) {
    add('project_number', await nextProjectNumber(pool));
  }
  const [cr] = await pool.query(
    'SELECT address, city, state, zipcode FROM customers WHERE id = ? LIMIT 1',
    [conv.customer_id]
  );
  const projectAddress =
    formatAddressFromCustomerAndLead(cr[0] || null, lead) ||
    String(lead.address || '').trim() ||
    null;
  add('address', projectAddress);
  if (cols.has('contract_value')) {
    add('contract_value', contractVal);
  }
  if (cols.has('estimated_cost')) {
    add('estimated_cost', contractVal);
  }
  add('flooring_type', flooringType);
  add('total_sqft', totalSqft);
  add('owner_id', lead.owner_id != null ? parseInt(String(lead.owner_id), 10) || null : null);
  add('assigned_to', lead.owner_id != null ? parseInt(String(lead.owner_id), 10) || null : null);
  add('created_by', userId || null);
  add('notes', `Projeto criado automaticamente ao ganhar o lead #${lid}.`.slice(0, 4000));

  if (cols.has('status')) {
    add('status', 'scheduled');
  }

  if (fields.length < 3) {
    return { ok: false, error: 'projects_schema_incompatible' };
  }

  const sql = `INSERT INTO projects (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`;
  const [ins] = await pool.execute(sql, vals);
  const insertId = ins.insertId;

  try {
    await seedChecklistIfEmpty(pool, insertId);
  } catch (_) {
    /* project_checklist pode não existir */
  }

  try {
    await pool.execute(
      `UPDATE quotes SET project_id = ?
       WHERE lead_id = ? AND LOWER(TRIM(status)) IN ('approved','accepted') AND project_id IS NULL`,
      [insertId, lid]
    );
  } catch (_) {
    /* quotes pode não existir */
  }

  return { ok: true, created: true, project_id: insertId };
}
