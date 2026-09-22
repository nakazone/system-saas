import { insertChecklistTemplate } from '../../database/seed-project-checklist-templates.js';

export function money(n) {
  const x = parseFloat(n);
  return Number.isFinite(x) ? x : 0;
}

export function moneyRound(n, d = 2) {
  const x = money(n);
  const p = 10 ** d;
  return Math.round(x * p) / p;
}

/** Colunas atuais da tabela `projects` (schema novo ou legado). */
export async function getProjectsTableColumnSet(pool) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects'`
  );
  return new Set((rows || []).map((r) => r.n));
}

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {number} projectId
 */
export async function recalcProjectActualCosts(pool, projectId) {
  const id = parseInt(String(projectId), 10);
  if (!Number.isFinite(id) || id <= 0) return;
  const [[h]] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_costs' AND COLUMN_NAME = 'is_projected'`
  );
  const projFilter = Number(h?.c) > 0 ? 'AND IFNULL(c.is_projected,0)=0' : '';
  await pool.execute(
    `UPDATE projects p SET
      labor_cost_actual = COALESCE((SELECT SUM(c.total_cost) FROM project_costs c WHERE c.project_id = p.id AND c.cost_type = 'labor' ${projFilter}), 0),
      material_cost_actual = COALESCE((SELECT SUM(c.total_cost) FROM project_costs c WHERE c.project_id = p.id AND c.cost_type = 'material' ${projFilter}), 0),
      additional_cost_actual = COALESCE((SELECT SUM(c.total_cost) FROM project_costs c WHERE c.project_id = p.id AND c.cost_type = 'additional' ${projFilter}), 0)
     WHERE p.id = ?`,
    [id]
  );
}

/**
 * Gera PRJ-YYYY-NNN se existir coluna `project_number`; caso contrário devolve `null` (schemas legados).
 * @param {import('mysql2/promise').Pool} pool
 * @returns {Promise<string|null>}
 */
export async function nextProjectNumber(pool) {
  const cols = await getProjectsTableColumnSet(pool);
  if (!cols.has('project_number')) return null;
  const year = new Date().getFullYear();
  const prefix = `PRJ-${year}-`;
  const [rows] = await pool.query(
    `SELECT project_number FROM projects
     WHERE project_number IS NOT NULL AND project_number LIKE ?
     ORDER BY id DESC LIMIT 50`,
    [`${prefix}%`]
  );
  let max = 0;
  const re = new RegExp(`^PRJ-${year}-(\\d+)$`);
  for (const r of rows) {
    const m = String(r.project_number || '').match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const next = max + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {number} projectId
 */
export async function seedChecklistIfEmpty(pool, projectId) {
  const [[{ c }]] = await pool.query(
    'SELECT COUNT(*) AS c FROM project_checklist WHERE project_id = ?',
    [projectId]
  );
  if (Number(c) > 0) return;
  await insertChecklistTemplate(pool, projectId);
}

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {number} projectId
 */
export async function refreshChecklistCompletedFlag(pool, projectId) {
  const [[agg]] = await pool.query(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN checked = 1 THEN 1 ELSE 0 END), 0) AS done
     FROM project_checklist WHERE project_id = ?`,
    [projectId]
  );
  const total = Number(agg.total) || 0;
  const done = Number(agg.done) || 0;
  if (total > 0 && done === total) {
    await pool.execute(
      `UPDATE projects SET checklist_completed = 1,
        checklist_completed_at = COALESCE(checklist_completed_at, NOW())
       WHERE id = ?`,
      [projectId]
    );
  } else {
    await pool.execute(
      'UPDATE projects SET checklist_completed = 0, checklist_completed_at = NULL WHERE id = ?',
      [projectId]
    );
  }
}

/** Normaliza status legado (ex.: enum Hostinger `quoted`) para UI nova. */
function normalizeProjectStatus(s) {
  const v = String(s || '');
  if (v === 'quoted') return 'scheduled';
  return v;
}

/**
 * Monta uma linha de endereço a partir do cadastro `customers` (address, city, state, zipcode).
 * @param {Record<string, unknown>|null|undefined} c
 * @returns {string|null}
 */
export function formatAddressFromCustomer(c) {
  if (!c) return null;
  const line = String(c.address ?? '').trim();
  const city = String(c.city ?? '').trim();
  const state = String(c.state ?? '').trim();
  const zip = String(c.zipcode ?? '').trim();
  const cityState = [city, state].filter(Boolean).join(', ');
  const tail = [cityState, zip].filter(Boolean).join(cityState && zip ? ' ' : '');
  const parts = [];
  if (line) parts.push(line);
  if (tail) parts.push(tail);
  const s = parts.join(' — ').trim();
  return s || null;
}

function trimOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/** Normaliza DATE / ISO do MySQL para `YYYY-MM-DD` (evita "Invalid Date" na UI ao concatenar com `T12:00:00`). */
export function sqlDateToYmd(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  const s = String(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * Junta cadastro do cliente com o lead (rua costuma estar no lead; ZIP só no cliente).
 * @param {Record<string, unknown>|null|undefined} customerRow
 * @param {Record<string, unknown>|null|undefined} leadRow
 */
export function mergeCustomerLeadForAddress(customerRow, leadRow) {
  const c = customerRow || {};
  const l = leadRow || {};
  return {
    address: trimOrNull(c.address) || trimOrNull(l.address),
    city: trimOrNull(c.city),
    state: trimOrNull(c.state),
    zipcode: trimOrNull(c.zipcode) || trimOrNull(l.zipcode),
  };
}

/** Uma linha de endereço a partir de cliente + lead (ex.: projeto com customer_id + lead_id). */
export function formatAddressFromCustomerAndLead(customerRow, leadRow) {
  return formatAddressFromCustomer(mergeCustomerLeadForAddress(customerRow, leadRow));
}

function isZipOnlyProjectAddress(pa) {
  const s = String(pa || '').trim();
  return /^\d{5}(-\d{4})?$/.test(s);
}

/**
 * Prioridade: endereço explícito no projeto; se for só ZIP, prefere linha completa cliente+lead.
 * @param {string|null|undefined} projectAddress
 * @param {Record<string, unknown>|null|undefined} customerRow
 * @param {Record<string, unknown>|null|undefined} [leadRow]
 * @returns {string}
 */
export function resolveProjectAddress(projectAddress, customerRow, leadRow = null) {
  const pa = projectAddress != null ? String(projectAddress).trim() : '';
  const merged = formatAddressFromCustomerAndLead(customerRow, leadRow) || '';

  if (!pa) return merged;
  if (isZipOnlyProjectAddress(pa)) {
    if (merged.length > pa.length) return merged;
    if (/[a-zA-ZÀ-ÿ]/.test(merged) && merged.trim() !== pa) return merged;
  }
  return pa;
}

export function mapListProjectRow(p) {
  const {
    _customer_address,
    _customer_city,
    _customer_state,
    _customer_zipcode,
    _lead_address,
    _lead_zipcode,
    ...rowIn
  } = p;

  const customerForAddr =
    _customer_address != null ||
    _customer_city != null ||
    _customer_state != null ||
    _customer_zipcode != null
      ? {
          address: _customer_address,
          city: _customer_city,
          state: _customer_state,
          zipcode: _customer_zipcode,
        }
      : null;

  const leadForAddr =
    _lead_address != null || _lead_zipcode != null
      ? { address: _lead_address, zipcode: _lead_zipcode }
      : null;

  const leadNumeric = rowIn.lead_id != null ? parseInt(String(rowIn.lead_id), 10) : NaN;
  const hasLead = Number.isFinite(leadNumeric) && leadNumeric > 0;
  const contract = money(rowIn.contract_value ?? rowIn.estimated_cost);
  const labor = money(rowIn.labor_cost_actual);
  const mat = money(rowIn.material_cost_actual);
  const add = money(rowIn.additional_cost_actual);
  let totalCost = labor + mat + add;
  if (totalCost === 0 && rowIn.actual_cost != null && String(rowIn.actual_cost).trim() !== '') {
    totalCost = money(rowIn.actual_cost);
  }
  const gross = contract - totalCost;
  const marginPct = contract > 0 ? moneyRound((gross / contract) * 100, 1) : 0;
  const startDate = sqlDateToYmd(rowIn.start_date ?? rowIn.estimated_start_date ?? null);
  const endEst = sqlDateToYmd(rowIn.end_date_estimated ?? rowIn.estimated_end_date ?? null);
  const completion =
    rowIn.completion_percentage != null && rowIn.completion_percentage !== ''
      ? parseInt(String(rowIn.completion_percentage), 10)
      : rowIn.status === 'completed'
        ? 100
        : 0;
  const resolvedAddress = resolveProjectAddress(rowIn.address, customerForAddr, leadForAddr);
  return {
    ...rowIn,
    address: resolvedAddress || rowIn.address,
    client_type: hasLead ? 'customer' : rowIn.client_type,
    status: normalizeProjectStatus(rowIn.status),
    start_date: startDate,
    end_date_estimated: endEst,
    estimated_start_date: startDate,
    estimated_end_date: endEst,
    checklist_completed: !!(rowIn.checklist_completed === 1 || rowIn.checklist_completed === true),
    contract_value: moneyRound(contract, 2),
    supply_value: moneyRound(money(rowIn.supply_value), 2),
    installation_value: moneyRound(money(rowIn.installation_value), 2),
    sand_finish_value: moneyRound(money(rowIn.sand_finish_value), 2),
    labor_cost_actual: moneyRound(labor, 2),
    material_cost_actual: moneyRound(mat, 2),
    additional_cost_actual: moneyRound(add, 2),
    total_cost_actual: moneyRound(totalCost, 2),
    gross_profit: moneyRound(gross, 2),
    margin_pct: marginPct,
    total_sqft: rowIn.total_sqft != null ? moneyRound(rowIn.total_sqft, 2) : null,
    completion_percentage: Number.isFinite(completion) ? completion : 0,
    photos_count: parseInt(String(rowIn.photos_count ?? 0), 10) || 0,
    checklist_total: parseInt(String(rowIn.checklist_total ?? 0), 10) || 0,
    checklist_done: parseInt(String(rowIn.checklist_done ?? 0), 10) || 0,
  };
}
