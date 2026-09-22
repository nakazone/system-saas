/**
 * Adiciona quotes.pdf_viewed_at se faltar — idempotente, corre no arranque.
 */
export async function ensureQuotePdfViewedColumn(pool) {
  if (!pool) return;
  try {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotes' AND COLUMN_NAME = 'pdf_viewed_at'`
    );
    if (rows[0].c > 0) return;
    await pool.query(
      'ALTER TABLE `quotes` ADD COLUMN `pdf_viewed_at` DATETIME NULL DEFAULT NULL COMMENT \'Cliente descarregou PDF na página pública\''
    );
    console.log('[db] Adicionada coluna quotes.pdf_viewed_at');
  } catch (e) {
    console.warn('[db] Não foi possível garantir quotes.pdf_viewed_at:', e.code || e.message);
  }
}
