/** Builder ? project linking (projects.builder_id = customers.id, with fallbacks). */
import { sqlNotDeletedAt } from './financialEngine.js';
import { getProjectsTableColumnSet } from '../modules/projects/projectHelpers.js';

/** Logical API field ? physical column candidates (legacy schemas first match wins). */
const PROJECT_SELECT_ALIASES = {
  id: ['id'],
  name: ['name'],
  address: ['address'],
  status: ['status'],
  contract_value: ['contract_value', 'estimated_cost'],
  completion_percentage: ['completion_percentage', 'progress_percentage'],
  start_date: ['start_date', 'estimated_start_date', 'actual_start_date'],
  end_date_estimated: ['end_date_estimated', 'estimated_end_date', 'end_date'],
  end_date_actual: ['end_date_actual', 'actual_end_date'],
  flooring_type: ['flooring_type'],
  total_sqft: ['total_sqft'],
  project_number: ['project_number'],
  service_type: ['service_type'],
  assigned_to: ['assigned_to', 'owner_id', 'project_manager_id'],
  notes: ['notes', 'internal_notes'],
  updated_at: ['updated_at', 'created_at'],
};

export async function buildProjectSelectSql(pool, fields, alias = 'p') {
  const cols = await getProjectsTableColumnSet(pool);
  return fields
    .map((logical) => {
      const candidates = PROJECT_SELECT_ALIASES[logical] || [logical];
      const physical = candidates.find((c) => cols.has(c));
      if (physical) {
        return physical === logical ? `${alias}.${physical}` : `${alias}.${physical} AS ${logical}`;
      }
      return `NULL AS ${logical}`;
    })
    .join(', ');
}

export async function buildProjectOrderSql(pool, prefer = 'end_date_actual', alias = 'p') {
  const cols = await getProjectsTableColumnSet(pool);
  const preferCandidates = PROJECT_SELECT_ALIASES[prefer] || [prefer];
  const preferCol = preferCandidates.find((c) => cols.has(c));
  const fallbackCol = cols.has('updated_at') ? 'updated_at' : cols.has('created_at') ? 'created_at' : 'id';
  if (preferCol) return `COALESCE(${alias}.${preferCol}, ${alias}.${fallbackCol})`;
  return `${alias}.${fallbackCol}`;
}

/** Map a raw projects row to canonical API field names (legacy + new schemas). */
export function normalizeProjectRow(row) {
  if (!row) return row;
  const pick = (logical) => {
    if (row[logical] != null && row[logical] !== '') return row[logical];
    const candidates = PROJECT_SELECT_ALIASES[logical] || [];
    for (const c of candidates) {
      if (c !== logical && row[c] != null && row[c] !== '') return row[c];
    }
    return null;
  };
  return {
    ...row,
    contract_value: pick('contract_value'),
    completion_percentage: pick('completion_percentage'),
    start_date: pick('start_date'),
    end_date_estimated: pick('end_date_estimated'),
    end_date_actual: pick('end_date_actual'),
    flooring_type: pick('flooring_type'),
    total_sqft: pick('total_sqft'),
    project_number: pick('project_number'),
    service_type: pick('service_type'),
    assigned_to: pick('assigned_to'),
    notes: pick('notes'),
  };
}

async function columnExists(pool, table, col) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return Number(rows[0]?.c) > 0;
}

async function tableExists(pool, name) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [name]
  );
  return Number(rows[0]?.c) > 0;
}

export async function getProjectBuilderLinkMeta(pool) {
  const [hasBuilderId, hasClientType, hasCustomerId, hasPartnerBuilderId, hasDeletedAt, hasBuilderProjects] =
    await Promise.all([
      columnExists(pool, 'projects', 'builder_id'),
      columnExists(pool, 'projects', 'client_type'),
      columnExists(pool, 'projects', 'customer_id'),
      columnExists(pool, 'projects', 'partner_builder_id'),
      columnExists(pool, 'projects', 'deleted_at'),
      tableExists(pool, 'builder_projects'),
    ]);
  return {
    hasBuilderId,
    hasClientType,
    hasCustomerId,
    hasPartnerBuilderId,
    hasDeletedAt,
    hasBuilderProjects,
  };
}

/** Correlated match: project row ? builders alias (e.g. p, b). */
export function buildProjectBuilderCorrelatedMatch(projectAlias, builderAlias, meta) {
  const parts = [];
  if (meta.hasBuilderId) {
    parts.push(`${projectAlias}.builder_id = ${builderAlias}.customer_id`);
  }
  if (meta.hasCustomerId && meta.hasClientType) {
    parts.push(
      `(${projectAlias}.customer_id = ${builderAlias}.customer_id AND (${projectAlias}.client_type = 'builder' OR ${projectAlias}.client_type IS NULL))`
    );
  } else if (meta.hasCustomerId) {
    parts.push(`${projectAlias}.customer_id = ${builderAlias}.customer_id`);
  }
  if (meta.hasPartnerBuilderId) {
    parts.push(`${projectAlias}.partner_builder_id = ${builderAlias}.id`);
  }
  if (meta.hasBuilderProjects) {
    parts.push(
      `EXISTS (SELECT 1 FROM builder_projects bp WHERE bp.project_id = ${projectAlias}.id AND bp.builder_id = ${builderAlias}.id)`
    );
  }
  return parts.length ? `(${parts.join(' OR ')})` : '0=1';
}

/** Parameterized match for a single builder (portal APIs). */
export function buildProjectBuilderMatch(projectAlias, builderId, customerId, meta) {
  const parts = [];
  const params = [];
  if (meta.hasBuilderId && customerId != null) {
    parts.push(`${projectAlias}.builder_id = ?`);
    params.push(customerId);
  }
  if (meta.hasCustomerId && customerId != null) {
    if (meta.hasClientType) {
      parts.push(
        `(${projectAlias}.customer_id = ? AND (${projectAlias}.client_type = 'builder' OR ${projectAlias}.client_type IS NULL))`
      );
    } else {
      parts.push(`${projectAlias}.customer_id = ?`);
    }
    params.push(customerId);
  }
  if (meta.hasPartnerBuilderId && builderId != null) {
    parts.push(`${projectAlias}.partner_builder_id = ?`);
    params.push(builderId);
  }
  if (meta.hasBuilderProjects && builderId != null) {
    parts.push(
      `EXISTS (SELECT 1 FROM builder_projects bp WHERE bp.project_id = ${projectAlias}.id AND bp.builder_id = ?)`
    );
    params.push(builderId);
  }
  return {
    sql: parts.length ? `(${parts.join(' OR ')})` : '0=1',
    params,
  };
}

export function projectNotDeletedClause(projectAlias, meta) {
  if (!meta.hasDeletedAt) return '';
  return ` AND ${sqlNotDeletedAt(projectAlias)}`;
}

export async function getBuilderCustomerId(pool, builderId) {
  const [rows] = await pool.query('SELECT customer_id FROM builders WHERE id = ? LIMIT 1', [builderId]);
  const cid = rows[0]?.customer_id;
  return cid != null ? Number(cid) : null;
}

export async function assertBuilderOwnsProject(pool, builderId, projectId) {
  const customerId = await getBuilderCustomerId(pool, builderId);
  const meta = await getProjectBuilderLinkMeta(pool);
  const match = buildProjectBuilderMatch('p', builderId, customerId, meta);
  const [rows] = await pool.query(
    `SELECT p.* FROM projects p
     WHERE p.id = ? AND ${match.sql}${projectNotDeletedClause('p', meta)}`,
    [projectId, ...match.params]
  );
  return rows[0] || null;
}

export function photoPublicUrl(row) {
  const fu = row.file_url != null ? String(row.file_url).trim() : '';
  if (fu) return fu.startsWith('/') ? fu : `/${fu}`;
  const fp = String(row.file_path || '').replace(/^\//, '');
  return fp ? `/uploads/${fp}` : '';
}
