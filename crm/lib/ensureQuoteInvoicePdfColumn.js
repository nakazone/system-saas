/**
 * Adiciona quotes.invoice_pdf se faltar — idempotente, corre no arranque.
 * Assim o Railway não depende de npm run migrate:quote-pdf-blob manual.
 */
export async function ensureQuoteInvoicePdfColumn(pool) {
  if (!pool) return;
  try {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotes' AND COLUMN_NAME = 'invoice_pdf'`
    );
    if (rows[0].c > 0) return;
    await pool.query(
      'ALTER TABLE `quotes` ADD COLUMN `invoice_pdf` LONGBLOB NULL DEFAULT NULL COMMENT \'PDF da fatura (persistente)\''
    );
    console.log('[db] Adicionada coluna quotes.invoice_pdf — novos PDFs ficam na base de dados.');
  } catch (e) {
    console.warn('[db] Não foi possível garantir quotes.invoice_pdf:', e.code || e.message);
  }
}
