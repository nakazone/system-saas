/**
 * Persiste supply_value / installation_value / sand_finish_value no projeto a partir das linhas do quote.
 */
import { getProjectsTableColumnSet } from '../modules/projects/projectHelpers.js';
import { sumQuoteItemsRevenueByCategory } from './quoteRevenueSplit.js';

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {number} projectId
 * @param {number} quoteId
 */
export async function applyQuoteLineRevenueToProject(pool, projectId, quoteId) {
  const pid = parseInt(String(projectId), 10);
  const qid = parseInt(String(quoteId), 10);
  if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(qid) || qid <= 0) return;

  const cols = await getProjectsTableColumnSet(pool);
  if (!cols.has('supply_value') || !cols.has('installation_value') || !cols.has('sand_finish_value')) {
    return;
  }

  let items = [];
  try {
    const [rows] = await pool.query('SELECT * FROM quote_items WHERE quote_id = ?', [qid]);
    items = rows || [];
  } catch (e) {
    if (e && e.code === 'ER_NO_SUCH_TABLE') return;
    throw e;
  }

  const { revSupply, revInst, revSand, lineTotal } = sumQuoteItemsRevenueByCategory(items);
  if (lineTotal <= 0.005) return;

  await pool.execute(
    `UPDATE projects SET supply_value = ?, installation_value = ?, sand_finish_value = ? WHERE id = ?`,
    [revSupply, revInst, revSand, pid]
  );
}
