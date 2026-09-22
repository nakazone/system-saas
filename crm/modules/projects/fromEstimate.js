import { setLeadPipelineBySlug } from '../../lib/pipelineAutomation.js';
import { ensureClientFromLead } from '../clients/leadToClient.js';
import {
  nextProjectNumber,
  seedChecklistIfEmpty,
  money,
  getProjectsTableColumnSet,
  formatAddressFromCustomerAndLead,
} from './projectHelpers.js';

/**
 * Quando um estimate é aceite: cria projeto se necessário ou sincroniza o existente.
 * @param {import('mysql2/promise').Pool} pool
 * @param {number} estimateId
 * @param {number|null} userId
 */
export async function createOrSyncProjectFromAcceptedEstimate(pool, estimateId, userId) {
  const eid = parseInt(String(estimateId), 10);
  if (!Number.isFinite(eid) || eid <= 0) {
    return { ok: false, error: 'invalid_estimate_id' };
  }

  const [estRows] = await pool.query(
    `SELECT e.*, l.name AS lead_name, l.address AS lead_address, l.zipcode AS lead_zipcode
     FROM estimates e
     LEFT JOIN leads l ON e.lead_id = l.id
     WHERE e.id = ?`,
    [eid]
  );
  if (!estRows.length) {
    return { ok: false, error: 'estimate_not_found' };
  }
  const est = estRows[0];

  let projectId = est.project_id != null ? parseInt(String(est.project_id), 10) : null;

  if (!projectId) {
    const leadId = est.lead_id != null ? parseInt(String(est.lead_id), 10) : null;
    if (!leadId) {
      return { ok: false, error: 'estimate_without_lead' };
    }
    const [leads] = await pool.query(
      `SELECT l.*, ps.slug AS pipeline_stage_slug
       FROM leads l
       LEFT JOIN pipeline_stages ps ON l.pipeline_stage_id = ps.id
       WHERE l.id = ?`,
      [leadId]
    );
    if (!leads.length) {
      return { ok: false, error: 'lead_not_found' };
    }
    const conv = await ensureClientFromLead(pool, leads[0], { force: true });
    if (!conv.customer_id) {
      return { ok: false, error: conv.reason || 'lead_without_customer' };
    }
    const customerId = conv.customer_id;

    let flooringType = null;
    let totalSqft = null;
    const [meas] = await pool.query(
      `SELECT * FROM measurements WHERE lead_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1`,
      [leadId]
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
    if (totalSqft == null && est.adjusted_sqft != null) {
      totalSqft = money(est.adjusted_sqft);
    }
    if (flooringType == null && est.flooring_type != null) {
      flooringType = String(est.flooring_type);
    }

    const leadName = String(est.lead_name || 'Cliente').trim() || 'Cliente';
    const addr =
      String(est.lead_address || '').trim() ||
      [est.lead_zipcode].filter(Boolean).join(' ') ||
      'Endereço a definir';
    const floorLabel = (flooringType || 'Piso').toString();
    const name = `${leadName} - ${floorLabel} - ${addr}`.slice(0, 255);
    const finalPrice = money(est.final_price);
    const pcols = await getProjectsTableColumnSet(pool);
    const pn = await nextProjectNumber(pool);
    const fields = [];
    const insVals = [];
    const addI = (col, val) => {
      if (!pcols.has(col)) return;
      fields.push(`\`${col}\``);
      insVals.push(val);
    };
    addI('customer_id', customerId);
    addI('lead_id', leadId);
    if (pcols.has('client_type')) addI('client_type', 'customer');
    if (pcols.has('builder_id')) addI('builder_id', null);
    if (pcols.has('builder_name')) addI('builder_name', null);
    addI('estimate_id', eid);
    addI('name', name);
    if (pn) addI('project_number', pn);
    const [cr] = await pool.query(
      'SELECT address, city, state, zipcode FROM customers WHERE id = ? LIMIT 1',
      [customerId]
    );
    const projectAddress =
      formatAddressFromCustomerAndLead(cr[0] || null, leads[0]) ||
      String(est.lead_address || '').trim() ||
      null;
    addI('address', projectAddress);
    addI('flooring_type', flooringType);
    addI('total_sqft', totalSqft);
    if (pcols.has('contract_value')) addI('contract_value', finalPrice);
    else if (pcols.has('estimated_cost')) addI('estimated_cost', finalPrice);
    if (pcols.has('status')) addI('status', 'scheduled');
    addI('created_by', userId || null);
    if (fields.length < 3) {
      return { ok: false, error: 'projects_schema_incompatible' };
    }
    const [ins] = await pool.execute(
      `INSERT INTO projects (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`,
      insVals
    );
    projectId = ins.insertId;
    await pool.execute('UPDATE estimates SET project_id = ? WHERE id = ?', [projectId, eid]);
  }

  const [pRows] = await pool.query('SELECT id FROM projects WHERE id = ?', [projectId]);
  if (!pRows.length) {
    return { ok: false, error: 'project_not_found' };
  }

  let flooringType = null;
  let totalSqft = null;
  const leadId = est.lead_id != null ? parseInt(String(est.lead_id), 10) : null;

  if (leadId) {
    const [meas] = await pool.query(
      `SELECT * FROM measurements WHERE lead_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1`,
      [leadId]
    );
    if (meas.length) {
      const m = meas[0];
      totalSqft =
        m.area_sqft != null
          ? money(m.area_sqft)
          : m.final_area != null
            ? money(m.final_area)
            : null;
      flooringType = m.flooring_type != null ? String(m.flooring_type) : null;
    }
  }

  if (totalSqft == null && est.adjusted_sqft != null) {
    totalSqft = money(est.adjusted_sqft);
  }
  if (flooringType == null && est.flooring_type != null) {
    flooringType = String(est.flooring_type);
  }

  const leadName = String(est.lead_name || 'Cliente').trim() || 'Cliente';
  const addr =
    String(est.lead_address || '').trim() ||
    [est.lead_zipcode].filter(Boolean).join(' ') ||
    'Endereço a definir';
  const floorLabel = (flooringType || 'Piso').toString();

  const name = `${leadName} - ${floorLabel} - ${addr}`.slice(0, 255);
  const finalPrice = money(est.final_price);
  const ucols = await getProjectsTableColumnSet(pool);
  const pn = await nextProjectNumber(pool);
  const sets = [];
  const uvals = [];
  if (ucols.has('estimate_id')) {
    sets.push('estimate_id = ?');
    uvals.push(eid);
  }
  if (ucols.has('contract_value')) {
    sets.push('contract_value = ?');
    uvals.push(finalPrice);
  } else if (ucols.has('estimated_cost')) {
    sets.push('estimated_cost = ?');
    uvals.push(finalPrice);
  }
  if (ucols.has('total_sqft')) {
    sets.push('total_sqft = COALESCE(?, total_sqft)');
    uvals.push(totalSqft);
  }
  if (ucols.has('flooring_type')) {
    sets.push('flooring_type = COALESCE(?, flooring_type)');
    uvals.push(flooringType);
  }
  if (ucols.has('name')) {
    sets.push('name = ?');
    uvals.push(name);
  }
  if (pn && ucols.has('project_number')) {
    sets.push(
      'project_number = IF(project_number IS NULL OR TRIM(COALESCE(project_number,\'\')) = \'\', ?, project_number)'
    );
    uvals.push(pn);
  }
  if (leadId) {
    if (ucols.has('client_type')) {
      sets.push('client_type = ?');
      uvals.push('customer');
    }
    if (ucols.has('builder_id')) sets.push('builder_id = NULL');
    if (ucols.has('builder_name')) sets.push('builder_name = NULL');
  }
  if (sets.length) {
    uvals.push(projectId);
    await pool.execute(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`, uvals);
  }

  if (userId) {
    await pool.execute('UPDATE projects SET created_by = COALESCE(created_by, ?) WHERE id = ?', [
      userId,
      projectId,
    ]);
  }

  await seedChecklistIfEmpty(pool, projectId);

  if (leadId) {
    await setLeadPipelineBySlug(leadId, 'production');
  }

  const [out] = await pool.query('SELECT * FROM projects WHERE id = ?', [projectId]);
  return { ok: true, data: out[0] };
}
