/**
 * Quotes para lead ou builder + dados do projeto no orçamento. Idempotente no arranque.
 */
async function columnExists(pool, table, col) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return Number(rows[0]?.c) > 0;
}

export async function ensureQuotePartySchema(pool) {
  if (!pool) return;
  try {
    if (!(await columnExists(pool, 'quotes', 'quote_party'))) {
      await pool.query(
        `ALTER TABLE quotes
         ADD COLUMN quote_party ENUM('lead','builder') NOT NULL DEFAULT 'lead'
         COMMENT 'Origem do cliente no orçamento'`
      );
      console.log('[db] Coluna quotes.quote_party adicionada.');
    }
    if (!(await columnExists(pool, 'quotes', 'builder_id'))) {
      await pool.query(
        `ALTER TABLE quotes
         ADD COLUMN builder_id INT NULL DEFAULT NULL
         COMMENT 'builders.id quando quote_party=builder',
         ADD KEY idx_quotes_builder (builder_id)`
      );
      console.log('[db] Coluna quotes.builder_id adicionada.');
    }
    if (!(await columnExists(pool, 'quotes', 'job_name'))) {
      await pool.query(
        `ALTER TABLE quotes
         ADD COLUMN job_name VARCHAR(255) NULL DEFAULT NULL
         COMMENT 'Nome do projeto / obra deste quote'`
      );
      console.log('[db] Coluna quotes.job_name adicionada.');
    }
    if (!(await columnExists(pool, 'quotes', 'job_address'))) {
      await pool.query(
        `ALTER TABLE quotes
         ADD COLUMN job_address VARCHAR(500) NULL DEFAULT NULL
         COMMENT 'Morada do projeto deste quote'`
      );
      console.log('[db] Coluna quotes.job_address adicionada.');
    }
  } catch (e) {
    console.warn('[db] ensureQuotePartySchema:', e.code || e.message);
  }
}
