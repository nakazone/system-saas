/**
 * Normaliza o papel da BD (espaços, variantes PT) para a chave em ROLE_DEFAULT_PERMISSION_KEYS.
 */
export function normalizeRoleForPermissions(role) {
  let r = String(role || 'sales_rep')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_');
  const aliases = {
    gestor_de_projeto: 'project_manager',
    gestor_de_projetos: 'project_manager',
    gestor_projeto: 'project_manager',
    projectmanager: 'project_manager',
    pm: 'project_manager',
    user: 'sales_rep',
    comercial: 'sales_rep',
    vendedor: 'sales_rep',
  };
  return aliases[r] || r;
}

/**
 * Permissões por papel quando não há linhas em user_permissions (compatibilidade).
 * Admin: null = todas as chaves da tabela permissions.
 */
export const ROLE_DEFAULT_PERMISSION_KEYS = {
  sales_rep: [
    'dashboard.view',
    'reports.view',
    'leads.view',
    'leads.create',
    'leads.edit',
    'leads.assign',
    'pipeline.view',
    'pipeline.edit',
    'customers.view',
    'customers.create',
    'customers.edit',
    'quotes.view',
    'quotes.create',
    'quotes.edit',
    'visits.view',
    'visits.create',
    'visits.edit',
    'activities.view',
    'activities.create',
    'contracts.view',
    /* Folha de obra: ver + lançar dias/horas/quadro (mesma equipa operacional que orçamentos) */
    'payroll.view',
    'payroll.manage',
  ],
  project_manager: [
    'dashboard.view',
    'reports.view',
    'leads.view',
    'customers.view',
    'customers.create',
    'customers.edit',
    'projects.view',
    'projects.create',
    'projects.edit',
    'projects.delete',
    'projects.update_status',
    'builders.view',
    'builders.edit',
    'payroll.view',
    'payroll.manage',
    'visits.view',
    'visits.create',
    'visits.edit',
    'quotes.view',
    'activities.view',
    'contracts.view',
  ],
  support: [
    'dashboard.view',
    'reports.view',
    'leads.view',
    'customers.view',
    'activities.view',
    'activities.create',
  ],
};

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {number} userId
 * @param {string} role
 * @returns {Promise<string[]>}
 */
export async function resolvePermissionKeysForUser(pool, userId, role) {
  const raw = String(role || '').toLowerCase().trim();
  if (raw === 'admin') {
    try {
      const [all] = await pool.query('SELECT permission_key FROM permissions ORDER BY permission_group, id');
      return (all || []).map((x) => x.permission_key).filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  const r = normalizeRoleForPermissions(role);

  let fromDb = [];
  try {
    const [rows] = await pool.query(
      `SELECT p.permission_key
       FROM user_permissions up
       INNER JOIN permissions p ON p.id = up.permission_id
       WHERE up.user_id = ? AND up.granted = 1
       ORDER BY p.permission_group, p.id`,
      [userId]
    );
    fromDb = (rows || []).map((x) => x.permission_key).filter(Boolean);
  } catch (_) {
    /* tabela pode não existir */
  }

  const defaults = ROLE_DEFAULT_PERMISSION_KEYS[r] || ROLE_DEFAULT_PERMISSION_KEYS.sales_rep;
  /* Unir padrão do papel com o que veio da matriz — evita perder payroll.manage etc. quando há user_permissions parcial. */
  if (fromDb.length > 0) {
    return [...new Set([...(defaults || []), ...fromDb])];
  }

  return defaults;
}

/**
 * @param {string[]} keys
 * @param {string} required
 */
export function permissionKeysInclude(keys, required) {
  if (!required) return true;
  return Array.isArray(keys) && keys.includes(required);
}
