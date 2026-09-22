/**
 * Resolve Senior Floors project team contacts for the builder portal.
 */
import { resolveUserContact } from './builderAccountManager.js';
import { getProjectsTableColumnSet } from '../modules/projects/projectHelpers.js';

const TEAM_ROLES = [
  {
    key: 'general_manager',
    title: 'General Manager',
    columns: ['general_manager_id', 'project_manager_id', 'assigned_to'],
  },
  {
    key: 'installation_supervisor',
    title: 'Installation Supervisor',
    columns: ['installation_supervisor_id'],
  },
  {
    key: 'sand_finish_supervisor',
    title: 'Sand & Finish Supervisor',
    columns: ['sand_finish_supervisor_id'],
  },
];

function pickUserId(project, columns, colSet) {
  for (const col of columns) {
    if (!colSet.has(col)) continue;
    const v = project[col];
    if (v != null && v !== '' && Number(v) > 0) return Number(v);
  }
  return null;
}

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {Record<string, unknown>} project Raw or normalized project row
 */
export async function resolveProjectTeamForBuilder(pool, project) {
  if (!project) return [];
  const colSet = await getProjectsTableColumnSet(pool);
  const team = [];

  for (const role of TEAM_ROLES) {
    const userId = pickUserId(project, role.columns, colSet);
    let contact = null;
    if (userId) {
      contact = await resolveUserContact(pool, userId);
    }
    team.push({
      role: role.key,
      title: role.title,
      user_id: userId,
      name: contact?.name || null,
      email: contact?.email || null,
      phone: contact?.phone || null,
      avatar_url: contact?.avatar_url || null,
    });
  }

  return team;
}
