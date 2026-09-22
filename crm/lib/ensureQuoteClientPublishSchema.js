/**
 * Cópia congelada do quote enviada ao cliente. Idempotente no arranque.
 */
async function columnExists(pool, table, col) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return Number(rows[0]?.c) > 0;
}

export async function ensureQuoteClientPublishSchema(pool) {
  if (!pool) return;
  try {
    if (!(await columnExists(pool, 'quotes', 'client_snapshot_json'))) {
      await pool.query(
        `ALTER TABLE quotes
         ADD COLUMN client_snapshot_json LONGTEXT NULL DEFAULT NULL
         COMMENT 'Cópia do orçamento enviada ao cliente (não atualiza com edições CRM)'`
      );
      console.log('[db] Coluna quotes.client_snapshot_json adicionada.');
    }
  } catch (e) {
    console.warn('[db] ensureQuoteClientPublishSchema:', e.code || e.message);
  }
}
