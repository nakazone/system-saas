/**
 * Cache of `leads` table columns (for optional marketing / UTM fields after migration).
 */
let cache = null;
let cacheTime = 0;
const TTL_MS = 60_000;

export async function getLeadsTableColumns(pool) {
  if (cache && Date.now() - cacheTime < TTL_MS) return cache;
  const [rows] = await pool.query('SHOW COLUMNS FROM leads');
  cache = new Set(rows.map((r) => r.Field));
  cacheTime = Date.now();
  return cache;
}

export function invalidateLeadsColumnCache() {
  cache = null;
}

/**
 * Garante coluna `leads.address` (BD legado sem migração).
 * Requer permissão ALTER na tabela; falha com erro claro se não houver.
 */
export async function ensureLeadsAddressColumn(pool) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'address'`
  );
  if (Number(row?.c) > 0) return;
  try {
    await pool.execute(
      "ALTER TABLE `leads` ADD COLUMN `address` VARCHAR(500) NULL DEFAULT NULL COMMENT 'Endereço completo (linha única)' AFTER `zipcode`"
    );
  } catch (e) {
    const dup = e && e.code === 'ER_DUP_FIELD_NAME';
    const bad = e && e.code === 'ER_BAD_FIELD_ERROR';
    if (dup) {
      /* coluna criada em corrida */
    } else if (bad) {
      await pool.execute(
        "ALTER TABLE `leads` ADD COLUMN `address` VARCHAR(500) NULL DEFAULT NULL COMMENT 'Endereço completo (linha única)'"
      );
    } else {
      throw e;
    }
  }
  invalidateLeadsColumnCache();
}
